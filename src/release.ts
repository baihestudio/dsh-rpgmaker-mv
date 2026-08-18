import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename as fsRename, rm, stat, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { findDshExecutable } from './bootstrap';
import { resolveHarnessPaths, type PathOptions } from './config';
import { resolveExecutable } from './executable';
import { commandFailure, redactSensitive, runCommand, terminateProcessTree, withoutCredentials, type CommandRunner, type ProcessTreeTerminator } from './process';
import { assertValidMvProject, pathExists } from './project';
import { prepareRpgMakerDeployment, BUILD_RELEASE_PRESET_ID, type McpSchemaProbe, type RpgMakerDeploymentOptions } from './rpgmaker';

export const RPGMPACKER_PACKAGE = 'rpgmpacker';
export const RPGMPACKER_VERSION = '2.0.5';
export const RPGMPACKER_NPM_INTEGRITY = 'sha512-3A79iYqXY84GdiClSnbSGqYh2a8Itwv2+xpUCR2cLXGFIsVuChWH1rkVrO6bJOkzr7W5tarkvjKpxUqfRuSkOw==';
export const RPGMPACKER_SCRIPT = 'dist/index.js';
export const RELEASE_TARGETS = ['Windows', 'Browser'] as const;
export type ReleaseTarget = (typeof RELEASE_TARGETS)[number];

const WINDOWS_TEMPLATE = 'nwjs-win';
const WINDOWS_ENTRY_NAMES = ['Game.exe'] as const;
const PACKAGER_TIMEOUT_MS = 15 * 60_000;
const SMOKE_TIMEOUT_MS = 2_000;
const HTTP_TIMEOUT_MS = 10_000;
const RELEASE_RUNTIME_NAME = 'rpgmpacker-runtime';

export class ReleaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReleaseError';
  }
}

export interface RpgMakerMvInstallation {
  path: string;
  source: 'explicit' | 'environment' | 'detected';
  templatePath: string;
}

export interface InstallationDetectionOptions {
  installationPath?: string;
  platform?: string;
  env?: Record<string, string | undefined>;
  targets?: readonly ReleaseTarget[];
}

export interface RpgmPackerRuntime {
  runtimeDir: string;
  runner: string;
  script: string;
  version: typeof RPGMPACKER_VERSION;
}

export interface ReleaseProcessSpawnOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  platform?: string;
}

export type ReleaseProcessSpawner = (command: string, args: string[], options: ReleaseProcessSpawnOptions) => ChildProcess | unknown;

export interface ArtifactInspection {
  target: ReleaseTarget;
  requiredPaths: string[];
  entryPath?: string;
  webRoot?: string;
}

export interface WindowsSmokeResult {
  kind: 'windows';
  status: 'passed' | 'unsupported';
  cleanup: 'confirmed' | 'not-run';
  entryPath?: string;
  reason?: string;
  stdout?: string;
  stderr?: string;
}

export interface WebSmokeResult {
  kind: 'web';
  status: 'passed';
  cleanup: 'confirmed';
  url: string;
  probedPaths: string[];
}

export type ReleaseSmokeResult = WindowsSmokeResult | WebSmokeResult;

export interface ReleaseArtifactResult {
  target: ReleaseTarget;
  outputPath: string;
  structure: ArtifactInspection;
  smoke: ReleaseSmokeResult;
}

export interface BuildReleaseOptions extends PathOptions {
  projectPath: string;
  outputRoot: string;
  targets?: readonly ReleaseTarget[];
  rpgmakerInstallationPath?: string;
  releaseRuntimeDir?: string;
  bunExecutable?: string;
  jsExecutable?: string;
  dshExecutable?: string;
  mcpRuntimeDir?: string;
  sourceRoot?: string;
  schemaProbe?: McpSchemaProbe;
  commandRunner?: CommandRunner;
  prepareDeployment?: () => Promise<unknown>;
  validateProject?: () => Promise<void>;
  spawnProcess?: ReleaseProcessSpawner;
  terminateProcessTree?: ProcessTreeTerminator;
  smokeTimeoutMs?: number;
  httpTimeoutMs?: number;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
}

export interface BuildReleaseResult {
  outputRoot: string;
  projectPath: string;
  rpgmakerInstallation: RpgMakerMvInstallation;
  packer: {
    package: typeof RPGMPACKER_PACKAGE;
    version: typeof RPGMPACKER_VERSION;
    runner: string;
    script: string;
    args: string[];
    options: {
      exclude: false;
      hardlinks: false;
      encryption: false;
    };
  };
  validation: 'existing-rpgmaker-mcp';
  artifacts: ReleaseArtifactResult[];
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

async function readBunLock(path: string): Promise<JsonObject | undefined> {
  try {
    const content = await readFile(path, 'utf8');
    try {
      return asObject(JSON.parse(content));
    } catch {
      return asObject(JSON.parse(content.replace(/,\s*([}\]])/g, '$1')));
    }
  } catch {
    return undefined;
  }
}

