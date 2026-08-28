import { isRegularFile } from './files';
import { lstat, readdir } from 'node:fs/promises';
import { extname, isAbsolute, join } from 'node:path';
import { environmentPath, pathDelimiter } from './config';
import { runCommand, withoutCredentials, type CommandRunner } from './process';

export interface ExecutableLookupOptions {
  platform?: string;
  env?: Record<string, string | undefined>;
  commandRunner?: CommandRunner;
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
 * prefer the actual WinGet installation under `%ProgramFiles%\PowerShell\7`
 * or the Microsoft Store/MSIX package directory.
 */
export async function resolveWindowsPwsh(options: ExecutableLookupOptions = {}): Promise<string | undefined> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const explicit = env.PWSH_EXECUTABLE;
  const isWindowsAppsAlias = (path: string): boolean => /[\\/]WindowsApps[\\/]pwsh\.exe$/i.test(path);
  if (explicit) {
    const executable = await resolveExecutable(explicit, { platform, env });
    if (executable && !isWindowsAppsAlias(executable)) return executable;
  }
  const resolved = await resolveExecutable('pwsh', { platform, env });
  if (resolved && !isWindowsAppsAlias(resolved)) return resolved;
  const programFiles = env.ProgramFiles ?? env.ProgramW6432;
  if (programFiles) {
    const standard = join(programFiles, 'PowerShell', '7', 'pwsh.exe');
    if (await isRegularFile(standard)) return standard;
    const store = await resolveMsixPowerShell(programFiles);
    if (store) return store;
  }
  return resolved && !isWindowsAppsAlias(resolved) ? resolved : undefined;
}

/**
 * Resolve the real 7-Zip executable for Windows. 7-Zip may be installed under
 * Program Files, Program Files (x86), ProgramW6432, or a per-user WinGet/
 * Programs directory depending on how it was installed; search all standard
 * roots before falling back to PATH so an already installed 7-Zip is reused
 * rather than reinstalled. Candidates are deduplicated and the chosen
 * executable is identity-verified by the caller via `7z i`.
 */
export async function resolveWindowsSevenZip(options: ExecutableLookupOptions = {}): Promise<string | undefined> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const explicit = env.SEVEN_ZIP_EXECUTABLE;
  if (explicit) return resolveExecutable(explicit, { platform, env });
  const roots = [
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    env.ProgramW6432,
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Programs') : undefined
  ];
  const seen = new Set<string>();
  const consider = async (candidate: string | undefined): Promise<string | undefined> => {
    if (!candidate) return undefined;
    const identity = candidate.toLowerCase();
    if (seen.has(identity)) return undefined;
    seen.add(identity);
    return await isRegularFile(candidate) ? candidate : undefined;
  };
  for (const root of roots) {
    if (!root) continue;
    const found = await consider(join(root, '7-Zip', '7z.exe'));
    if (found) return found;
  }
  // WinGet allows a custom InstallLocation (e.g. D:\解压\7-Zip). The package
  // records it under the 7-Zip registry keys, so an already-installed 7-Zip
  // must be reused from there before falling back to a PATH lookup.
  const runner = options.commandRunner ?? runCommand;
  for (const candidate of await readSevenZipRegistryPaths(runner, env)) {
    const found = await consider(candidate);
    if (found) return found;
  }
  return resolveExecutable('7z', { platform, env });
}

const SEVEN_ZIP_REGISTRY_KEYS = [
  ['HKLM', 'SOFTWARE\\7-Zip'],
  ['HKLM', 'SOFTWARE\\WOW6432Node\\7-Zip'],
  ['HKCU', 'SOFTWARE\\7-Zip']
] as const;

/** Read 7-Zip install paths from the supported registry keys without touching live values on non-Windows hosts. */
async function readSevenZipRegistryPaths(runner: CommandRunner, env: Record<string, string | undefined>): Promise<string[]> {
  const reg = env.SystemRoot ? join(env.SystemRoot, 'System32', 'reg.exe') : 'reg.exe';
  const results: string[] = [];
  for (const [hive, key] of SEVEN_ZIP_REGISTRY_KEYS) {
    try {
      const result = await runner(reg, ['query', `${hive}\\${key}`, '/v', 'Path'], {
        env: withoutCredentials(env),
        platform: 'win32',
        timeoutMs: 15_000
      });
      if (result.exitCode !== 0) continue;
      const value = result.stdout.match(/^\s*Path\s+REG_[A-Z_]+\s+(.*)$/im)?.[1]?.trim();
      if (!value) continue;
      const expanded = value.replace(/%([^%]+)%/g, (_match, name: string) => env[name] ?? process.env[name] ?? `%${name}%`);
      if (expanded.includes('%')) continue;
      const leaf = expanded.trim().replace(/[\\/]+$/, '');
      if (!leaf) continue;
      results.push(join(leaf, '7z.exe'));
    } catch {
      // A missing/unreadable registry key is not an error; other roots still apply.
    }
  }
  return results;
}

/**
 * Parse a 7-Zip version from the `7z i` banner. Accepts both the modern form
 * ("7-Zip 24.09 (x64)") and legacy builds ("7-Zip [64] 19.00") so the recorded
 * version is the real product version rather than bitness or banner noise.
 */
export function parseSevenZipVersion(output: string): [number, number, number] | undefined {
  const match = output.match(/7-Zip(?:\s+\[[^\]]*\])?\s+(\d+)\.(\d+)(?:\.(\d+))?/i);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

/**
 * Return the exact version text as printed by 7-Zip ("24.09", "19.00") so
 * user-visible reports match the real banner rather than a normalized tuple.
 */
export function parseSevenZipVersionText(output: string): string | undefined {
  const match = output.match(/7-Zip(?:\s+\[[^\]]*\])?\s+(\d+\.\d+(?:\.\d+)?)/i);
  return match?.[1];
}

/** Find the newest installed Microsoft Store PowerShell package executable, if any. */
async function resolveMsixPowerShell(programFiles: string): Promise<string | undefined> {
  const appsRoot = join(programFiles, 'WindowsApps');
  let entries;
  try {
    entries = await readdir(appsRoot, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const candidates = entries
    .filter((entry) => entry.isDirectory() && /^Microsoft\.PowerShell_/i.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const name of candidates) {
    const pwsh = join(appsRoot, name, 'pwsh.exe');
    if (await isRegularFile(pwsh)) return pwsh;
  }
  return undefined;
}
