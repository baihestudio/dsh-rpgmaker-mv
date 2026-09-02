import { isRegularFile } from './files';
import { lstat, readdir } from 'node:fs/promises';
import { basename, extname, isAbsolute, join } from 'node:path';
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
 * prefer the actual WinGet installation under `%ProgramFiles%\PowerShell\7`
 * or the Microsoft Store/MSIX package directory.
 */
export async function resolveWindowsPwsh(options: ExecutableLookupOptions = {}): Promise<string | undefined> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const explicit = env.PWSH_EXECUTABLE;
  const isWindowsAppsAlias = (path: string): boolean => /[\\/]WindowsApps[\\/]pwsh\.exe$/i.test(path);
  const isDirectPwsh = (path: string): boolean => basename(path.replaceAll('\\', '/')).toLowerCase() === 'pwsh.exe' && !isWindowsAppsAlias(path);
  if (explicit) {
    const executable = await resolveExecutable(explicit, { platform, env });
    if (executable && isDirectPwsh(executable)) return executable;
  }
  // `resolveExecutable` intentionally returns the first PATH match, which can
  // be the WindowsApps execution alias. Scan every PATH entry here so an
  // actual pwsh.exe later on PATH is still found instead of being hidden by
  // that alias.
  const pathCandidates = environmentPath(env, platform)
    .split(pathDelimiter(platform))
    .filter(Boolean)
    .map((entry) => join(entry.replace(/^"|"$/g, ''), 'pwsh.exe'));
  for (const candidate of pathCandidates) {
    if (isDirectPwsh(candidate) && await isRegularFile(candidate)) return candidate;
  }
  const resolved = await resolveExecutable('pwsh', { platform, env });
  if (resolved && isDirectPwsh(resolved)) return resolved;
  const programFilesRoots = [...new Set([env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)']].filter((value): value is string => Boolean(value)))];
  for (const programFiles of programFilesRoots) {
    const standard = join(programFiles, 'PowerShell', '7', 'pwsh.exe');
    if (await isRegularFile(standard)) return standard;
    const store = await resolveMsixPowerShell(programFiles);
    if (store && isDirectPwsh(store)) return store;
  }
  return resolved && isDirectPwsh(resolved) ? resolved : undefined;
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
    .sort((left, right) => {
      const parseVersion = (value: string): number[] => value.match(/_(\d+(?:\.\d+){0,3})_/)?.[1]?.split('.').map(Number) ?? [];
      const leftVersion = parseVersion(left);
      const rightVersion = parseVersion(right);
      for (let index = 0; index < Math.max(leftVersion.length, rightVersion.length); index += 1) {
        const delta = (rightVersion[index] ?? 0) - (leftVersion[index] ?? 0);
        if (delta !== 0) return delta;
      }
      return right.localeCompare(left);
    });
  for (const name of candidates) {
    const pwsh = join(appsRoot, name, 'pwsh.exe');
    if (await isRegularFile(pwsh)) return pwsh;
  }
  return undefined;
}

/**
 * Resolve a spawnable native Node executable for Windows.  `node.cmd`, Bun,
 * and App Execution Alias shims are intentionally not accepted: JavaScript
 * MCP/DSH entrypoints need a direct `node.exe` process image.
 */
export async function resolveWindowsNode(options: ExecutableLookupOptions = {}): Promise<string | undefined> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (platform !== 'win32') return resolveExecutable('node', { platform, env });
  const candidates: string[] = [];
  if (env.NODE_EXECUTABLE) {
    const explicit = env.NODE_EXECUTABLE;
    const normalizedExplicit = explicit.replaceAll('\\', '/');
    if (
      basename(normalizedExplicit).toLowerCase() !== 'node.exe' ||
      /\/WindowsApps\/.*node\.exe$/i.test(normalizedExplicit) ||
      !(await isRegularFile(explicit))
    ) {
      return undefined;
    }
    return explicit;
  }
  for (const entry of environmentPath(env, platform).split(pathDelimiter(platform)).filter(Boolean)) {
    candidates.push(join(entry.replace(/^"|"$/g, ''), 'node.exe'));
  }
  for (const root of [env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)']]) {
    if (root) candidates.push(join(root, 'nodejs', 'node.exe'));
  }
  if (env.LOCALAPPDATA) candidates.push(join(env.LOCALAPPDATA, 'Programs', 'nodejs', 'node.exe'));
  for (const candidate of candidates) {
    const normalizedCandidate = candidate.replaceAll('\\', '/');
    if (basename(normalizedCandidate).toLowerCase() !== 'node.exe' || /\/WindowsApps\/.*node\.exe$/i.test(normalizedCandidate)) continue;
    if (await isRegularFile(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Resolve a direct Windows executable with an exact `.exe` basename.  This is
 * intentionally separate from `resolveExecutable`, whose compatibility
 * behaviour also considers `.cmd`, `.bat`, and App Execution Alias shims.
 */
export async function resolveWindowsDirectExecutable(
  name: string,
  options: ExecutableLookupOptions = {}
): Promise<string | undefined> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (platform !== 'win32') return resolveExecutable(name, { platform, env });
  const expected = `${name.replace(/\.exe$/i, '')}.exe`.toLowerCase();
  const candidates: string[] = [];
  const variable = `${name.replace(/\.exe$/i, '').toUpperCase()}_EXECUTABLE`;
  const explicit = env[variable];
  if (explicit) {
    const normalizedExplicit = explicit.replaceAll('\\', '/');
    if (
      basename(normalizedExplicit).toLowerCase() !== expected ||
      /\/WindowsApps\/.*(?:node|bun)\.exe$/i.test(normalizedExplicit) ||
      !(await isRegularFile(explicit))
    ) {
      return undefined;
    }
    return explicit;
  }
  for (const entry of environmentPath(env, platform).split(pathDelimiter(platform)).filter(Boolean)) {
    candidates.push(join(entry.replace(/^"|"$/g, ''), expected));
  }
  if (name.replace(/\.exe$/i, '').toLowerCase() === 'bun') {
    if (env.USERPROFILE) candidates.push(join(env.USERPROFILE, '.bun', 'bin', 'bun.exe'));
    if (env.LOCALAPPDATA) candidates.push(join(env.LOCALAPPDATA, 'Programs', 'Bun', 'bun.exe'));
  }
  for (const candidate of candidates) {
    if (basename(candidate.replaceAll('\\', '/')).toLowerCase() !== expected) continue;
    if (/[\\/]WindowsApps\/.*(?:node|bun)\.exe$/i.test(candidate.replaceAll('\\', '/'))) continue;
    if (await isRegularFile(candidate)) return candidate;
  }
  return undefined;
}
