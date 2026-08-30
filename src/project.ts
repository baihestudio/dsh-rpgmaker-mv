import { access, constants, readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { isRegularFile } from './files';

export const MV_PROJECT_MARKER = 'Game.rpgproject';
export const MV_REQUIRED_DIRECTORIES = ['data', 'js'] as const;
export const MZ_PROJECT_MARKER = 'game.rmmzproject';
export const MZ_REQUIRED_DIRECTORIES = ['data', 'js'] as const;
export type RpgMakerEngine = 'mv' | 'mz';

export interface RpgMakerWorkspaceValidation extends ProjectValidation {
  engine?: RpgMakerEngine;
  markers: string[];
  ambiguous: boolean;
}

export interface ProjectValidation {
  valid: boolean;
  projectPath: string;
  markerPath: string;
  missing: string[];
  reason?: string;
}

export interface BackupIgnoreGuidance {
  configured: boolean;
  needsConsent: boolean;
  suggestedEntry: '.mcp-backups/';
  gitignorePath: string;
  message: string;
}

async function exists(path: string, expected: 'file' | 'directory'): Promise<boolean> {
  if (expected === 'file') return isRegularFile(path);
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function validateMvProject(projectPath: string): Promise<ProjectValidation> {
  const normalized = resolve(projectPath);
  const missing: string[] = [];
  const markerPath = join(normalized, MV_PROJECT_MARKER);

  if (!(await exists(markerPath, 'file'))) missing.push(MV_PROJECT_MARKER);
  for (const directory of MV_REQUIRED_DIRECTORIES) {
    if (!(await exists(join(normalized, directory), 'directory'))) missing.push(directory);
  }

  let reason: string | undefined;
  try {
    const info = await stat(normalized);
    if (!info.isDirectory()) reason = `${basename(normalized)} is not a directory`;
  } catch {
    reason = 'directory does not exist';
  }

  if (reason && missing.length === 0) missing.push(reason);
  return { valid: missing.length === 0, projectPath: normalized, markerPath, missing, reason };
}

/** Classify a selected project from direct-child markers only. */
export async function validateRpgMakerWorkspace(projectPath: string): Promise<RpgMakerWorkspaceValidation> {
  const normalized = resolve(projectPath);
  const markerPaths = {
    mv: join(normalized, MV_PROJECT_MARKER),
    mz: join(normalized, MZ_PROJECT_MARKER)
  } as const;
  const [mvMarker, mzMarker] = await Promise.all([
    exists(markerPaths.mv, 'file'),
    exists(markerPaths.mz, 'file')
  ]);
  const markers = [mvMarker ? MV_PROJECT_MARKER : undefined, mzMarker ? MZ_PROJECT_MARKER : undefined].filter((value): value is string => Boolean(value));
  const ambiguous = markers.length > 1;
  const engine = markers.length === 1 ? markers[0] === MV_PROJECT_MARKER ? 'mv' : 'mz' : undefined;
  const missing: string[] = [];
  if (markers.length === 0) missing.push(MV_PROJECT_MARKER, MZ_PROJECT_MARKER);
  if (engine) {
    for (const directory of engine === 'mv' ? MV_REQUIRED_DIRECTORIES : MZ_REQUIRED_DIRECTORIES) {
      if (!(await exists(join(normalized, directory), 'directory'))) missing.push(directory);
    }
  } else if (!ambiguous) {
    for (const directory of MV_REQUIRED_DIRECTORIES) {
      if (!(await exists(join(normalized, directory), 'directory'))) missing.push(directory);
    }
  }
  let reason: string | undefined;
  try {
    const info = await stat(normalized);
    if (!info.isDirectory()) reason = `${basename(normalized)} is not a directory`;
  } catch {
    reason = 'directory does not exist';
  }
  if (reason && missing.length === 0) missing.push(reason);
  return {
    valid: !ambiguous && missing.length === 0 && Boolean(engine),
    projectPath: normalized,
    markerPath: engine ? markerPaths[engine] : markerPaths.mv,
    missing,
    reason,
    engine,
    markers,
    ambiguous
  };
}

export function assertValidRpgMakerWorkspace(projectPath: string): Promise<RpgMakerWorkspaceValidation> {
  return validateRpgMakerWorkspace(projectPath).then((result) => {
    if (result.valid) return result;
    if (result.ambiguous) throw new Error(`Ambiguous RPG Maker workspace: ${result.projectPath}. Keep exactly one direct-child marker (${MV_PROJECT_MARKER} or ${MZ_PROJECT_MARKER}).`);
    throw new Error(`Not a valid RPG Maker workspace: ${result.projectPath}. Missing direct-child markers or directories: ${result.missing.join(', ')}. Expected exactly one of ${MV_PROJECT_MARKER} or ${MZ_PROJECT_MARKER}, plus data and js.`);
  });
}

export async function assertValidMvProject(projectPath: string): Promise<ProjectValidation> {
  const result = await validateMvProject(projectPath);
  if (!result.valid) {
    const missing = result.missing.join(', ');
    throw new Error(`Not a valid RPG Maker MV project: ${result.projectPath}. Missing ${missing}. Select a folder containing ${MV_PROJECT_MARKER}, data, and js.`);
  }
  return result;
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function backupIgnoreGuidance(projectPath: string): Promise<BackupIgnoreGuidance> {
  const gitignorePath = join(projectPath, '.gitignore');
  let content = '';
  try {
    content = await readFile(gitignorePath, 'utf8');
  } catch {
    // A missing ignore file is a user choice; guidance never creates it silently.
  }
  const configured = content.split(/\r?\n/).some((line) => {
    const value = line.trim();
    return value === '.mcp-backups/' || value === '.mcp-backups';
  });
  return {
    configured,
    needsConsent: !configured,
    suggestedEntry: '.mcp-backups/',
    gitignorePath,
    message: configured
      ? '.mcp-backups/ is already ignored; project version control remains authoritative.'
      : 'MCP backups are stored under .mcp-backups/. Add .mcp-backups/ to .gitignore only with the user’s consent; this command does not edit .gitignore.'
  };
}
