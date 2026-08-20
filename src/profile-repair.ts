import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { resolveHarnessPaths, type HarnessPaths, type PathOptions } from './config';
import { profileDirFor } from './profile';

/** State owned by the pre-removal remote image plugin and safe to delete on repair. */
export const OBSOLETE_VISION_TOOLKIT_PACKAGE = '@anionex/dsh-vision-toolkit';
const OBSOLETE_VISION_TOOLKIT_CACHE_RELATIVE = join('cache', 'dsh-vision-toolkit');
const PNPM_STORE_RELATIVE = join('node_modules', '.pnpm');
const OBSOLETE_PROFILE_ROW_IDS = new Set([
  'vision-toolkit',
  'vision-toolkit-activation',
  'vision-toolkit-provider',
  'vision-toolkit-settings',
  'vision-toolkit-tools'
]);


export type ObsoleteVisionToolkitRepairOptions = PathOptions;

export interface ObsoleteVisionToolkitRepairResult {
  profile: string;
  profileDir: string;
  cacheDir: string;
  removed: boolean;
}

interface JsonObject {
  [key: string]: unknown;
}

interface ProfileRepairSnapshotEntry {
  source: string;
  backup: string;
  existed: boolean;
}

interface ProfileRepairSnapshot {
  root: string;
  entries: ProfileRepairSnapshotEntry[];
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

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

function packageDirectory(profileDir: string): string {
  return join(profileDir, 'node_modules', ...OBSOLETE_VISION_TOOLKIT_PACKAGE.split('/'));
}

function cacheDirectory(paths: HarnessPaths): string {
  return join(paths.dshHome, OBSOLETE_VISION_TOOLKIT_CACHE_RELATIVE);
}

function removePackageFromManifest(manifest: JsonObject): boolean {
  let changed = false;
  const dependencies = asObject(manifest.dependencies);
  if (dependencies && Object.prototype.hasOwnProperty.call(dependencies, OBSOLETE_VISION_TOOLKIT_PACKAGE)) {
    delete dependencies[OBSOLETE_VISION_TOOLKIT_PACKAGE];
    changed = true;
  }
  const profile = asObject(asObject(manifest.dsh)?.profile);
  const bundles = profile?.bundles;
  if (Array.isArray(bundles)) {
    const filtered = bundles.filter((value) => value !== OBSOLETE_VISION_TOOLKIT_PACKAGE);
    if (filtered.length !== bundles.length) {
      profile!.bundles = filtered;
      changed = true;
    }
  }
  return changed;
}

function packageReferenceLine(line: string): boolean {
  return line.includes(OBSOLETE_VISION_TOOLKIT_PACKAGE);
}

/** Remove the package's importer/snapshot blocks without rewriting other lock entries. */
function removePackageFromPnpmLock(content: string): { content: string; changed: boolean } {
  const lines = content.split('\n');
  const removed = new Set<number>();
  for (let index = 0; index < lines.length; index += 1) {
    if (!packageReferenceLine(lines[index])) continue;
    const indent = lines[index].match(/^ */)?.[0].length ?? 0;
    removed.add(index);
    for (let next = index + 1; next < lines.length; next += 1) {
      if (lines[next].trim() === '') {
        if (next + 1 < lines.length && (lines[next + 1].match(/^ */)?.[0].length ?? 0) > indent) removed.add(next);
        continue;
      }
      const nextIndent = lines[next].match(/^ */)?.[0].length ?? 0;
      if (nextIndent <= indent) break;
      removed.add(next);
    }
  }
  const nextContent = lines.filter((_line, index) => !removed.has(index)).join('\n');
  return { content: nextContent, changed: removed.size > 0 };
}

async function cleanPackageStateFile(path: string, label: string): Promise<boolean> {
  const content = await readFile(path, 'utf8').catch(() => undefined);
  if (content === undefined) return false;
  const cleaned = removePackageFromPnpmLock(content);
  if (cleaned.changed) await writeFile(path, cleaned.content, 'utf8');
  if (cleaned.content.includes(OBSOLETE_VISION_TOOLKIT_PACKAGE)) {
    throw new Error(`Could not remove all ${OBSOLETE_VISION_TOOLKIT_PACKAGE} entries from the app-owned ${label}.`);
  }
  return cleaned.changed;
}

function topLevelRows(content: string): Array<{ id: string; start: number; end: number; text: string }> {
  const matches = [...content.matchAll(/^- id:\s*([^\s#]+)/gm)];
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? content.length;
    return { id: match[1], start, end, text: content.slice(start, end) };
  });
}

function removePackageFromPatch(content: string): { content: string; changed: boolean } {
  const rows = topLevelRows(content);
  if (rows.length === 0) return { content, changed: false };
  const remove = rows.filter((row) => row.text.includes(OBSOLETE_VISION_TOOLKIT_PACKAGE) || OBSOLETE_PROFILE_ROW_IDS.has(row.id));
  if (remove.length === 0) return { content, changed: false };
  let next = content;
  for (const row of [...remove].sort((a, b) => b.start - a.start)) next = `${next.slice(0, row.start)}${next.slice(row.end)}`;
  return { content: next, changed: true };
}

function isWithin(root: string, candidate: string): boolean {
  const rest = relative(resolve(root), resolve(candidate));
  return rest === '' || (!rest.startsWith(`..${sep}`) && rest !== '..');
}

async function obsoletePackageStoreEntries(profileDir: string): Promise<string[]> {
  const storeDir = join(profileDir, PNPM_STORE_RELATIVE);
  const entries = await readdir(storeDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.name.includes('dsh-vision-toolkit'))
    .map((entry) => join(storeDir, entry.name));
}

async function snapshotProfileState(paths: HarnessPaths, profileDir: string, cacheDir: string): Promise<ProfileRepairSnapshot> {
  const root = await mkdtemp(join(paths.dshHome, '.profile-repair-rollback-'));
  const entries = [
    join(profileDir, 'package.json'),
    join(profileDir, 'pnpm-lock.yaml'),
    join(profileDir, 'cordis.patch.yml'),
    packageDirectory(profileDir),
    join(profileDir, 'node_modules', '.pnpm', 'lock.yaml'),
    join(profileDir, 'node_modules', '.modules.yaml'),
    ...(await obsoletePackageStoreEntries(profileDir)),
    cacheDir
  ];
  const snapshotEntries: ProfileRepairSnapshotEntry[] = [];
  try {
    for (const [index, source] of entries.entries()) {
      const existed = await exists(source);
      const backup = join(root, String(index));
      if (existed) {
        if (!isWithin(paths.dshHome, source)) throw new Error(`Obsolete profile repair path escaped DSH_HOME: ${source}`);
        await cp(source, backup, { recursive: true, force: false, errorOnExist: true });
      }
      snapshotEntries.push({ source, backup, existed });
    }
    return { root, entries: snapshotEntries };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

async function restoreProfileState(snapshot: ProfileRepairSnapshot): Promise<void> {
  for (const entry of snapshot.entries) {
    await rm(entry.source, { recursive: true, force: true });
    if (entry.existed) {
      await mkdir(dirname(entry.source), { recursive: true });
      await cp(entry.backup, entry.source, { recursive: true, force: false, errorOnExist: true });
    }
  }
}

/** Remove only app-owned state from the obsolete remote image plugin. */
export async function removeObsoleteVisionToolkitState(options: ObsoleteVisionToolkitRepairOptions = {}): Promise<ObsoleteVisionToolkitRepairResult> {
  const paths = resolveHarnessPaths(options);
  await mkdir(paths.dshHome, { recursive: true });
  const profile = 'web';
  const profileDir = profileDirFor(paths, profile);
  const cacheDir = cacheDirectory(paths);
  const snapshot = await snapshotProfileState(paths, profileDir, cacheDir);
  let removed = false;
  try {
    const manifestPath = join(profileDir, 'package.json');
    const manifestText = await readFile(manifestPath, 'utf8').catch(() => undefined);
    const manifest = manifestText === undefined ? undefined : await readJson(manifestPath);
    if (manifestText !== undefined && !manifest) throw new Error(`The app-owned ${profile} profile manifest is invalid; obsolete image state was not removed.`);
    if (manifest && removePackageFromManifest(manifest)) {
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      removed = true;
    }

    for (const [path, label] of [
      [join(profileDir, 'pnpm-lock.yaml'), 'profile lockfile'],
      [join(profileDir, 'node_modules', '.pnpm', 'lock.yaml'), 'pnpm store lockfile'],
      [join(profileDir, 'node_modules', '.modules.yaml'), 'pnpm module metadata']
    ] as const) {
      if (await cleanPackageStateFile(path, label)) removed = true;
    }

    const patchPath = join(profileDir, 'cordis.patch.yml');
    const patch = await readFile(patchPath, 'utf8').catch(() => undefined);
    if (patch !== undefined) {
      const cleaned = removePackageFromPatch(patch);
      if (cleaned.changed) {
        await writeFile(patchPath, cleaned.content, 'utf8');
        removed = true;
      }
      if (cleaned.content.includes(OBSOLETE_VISION_TOOLKIT_PACKAGE)) {
        throw new Error(`Could not remove all ${OBSOLETE_VISION_TOOLKIT_PACKAGE} entries from the app-owned profile patch.`);
      }
    }

    for (const storeEntry of await obsoletePackageStoreEntries(profileDir)) {
      await rm(storeEntry, { recursive: true, force: true });
      removed = true;
    }
    if (await exists(packageDirectory(profileDir))) {
      await rm(packageDirectory(profileDir), { recursive: true, force: true });
      removed = true;
    }
    if (await exists(cacheDir)) {
      await rm(cacheDir, { recursive: true, force: true });
      removed = true;
    }
    return { profile, profileDir, cacheDir, removed };
  } catch (error) {
    const original = error instanceof Error ? error : new Error(String(error));
    try {
      await restoreProfileState(snapshot);
    } catch (restoreError) {
      throw new Error(`${original.message}; obsolete image profile rollback failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
    }
    throw original;
  } finally {
    await rm(snapshot.root, { recursive: true, force: true });
  }
}