function within(parent: string, child: string): boolean {
  const rest = relative(resolve(parent), resolve(child));
  return rest === '' || (!rest.startsWith(`..${sep}`) && rest !== '..');
}

function normalizedPath(value: string, platform: string): string {
  const result = resolve(value);
  return platform === 'win32' ? result.toLowerCase() : result;
}

function physicallyWithin(parent: string, child: string, platform: string): boolean {
  const rest = relative(normalizedPath(parent, platform), normalizedPath(child, platform));
  return rest === '' || (!rest.startsWith(`..${sep}`) && rest !== '..' && !isAbsolute(rest));
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function regularFile(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    return info.isFile() && !info.isSymbolicLink();
  } catch {
    return false;
  }
}

async function entryExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

function targetsFor(value: readonly ReleaseTarget[] | undefined): ReleaseTarget[] {
  const targets = [...(value ?? RELEASE_TARGETS)];
  if (targets.length === 0) throw new ReleaseError('At least one release target is required.');
  if (targets.some((target) => !RELEASE_TARGETS.includes(target))) throw new ReleaseError(`Unsupported release target. Choose Windows or Browser.`);
  if (new Set(targets).size !== targets.length) throw new ReleaseError('Release targets must be unique.');
  return targets;
}

function knownInstallationCandidates(platform: string, env: Record<string, string | undefined>): string[] {
  const candidates: string[] = [];
  const add = (value: string | undefined): void => {
    if (value && !candidates.includes(value)) candidates.push(value);
  };
  const home = env.USERPROFILE ?? env.HOME;
  const programFiles = env.ProgramFiles;
  const programFilesX86 = env['ProgramFiles(x86)'];
  const localAppData = env.LOCALAPPDATA;
  const steamRoots = [
    env.STEAM_DIR,
    env.STEAM_ROOT,
    programFiles ? join(programFiles, 'Steam') : undefined,
    programFilesX86 ? join(programFilesX86, 'Steam') : undefined,
    home ? join(home, 'AppData', 'Local', 'Steam') : undefined,
    home ? join(home, '.steam', 'steam', 'steamapps', 'common') : undefined
  ].filter((value): value is string => Boolean(value));

  if (platform === 'win32') {
    for (const root of [programFiles, programFilesX86, localAppData ? join(localAppData, 'Programs') : undefined]) {
      if (!root) continue;
      add(join(root, 'RPG Maker MV'));
      add(join(root, 'KADOKAWA', 'RPG Maker MV'));
      add(join(root, 'KADOKAWA', 'RPGMV'));
    }
    for (const root of steamRoots) add(join(root, 'steamapps', 'common', 'RPG Maker MV'));
  } else if (platform === 'darwin') {
    add('/Applications/RPG Maker MV');
    add('/Applications/RPG Maker MV.app/Contents/Resources');
    if (home) add(join(home, 'Library', 'Application Support', 'Steam', 'steamapps', 'common', 'RPG Maker MV'));
    for (const root of steamRoots) add(join(root, 'RPG Maker MV'));
  } else {
    if (home) add(join(home, '.steam', 'steam', 'steamapps', 'common', 'RPG Maker MV'));
    for (const root of steamRoots) add(join(root, 'RPG Maker MV'));
  }
  return candidates;
}

async function inspectInstallation(pathInput: string, targets: readonly ReleaseTarget[]): Promise<{ valid: boolean; path: string; reason?: string }> {
  const path = resolve(pathInput);
  if (!(await directoryExists(path))) return { valid: false, path, reason: 'the directory does not exist' };
  const templatePath = join(path, WINDOWS_TEMPLATE);
  if (!(await directoryExists(templatePath))) return { valid: false, path, reason: `the ${WINDOWS_TEMPLATE} template directory is missing` };
  if (targets.includes('Windows')) {
    const entry = await findWindowsEntry(templatePath);
    if (!entry) return { valid: false, path, reason: `the ${WINDOWS_TEMPLATE} template has no Game.exe or nw.exe entry` };
  }
  return { valid: true, path };
}

