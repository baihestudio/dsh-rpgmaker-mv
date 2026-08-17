import { access, constants, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { isRegularFile } from './files';

export const MV_PROJECT_MARKER = 'Game.rpgproject';
export const MV_REQUIRED_DIRECTORIES = ['data', 'js'] as const;

export interface ProjectValidation {
  valid: boolean;
  projectPath: string;
  markerPath: string;
  missing: string[];
  reason?: string;
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
