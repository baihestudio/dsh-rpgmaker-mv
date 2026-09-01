import { cp, mkdir, readFile, realpath, rename as fsRename, rm } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import { type HarnessPaths, type PathOptions } from './config';
import { commandFailure, redactSensitive, runCommand, withoutCredentials, type CommandRunner } from './process';
import { pathExists } from './project';
import { withHarnessOperationLock } from './lock';
import { resolveReceiptBackedHarnessPaths } from './installation-root';

/** Exact-pinned app-owned MCPorter runtime (Host MCP client pool). */
export const MCPORTER_PACKAGE = 'mcporter';
export const MCPORTER_VERSION = '0.12.3';
export const MCPORTER_NPM_INTEGRITY = 'sha512-FD6nV4AzrsJSYtIqkLE0emNNiVl0p9W2bJosORAhmI5HCfcz2fc0WjmaY26bfFRW+2aCNL3aCssoFRjcYcQjgQ==';
export const MCPORTER_RUNTIME_RELATIVE = join('runtime', 'mcporter');
export const MCPORTER_MANIFEST_RELATIVE = join('runtime-manifests', 'mcporter');
export const MCPORTER_ENTRYPOINT = join('dist', 'index.js');

export interface McporterRuntimeOptions extends PathOptions {
  nodeExecutable?: string;
  npmExecutable?: string;
  /** Release-owned package.json/package-lock.json used for npm ci. */
  manifestRoot?: string;
  commandRunner?: CommandRunner;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
}

