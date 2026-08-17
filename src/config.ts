import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

export const DSH_PACKAGE_NAME = '@deepseek-ai/dsh';
export const DSH_VERSION = '0.1.0-rc.6';
export const DSH_RUNTIME_NAME = 'dsh-rpgmaker-runtime';

export interface HarnessPaths {
  dshHome: string;
  runtimeDir: string;
  lockDir: string;
}

export interface PathOptions {
  dshHome?: string;
  runtimeDir?: string;
  platform?: string;
  env?: Record<string, string | undefined>;
}

function defaultDshHome(platform: string, env: Record<string, string | undefined>): string {
  if (platform === 'win32') {
    return resolve(env.LOCALAPPDATA ?? env.USERPROFILE ?? homedir(), 'dsh');
  }
  if (platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'dsh');
  }
  return resolve(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'dsh');
}

export function resolveHarnessPaths(options: PathOptions = {}): HarnessPaths {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const dshHome = resolve(options.dshHome ?? env.DSH_HOME ?? defaultDshHome(platform, env));
  const runtimeDir = resolve(options.runtimeDir ?? env.DSH_RPGMAKER_RUNTIME ?? join(dshHome, 'rpgmaker-mv', 'runtime'));
  return {
    dshHome,
    runtimeDir,
    lockDir: `${runtimeDir}.lock`
  };
}

export function pathDelimiter(platform: string = process.platform): string {
  return platform === 'win32' ? ';' : delimiter;
}
