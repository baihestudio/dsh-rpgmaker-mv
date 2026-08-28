import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveHarnessPaths, type HarnessPaths, type PathOptions } from './config';
import { profileDirFor } from './profile';

export const WORKSPACE_MCP_PACKAGE = '@baihestudio/dsh-workspace-mcp';
export const WORKSPACE_MCP_VERSION = '0.1.0';
export const WORKSPACE_MCP_LICENSE = 'MIT';
export const WORKSPACE_MCP_PROFILE = 'web';
export const WORKSPACE_MCP_ENTRYPOINT = 'lib/index.js';
export const WORKSPACE_MCP_AGENT_ENTRYPOINT = 'lib/agent.js';
export const WORKSPACE_MCP_BUNDLE_PATCH = './cordis.patch.yml';
export const WORKSPACE_MCP_ROW_ID = 'workspace-mcp';
export const WORKSPACE_MCP_AGENT_ROW_ID = 'workspace-mcp-agent';
/** Deterministic digest over the shipped prebuilt bundle; see scripts/release notes. */
export const WORKSPACE_MCP_SHA256 = 'c316a730f28205d37df67d1365f696554c724c29ae765ce2818464dd19e40433';
export const WORKSPACE_MCP_BUNDLE_RELATIVE = join('bundle', 'dsh-workspace-mcp');
export const WORKSPACE_MCP_DATA_BUNDLE_RELATIVE = join('rpgmaker-mv', 'bundle', 'dsh-workspace-mcp');
/** Archive entries always use POSIX separators, including on Windows. */
export const WORKSPACE_MCP_BUNDLE_ARCHIVE_RELATIVE = 'bundle/dsh-workspace-mcp';

/** Host env contract consumed by the prebuilt workspace bundle. */
export const MCPORTER_RUNTIME_ENV = 'DSH_RPGMAKER_MCPORTER_RUNTIME';
export const XEROLO_RUNTIME_ENV = 'DSH_RPGMAKER_XEROLO_RUNTIME';
export const JS_RUNNER_ENV = 'DSH_RPGMAKER_JS_RUNNER';

export interface WorkspaceMcpBundleOptions extends PathOptions {
  platform?: string;
  env?: Record<string, string | undefined>;
  profile?: string;
  bundleDir?: string;
}

export interface WorkspaceMcpBundleVerification {
  valid: boolean;
  errors: string[];
  packageDir: string | undefined;
  packageVersion: string | undefined;
  bundleOccurrences: number;
  entrypoint: string | undefined;
  ownedPath: boolean;
  sha256: string | undefined;
}

export function defaultWorkspaceMcpBundleDir(): string {
  return fileURLToPath(new URL(`../${WORKSPACE_MCP_BUNDLE_RELATIVE}/`, import.meta.url));
}

export function workspaceMcpBundleDirFor(paths: Pick<HarnessPaths, 'dshHome'>): string {
  return join(paths.dshHome, WORKSPACE_MCP_DATA_BUNDLE_RELATIVE);
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Resolve an existing path, including symlinked ancestors of a missing leaf. */
export async function canonicalPath(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch {
    const missing: string[] = [];
    let cursor = absolute;
    while (true) {
      const parent = dirname(cursor);
      if (parent === cursor) return absolute;
      missing.unshift(basename(cursor));
      cursor = parent;
      try {
        return join(await realpath(cursor), ...missing);
      } catch {
        // Continue walking until an existing ancestor can be canonicalized.
      }
    }
  }
}

export async function canonicalExistingPath(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return asObject(value);
  } catch {
    return undefined;
  }
}

export function pathIsWithin(parent: string, child: string, platform: string): boolean {
  const parentKey = platform === 'win32' ? parent.toLowerCase() : parent;
  const childKey = platform === 'win32' ? child.toLowerCase() : child;
  const prefix = parentKey.endsWith(sep) ? parentKey : `${parentKey}${sep}`;
  return childKey === parentKey || childKey.startsWith(prefix);
}

export function pathIsStrictlyWithin(parent: string, child: string, platform: string): boolean {
  const parentKey = platform === 'win32' ? parent.toLowerCase() : parent;
  const childKey = platform === 'win32' ? child.toLowerCase() : child;
  const prefix = parentKey.endsWith(sep) ? parentKey : `${parentKey}${sep}`;
  return childKey !== parentKey && childKey.startsWith(prefix);
}