export async function detectRpgMakerMvInstallation(options: InstallationDetectionOptions = {}): Promise<RpgMakerMvInstallation> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const targets = targetsFor(options.targets);
  const configured = options.installationPath ?? env.RPGMAKER_MV_INSTALLATION ?? env.RPGMAKER_MV_HOME ?? env.RPGMAKER_MV_PATH;
  if (configured) {
    const result = await inspectInstallation(configured, targets);
    if (!result.valid) throw new ReleaseError(`RPG Maker MV installation at ${result.path} is unusable: ${result.reason}. Supply the installed RPG Maker MV folder explicitly.`);
    return { path: result.path, source: options.installationPath ? 'explicit' : 'environment', templatePath: join(result.path, WINDOWS_TEMPLATE) };
  }
  const candidates = knownInstallationCandidates(platform, env);
  for (const candidate of candidates) {
    const result = await inspectInstallation(candidate, targets);
    if (result.valid) return { path: result.path, source: 'detected', templatePath: join(result.path, WINDOWS_TEMPLATE) };
  }
  throw new ReleaseError(`RPG Maker MV installation was not detected. Supply --rpgmaker-installation with the installed folder; searched ${candidates.length ? candidates.join(', ') : 'no platform-known locations'}.`);
}

function packageDirectory(runtimeDir: string): string {
  return join(runtimeDir, 'node_modules', RPGMPACKER_PACKAGE);
}

