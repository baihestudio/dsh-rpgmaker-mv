import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROGRAM_OWNER, PROGRAM_OWNERSHIP_FILE, PRODUCT_NAME, resolveHarnessPaths, WINDOWS_DSH_HOST, WINDOWS_DSH_PORT, type HarnessPaths, type PathOptions } from './config';
import { resolveWindowsPwsh } from './executable';
import { redactSensitive, runCommand, withoutCredentials, type CommandRunner } from './process';

export interface HarnessLayout {
  paths: HarnessPaths;
  stateDir: string;
  logsDir: string;
  cacheDir: string;
}

export async function ensureHarnessLayout(options: PathOptions = {}): Promise<HarnessLayout> {
  const paths = resolveHarnessPaths(options);
  await mkdir(paths.mutableRoot, { recursive: true });
  await mkdir(paths.dshHome, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });
  await mkdir(paths.cacheDir, { recursive: true });
  return { paths, stateDir: paths.dshHome, logsDir: paths.logsDir, cacheDir: paths.cacheDir };
}

async function fileIsDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export type PortProbe = (host: string, port: number) => Promise<boolean>;
export type PortConflictAction = 'open-existing' | 'retry' | 'cancel';
export type ExistingSessionOpener = (url: string) => Promise<void>;

export function probeLoopbackPort(host: string = WINDOWS_DSH_HOST, port: number = WINDOWS_DSH_PORT, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolveProbe) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (occupied: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveProbe(occupied);
    };
    const socket = createConnection({ host, port });
    timer = setTimeout(() => {
      socket.destroy();
      finish(false);
    }, timeoutMs);
    socket.once('connect', () => {
      socket.destroy();
      finish(true);
    });
    socket.once('error', () => finish(false));
  });
}

export async function openExistingDshSession(
  url: string = `http://${WINDOWS_DSH_HOST}:${WINDOWS_DSH_PORT}/`,
  options: { platform?: string; env?: Record<string, string | undefined>; commandRunner?: CommandRunner } = {}
): Promise<void> {
  if ((options.platform ?? process.platform) !== 'win32') throw new Error('Opening an existing DSH session is supported on Windows only.');
  const runner = options.commandRunner ?? runCommand;
  const explorer = options.env?.EXPLORER_EXECUTABLE ?? 'explorer.exe';
  const result = await runner(explorer, [url], { env: withoutCredentials(options.env ?? process.env), platform: 'win32', timeoutMs: 30_000 });
  if (result.exitCode !== 0) throw new Error(`Could not open the existing DSH session at ${url}.`);
}

export interface PortAvailabilityOptions {
  platform?: string;
  host?: string;
  port?: number;
  portProbe?: PortProbe;
  onConflict?: (url: string) => Promise<PortConflictAction> | PortConflictAction;
  openExisting?: ExistingSessionOpener;
  notify?: (message: string) => void;
  maxRetries?: number;
}

export class ExistingDshSessionError extends Error {
  readonly url: string;

  constructor(url: string) {
    super(`An existing DSH session is already running at ${url}; it was opened instead of starting a second project.`);
    this.name = 'ExistingDshSessionError';
    this.url = url;
  }
}

export async function ensureFixedPortAvailable(options: PortAvailabilityOptions = {}): Promise<void> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return;
  const host = options.host ?? WINDOWS_DSH_HOST;
  const port = options.port ?? WINDOWS_DSH_PORT;
  const url = `http://${host}:${port}/`;
  const probe = options.portProbe ?? probeLoopbackPort;
  const maxRetries = options.maxRetries ?? 3;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (!(await probe(host, port))) return;
    options.notify?.(`Port ${host}:${port} is occupied. Choose “open existing session” or close it and retry; the harness will not choose another port.`);
    const action = options.onConflict ? await options.onConflict(url) : 'cancel';
    if (action === 'open-existing') {
      if (options.openExisting) await options.openExisting(url);
      throw new ExistingDshSessionError(url);
    }
    if (action === 'retry') continue;
    throw new Error(`Port ${host}:${port} is occupied. Open ${url} or close the existing session, then retry. The harness never changes the fixed port.`);
  }
  throw new Error(`Port ${host}:${port} is still occupied after retrying. Close the existing session and retry.`);
}

