import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

export const DSH_PACKAGE_NAME = '@deepseek-ai/dsh';
export const DSH_VERSION = '0.1.2-alpha.3';
export const PRODUCT_VERSION = '0.3.0';
export const DSH_NPM_INTEGRITY = 'sha512-VvATzYmQ4LMJREJ9e2POKksSHRfqP3y9pghplLBaQBuw2BqfbC0mQUVsaPwxe4wlcpj+riEgn8OJB01YnpF+3A==';
export const DSH_RUNTIME_NAME = 'dsh-rpgmaker-runtime';
export const PRODUCT_VENDOR = 'BaiheStudio';
export const PRODUCT_NAME = 'DSH-RPGMaker-MV';
export const START_MENU_NAME = 'RPG Maker Agent';
export const LEGACY_START_MENU_NAME = 'DSH for RPG Maker MV';
export const PROGRAM_OWNERSHIP_FILE = '.dsh-rpgmaker-owned.json';
export const PROGRAM_OWNER = 'dsh-rpgmaker-mv';
export const WINDOWS_DSH_HOST = '127.0.0.1';
export const WINDOWS_DSH_PORT = 3081;

export interface HarnessPaths {
  /** User-selected root that owns program files, runtimes, and disposable cache. */
  installationRoot: string;
  /** Replaceable program tree within the installation root. */
  programRoot: string;
  /** Fixed per-user local state root under LOCALAPPDATA. */
  localStateRoot: string;
  mutableRoot: string;
  dshHome: string;
  logsDir: string;
  cacheDir: string;
  installationCacheDir: string;
  installationReceiptPath: string;
  neutralLandingDir: string;
  startMenuShortcutPath: string;
  runtimeDir: string;
  lockDir: string;
  sessionLeaseDir: string;
}

export interface PathOptions {
  installationRoot?: string;
  localStateRoot?: string;
  dshHome?: string;
  runtimeDir?: string;
  mutableRoot?: string;
  startMenuShortcutPath?: string;
  platform?: string;
  env?: Record<string, string | undefined>;
}

export function legacyStartMenuShortcutPath(options: Pick<PathOptions, 'env'> = {}): string {
  const env = options.env ?? process.env;
  const appData = env.APPDATA ?? join(env.USERPROFILE ?? homedir(), 'AppData', 'Roaming');
  return resolve(join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', PRODUCT_VENDOR, `${LEGACY_START_MENU_NAME}.lnk`));
}

function defaultWindowsProgramRoot(env: Record<string, string | undefined>): string {
  return resolve(env.LOCALAPPDATA ?? env.USERPROFILE ?? homedir(), 'Programs', PRODUCT_VENDOR, PRODUCT_NAME);
}

function defaultWindowsMutableRoot(env: Record<string, string | undefined>): string {
  return resolve(env.LOCALAPPDATA ?? env.USERPROFILE ?? homedir(), PRODUCT_VENDOR, PRODUCT_NAME);
}

function defaultDshHome(platform: string, env: Record<string, string | undefined>): string {
  if (platform === 'win32') return join(defaultWindowsMutableRoot(env), 'state');
  return resolve(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'dsh');
}

export function resolveHarnessPaths(options: PathOptions = {}): HarnessPaths {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const explicitMutableRoot = options.localStateRoot ?? options.mutableRoot ?? env.DSH_RPGMAKER_LOCAL_STATE_ROOT ?? env.DSH_RPGMAKER_DATA_ROOT ?? env.DSH_RPGMAKER_MUTABLE_ROOT;
  const explicitDshHome = options.dshHome ?? env.DSH_HOME;
  const mutableRoot = resolve(explicitMutableRoot ?? (explicitDshHome ? dirname(resolve(explicitDshHome)) : platform === 'win32' ? defaultWindowsMutableRoot(env) : resolve(join(homedir(), '.config', 'dsh'))));
  // An explicit local-state root owns DSH_HOME by default.  This keeps
  // disposable/test-owned runs and receipt-backed maintenance from leaking
  // credentials or settings into an ambient DSH_HOME.
  const dshHome = resolve(options.dshHome ?? (explicitMutableRoot ? join(mutableRoot, 'state') : explicitDshHome ?? defaultDshHome(platform, env)));
  const explicitInstallationRoot = options.installationRoot ?? env.DSH_RPGMAKER_INSTALLATION_ROOT;
  const installationRoot = resolve(explicitInstallationRoot ?? (platform === 'win32'
    ? (explicitDshHome ? dirname(dshHome) : defaultWindowsProgramRoot(env))
    : dirname(dshHome)));
  // The replaceable program tree is always a distinct child of the selected
  // installation root.  There is no direct program-root compatibility path.
  const programRoot = resolve(join(installationRoot, 'program'));
  const logsDir = join(mutableRoot, 'logs');
  const installationCacheDir = join(installationRoot, 'cache');
  // Cache is disposable and therefore belongs to the selected installation
  // root, not the fixed local-state tree.
  const cacheDir = installationCacheDir;
  const neutralLandingDir = join(programRoot, 'neutral');
  const appData = env.APPDATA ?? join(env.USERPROFILE ?? homedir(), 'AppData', 'Roaming');
  const startMenuShortcutPath = resolve(options.startMenuShortcutPath ?? join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', PRODUCT_VENDOR, `${START_MENU_NAME}.lnk`));
  const runtimeDir = resolve(options.runtimeDir ?? env.DSH_RPGMAKER_RUNTIME ?? join(programRoot, 'runtime', 'dsh'));
  return {
    installationRoot,
    programRoot,
    localStateRoot: mutableRoot,
    mutableRoot,
    dshHome,
    logsDir,
    cacheDir,
    installationCacheDir,
    installationReceiptPath: join(mutableRoot, 'installation-location.json'),
    neutralLandingDir,
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