/** Deterministic digest over the bundle directory (sorted files, LF, slash paths). */
export async function workspaceMcpBundleDigest(bundleDir: string): Promise<string> {
  const bundleReal = await canonicalExistingPath(bundleDir);
  if (!bundleReal) throw new Error('workspace MCP bundle root could not be canonicalized');
  const files: string[] = [];
  const visitedDirectories = new Set<string>();
  const walk = async (directory: string): Promise<void> => {
    const directoryReal = await canonicalExistingPath(directory);
    if (!directoryReal || !pathIsWithin(bundleReal, directoryReal, process.platform)) {
      throw new Error('workspace MCP bundle content escapes its canonical bundle root');
    }
    if (visitedDirectories.has(directoryReal)) throw new Error('workspace MCP bundle contains a directory cycle');
    visitedDirectories.add(directoryReal);
    for (const entry of await readdir(directory)) {
      const abs = join(directory, entry);
      const targetReal = await canonicalExistingPath(abs);
      if (!targetReal || !pathIsWithin(bundleReal, targetReal, process.platform)) {
        throw new Error('workspace MCP bundle content escapes its canonical bundle root');
      }
      const metadata = await stat(abs);
      if (metadata.isDirectory()) await walk(abs);
      else if (metadata.isFile()) files.push(relative(bundleDir, abs).split(sep).join('/'));
      else throw new Error('workspace MCP bundle contains a non-regular file');
    }
  };
  await walk(bundleDir);
  files.sort();
  const digest = createHash('sha256');
  for (const rel of files) {
    const filePath = join(bundleDir, ...rel.split('/'));
    const fileReal = await canonicalExistingPath(filePath);
    if (!fileReal || !pathIsWithin(bundleReal, fileReal, process.platform) || !(await isRegularFile(filePath))) {
      throw new Error('workspace MCP bundle content escapes its canonical bundle root');
    }
    const content = await readFile(filePath);
    digest.update(rel);
    digest.update('\0');
    digest.update(content.toString('hex'));
    digest.update('\0');
  }
  return digest.digest('hex');
}

function profilePackageDir(profileDir: string): string {
  return join(profileDir, 'node_modules', WORKSPACE_MCP_PACKAGE);
}

function sameCanonicalPath(a: string, b: string, platform: string): boolean {
  const first = platform === 'win32' ? a.toLowerCase() : a;
  const second = platform === 'win32' ? b.toLowerCase() : b;
  return first === second;
}

interface BundleRootVerification {
  manifest: Record<string, unknown> | undefined;
  entrypoint: string | undefined;
  digest: string | undefined;
}

export interface WorkspaceMcpSourceVerification {
  valid: boolean;
  errors: string[];
  sourceDir: string;
  sha256: string | undefined;
}

async function verifyLoadedFile(
  rootReal: string,
  target: string | undefined,
  label: string,
  platform: string,
  errors: string[]
): Promise<string | undefined> {
  if (!target) {
    errors.push(`${label} was not found`);
    return undefined;
  }
  const targetReal = await canonicalExistingPath(target);
  if (!targetReal) {
    errors.push(`${label} was not found`);
    return undefined;
  }
  if (!pathIsWithin(rootReal, targetReal, platform)) {
    errors.push(`${label} escapes its canonical bundle root`);
    return undefined;
  }
  if (!(await isRegularFile(target))) {
    errors.push(`${label} is not a regular file`);
    return undefined;
  }
  return target;
}