export interface ShortcutCreationOptions extends PathOptions {
  platform?: string;
  env?: Record<string, string | undefined>;
  pwshExecutable?: string;
  helperScript?: string;
  targetPath: string;
  workingDirectory: string;
  iconPath?: string;
  commandRunner?: CommandRunner;
}

export async function createStartMenuShortcut(options: ShortcutCreationOptions): Promise<string> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') throw new Error('Start Menu shortcuts are supported on Windows only.');
  const paths = resolveHarnessPaths(options);
  const env = options.env ?? process.env;
  const helperScript = options.helperScript ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'create-shortcut.ps1');
  const pwsh = options.pwshExecutable ?? env.PWSH_EXECUTABLE ?? await resolveWindowsPwsh({ platform, env }) ?? 'pwsh.exe';
  const runner = options.commandRunner ?? runCommand;
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', helperScript, '-TargetPath', options.targetPath, '-ShortcutPath', paths.startMenuShortcutPath, '-WorkingDirectory', options.workingDirectory];
  if (options.iconPath) args.push('-IconPath', options.iconPath);
  const result = await runner(pwsh, args, { env: withoutCredentials(env), platform, timeoutMs: 30_000 });
  if (result.exitCode !== 0) throw new Error(`Start Menu shortcut could not be created at ${paths.startMenuShortcutPath}.`);
  return paths.startMenuShortcutPath;
}

export class UninstallSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UninstallSafetyError';
  }
}

async function readObject(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function sameWindowsPath(left: unknown, right: string, platform: string): boolean {
  if (typeof left !== 'string') return false;
  const normalize = (value: string): string => value.replace(/[\\/]+/g, '/').replace(/\/$/, '');
  const a = normalize(left);
  const b = normalize(right);
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export async function validateHarnessOwnership(options: PathOptions = {}): Promise<void> {
  const platform = options.platform ?? process.platform;
  const paths = resolveHarnessPaths(options);
  if (!(await fileIsDirectory(paths.programRoot))) throw new UninstallSafetyError(`Harness program root does not exist: ${paths.programRoot}`);
  const markerPath = join(paths.programRoot, PROGRAM_OWNERSHIP_FILE);
  const marker = await readObject(markerPath);
  if (marker?.owner !== PROGRAM_OWNER || marker.product !== PRODUCT_NAME || marker.format !== 1) {
    throw new UninstallSafetyError(`Refusing to remove ${paths.programRoot}: the harness ownership marker is missing or invalid.`);
  }
  const metadataPath = join(paths.programRoot, 'install.json');
  const metadata = await readObject(metadataPath);
  if (metadata?.owner !== PROGRAM_OWNER
    || metadata.product !== PRODUCT_NAME
    || metadata.format !== 1
    || !sameWindowsPath(metadata.programRoot, paths.programRoot, platform)
    || !sameWindowsPath(metadata.mutableRoot, paths.mutableRoot, platform)
    || !sameWindowsPath(metadata.dshHome, paths.dshHome, platform)
    || !sameWindowsPath(metadata.runtimeDir, paths.runtimeDir, platform)) {
    throw new UninstallSafetyError(`Refusing to remove ${paths.programRoot}: install.json is missing, invalid, or does not belong to this harness layout.`);
  }
}

const RECOVERY_NAME = /(?:\.rollback-|\.failed-|\.recovery-|\.staging-|\.install-)/i;

async function recoveryEntries(parent: string, programName: string): Promise<string[]> {
  const names = await readdir(parent, { withFileTypes: true }).catch(() => []);
  return names
    .filter((entry) => entry.isDirectory() && (entry.name.startsWith(`${programName}.rollback-`)
      || entry.name.startsWith(`${programName}.failed-`)
      || entry.name.startsWith(`${programName}.recovery-`)
      || entry.name.startsWith(`.${programName}.install-`)))
    .map((entry) => resolve(parent, entry.name));
}

async function nestedRecoveryEntries(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = join(current, entry.name);
      if (RECOVERY_NAME.test(entry.name)) {
        found.push(child);
        continue;
      }
      await walk(child);
    }
  }
  await walk(root);
  return found;
}

