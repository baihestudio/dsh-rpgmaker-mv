import { cp, mkdir, readFile, rename as fsRename, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { DSH_NPM_INTEGRITY, DSH_PACKAGE_NAME, DSH_VERSION, resolveHarnessPaths, type HarnessPaths, type PathOptions } from './config';
import { commandFailure, ProcessTerminationError, redactSensitive, runCommand, withoutCredentials, type CommandResult, type CommandRunner } from './process';
import { pathExists } from './project';
import { withHarnessOperationLock } from './lock';
import { readInstallationReceipt } from './installation-root';

const KOFFI_LOAD_EXPRESSION = "import('koffi').then(() => process.exit(0)).catch(() => process.exit(1))";
const PACKAGE_SPEC = `${DSH_PACKAGE_NAME}@${DSH_VERSION}`;
export const DSH_RUNTIME_MANIFEST_RELATIVE = join('runtime-manifests', 'dsh');

// DSH publishes a broad plugin graph with a number of required peer
// dependencies.  npm's normal peer resolver is prohibitively expensive on
// the target machine, while --legacy-peer-deps would omit those packages
// entirely.  Keep the runtime closure explicit and exact in the release-owned
// manifest, then use the fast legacy resolver against that manifest.  These
// are runtime peers only; optional development/native peers are intentionally
// not pulled into the product tree.
export const DSH_RUNTIME_PEER_DEPENDENCIES: Readonly<Record<string, string>> = {
  '@deepseek-ai/cordis-plugin-group': '1.0.2',
  '@deepseek-ai/dsh-anonymous-user-id': DSH_VERSION,
  '@deepseek-ai/dsh-atomic-write': DSH_VERSION,
  '@deepseek-ai/dsh-authorization': DSH_VERSION,
  '@deepseek-ai/dsh-bash-local': DSH_VERSION,
  '@deepseek-ai/dsh-code-runtime': DSH_VERSION,
  '@deepseek-ai/dsh-compaction': DSH_VERSION,
  '@deepseek-ai/dsh-fs': DSH_VERSION,
  '@deepseek-ai/dsh-invariants': DSH_VERSION,
  '@deepseek-ai/dsh-output-retention': DSH_VERSION,
  '@deepseek-ai/dsh-sandbox': DSH_VERSION,
  '@deepseek-ai/dsh-scope': DSH_VERSION,
  '@deepseek-ai/dsh-session-telemetry': DSH_VERSION,
  '@deepseek-ai/dsh-session-title-llm': DSH_VERSION,
  '@deepseek-ai/dsh-shell': DSH_VERSION,
  '@deepseek-ai/dsh-spill': DSH_VERSION,
  '@deepseek-ai/dsh-subagent-in-process-driver': DSH_VERSION,
  '@deepseek-ai/dsh-timeout': DSH_VERSION,
  '@deepseek-ai/dsh-workflow': DSH_VERSION,
  react: '18.3.1',
  'react-dom': '18.3.1'
};

export type RenamePath = (from: string, to: string) => Promise<void>;

export interface BootstrapOptions extends PathOptions {
  nodeExecutable?: string;
  npmExecutable?: string;
  /** Release-owned package.json/package-lock.json used for npm ci. */
  manifestRoot?: string;
  commandRunner?: CommandRunner;
  now?: () => Date;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
  renamePath?: RenamePath;
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
  readonly preserveStaging: boolean;

  constructor(message: string, options: { preserveStaging?: boolean } = {}) {
    super(message);
    this.name = 'BootstrapError';
    this.preserveStaging = options.preserveStaging ?? false;
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

async function readNpmLock(path: string): Promise<JsonObject | undefined> {
  try {
    const content = await readFile(path, 'utf8');
    return asObject(JSON.parse(content));
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

/** Return the JavaScript DSH entrypoint that must be invoked through Node. */
export async function findDshJavaScriptEntrypoint(runtimeDir: string): Promise<string | undefined> {
  const packageJsonPath = await packagePath(runtimeDir);
  const packageJson = await readJson(packageJsonPath);
  const packageDirectory = dirname(packageJsonPath);
  const bin = packageJson?.bin;
  const packageBins = asObject(bin);
  const packageBin = typeof bin === 'string' ? bin : packageBins?.dsh;
  if (typeof packageBin !== 'string') return undefined;
  const candidate = resolve(packageDirectory, packageBin);
  return (await pathExists(candidate)) ? candidate : undefined;
}

function versionFromPackage(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export async function verifyRuntime(runtimeDirInput: string, options: Pick<BootstrapOptions, 'nodeExecutable' | 'npmExecutable' | 'commandRunner' | 'env' | 'platform'> = {}): Promise<RuntimeVerification> {
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
  for (const [name, version] of Object.entries(DSH_RUNTIME_PEER_DEPENDENCIES)) {
    if (dependencies?.[name] !== version) {
      errors.push(`runtime peer dependency ${name}@${version} is not pinned in package.json`);
    }
  }
  const lock = await readNpmLock(join(runtimeDir, 'package-lock.json'));
  const lockRoot = asObject(asObject(lock?.packages)?.['']);
  const lockedPackage = asObject(asObject(lock?.packages)?.[`node_modules/${DSH_PACKAGE_NAME}`]);
  const lockDependency = asObject(lockRoot?.dependencies)?.[DSH_PACKAGE_NAME];
  if (!lock) errors.push('runtime package-lock.json is missing or invalid');
  else if (lockDependency !== DSH_VERSION
    || lockedPackage?.version !== DSH_VERSION
    || lockedPackage?.integrity !== DSH_NPM_INTEGRITY) {
    errors.push(`runtime package-lock.json does not match ${DSH_PACKAGE_NAME}@${DSH_VERSION} and its pinned npm integrity`);
  }
  if (lock) {
    const lockPackages = asObject(lock.packages);
    const lockDependencies = asObject(lockRoot?.dependencies);
    for (const [name, version] of Object.entries(DSH_RUNTIME_PEER_DEPENDENCIES)) {
      const dependency = lockDependencies?.[name];
      const packageEntry = asObject(lockPackages?.[`node_modules/${name}`]);
      const resolvedVersion = typeof dependency === 'string'
        ? dependency
        : asObject(dependency)?.version;
      if (resolvedVersion !== version || packageEntry?.version !== version) {
        errors.push(`runtime package-lock.json is missing pinned peer ${name}@${version}`);
      }
    }
  }

  const dshPackage = await readJson(await packagePath(runtimeDir));
  dshPackageVersion = versionFromPackage(dshPackage?.version);
  if (dshPackageVersion !== DSH_VERSION) errors.push(`installed DSH version is ${dshPackageVersion ?? 'missing'}, expected ${DSH_VERSION}`);

  dshExecutable = await findDshJavaScriptEntrypoint(runtimeDir) ?? await findDshExecutable(runtimeDir, options.platform ?? process.platform);
  if (!dshExecutable) errors.push('installed DSH executable was not found');

  const koffiPackage = await findExistingPath([
    join(runtimeDir, 'node_modules', 'koffi', 'package.json'),
    join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', 'koffi', 'package.json')
  ]);
  if (!koffiPackage) errors.push('installed koffi package was not found');

  if (errors.length === 0) {
    const runner = options.commandRunner ?? runCommand;
    const nodeExecutable = options.nodeExecutable ?? (options.env ?? process.env).NODE_EXECUTABLE ?? 'node';
    try {
      const result = await runner(nodeExecutable, ['-e', KOFFI_LOAD_EXPRESSION], {
        cwd: runtimeDir,
        env: options.env,
        timeoutMs: 60_000
      });
      koffiLoaded = result.exitCode === 0;
      if (!koffiLoaded) errors.push('koffi could not be loaded by Node');
    } catch {
      errors.push('Node could not load koffi; verify that Node/npm dependencies are complete');
    }
  }

  return { valid: errors.length === 0, errors, dshPackageVersion, dshExecutable, koffiLoaded };
}

async function createStagingRuntime(runtimeDir: string, now: () => Date, manifestRoot: string): Promise<string> {
  const stamp = now().toISOString().replace(/[-:.TZ]/g, '');
  const staging = join(dirname(runtimeDir), `.${basename(runtimeDir)}.staging-${stamp}-${Math.random().toString(16).slice(2)}`);
  await mkdir(staging, { recursive: true });
  try {
    for (const filename of ['package.json', 'package-lock.json']) {
      const source = join(manifestRoot, filename);
      if (!(await pathExists(source))) {
        throw new BootstrapError(`Release-owned DSH runtime ${filename} is missing at ${source}; refusing to resolve a target lock from the registry.`);
      }
      await cp(source, join(staging, filename), { force: false, errorOnExist: true });
    }
    return staging;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
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
    if (error instanceof ProcessTerminationError) {
      throw new BootstrapError(`${label} could not confirm process-tree termination. The active runtime was not changed and staging was preserved at ${cwd}; inspect or remove it only after confirming no installer descendants remain.`, { preserveStaging: true });
    }
    throw new BootstrapError(`${label} could not start. Install or repair Node.js/npm, then retry: ${redactSensitive(detail, redactionEnv)}`);
  }
  if (result.exitCode !== 0) throw failedCommand(command, args, result, redactionEnv);
}

async function swapRuntime(staging: string, runtimeDir: string, now: () => Date, renamePath: RenamePath = fsRename): Promise<string | undefined> {
  await mkdir(dirname(runtimeDir), { recursive: true });
  const hadRuntime = await pathExists(runtimeDir);
  let rollbackDir: string | undefined;
  if (hadRuntime) {
    const stamp = now().toISOString().replace(/[-:.TZ]/g, '');
    rollbackDir = join(dirname(runtimeDir), `${basename(runtimeDir)}.rollback-${stamp}-${Math.random().toString(16).slice(2)}`);
    try {
      await renamePath(runtimeDir, rollbackDir);
    } catch (error) {
      throw new BootstrapError(`Runtime swap could not move the current runtime; it remains usable at ${runtimeDir}. Staging will be discarded: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    await renamePath(staging, runtimeDir);
  } catch (error) {
    if (rollbackDir && await pathExists(rollbackDir) && !(await pathExists(runtimeDir))) {
      try {
        await renamePath(rollbackDir, runtimeDir);
      } catch (restoreError) {
        throw new BootstrapError(`DEGRADED runtime swap: the active runtime is missing; prior runtime is preserved at ${rollbackDir}, staging is preserved at ${staging}, and restoration failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`, { preserveStaging: true });
      }
      throw new BootstrapError(`Runtime swap failed; the current runtime was restored at ${runtimeDir}. Staging can be discarded: ${error instanceof Error ? error.message : String(error)}`);
    }
    throw new BootstrapError(`Runtime swap failed; active runtime remains ${await pathExists(runtimeDir) ? 'usable' : 'missing'} and staging is preserved at ${staging}: ${error instanceof Error ? error.message : String(error)}`, { preserveStaging: true });
  }
  return rollbackDir;
}

async function restoreAfterPostSwapFailure(runtimeDir: string, rollbackDir: string | undefined, now: () => Date, renamePath: RenamePath): Promise<string | undefined> {
  const failedDir = join(dirname(runtimeDir), `${basename(runtimeDir)}.failed-${now().toISOString().replace(/[-:.TZ]/g, '')}-${Math.random().toString(16).slice(2)}`);
  try {
    await renamePath(runtimeDir, failedDir);
  } catch (error) {
    throw new BootstrapError(`DEGRADED post-swap verification: the active runtime at ${runtimeDir} is unverified, prior runtime remains at ${rollbackDir ?? 'none'}, and the failed tree could not be moved aside: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!rollbackDir) {
    throw new BootstrapError(`DEGRADED post-swap verification: no active runtime remains; the unverified tree is preserved at ${failedDir}. Re-run bootstrap after inspecting it.`);
  }
  try {
    await renamePath(rollbackDir, runtimeDir);
  } catch (error) {
    throw new BootstrapError(`DEGRADED post-swap verification: the active runtime is missing; unverified tree is preserved at ${failedDir}, prior runtime is preserved at ${rollbackDir}, and restoration failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return failedDir;
}

export async function bootstrapRuntime(options: BootstrapOptions = {}): Promise<BootstrapResult> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') throw new BootstrapError('DSH runtime bootstrap is supported on Windows only.');
  const windowsOptions = { ...options, platform };
  const initialPaths: HarnessPaths = resolveHarnessPaths(windowsOptions);
  const receipt = await readInstallationReceipt(initialPaths.mutableRoot);
  const paths: HarnessPaths = receipt && !options.programRoot && !options.installationRoot
    ? resolveHarnessPaths({ ...windowsOptions, installationRoot: receipt.installationRoot, programRoot: receipt.programRoot, mutableRoot: receipt.localStateRoot, localStateRoot: receipt.localStateRoot })
    : initialPaths;
  return withHarnessOperationLock(paths.lockDir, paths.sessionLeaseDir, () => bootstrapRuntimeUnlocked(windowsOptions, paths), {
    timeoutMs: options.lockTimeoutMs ?? 15 * 60_000,
    retryMs: options.lockRetryMs
  });
}

async function bootstrapRuntimeUnlocked(options: BootstrapOptions, paths: HarnessPaths): Promise<BootstrapResult> {
  const runtimeDir = paths.runtimeDir;
  const env = options.env ?? process.env;
  const commandEnv = withoutCredentials(env);
  const runner = options.commandRunner ?? runCommand;
  const nodeExecutable = options.nodeExecutable ?? env.NODE_EXECUTABLE ?? 'node';
  const npmExecutable = options.npmExecutable ?? env.NPM_EXECUTABLE ?? 'npm';
  const manifestRoot = resolve(options.manifestRoot ?? join(paths.programRoot, DSH_RUNTIME_MANIFEST_RELATIVE));
  const now = options.now ?? (() => new Date());
  const existing = await verifyRuntime(runtimeDir, { nodeExecutable, npmExecutable, commandRunner: runner, env: commandEnv, platform: options.platform });

  if (existing.valid) {
    return { status: 'unchanged', runtimeDir, verification: existing };
  }

  let staging: string | undefined;
  try {
    staging = await createStagingRuntime(runtimeDir, now, manifestRoot);
    // The package manifest and lock are release-owned inputs. npm ci is the
    // only target-side dependency operation and must consume those exact files.
    await runRequired(runner, npmExecutable, ['ci', '--legacy-peer-deps', '--no-audit', '--no-fund'], staging, commandEnv, 'DSH runtime installation', env);

    const staged = await verifyRuntime(staging, { nodeExecutable, npmExecutable, commandRunner: runner, env: commandEnv, platform: options.platform });
    if (!staged.valid) {
      throw new BootstrapError(`Runtime verification failed: ${staged.errors.join('; ')}. The current runtime was not changed.`);
    }

    const wasPresent = await pathExists(runtimeDir);
    const renamePath = options.renamePath ?? fsRename;
    const rollbackDir = await swapRuntime(staging, runtimeDir, now, renamePath);
    staging = undefined;
    const verification = await verifyRuntime(runtimeDir, { nodeExecutable, npmExecutable, commandRunner: runner, env: commandEnv, platform: options.platform });
    if (!verification.valid) {
      const failedDir = await restoreAfterPostSwapFailure(runtimeDir, rollbackDir, now, renamePath);
      throw new BootstrapError(`Post-swap runtime verification failed: ${verification.errors.join('; ')}. The prior runtime was restored; unverified tree preserved at ${failedDir}.`);
    }
    return {
      status: wasPresent ? 'repaired' : 'installed',
      runtimeDir,
      rollbackDir,
      verification
    };
  } catch (error) {
    if (staging && !(error instanceof BootstrapError && error.preserveStaging)) {
      await rm(staging, { recursive: true, force: true });
    }
    if (error instanceof BootstrapError) throw error;
    throw new BootstrapError(`Bootstrap failed; existing runtime was not changed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export { KOFFI_LOAD_EXPRESSION, PACKAGE_SPEC };