async function verifyBundleRoot(
  root: string,
  label: string,
  platform: string,
  allowed: boolean,
  errors: string[]
): Promise<BundleRootVerification> {
  const rootReal = await canonicalPath(root);
  if (!(await isDirectory(root))) errors.push(`${label} root ${root} was not found or is not a directory`);
  if (!allowed) return { manifest: undefined, entrypoint: undefined, digest: undefined };
  const manifest = await readJson(join(root, 'package.json'));
  const main = typeof manifest?.main === 'string' ? manifest.main : undefined;
  const entrypoint = await verifyLoadedFile(
    rootReal,
    main ? resolve(root, main) : undefined,
    `${label} entrypoint ${main ?? WORKSPACE_MCP_ENTRYPOINT}`,
    platform,
    errors
  );
  await verifyLoadedFile(
    rootReal,
    resolve(root, WORKSPACE_MCP_AGENT_ENTRYPOINT),
    `${label} Agent entrypoint ${WORKSPACE_MCP_AGENT_ENTRYPOINT}`,
    platform,
    errors
  );
  const bundlePatch = typeof asObject(asObject(manifest?.dsh)?.bundle)?.patch === 'string'
    ? asObject(asObject(manifest?.dsh)?.bundle)?.patch as string
    : undefined;
  await verifyLoadedFile(
    rootReal,
    bundlePatch ? resolve(root, bundlePatch) : undefined,
    `${label} patch file ${bundlePatch ?? WORKSPACE_MCP_BUNDLE_PATCH}`,
    platform,
    errors
  );
  const digest = await workspaceMcpBundleDigest(root).catch(() => undefined);
  return { manifest, entrypoint, digest };
}

/**
 * Verify only the app-owned workspace MCP source bundle. This intentionally
 * excludes the mutable data target and profile state so a stale target can be
 * repaired without weakening the source safety gate.
 */
export async function verifyWorkspaceMcpSource(options: WorkspaceMcpBundleOptions = {}): Promise<WorkspaceMcpSourceVerification> {
  const paths = resolveHarnessPaths(options);
  const platform = options.platform ?? process.platform;
  const packagedSource = resolve(join(paths.programRoot, WORKSPACE_MCP_BUNDLE_RELATIVE));
  const defaultSource = resolve(defaultWorkspaceMcpBundleDir());
  let packagedSourceExists = false;
  try {
    await lstat(packagedSource);
    packagedSourceExists = true;
  } catch {
    // An absent packaged source permits the canonical repository fallback.
  }
  const sourceDir = packagedSourceExists ? packagedSource : defaultSource;
  const sourceReal = await canonicalPath(sourceDir);
  const programRootReal = await canonicalPath(paths.programRoot);
  const defaultSourceReal = await canonicalPath(defaultSource);
  const sourceAllowed = packagedSourceExists
    ? pathIsStrictlyWithin(programRootReal, sourceReal, platform)
    : sameCanonicalPath(sourceReal, defaultSourceReal, platform);
  const errors: string[] = [];
  if (!sourceAllowed) {
    errors.push(`workspace MCP source bundle ${sourceDir} is outside its allowed app-owned root`);
    return { valid: false, errors, sourceDir, sha256: undefined };
  }

  const sourceCheck = await verifyBundleRoot(sourceDir, 'workspace MCP source bundle', platform, true, errors);
  const sourceName = typeof sourceCheck.manifest?.name === 'string' ? sourceCheck.manifest.name : undefined;
  const sourceVersion = typeof sourceCheck.manifest?.version === 'string' ? sourceCheck.manifest.version : undefined;
  if (sourceName !== WORKSPACE_MCP_PACKAGE) errors.push(`workspace MCP source bundle identity is ${sourceName ?? 'missing'}, expected ${WORKSPACE_MCP_PACKAGE}`);
  if (sourceVersion !== WORKSPACE_MCP_VERSION) errors.push(`workspace MCP source bundle version is ${sourceVersion ?? 'missing'}, expected ${WORKSPACE_MCP_VERSION}`);
  if (sourceCheck.manifest?.license !== WORKSPACE_MCP_LICENSE) errors.push(`workspace MCP source bundle license is ${String(sourceCheck.manifest?.license ?? 'missing')}, expected ${WORKSPACE_MCP_LICENSE}`);
  const sourcePatch = typeof asObject(asObject(sourceCheck.manifest?.dsh)?.bundle)?.patch === 'string'
    ? asObject(asObject(sourceCheck.manifest?.dsh)?.bundle)?.patch as string
    : undefined;
  if (sourcePatch !== WORKSPACE_MCP_BUNDLE_PATCH) errors.push(`workspace MCP source bundle dsh.bundle.patch is not ${WORKSPACE_MCP_BUNDLE_PATCH}`);
  if (sourceCheck.digest !== WORKSPACE_MCP_SHA256) errors.push(`workspace MCP source release hash mismatch (got ${sourceCheck.digest?.slice(0, 12) ?? 'none'}, expected ${WORKSPACE_MCP_SHA256.slice(0, 12)})`);
  return { valid: errors.length === 0, errors, sourceDir: sourceReal, sha256: sourceCheck.digest };
}