async function preserveNestedRecovery(programRoot: string): Promise<string[]> {
  const entries = await nestedRecoveryEntries(programRoot);
  if (entries.length === 0) return [];
  const destination = join(dirname(programRoot), `${basename(programRoot)}.recovery-${Date.now()}-${randomUUID()}`);
  for (const entry of entries) {
    const target = join(destination, relative(programRoot, entry));
    await mkdir(dirname(target), { recursive: true });
    await rename(entry, target);
  }
  return [destination];
}

export interface UninstallOptions extends PathOptions {
  platform?: string;
  env?: Record<string, string | undefined>;
  purge?: boolean;
  removeShortcut?: (path: string) => Promise<void>;
}

export interface UninstallResult {
  programRoot: string;
  mutableRoot: string;
  shortcutPath: string;
  removed: string[];
  preserved: string[];
  purged: boolean;
}

export async function uninstallHarness(options: UninstallOptions = {}): Promise<UninstallResult> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') throw new Error('The Windows harness uninstaller can only run on Windows.');
  const paths = resolveHarnessPaths(options);
  const removed: string[] = [];
  const preserved = await recoveryEntries(dirname(paths.programRoot), basename(paths.programRoot));
  const programStat = await lstat(paths.programRoot).catch(() => undefined);
  if (programStat?.isSymbolicLink()) throw new UninstallSafetyError(`Refusing to remove ${paths.programRoot}: the harness program root is a symbolic link.`);
  if (programStat && !programStat.isDirectory()) throw new UninstallSafetyError(`Refusing to remove ${paths.programRoot}: the harness program root is not a directory.`);
  const programExists = programStat?.isDirectory() ?? false;
  if (programExists) await validateHarnessOwnership(options);

  // A missing active tree is already uninstalled. Never remove a shortcut or
  // recovery tree in that case: neither can be proven to be ours here.
  if (programExists) {
    preserved.push(...await preserveNestedRecovery(paths.programRoot));
    const removeShortcut = options.removeShortcut ?? (async (path: string) => { await rm(path, { force: true }); });
    await removeShortcut(paths.startMenuShortcutPath);
    removed.push(paths.startMenuShortcutPath);
    await rm(paths.programRoot, { recursive: true, force: true });
    removed.push(paths.programRoot);
  }
  await rm(paths.cacheDir, { recursive: true, force: true });
  removed.push(paths.cacheDir);
  if (options.purge) {
    await rm(paths.mutableRoot, { recursive: true, force: true });
    removed.push(paths.mutableRoot);
    return { programRoot: paths.programRoot, mutableRoot: paths.mutableRoot, shortcutPath: paths.startMenuShortcutPath, removed, preserved, purged: true };
  }
  return {
    programRoot: paths.programRoot,
    mutableRoot: paths.mutableRoot,
    shortcutPath: paths.startMenuShortcutPath,
    removed,
    preserved: [...preserved, paths.dshHome, paths.logsDir],
    purged: false
  };
}

export async function writeLaunchLog(options: PathOptions & { event: string; preset?: string; host?: string; port?: number }): Promise<void> {
  const layout = await ensureHarnessLayout(options);
  const entry = {
    at: new Date().toISOString(),
    event: options.event,
    ...(options.preset ? { preset: options.preset } : {}),
    ...(options.host ? { host: options.host } : {}),
    ...(options.port ? { port: options.port } : {})
  };
  await writeFile(resolve(layout.logsDir, 'launcher.log'), `${redactSensitive(JSON.stringify(entry), options.env ?? process.env)}\n`, { encoding: 'utf8', flag: 'a' });
}