export interface McporterRuntimeVerification {
  valid: boolean;
  errors: string[];
  packageVersion?: string;
  packageDir?: string;
  entrypoint?: string;
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

async function readNpmLock(path: string): Promise<JsonObject | undefined> {
  try {
    const content = await readFile(path, 'utf8');
    return asObject(JSON.parse(content));
  } catch {
    return undefined;
  }
}

function packageDirectory(runtimeDir: string): string {
  return join(runtimeDir, 'node_modules', MCPORTER_PACKAGE);
}

/** The app-owned MCPorter runtime directory under a program root. */
export function mcporterRuntimeDirFor(paths: HarnessPaths): string {
  return join(paths.programRoot, MCPORTER_RUNTIME_RELATIVE);
}

async function findMcporterEntry(runtimeDir: string): Promise<string | undefined> {
  const packageDir = packageDirectory(runtimeDir);
  const candidate = resolve(packageDir, MCPORTER_ENTRYPOINT);
  if (!(await pathExists(candidate))) return undefined;
  let runtimeRoot: string;
  try {
    runtimeRoot = await realpath(runtimeDir);
    const target = await realpath(candidate);
    const pathFromRoot = relative(runtimeRoot, target);
    if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`)) return undefined;
  } catch {
    return undefined;
  }
  return candidate;
}

/** Verify the exact-pinned mcporter install and its npm lock integrity. */
export async function verifyMcporterRuntime(
  runtimeDirInput: string,
  platform: string = process.platform
): Promise<McporterRuntimeVerification> {
  const runtimeDir = resolve(runtimeDirInput);
  const errors: string[] = [];
  const rootPackage = await readJson(join(runtimeDir, 'package.json'));
  const dependencies = asObject(rootPackage?.dependencies);
  if (dependencies?.[MCPORTER_PACKAGE] !== MCPORTER_VERSION) {
    errors.push(`MCPorter dependency ${MCPORTER_PACKAGE}@${MCPORTER_VERSION} is not pinned`);
  }
  const lock = await readNpmLock(join(runtimeDir, 'package-lock.json'));
  const lockRoot = asObject(asObject(lock?.packages)?.['']);
  const lockedPackage = asObject(asObject(lock?.packages)?.[`node_modules/${MCPORTER_PACKAGE}`]);
  const lockedDependency = asObject(lockRoot?.dependencies)?.[MCPORTER_PACKAGE];
  if (!lock) errors.push('MCPorter package-lock.json is missing or invalid');
  else if (lockedDependency !== MCPORTER_VERSION
    || lockedPackage?.version !== MCPORTER_VERSION
    || lockedPackage?.integrity !== MCPORTER_NPM_INTEGRITY) {
    errors.push('MCPorter package-lock.json does not match the pinned package version and npm integrity');
  }
  const packageManifest = await readJson(join(packageDirectory(runtimeDir), 'package.json'));
  const packageVersion = typeof packageManifest?.version === 'string' ? packageManifest.version : undefined;
  if (packageVersion !== MCPORTER_VERSION) {
    errors.push(`installed MCPorter version is ${packageVersion ?? 'missing'}, expected ${MCPORTER_VERSION}`);
  }
  const entrypoint = await findMcporterEntry(runtimeDir);
  if (!entrypoint) errors.push(`installed MCPorter JavaScript entry was not found inside the app-owned runtime`);
  return {
    valid: errors.length === 0,
    errors,
    packageVersion,
    packageDir: packageVersion === MCPORTER_VERSION ? packageDirectory(runtimeDir) : undefined,
    entrypoint
  };
}

async function runRequired(
  runner: CommandRunner,
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string | undefined>,
  label: string
): Promise<void> {
  let result;
  try {
    result = await runner(command, args, { cwd, env, timeoutMs: 15 * 60_000 });
  } catch (error) {
    throw new Error(`${label} could not start: ${redactSensitive(error instanceof Error ? error.message : String(error), env)}`);
  }
  if (result.exitCode !== 0) throw new Error(commandFailure(command, args, result, env).message);
}

/** Install or repair the app-owned exact-pinned MCPorter runtime. */
export async function prepareMcporterRuntime(
  options: McporterRuntimeOptions,
  runtimeDirInput: string
): Promise<McporterRuntimeVerification> {
  const runtimeDir = resolve(runtimeDirInput);
  const { paths } = await resolveReceiptBackedHarnessPaths(options);
  return withHarnessOperationLock(paths.lockDir, paths.sessionLeaseDir, () => prepareMcporterRuntimeUnlocked(options, runtimeDir), {
    timeoutMs: options.lockTimeoutMs,
    retryMs: options.lockRetryMs
  });
}

async function prepareMcporterRuntimeUnlocked(options: McporterRuntimeOptions, runtimeDir: string): Promise<McporterRuntimeVerification> {
  const platform = options.platform ?? process.platform;
  const env = withoutCredentials(options.env ?? process.env);
  const runner = options.commandRunner ?? runCommand;
  const npm = options.npmExecutable ?? (options.env ?? process.env).NPM_EXECUTABLE ?? 'npm';
  const manifestRoot = resolve(options.manifestRoot ?? join(dirname(dirname(runtimeDir)), MCPORTER_MANIFEST_RELATIVE));
  const current = await verifyMcporterRuntime(runtimeDir, platform);
  if (current.valid) return current;

  const parent = dirname(runtimeDir);
  await mkdir(parent, { recursive: true });
  const staging = join(parent, `.${basename(runtimeDir)}.staging-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(staging, { recursive: true });
  try {
    for (const filename of ['package.json', 'package-lock.json']) {
      const source = join(manifestRoot, filename);
      if (!(await pathExists(source))) throw new Error(`Release-owned MCPorter runtime ${filename} is missing at ${source}; refusing to resolve a target lock from the registry.`);
      await cp(source, join(staging, filename), { force: false, errorOnExist: true });
    }
    await runRequired(runner, npm, ['ci', '--legacy-peer-deps', '--no-audit', '--no-fund'], staging, env, 'MCPorter installation');
    const staged = await verifyMcporterRuntime(staging, platform);
    if (!staged.valid) throw new Error(`MCPorter verification failed: ${staged.errors.join('; ')}`);
    if (await pathExists(runtimeDir)) {
      const rollback = `${runtimeDir}.rollback-${Date.now()}`;
      await fsRename(runtimeDir, rollback);
      try {
        await fsRename(staging, runtimeDir);
      } catch (error) {
        await fsRename(rollback, runtimeDir);
        throw new Error(`MCPorter runtime swap failed; prior runtime restored: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      await fsRename(staging, runtimeDir);
    }
    return await verifyMcporterRuntime(runtimeDir, platform);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (error instanceof Error && error.message.startsWith('MCPorter')) throw error;
    throw new Error(`MCPorter installation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
