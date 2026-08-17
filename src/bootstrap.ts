import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { DSH_PACKAGE_NAME, DSH_RUNTIME_NAME, DSH_VERSION, resolveHarnessPaths, type HarnessPaths, type PathOptions } from './config';
import { commandFailure, redactSensitive, runCommand, withoutCredentials, type CommandResult, type CommandRunner } from './process';
import { pathExists } from './project';

const KOFFI_LOAD_EXPRESSION = "import('koffi').then(() => process.exit(0)).catch(() => process.exit(1))";
const PACKAGE_SPEC = `${DSH_PACKAGE_NAME}@${DSH_VERSION}`;

export interface BootstrapOptions extends PathOptions {
  bunExecutable?: string;
  commandRunner?: CommandRunner;
  now?: () => Date;
}

export interface RuntimeVerification {
  valid: boolean;
  errors: string[];
  dshPackageVersion?: string;
  dshExecutable?: string;
  koffiLoaded: boolean;
}

export interface BootstrapResult {
  status: 'unchanged' | 'installed' | 'repaired';
  runtimeDir: string;
  rollbackDir?: string;
  verification: RuntimeVerification;
}

export class BootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapError';
  }
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}

async function readJson(path: string): Promise<JsonObject | undefined> {
  try {
    return asObject(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    return undefined;
  }
}

async function packagePath(runtimeDir: string): Promise<string> {
  return join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
}

async function findExistingPath(candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return undefined;
}

export async function findDshExecutable(runtimeDir: string, platform: string = process.platform): Promise<string | undefined> {
  const packageJsonPath = await packagePath(runtimeDir);
  const packageJson = await readJson(packageJsonPath);
  const packageDirectory = dirname(packageJsonPath);
  const bin = packageJson?.bin;
  const packageBins = asObject(bin);
  const packageBin = typeof bin === 'string'
    ? bin
    : packageBins?.dsh ?? Object.values(packageBins ?? {}).find((value): value is string => typeof value === 'string');
  const candidates: string[] = [];
  const windowsPackageFallbacks: string[] = [];
  if (typeof packageBin === 'string') {
    const base = resolve(packageDirectory, packageBin);
    if (platform === 'win32') {
      candidates.push(`${base}.cmd`, `${base}.exe`, `${base}.ps1`);
      windowsPackageFallbacks.push(base);
    } else {
      candidates.push(base);
    }
  }
  const dotBin = join(runtimeDir, 'node_modules', '.bin', 'dsh');
  if (platform === 'win32') {
    candidates.push(`${dotBin}.cmd`, `${dotBin}.exe`, `${dotBin}.ps1`, dotBin, ...windowsPackageFallbacks);
  } else {
    candidates.push(dotBin);
  }
  return findExistingPath(candidates);
}

function versionFromPackage(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export async function verifyRuntime(runtimeDirInput: string, options: Pick<BootstrapOptions, 'bunExecutable' | 'commandRunner' | 'env' | 'platform'> = {}): Promise<RuntimeVerification> {
  const runtimeDir = resolve(runtimeDirInput);
  const errors: string[] = [];
  let dshPackageVersion: string | undefined;
  let dshExecutable: string | undefined;
  let koffiLoaded = false;

  const rootPackage = await readJson(join(runtimeDir, 'package.json'));
  const dependencies = asObject(rootPackage?.dependencies);
  if (dependencies?.[DSH_PACKAGE_NAME] !== DSH_VERSION) {
    errors.push(`runtime dependency ${DSH_PACKAGE_NAME}@${DSH_VERSION} is not pinned in package.json`);
  }

  const dshPackage = await readJson(await packagePath(runtimeDir));
  dshPackageVersion = versionFromPackage(dshPackage?.version);
  if (dshPackageVersion !== DSH_VERSION) errors.push(`installed DSH version is ${dshPackageVersion ?? 'missing'}, expected ${DSH_VERSION}`);

  dshExecutable = await findDshExecutable(runtimeDir, options.platform ?? process.platform);
  if (!dshExecutable) errors.push('installed DSH executable was not found');

  const koffiPackage = await findExistingPath([
    join(runtimeDir, 'node_modules', 'koffi', 'package.json'),
    join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', 'koffi', 'package.json')
  ]);
  if (!koffiPackage) errors.push('installed koffi package was not found');

  if (errors.length === 0) {
    const runner = options.commandRunner ?? runCommand;
    const bunExecutable = options.bunExecutable ?? 'bun';
    try {
      const result = await runner(bunExecutable, ['-e', KOFFI_LOAD_EXPRESSION], {
        cwd: runtimeDir,
        env: options.env,
        timeoutMs: 60_000
      });
      koffiLoaded = result.exitCode === 0;
      if (!koffiLoaded) errors.push('koffi could not be loaded by Bun');
    } catch {
      errors.push('Bun could not load koffi; verify that Bun is installed and trusted dependencies are complete');
    }
  }

  return { valid: errors.length === 0, errors, dshPackageVersion, dshExecutable, koffiLoaded };
}

async function createStagingRuntime(runtimeDir: string, now: () => Date): Promise<string> {
  const stamp = now().toISOString().replace(/[-:.TZ]/g, '');
  const staging = join(dirname(runtimeDir), `.${basename(runtimeDir)}.staging-${stamp}-${Math.random().toString(16).slice(2)}`);
  await mkdir(staging, { recursive: true });
  await writeFile(join(staging, 'package.json'), `${JSON.stringify({
    name: DSH_RUNTIME_NAME,
    private: true,
    dependencies: { [DSH_PACKAGE_NAME]: DSH_VERSION }
  }, null, 2)}\n`);
  return staging;
}

function failedCommand(command: string, args: string[], result: CommandResult, env?: Record<string, string | undefined>): BootstrapError {
  return new BootstrapError(commandFailure(command, args, result, env).message);
}

async function runRequired(
  runner: CommandRunner,
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string | undefined> | undefined,
  label: string,
  redactionEnv: Record<string, string | undefined> | undefined = env
): Promise<void> {
  let result: CommandResult;
  try {
    result = await runner(command, args, { cwd, env, timeoutMs: 15 * 60_000 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new BootstrapError(`${label} could not start. Install or repair Bun, then retry: ${redactSensitive(detail, redactionEnv)}`);
  }
  if (result.exitCode !== 0) throw failedCommand(command, args, result, redactionEnv);
}

async function swapRuntime(staging: string, runtimeDir: string, now: () => Date): Promise<string | undefined> {
  await mkdir(dirname(runtimeDir), { recursive: true });
  const hadRuntime = await pathExists(runtimeDir);
  let rollbackDir: string | undefined;
  if (hadRuntime) {
    const stamp = now().toISOString().replace(/[-:.TZ]/g, '');
    rollbackDir = join(dirname(runtimeDir), `${basename(runtimeDir)}.rollback-${stamp}-${Math.random().toString(16).slice(2)}`);
    await rename(runtimeDir, rollbackDir);
  }

  try {
    await rename(staging, runtimeDir);
  } catch (error) {
    if (rollbackDir && await pathExists(rollbackDir) && !(await pathExists(runtimeDir))) {
      await rename(rollbackDir, runtimeDir);
    }
    throw new BootstrapError(`Runtime swap failed; current runtime was not changed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return rollbackDir;
}

export async function bootstrapRuntime(options: BootstrapOptions = {}): Promise<BootstrapResult> {
  const paths: HarnessPaths = resolveHarnessPaths(options);
  const runtimeDir = paths.runtimeDir;
  const env = options.env ?? process.env;
  const commandEnv = withoutCredentials(env);
  const runner = options.commandRunner ?? runCommand;
  const bunExecutable = options.bunExecutable ?? env.BUN_EXECUTABLE ?? 'bun';
  const now = options.now ?? (() => new Date());
  const existing = await verifyRuntime(runtimeDir, { bunExecutable, commandRunner: runner, env: commandEnv, platform: options.platform });

  if (existing.valid) {
    return { status: 'unchanged', runtimeDir, verification: existing };
  }

  let staging: string | undefined;
  try {
    staging = await createStagingRuntime(runtimeDir, now);
    await runRequired(runner, bunExecutable, ['add', '--exact', PACKAGE_SPEC], staging, commandEnv, 'DSH runtime installation', env);
    await runRequired(runner, bunExecutable, ['pm', 'trust', '--all'], staging, commandEnv, 'native dependency trust', env);

    const staged = await verifyRuntime(staging, { bunExecutable, commandRunner: runner, env: commandEnv, platform: options.platform });
    if (!staged.valid) {
      throw new BootstrapError(`Runtime verification failed: ${staged.errors.join('; ')}. The current runtime was not changed.`);
    }

    const wasPresent = await pathExists(runtimeDir);
    const rollbackDir = await swapRuntime(staging, runtimeDir, now);
    staging = undefined;
    const verification = await verifyRuntime(runtimeDir, { bunExecutable, commandRunner: runner, env: commandEnv, platform: options.platform });
    if (!verification.valid) {
      // The staged tree was already verified, but do not leave a broken active tree if the filesystem changed during swap.
      await rm(runtimeDir, { recursive: true, force: true });
      if (rollbackDir && await pathExists(rollbackDir)) await rename(rollbackDir, runtimeDir);
      throw new BootstrapError(`Post-swap runtime verification failed: ${verification.errors.join('; ')}. The current runtime was restored.`);
    }
    return {
      status: wasPresent ? 'repaired' : 'installed',
      runtimeDir,
      rollbackDir,
      verification
    };
  } catch (error) {
    if (staging) await rm(staging, { recursive: true, force: true });
    if (error instanceof BootstrapError) throw error;
    throw new BootstrapError(`Bootstrap failed; existing runtime was not changed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export { KOFFI_LOAD_EXPRESSION, PACKAGE_SPEC };