export async function verifyWorkspaceMcpBundle(options: WorkspaceMcpBundleOptions = {}): Promise<WorkspaceMcpBundleVerification> {
  const paths = resolveHarnessPaths(options);
  const platform = options.platform ?? process.platform;
  const bundleDir = resolve(options.bundleDir ?? workspaceMcpBundleDirFor(paths));
  const errors: string[] = [];
  const dshHomeReal = await canonicalPath(paths.dshHome);
  const profilesRoot = resolve(join(paths.dshHome, 'profiles'));
  const profilesRootReal = await canonicalPath(profilesRoot);
  const profile = options.profile ?? WORKSPACE_MCP_PROFILE;
  const profileDir = profileDirFor(paths, profile);
  const profileRootReal = await canonicalPath(profileDir);
  const profileRootAllowed = pathIsWithin(dshHomeReal, profilesRootReal, platform)
    && pathIsStrictlyWithin(profilesRootReal, profileRootReal, platform);
  if (!pathIsWithin(dshHomeReal, profilesRootReal, platform)) errors.push(`managed profiles root ${profilesRoot} escapes canonical DSH_HOME ${paths.dshHome}`);
  if (!pathIsStrictlyWithin(profilesRootReal, profileRootReal, platform)) errors.push(`${profile} profile root ${profileDir} is not strictly inside canonical profiles root ${profilesRoot}`);

  const dataRoot = resolve(join(paths.dshHome, 'rpgmaker-mv'));
  const dataRootReal = await canonicalPath(dataRoot);
  const bundleReal = await canonicalPath(bundleDir);
  const dataRootAllowed = pathIsWithin(dshHomeReal, dataRootReal, platform);
  const ownedPath = dataRootAllowed && pathIsStrictlyWithin(dataRootReal, bundleReal, platform);
  if (!dataRootAllowed) errors.push(`workspace MCP data root ${dataRoot} escapes canonical DSH_HOME ${paths.dshHome}`);
  if (!ownedPath) errors.push(`bundle path ${bundleDir} is not strictly inside the app-owned data root ${dataRoot}`);

  const sourceCheck = await verifyWorkspaceMcpSource({ ...options, platform });
  errors.push(...sourceCheck.errors);
  const targetCheck = await verifyBundleRoot(bundleDir, 'bundle', platform, ownedPath, errors);
  const manifest = targetCheck.manifest;
  const packageName = typeof manifest?.name === 'string' ? manifest.name : undefined;
  const packageVersion = typeof manifest?.version === 'string' ? manifest.version : undefined;
  if (packageName !== WORKSPACE_MCP_PACKAGE) errors.push(`bundle identity is ${packageName ?? 'missing'}, expected ${WORKSPACE_MCP_PACKAGE}`);
  if (packageVersion !== WORKSPACE_MCP_VERSION) errors.push(`bundle version is ${packageVersion ?? 'missing'}, expected ${WORKSPACE_MCP_VERSION}`);
  if (manifest?.license !== WORKSPACE_MCP_LICENSE) errors.push(`bundle license is ${String(manifest?.license ?? 'missing')}, expected ${WORKSPACE_MCP_LICENSE}`);
  const bundlePatch = typeof asObject(asObject(manifest?.dsh)?.bundle)?.patch === 'string'
    ? asObject(asObject(manifest?.dsh)?.bundle)?.patch as string
    : undefined;
  if (bundlePatch !== WORKSPACE_MCP_BUNDLE_PATCH) errors.push(`bundle dsh.bundle.patch is not ${WORKSPACE_MCP_BUNDLE_PATCH}`);
  const sha256 = targetCheck.digest;
  if (sha256 !== WORKSPACE_MCP_SHA256) errors.push(`bundle release hash mismatch (got ${sha256?.slice(0, 12) ?? 'none'}, expected ${WORKSPACE_MCP_SHA256.slice(0, 12)}); the prebuilt package must not be edited by hand`);

  const profileManifest = await readJson(join(profileDir, 'package.json'));
  const dependency = asObject(profileManifest?.dependencies)?.[WORKSPACE_MCP_PACKAGE];
  const profileDependency = typeof dependency === 'string' ? dependency : undefined;
  const profileConfig = asObject(asObject(profileManifest?.dsh)?.profile);
  const layers = Array.isArray(profileConfig?.bundles) ? profileConfig.bundles : [];
  const bundleOccurrences = layers.filter((value) => value === WORKSPACE_MCP_PACKAGE).length;
  if (!profileDependency) {
    errors.push(`profile dependency ${WORKSPACE_MCP_PACKAGE} is not installed in the ${profile} profile`);
  } else if (!/^(file:|link:)/i.test(profileDependency)) {
    errors.push(`profile dependency ${WORKSPACE_MCP_PACKAGE} is not pinned to the app-owned local bundle (file:/link:); a bare or npm specifier could resolve from the public registry`);
  } else {
    const spec = profileDependency.replace(/^(file|link):/i, '');
    const targetReal = await canonicalExistingPath(resolve(profileDir, spec));
    if (!targetReal || !sameCanonicalPath(targetReal, bundleReal, platform)) {
      // The raw dependency specifier is deliberately omitted: a bare or remote
      // specifier could carry credentials, so verification never surfaces it.
      errors.push(`profile dependency ${WORKSPACE_MCP_PACKAGE} does not resolve to the app-owned local bundle`);
    }
  }
  if (bundleOccurrences !== 1) {
    errors.push(`profile contains ${bundleOccurrences} ${WORKSPACE_MCP_PACKAGE} bundle layers; expected exactly one host-level layer`);
  }

  const installedDir = profilePackageDir(profileDir);
  let installedResolved: string | undefined;
  if (!(await exists(installedDir))) {
    errors.push(`installed profile package ${WORKSPACE_MCP_PACKAGE} was not found under the ${profile} profile`);
  } else {
    const installedReal = await canonicalExistingPath(installedDir);
    installedResolved = installedReal ?? installedDir;
    const canonicalInstalled = join(profileRootReal, 'node_modules', WORKSPACE_MCP_PACKAGE);
    const installedAllowed = profileRootAllowed && installedReal !== undefined
      && (sameCanonicalPath(installedReal, bundleReal, platform) || sameCanonicalPath(installedReal, canonicalInstalled, platform));
    if (!installedAllowed) {
      errors.push(`installed profile package does not resolve to the app-owned data bundle or the canonical profile copy (got ${installedReal ?? 'unresolvable'})`);
    }
    const installedCheck = await verifyBundleRoot(installedReal ?? installedDir, 'installed profile package', platform, installedAllowed, errors);
    const installedManifest = installedCheck.manifest;
    const installedName = typeof installedManifest?.name === 'string' ? installedManifest.name : undefined;
    const installedVersion = typeof installedManifest?.version === 'string' ? installedManifest.version : undefined;
    if (installedAllowed && (installedName !== WORKSPACE_MCP_PACKAGE || installedVersion !== WORKSPACE_MCP_VERSION)) {
      errors.push(`installed profile package identity is ${installedName ?? 'missing'}@${installedVersion ?? 'missing'}, expected ${WORKSPACE_MCP_PACKAGE}@${WORKSPACE_MCP_VERSION}`);
    }
    if (installedAllowed && installedCheck.digest !== WORKSPACE_MCP_SHA256) {
      errors.push(`installed profile package release hash mismatch (got ${installedCheck.digest?.slice(0, 12) ?? 'none'}); the installed copy is not the pinned prebuilt bundle`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    packageDir: installedResolved,
    packageVersion,
    bundleOccurrences,
    entrypoint: targetCheck.entrypoint,
    ownedPath,
    sha256
  };
}

export function workspaceMcpSummary(verification: WorkspaceMcpBundleVerification): string {
  return verification.valid
    ? `App-owned workspace MCP bundle ${WORKSPACE_MCP_PACKAGE}@${verification.packageVersion} is linked as one host-level layer of the ${WORKSPACE_MCP_PROFILE} profile`
    : `App-owned workspace MCP bundle is not usable: ${verification.errors.join('; ') || 'unknown reason'}`;
}
