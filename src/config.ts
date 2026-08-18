import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

export const DSH_PACKAGE_NAME = '@deepseek-ai/dsh';
export const DSH_VERSION = '0.1.0-rc.7';
export const DSH_NPM_INTEGRITY = 'sha512-ZceDCJ8FAywih+USW/OMk9jEhunlvJBGEz4kqrhau23hPzbciOazZrywH0nBRsaalSeAJ1JGBmjtw4OSjToStw==';
export const DSH_RUNTIME_NAME = 'dsh-rpgmaker-runtime';
export const PRODUCT_VENDOR = 'BaiheStudio';
export const PRODUCT_NAME = 'DSH-RPGMaker-MV';
export const START_MENU_NAME = 'DSH for RPG Maker MV';
export const PROGRAM_OWNERSHIP_FILE = '.dsh-rpgmaker-owned.json';
export const PROGRAM_OWNER = 'dsh-rpgmaker-mv';
export const WINDOWS_DSH_HOST = '127.0.0.1';
export const WINDOWS_DSH_PORT = 3081;

export interface HarnessPaths {
  programRoot: string;
  mutableRoot: string;
  dshHome: string;
  logsDir: string;
  cacheDir: string;
  recentProjectsPath: string;
  startMenuShortcutPath: string;
  runtimeDir: string;
  lockDir: string;
  sessionLeaseDir: string;
}

export interface PathOptions {
  dshHome?: string;
  runtimeDir?: string;
  programRoot?: string;
  mutableRoot?: string;
  startMenuShortcutPath?: string;
  platform?: string;
  env?: Record<string, string | undefined>;
}

function defaultWindowsProgramRoot(env: Record<string, string | undefined>): string {
  return resolve(env.LOCALAPPDATA ?? env.USERPROFILE ?? homedir(), 'Programs', PRODUCT_VENDOR, PRODUCT_NAME);
}

function defaultWindowsMutableRoot(env: Record<string, string | undefined>): string {
  return resolve(env.LOCALAPPDATA ?? env.USERPROFILE ?? homedir(), PRODUCT_VENDOR, PRODUCT_NAME);
}

function defaultDshHome(platform: string, env: Record<string, string | undefined>): string {
  if (platform === 'win32') return join(defaultWindowsMutableRoot(env), 'state');
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'dsh');
  return resolve(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'dsh');
}

export function resolveHarnessPaths(options: PathOptions = {}): HarnessPaths {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const explicitDshHome = options.dshHome ?? env.DSH_HOME;
  const dshHome = resolve(explicitDshHome ?? defaultDshHome(platform, env));
  const explicitMutableRoot = options.mutableRoot ?? env.DSH_RPGMAKER_DATA_ROOT ?? env.DSH_RPGMAKER_MUTABLE_ROOT;
  const mutableRoot = resolve(explicitMutableRoot ?? (explicitDshHome ? dirname(dshHome) : platform === 'win32' ? defaultWindowsMutableRoot(env) : dirname(dshHome)));
  const explicitProgramRoot = options.programRoot ?? env.DSH_RPGMAKER_PROGRAM_ROOT;
  const programRoot = resolve(explicitProgramRoot ?? (platform === 'win32'
    ? (explicitDshHome ? join(dirname(dshHome), 'program') : defaultWindowsProgramRoot(env))
    : join(dirname(dshHome), 'program')));
  const logsDir = join(mutableRoot, 'logs');
  const cacheDir = join(mutableRoot, 'cache');
  const recentProjectsPath = join(mutableRoot, 'recent-projects.json');
  const appData = env.APPDATA ?? join(env.USERPROFILE ?? homedir(), 'AppData', 'Roaming');
  const startMenuShortcutPath = resolve(options.startMenuShortcutPath ?? join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', PRODUCT_VENDOR, `${START_MENU_NAME}.lnk`));
  const runtimeDir = resolve(options.runtimeDir ?? env.DSH_RPGMAKER_RUNTIME ?? join(programRoot, 'runtime', 'dsh'));
  return {
    programRoot,
    mutableRoot,
    dshHome,
    logsDir,
    cacheDir,
    recentProjectsPath,
    startMenuShortcutPath,
    runtimeDir,
    lockDir: `${runtimeDir}.lock`,
    sessionLeaseDir: `${runtimeDir}.session`
  };
}

export function pathDelimiter(platform: string = process.platform): string {
  return platform === 'win32' ? ';' : delimiter;
}

export function environmentPath(env: Record<string, string | undefined>, platform: string = process.platform): string {
  if (platform !== 'win32') return env.PATH ?? '';
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === 'path');
  return key ? env[key] ?? '' : '';
}

/**
 * Return `env` with every case-insensitive PATH key variant replaced by one
 * canonical `PATH` holding `value`. Windows environment keys are
 * case-insensitive; keeping both `Path` and `PATH` lets child-process spawning
 * pick a stale variant, so this normalizes to exactly one key.
 */
export function withEnvironmentPath(
  env: Record<string, string | undefined>,
  value: string,
  platform: string = process.platform
): Record<string, string | undefined> {
  const next = { ...env };
  const matches = platform === 'win32'
    ? (key: string): boolean => key.toLowerCase() === 'path'
    : (key: string): boolean => key === 'PATH';
  for (const key of Object.keys(next)) {
    if (matches(key)) delete next[key];
  }
  next.PATH = value;
  return next;
}