function normalizedPackageEntry(value: unknown): string | undefined {
  return typeof value === 'string' ? value.replace(/^\.\//, '') : undefined;
}

function packageIntegrity(lock: JsonObject | undefined): string | undefined {
  const packageEntry = asObject(lock?.packages)?.[RPGMPACKER_PACKAGE];
  return Array.isArray(packageEntry) && typeof packageEntry[3] === 'string' ? packageEntry[3] : undefined;
}

async function findRpgmPackerScript(runtimeDir: string): Promise<string | undefined> {
  const packageJsonPath = join(packageDirectory(runtimeDir), 'package.json');
  const packageJson = await readJson(packageJsonPath);
  const bins = asObject(packageJson?.bin);
  const entry = normalizedPackageEntry(bins?.rpgmpacket);
  if (entry !== RPGMPACKER_SCRIPT) return undefined;
  const candidate = resolve(packageDirectory(runtimeDir), entry);
  if (!(await regularFile(candidate))) return undefined;
  try {
    const runtimeRoot = await realpath(runtimeDir);
    const script = await realpath(candidate);
    if (!within(runtimeRoot, script)) return undefined;
  } catch {
    return undefined;
  }
  return candidate;
}

export async function verifyRpgmPackerRuntime(runtimeDirInput: string): Promise<{ valid: boolean; errors: string[]; version?: string; script?: string }> {
  const runtimeDir = resolve(runtimeDirInput);
  const errors: string[] = [];
  const rootPackage = await readJson(join(runtimeDir, 'package.json'));
  const dependencies = asObject(rootPackage?.dependencies);
  if (dependencies?.[RPGMPACKER_PACKAGE] !== RPGMPACKER_VERSION) errors.push(`runtime dependency ${RPGMPACKER_PACKAGE}@${RPGMPACKER_VERSION} is not exact-pinned`);
  const lock = await readBunLock(join(runtimeDir, 'bun.lock'));
  const workspace = asObject(asObject(lock?.workspaces)?.['']);
  const lockedDependencies = asObject(workspace?.dependencies);
  const packageEntry = asObject(lock?.packages)?.[RPGMPACKER_PACKAGE];
  const lockMetadata = Array.isArray(packageEntry) ? asObject(packageEntry[2]) : undefined;
  const lockBins = asObject(lockMetadata?.bin);
  if (!lock) errors.push('rpgmpacker runtime bun.lock is missing or invalid');
  else if (lockedDependencies?.[RPGMPACKER_PACKAGE] !== RPGMPACKER_VERSION
    || !Array.isArray(packageEntry)
    || packageEntry[0] !== `${RPGMPACKER_PACKAGE}@${RPGMPACKER_VERSION}`
    || normalizedPackageEntry(lockBins?.rpgmpacket) !== RPGMPACKER_SCRIPT
    || packageIntegrity(lock) !== RPGMPACKER_NPM_INTEGRITY) {
    errors.push(`rpgmpacker bun.lock does not match ${RPGMPACKER_PACKAGE}@${RPGMPACKER_VERSION} and its pinned npm integrity`);
  }
  const packageJson = await readJson(join(packageDirectory(runtimeDir), 'package.json'));
  const version = typeof packageJson?.version === 'string' ? packageJson.version : undefined;
  if (version !== RPGMPACKER_VERSION) errors.push(`installed rpgmpacker version is ${version ?? 'missing'}, expected ${RPGMPACKER_VERSION}`);
  const bins = asObject(packageJson?.bin);
  if (normalizedPackageEntry(bins?.rpgmpacket) !== RPGMPACKER_SCRIPT) errors.push(`installed rpgmpacker bin is ${String(bins?.rpgmpacket ?? 'missing')}, expected ${RPGMPACKER_SCRIPT}`);
  const script = await findRpgmPackerScript(runtimeDir);
  if (!script) errors.push('resolved rpgmpacker JavaScript entry dist/index.js was not found inside the app-owned runtime');
  return { valid: errors.length === 0, errors, version, script };
}

export async function resolveReleaseRunner(options: { jsExecutable?: string; bunExecutable?: string }, platform: string, env: Record<string, string | undefined>): Promise<string> {
  const candidate = options.jsExecutable ?? options.bunExecutable ?? env.BUN_EXECUTABLE ?? env.NODE_EXECUTABLE;
  const direct = candidate ? await resolveExecutable(candidate, { platform, env }) : undefined;
  const expected = (path: string | undefined): path is string => {
    if (!path) return false;
    const name = basename(path).toLowerCase();
    return platform === 'win32' ? name === 'bun.exe' || name === 'node.exe' : name === 'bun' || name === 'node';
  };
  if (expected(direct)) return direct;
  const names = platform === 'win32' ? ['bun.exe', 'node.exe'] : ['bun', 'node'];
  for (const name of names) {
    const found = await resolveExecutable(name, { platform, env });
    if (expected(found)) return found;
  }
  throw new ReleaseError(`Release packaging requires a resolved direct ${platform === 'win32' ? 'bun.exe or node.exe' : 'bun or node'} executable; shell shims are not accepted.`);
}

async function runRequired(runner: CommandRunner, command: string, args: string[], cwd: string, env: Record<string, string | undefined>, label: string): Promise<void> {
  let result;
  try {
    result = await runner(command, args, { cwd, env: withoutCredentials(env), timeoutMs: PACKAGER_TIMEOUT_MS });
  } catch (error) {
    throw new ReleaseError(`${label} could not start: ${redactSensitive(error instanceof Error ? error.message : String(error), env)}`);
  }
  if (result.exitCode !== 0) throw new ReleaseError(commandFailure(command, args, result, env).message);
}

async function ensureRpgmPackerRuntime(options: BuildReleaseOptions, platform: string, env: Record<string, string | undefined>): Promise<RpgmPackerRuntime> {
  const paths = resolveHarnessPaths(options);
  const runtimeDir = resolve(options.releaseRuntimeDir ?? join(paths.programRoot, 'runtime', RELEASE_RUNTIME_NAME));
  const current = await verifyRpgmPackerRuntime(runtimeDir);
  const runner = await resolveReleaseRunner({ jsExecutable: options.jsExecutable, bunExecutable: options.bunExecutable }, platform, env);
  if (current.valid && current.script) return { runtimeDir, runner, script: current.script, version: RPGMPACKER_VERSION };

  const staging = join(dirname(runtimeDir), `.${basename(runtimeDir)}.staging-${Date.now()}-${randomUUID()}`);
  await mkdir(staging, { recursive: true });
  await writeFile(join(staging, 'package.json'), `${JSON.stringify({ name: RELEASE_RUNTIME_NAME, private: true, dependencies: { [RPGMPACKER_PACKAGE]: RPGMPACKER_VERSION } }, null, 2)}\n`);
  let stagingOwned = true;
  let rollback: string | undefined;
  try {
    const bun = options.bunExecutable ?? env.BUN_EXECUTABLE ?? 'bun';
    await runRequired(options.commandRunner ?? runCommand, bun, ['add', '--exact', '--ignore-scripts', `${RPGMPACKER_PACKAGE}@${RPGMPACKER_VERSION}`], staging, env, 'rpgmpacker installation');
    const staged = await verifyRpgmPackerRuntime(staging);
    if (!staged.valid || !staged.script) throw new ReleaseError(`rpgmpacker verification failed: ${staged.errors.join('; ')}`);
    await mkdir(dirname(runtimeDir), { recursive: true });
    if (await pathExists(runtimeDir)) {
      rollback = `${runtimeDir}.rollback-${Date.now()}-${randomUUID()}`;
      await fsRename(runtimeDir, rollback);
    }
    try {
      await fsRename(staging, runtimeDir);
      stagingOwned = false;
    } catch (error) {
      if (rollback) await fsRename(rollback, runtimeDir).catch(() => undefined);
      throw new ReleaseError(`rpgmpacker runtime swap failed; the prior runtime was preserved: ${error instanceof Error ? error.message : String(error)}`);
    }
    const verified = await verifyRpgmPackerRuntime(runtimeDir);
    if (!verified.valid || !verified.script) {
      const failed = `${runtimeDir}.failed-${Date.now()}-${randomUUID()}`;
      await fsRename(runtimeDir, failed).catch(() => undefined);
      if (rollback) {
        await fsRename(rollback, runtimeDir).catch((error) => { throw new ReleaseError(`rpgmpacker verification failed and the prior runtime could not be restored: ${error instanceof Error ? error.message : String(error)}`); });
      }
      throw new ReleaseError(`rpgmpacker post-swap verification failed: ${verified.errors.join('; ')}`);
    }
    if (rollback) await rm(rollback, { recursive: true, force: true });
    return { runtimeDir, runner, script: verified.script, version: RPGMPACKER_VERSION };
  } finally {
    if (stagingOwned) await rm(staging, { recursive: true, force: true });
  }
}

async function findWindowsEntry(artifactPath: string): Promise<string | undefined> {
  for (const name of WINDOWS_ENTRY_NAMES) {
    const candidate = join(artifactPath, name);
    if (await regularFile(candidate)) return name;
  }
  return undefined;
}

async function requireArtifactPath(root: string, path: string, kind: 'file' | 'directory'): Promise<void> {
  const candidate = join(root, path);
  const info = await lstat(candidate).catch(() => undefined);
  if (!info || info.isSymbolicLink() || (kind === 'file' ? !info.isFile() : !info.isDirectory())) throw new ReleaseError(`Invalid ${basename(root)} artifact: required ${path} is missing or is not a regular ${kind}.`);
}

export async function inspectReleaseArtifact(artifactPathInput: string, target: ReleaseTarget): Promise<ArtifactInspection> {
  const artifactPath = resolve(artifactPathInput);
  if (!(await directoryExists(artifactPath))) throw new ReleaseError(`Invalid ${target} artifact: output directory is missing at ${artifactPath}.`);
  const requiredPaths: string[] = [];
  let entryPath: string | undefined;
  if (target === 'Windows') {
    entryPath = await findWindowsEntry(artifactPath);
    if (!entryPath) throw new ReleaseError(`Invalid Windows artifact: missing Game.exe at ${artifactPath}.`);
    requiredPaths.push(entryPath, 'www/index.html', 'www/data/System.json', 'www/js/main.js');
    await requireArtifactPath(artifactPath, entryPath, 'file');
    await requireArtifactPath(artifactPath, 'www/index.html', 'file');
    await requireArtifactPath(artifactPath, 'www/data/System.json', 'file');
    await requireArtifactPath(artifactPath, 'www/js/main.js', 'file');
  } else {
    const webRoot = await directoryExists(join(artifactPath, 'www')) ? 'www' : '';
    const prefix = webRoot ? `${webRoot}/` : '';
    requiredPaths.push(`${prefix}index.html`, `${prefix}data/System.json`, `${prefix}js/main.js`);
    await requireArtifactPath(artifactPath, `${webRoot ? `${webRoot}/` : ''}index.html`, 'file');
    await requireArtifactPath(artifactPath, `${webRoot ? `${webRoot}/` : ''}data/System.json`, 'file');
    await requireArtifactPath(artifactPath, `${webRoot ? `${webRoot}/` : ''}js/main.js`, 'file');
    return { target, requiredPaths, ...(webRoot ? { webRoot } : {}) };
  }
  return { target, requiredPaths, ...(entryPath ? { entryPath } : {}) };
}

interface TrackedChild {
  once?: (event: string, listener: (...args: any[]) => void) => unknown;
  exitCode?: number | null;
  signalCode?: string | null;
  stdout?: { setEncoding?: (encoding: string) => unknown; on?: (event: string, listener: (chunk: string) => void) => unknown };
  stderr?: { setEncoding?: (encoding: string) => unknown; on?: (event: string, listener: (chunk: string) => void) => unknown };
}

function isRunning(child: TrackedChild): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function waitForClose(child: TrackedChild, timeoutMs: number): Promise<boolean> {
  if (!isRunning(child)) return Promise.resolve(true);
  return new Promise((resolveWait) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveWait(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once?.('close', () => finish(true));
    child.once?.('error', () => finish(true));
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export async function smokeWindowsArtifact(artifactPathInput: string, options: {
  platform?: string;
  env?: Record<string, string | undefined>;
  spawnProcess?: ReleaseProcessSpawner;
  terminateProcessTree?: ProcessTreeTerminator;
  timeoutMs?: number;
  commandArgs?: string[];
} = {}): Promise<WindowsSmokeResult> {
  const artifactPath = resolve(artifactPathInput);
  const structure = await inspectReleaseArtifact(artifactPath, 'Windows');
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    return { kind: 'windows', status: 'unsupported', cleanup: 'not-run', entryPath: structure.entryPath, reason: 'Windows artifact launch smoke requires a Windows host; this non-Windows result is not hardware evidence.' };
  }
  const entryPath = join(artifactPath, structure.entryPath!);
  const spawnProcess = options.spawnProcess ?? ((command, args, spawnOptions) => spawn(command, args, { cwd: spawnOptions.cwd, env: Object.fromEntries(Object.entries(spawnOptions.env ?? process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }));
  let child: unknown;
  try {
    child = spawnProcess(entryPath, options.commandArgs ?? [], { cwd: artifactPath, env: withoutCredentials(options.env ?? process.env), platform });
  } catch (error) {
    throw new ReleaseError(`Windows artifact smoke could not start ${entryPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const tracked = child as TrackedChild;
  if (!tracked || typeof tracked.once !== 'function') throw new ReleaseError('Windows artifact smoke could not track its owned process; cleanup was not attempted.');
  let stdout = '';
  let stderr = '';
  tracked.stdout?.setEncoding?.('utf8');
  tracked.stderr?.setEncoding?.('utf8');
  tracked.stdout?.on?.('data', (chunk) => { stdout += chunk; });
  tracked.stderr?.on?.('data', (chunk) => { stderr += chunk; });
  let exitError: string | undefined;
  tracked.once('error', (error) => { exitError = error instanceof Error ? error.message : String(error); });
  await delay(options.timeoutMs ?? SMOKE_TIMEOUT_MS);
  if (!isRunning(tracked)) {
    throw new ReleaseError(`Windows artifact smoke exited immediately with code ${String(tracked.exitCode ?? tracked.signalCode ?? 'unknown')}${exitError ? `: ${exitError}` : ''}. ${stderr.trim()}`.trim());
  }
  const terminator = options.terminateProcessTree ?? terminateProcessTree;
  try {
    await terminator(child as ChildProcess, { platform, env: options.env, timeoutMs: options.timeoutMs ?? SMOKE_TIMEOUT_MS });
  } catch (error) {
    throw new ReleaseError(`Windows artifact smoke cleanup is unverified: the owned process tree could not be terminated: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!(await waitForClose(tracked, options.timeoutMs ?? SMOKE_TIMEOUT_MS)) || isRunning(tracked)) {
    throw new ReleaseError('Windows artifact smoke cleanup is unverified: the owned process did not confirm termination.');
  }
  return { kind: 'windows', status: 'passed', cleanup: 'confirmed', entryPath: structure.entryPath, stdout, stderr };
}

function mimeType(path: string): string {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

async function staticResponse(root: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const rawPath = (request.url ?? '/').split('?')[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    response.writeHead(400).end('bad request');
    return;
  }
  const relativePath = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const candidate = resolve(root, relativePath);
  if (!within(root, candidate)) {
    response.writeHead(404).end('not found');
    return;
  }
  const info = await lstat(candidate).catch(() => undefined);
  if (!info || info.isSymbolicLink() || !info.isFile()) {
    response.writeHead(404).end('not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': mimeType(candidate), 'Cache-Control': 'no-store' });
  response.end(await readFile(candidate));
}

async function listen(server: Server): Promise<number> {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error: Error): void => { server.off('listening', onListening); rejectListen(error); };
    const onListening = (): void => { server.off('error', onError); resolveListen((server.address() as { port: number }).port); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
}

async function probeUrl(url: string, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new ReleaseError(`Web smoke HTTP probe returned ${response.status} for ${url}.`);
    await response.arrayBuffer();
  } catch (error) {
    if (error instanceof ReleaseError) throw error;
    throw new ReleaseError(`Web smoke HTTP probe failed for ${url}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function smokeWebArtifact(artifactPathInput: string, options: { timeoutMs?: number } = {}): Promise<WebSmokeResult> {
  const artifactPath = resolve(artifactPathInput);
  const structure = await inspectReleaseArtifact(artifactPath, 'Browser');
  const webRoot = structure.webRoot ? join(artifactPath, structure.webRoot) : artifactPath;
  const server = createServer((request, response) => { void staticResponse(webRoot, request, response).catch(() => response.writeHead(500).end('server error')); });
  let port: number | undefined;
  try {
    port = await listen(server);
    const base = `http://127.0.0.1:${port}`;
    const probedPaths = ['/index.html', '/'];
    for (const path of probedPaths) await probeUrl(`${base}${path}`, options.timeoutMs ?? HTTP_TIMEOUT_MS);
    return { kind: 'web', status: 'passed', cleanup: 'confirmed', url: `${base}/`, probedPaths };
  } catch (error) {
    throw error instanceof ReleaseError ? error : new ReleaseError(`Web artifact smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    try {
      await closeServer(server);
    } catch (error) {
      throw new ReleaseError(`Web smoke cleanup is unverified: local server could not shut down: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

interface TreeSnapshot {
  entries: Map<string, string>;
}

async function snapshotTree(root: string): Promise<TreeSnapshot> {
  const entriesSnapshot = new Map<string, string>();
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const relativePath = relative(root, path);
      if (entry.isSymbolicLink()) throw new ReleaseError(`RPG Maker project contains a symbolic link; refusing packaging outside the selected project: ${path}`);
      if (entry.isDirectory()) {
        entriesSnapshot.set(relativePath, 'directory');
        await walk(path);
      } else if (entry.isFile()) {
        entriesSnapshot.set(relativePath, `file:${createHash('sha256').update(await readFile(path)).digest('hex')}`);
      }
    }
  };
  await walk(root);
  return { entries: entriesSnapshot };
}

function changedFiles(before: TreeSnapshot, after: TreeSnapshot): string[] {
  const keys = new Set([...before.entries.keys(), ...after.entries.keys()]);
  return [...keys].filter((key) => before.entries.get(key) !== after.entries.get(key));
}

interface CanonicalOutputPath {
  lexicalPath: string;
  canonicalPath: string;
  canonicalParent: string;
}

async function canonicalizeOutputPath(outputRootInput: string): Promise<CanonicalOutputPath> {
  const lexicalPath = resolve(outputRootInput);
  let cursor = lexicalPath;
  const missing: string[] = [];

  while (true) {
    let info;
    try {
      info = await lstat(cursor);
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') {
        throw new ReleaseError(`Release output path could not be inspected: ${lexicalPath}.`);
      }
      const parent = dirname(cursor);
      if (parent === cursor) throw new ReleaseError(`Release output path has no existing parent: ${lexicalPath}.`);
      missing.unshift(basename(cursor));
      cursor = parent;
      continue;
    }

    if (missing.length > 0 && !(await stat(cursor).catch(() => undefined))?.isDirectory()) {
      throw new ReleaseError(`Release output parent is not a directory: ${cursor}.`);
    }
    const canonicalBase = await realpath(cursor).catch(() => undefined);
    if (!canonicalBase) throw new ReleaseError(`Release output path could not be canonicalized: ${lexicalPath}.`);
    const canonicalPath = missing.length > 0 ? join(canonicalBase, ...missing) : canonicalBase;
    const canonicalParent = missing.length > 0 ? join(canonicalBase, ...missing.slice(0, -1)) : dirname(canonicalBase);
    return { lexicalPath, canonicalPath, canonicalParent };
  }
}

async function canonicalProjectPath(projectPath: string): Promise<string> {
  const canonical = await realpath(projectPath).catch(() => undefined);
  if (!canonical || !(await stat(canonical).catch(() => undefined))?.isDirectory()) {
    throw new ReleaseError(`Selected RPG Maker MV project could not be canonicalized: ${projectPath}.`);
  }
  return canonical;
}

async function beginOutput(outputRootInput: string, projectPath: string, platform: string): Promise<{ outputRoot: string; staging: string }> {
  const output = await canonicalizeOutputPath(outputRootInput);
  if (physicallyWithin(projectPath, output.canonicalPath, platform) || physicallyWithin(output.canonicalPath, projectPath, platform)) {
    throw new ReleaseError(`Release output must be outside the source project; refusing physically overlapping source/output paths ${output.lexicalPath}.`);
  }

  if (await entryExists(output.lexicalPath)) {
    throw new ReleaseError(`Release output must be a fresh destination; refusing to overwrite ${output.lexicalPath}.`);
  }
  await mkdir(output.canonicalParent, { recursive: true });
  const parentReal = await realpath(output.canonicalParent).catch(() => undefined);
  if (!parentReal) throw new ReleaseError(`Release output parent could not be canonicalized: ${output.canonicalParent}.`);
  const canonicalFinal = join(parentReal, basename(output.lexicalPath));
  if (physicallyWithin(projectPath, canonicalFinal, platform) || physicallyWithin(canonicalFinal, projectPath, platform)) {
    throw new ReleaseError(`Release output must be outside the source project; refusing physically overlapping source/output paths ${output.lexicalPath}.`);
  }
  if (await entryExists(output.lexicalPath)) {
    throw new ReleaseError(`Release output appeared while preparing packaging; refusing to overwrite ${output.lexicalPath}.`);
  }
  const staging = await mkdtemp(join(parentReal, `.${basename(output.lexicalPath)}.dsh-release-${randomUUID()}-`));
  return { outputRoot: output.lexicalPath, staging };
}

async function commitOutput(staging: string, outputRoot: string): Promise<void> {
  if (await entryExists(outputRoot)) throw new ReleaseError(`Release output appeared during packaging; refusing to overwrite the racing path ${outputRoot}.`);
  try {
    await fsRename(staging, outputRoot);
  } catch (error) {
    throw new ReleaseError(`Release output could not be committed without overwrite: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function packagingArgs(runtime: RpgmPackerRuntime, projectPath: string, staging: string, installationPath: string, targets: readonly ReleaseTarget[]): string[] {
  return [runtime.script, '--input', projectPath, '--output', staging, '--rpgmaker', installationPath, '--platforms', ...targets];
}

export async function buildRelease(options: BuildReleaseOptions): Promise<BuildReleaseResult> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const validation = await assertValidMvProject(options.projectPath);
  const project = { ...validation, projectPath: await canonicalProjectPath(validation.projectPath) };
  const targets = targetsFor(options.targets);

  if (options.prepareDeployment) {
    await options.prepareDeployment();
    if (!options.validateProject) throw new ReleaseError('Build-release packaging requires validation through the existing RPG Maker MCP before packaging.');
    await options.validateProject();
  } else {
    await prepareRpgMakerDeployment({
      platform,
      env,
      dshHome: options.dshHome,
      runtimeDir: options.runtimeDir,
      projectPath: project.projectPath,
      mcpRuntimeDir: options.mcpRuntimeDir,
      dshExecutable: options.dshExecutable,
      bunExecutable: options.bunExecutable,
      jsExecutable: options.jsExecutable,
      sourceRoot: options.sourceRoot,
      schemaProbe: options.schemaProbe,
      agentPreset: BUILD_RELEASE_PRESET_ID,
      commandRunner: options.commandRunner,
      lockTimeoutMs: options.lockTimeoutMs,
      lockRetryMs: options.lockRetryMs
    } satisfies RpgMakerDeploymentOptions);
    if (options.validateProject) await options.validateProject();
  }

  const installation = await detectRpgMakerMvInstallation({ installationPath: options.rpgmakerInstallationPath, platform, env, targets });
  const before = await snapshotTree(project.projectPath);
  const operation = await beginOutput(options.outputRoot, project.projectPath, platform);
  const runner = options.commandRunner ?? runCommand;
  let committed = false;
  try {
    const runtime = await ensureRpgmPackerRuntime(options, platform, env);
    const args = packagingArgs(runtime, project.projectPath, operation.staging, installation.path, targets);
    let result;
    try {
      result = await runner(runtime.runner, args, { cwd: project.projectPath, env: withoutCredentials(env), platform, timeoutMs: PACKAGER_TIMEOUT_MS });
    } catch (error) {
      throw new ReleaseError(`rpgmpacker could not start: ${redactSensitive(error instanceof Error ? error.message : String(error), env)}`);
    }
    if (result.exitCode !== 0) throw new ReleaseError(commandFailure(runtime.runner, args, result, env).message);

    const artifactResults: ReleaseArtifactResult[] = [];
    for (const target of targets) {
      const stagedArtifact = join(operation.staging, target);
      const structure = await inspectReleaseArtifact(stagedArtifact, target);
      const smoke = target === 'Windows'
        ? await smokeWindowsArtifact(stagedArtifact, { platform, env, spawnProcess: options.spawnProcess, terminateProcessTree: options.terminateProcessTree, timeoutMs: options.smokeTimeoutMs })
        : await smokeWebArtifact(stagedArtifact, { timeoutMs: options.httpTimeoutMs });
      artifactResults.push({ target, outputPath: join(operation.outputRoot, target), structure, smoke });
    }

    const after = await snapshotTree(project.projectPath);
    const changes = changedFiles(before, after);
    if (changes.length > 0) throw new ReleaseError(`Source project changed during packaging; refusing to claim a release: ${changes.slice(0, 10).join(', ')}`);
    await commitOutput(operation.staging, operation.outputRoot);
    committed = true;
    return {
      outputRoot: operation.outputRoot,
      projectPath: project.projectPath,
      rpgmakerInstallation: installation,
      packer: {
        package: RPGMPACKER_PACKAGE,
        version: RPGMPACKER_VERSION,
        runner: runtime.runner,
        script: runtime.script,
        args,
        options: { exclude: false, hardlinks: false, encryption: false }
      },
      validation: 'existing-rpgmaker-mcp',
      artifacts: artifactResults
    };
  } finally {
    if (!committed) await rm(operation.staging, { recursive: true, force: true });
  }
}

export function releaseSummary(result: BuildReleaseResult): string {
  const lines = [`Release output: ${result.outputRoot}`, `Validated through existing RPG Maker MCP`, `rpgmpacker ${result.packer.version} via ${result.packer.script}`, `RPG Maker MV installation: ${result.rpgmakerInstallation.path}`];
  for (const artifact of result.artifacts) {
    lines.push(`${artifact.target} structure: ${artifact.structure.requiredPaths.join(', ')}`);
    if (artifact.smoke.kind === 'windows') {
      lines.push(`${artifact.target} smoke: ${artifact.smoke.status}; cleanup ${artifact.smoke.cleanup}${artifact.smoke.entryPath ? `; entry ${artifact.smoke.entryPath}` : ''}${artifact.smoke.reason ? `; ${artifact.smoke.reason}` : ''}`);
    } else {
      lines.push(`${artifact.target} smoke: ${artifact.smoke.status}; cleanup ${artifact.smoke.cleanup}; HTTP ${artifact.smoke.url}`);
    }
  }
  return lines.join('\n');
}

export { WINDOWS_ENTRY_NAMES, WINDOWS_TEMPLATE };
