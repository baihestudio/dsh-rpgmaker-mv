import { isRegularFile } from './files';
import { lstat } from 'node:fs/promises';
import { extname, isAbsolute, join } from 'node:path';
import { environmentPath, pathDelimiter } from './config';

export interface ExecutableLookupOptions {
  platform?: string;
  env?: Record<string, string | undefined>;
}

function looksLikePath(value: string): boolean {
  return isAbsolute(value) || value.includes('/') || value.includes('\\');
}

async function isExecutableFile(path: string, platform: string): Promise<boolean> {
  if (await isRegularFile(path)) return true;
  if (platform !== 'win32' || extname(path).toLowerCase() !== '.exe') return false;
  try {
    const entry = await lstat(path);
    return entry.isFile() || entry.isSymbolicLink();
  } catch {
    return false;
  }
}

export async function resolveExecutable(name: string, options: ExecutableLookupOptions = {}): Promise<string | undefined> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const requested = name.trim();
  if (!requested) return undefined;

  if (looksLikePath(requested)) {
    if (await isExecutableFile(requested, platform)) return requested;
    if (platform === 'win32' && !requested.includes('.')) {
      for (const extension of ['.exe', '.cmd', '.bat', '.ps1']) {
        if (await isExecutableFile(`${requested}${extension}`, platform)) return `${requested}${extension}`;
      }
    }
    return undefined;
  }

  const entries = environmentPath(env, platform).split(pathDelimiter(platform)).filter(Boolean);
  const names = platform === 'win32'
    ? (extname(requested) ? [requested] : [`${requested}.exe`, `${requested}.cmd`, `${requested}.bat`, `${requested}.ps1`, requested])
    : [requested];
  for (const entry of entries) {
    for (const candidate of names) {
      const path = join(entry.replace(/^"|"$/g, ''), candidate);
      if (await isExecutableFile(path, platform)) return path;
    }
  }
  return undefined;
}

/**
 * Resolve the real PowerShell 7 executable for Windows, avoiding the
 * WindowsApps App Execution Alias (`WindowsApps\pwsh.exe`). The alias is a
 * reparse-point stub that Bun and Node cannot spawn as a normal executable;
 * prefer the actual WinGet/MSIX installation under `%ProgramFiles%\PowerShell\7`.
 */
export async function resolveWindowsPwsh(options: ExecutableLookupOptions = {}): Promise<string | undefined> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const explicit = env.PWSH_EXECUTABLE;
  if (explicit) return resolveExecutable(explicit, { platform, env });
  const resolved = await resolveExecutable('pwsh', { platform, env });
  if (resolved && !/windowsapps/i.test(resolved)) return resolved;
  const programFiles = env.ProgramFiles ?? env.ProgramW6432;
  if (programFiles) {
    const standard = join(programFiles, 'PowerShell', '7', 'pwsh.exe');
    if (await isRegularFile(standard)) return standard;
  }
  return resolved;
}
