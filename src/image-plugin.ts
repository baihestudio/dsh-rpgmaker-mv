import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveHarnessPaths, type HarnessPaths, type PathOptions } from './config';
import { findDshExecutable } from './bootstrap';
import { commandFailure, redactSensitive, runCommand, type CommandRunner } from './process';
import {
  pluginEnvironment,
  preparePnpmRuntime,
  profileDirFor,
  resolveDshInvocation
} from './vision-toolkit';

export const IMAGE_WORKSHOP_PLUGIN_PACKAGE = '@baihestudio/dsh-image-workshop';
export const IMAGE_WORKSHOP_PLUGIN_VERSION = '0.1.0';
export const IMAGE_WORKSHOP_PLUGIN_LICENSE = 'MIT';
export const IMAGE_WORKSHOP_PLUGIN_PROFILE = 'web';
export const IMAGE_WORKSHOP_PLUGIN_ENTRYPOINT = 'lib/index.js';
/** Deterministic digest over the shipped prebuilt bundle; see scripts/release notes. */
export const IMAGE_WORKSHOP_PLUGIN_SHA256 = 'ece82b0640711eda0ecb324d44da45b75dd16baf3138fe0ed87f2df2073995b8';
export const IMAGE_WORKSHOP_BUNDLE_RELATIVE = join('bundle', 'dsh-image-workshop');
export const IMAGE_WORKSHOP_TOOL_NAMES = ['image_inspect', 'image_resize_pixel'] as const;
export const IMAGE_WORKSHOP_PLUGIN_ROW_ID = 'image-workshop-plugin';

export interface ImageWorkshopPluginOptions extends PathOptions {
  platform?: string;
  env?: Record<string, string | undefined>;
  commandRunner?: CommandRunner;
  dshExecutable?: string;
  npmExecutable?: string;
  pnpmExecutable?: string;
  profile?: string;
  bundleDir?: string;
}

export interface ImageWorkshopPluginVerification {
  valid: boolean;
  errors: string[];
  packageDir: string | undefined;
  packageVersion: string | undefined;
  profileDependency: string | undefined;
  bundleOccurrences: number;
  entrypoint: string | undefined;
  ownedPath: boolean;
  sha256: string | undefined;
}

export function defaultImageWorkshopBundleDir(): string {
  return fileURLToPath(new URL(`../${IMAGE_WORKSHOP_BUNDLE_RELATIVE}/`, import.meta.url));
}

export function imageWorkshopBundleDirFor(paths: HarnessPaths): string {
  return join(paths.programRoot, IMAGE_WORKSHOP_BUNDLE_RELATIVE);
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

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return asObject(value);
  } catch {
    return undefined;
  }
}

/** Deterministic digest over the bundle directory (sorted files, LF, slash paths). */
export async function imageWorkshopBundleDigest(bundleDir: string): Promise<string> {
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory)) {
      const abs = join(directory, entry);
      if ((await stat(abs)).isDirectory()) await walk(abs);
      else files.push(relative(bundleDir, abs).split(sep).join('/'));
    }
  };
  await walk(bundleDir);
  files.sort();
  const digest = createHash('sha256');
  for (const rel of files) {
    const content = await readFile(join(bundleDir, ...rel.split('/')));
    digest.update(rel);
    digest.update('\0');
    digest.update(content.toString('hex'));
    digest.update('\0');
  }
  return digest.digest('hex');
}

function profilePackageDir(profileDir: string): string {
  return join(profileDir, 'node_modules', IMAGE_WORKSHOP_PLUGIN_PACKAGE);
}

function pathKey(path: string, platform: string): string {
  return platform === 'win32' ? path.toLowerCase() : path;
}

function sameCanonicalPath(a: string, b: string, platform: string): boolean {
  return pathKey(a, platform) === pathKey(b, platform);
}

function isWithinCanonicalPath(child: string, parent: string, platform: string): boolean {
  const keyChild = pathKey(child, platform);
  const keyParent = pathKey(parent, platform);
  return keyChild === keyParent || keyChild.startsWith(`${keyParent}${sep}`);
}

interface ImageWorkshopProfileSnapshotEntry {
  source: string;
  backup: string;
  existed: boolean;
}

interface ImageWorkshopProfileSnapshot {
  root: string;
  entries: ImageWorkshopProfileSnapshotEntry[];
}

/**
 * Image-plugin-owned profile snapshot. Covers the manifest, lockfile, patch,
 * and this plugin's OWN node_modules entry so a failed or partial `plugin add`
 * can never leave an orphaned image-tool package row. Deliberately does not
 * reuse Vision Toolkit's package-specific rollback internals.
 */
async function snapshotImageWorkshopProfile(paths: HarnessPaths, profileDir: string): Promise<ImageWorkshopProfileSnapshot> {
  const root = await mkdtemp(join(paths.dshHome, '.image-workshop-profile-rollback-'));
  const sources = [
    join(profileDir, 'package.json'),
    join(profileDir, 'pnpm-lock.yaml'),
    join(profileDir, 'cordis.patch.yml'),
    profilePackageDir(profileDir)
  ];
  const entries: ImageWorkshopProfileSnapshotEntry[] = [];
  try {
    for (const [index, source] of sources.entries()) {
      const existed = await exists(source);
      const backup = join(root, String(index));
      if (existed) await cp(source, backup, { recursive: true, force: false, errorOnExist: true });
      entries.push({ source, backup, existed });
    }
    return { root, entries };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

async function restoreImageWorkshopProfile(snapshot: ImageWorkshopProfileSnapshot): Promise<void> {
  for (const entry of snapshot.entries) {
    await rm(entry.source, { recursive: true, force: true });
    if (entry.existed) {
      await mkdir(dirname(entry.source), { recursive: true });
      await cp(entry.backup, entry.source, { recursive: true, force: false, errorOnExist: true });
    }
  }
}

export async function verifyImageWorkshopPlugin(options: ImageWorkshopPluginOptions = {}): Promise<ImageWorkshopPluginVerification> {
  const paths = resolveHarnessPaths(options);
  const platform = options.platform ?? process.platform;
  const bundleDir = resolve(options.bundleDir ?? imageWorkshopBundleDirFor(paths));
  const errors: string[] = [];
  const manifest = await readJson(join(bundleDir, 'package.json'));
  const packageName = typeof manifest?.name === 'string' ? manifest.name : undefined;
  const packageVersion = typeof manifest?.version === 'string' ? manifest.version : undefined;
  const main = typeof manifest?.main === 'string' ? manifest.main : undefined;
  const entrypoint = main && await exists(join(bundleDir, main)) ? join(bundleDir, main) : undefined;
  if (packageName !== IMAGE_WORKSHOP_PLUGIN_PACKAGE) errors.push(`bundle identity is ${packageName ?? 'missing'}, expected ${IMAGE_WORKSHOP_PLUGIN_PACKAGE}`);
  if (packageVersion !== IMAGE_WORKSHOP_PLUGIN_VERSION) errors.push(`bundle version is ${packageVersion ?? 'missing'}, expected ${IMAGE_WORKSHOP_PLUGIN_VERSION}`);
  if (manifest?.license !== IMAGE_WORKSHOP_PLUGIN_LICENSE) errors.push(`bundle license is ${String(manifest?.license ?? 'missing')}, expected ${IMAGE_WORKSHOP_PLUGIN_LICENSE}`);
  if (!entrypoint) errors.push(`bundle entrypoint ${IMAGE_WORKSHOP_PLUGIN_ENTRYPOINT} was not found`);
  const sha256 = await imageWorkshopBundleDigest(bundleDir).catch(() => undefined);
  if (sha256 !== IMAGE_WORKSHOP_PLUGIN_SHA256) errors.push(`bundle release hash mismatch (got ${sha256?.slice(0, 12) ?? 'none'}, expected ${IMAGE_WORKSHOP_PLUGIN_SHA256.slice(0, 12)}); the prebuilt package must not be edited by hand`);
  let ownedPath = false;
  const programRoot = await realpath(paths.programRoot).catch(() => paths.programRoot);
  const bundleReal = await realpath(bundleDir).catch(() => bundleDir);
  ownedPath = bundleReal === programRoot || bundleReal.startsWith(`${programRoot}${sep}`);
  if (!ownedPath) errors.push(`bundle path ${bundleDir} is not inside the app-owned program root ${paths.programRoot}`);

  const profile = options.profile ?? IMAGE_WORKSHOP_PLUGIN_PROFILE;
  const profileDir = profileDirFor(paths, profile);
  const profileManifest = await readJson(join(profileDir, 'package.json'));
  const dependency = asObject(profileManifest?.dependencies)?.[IMAGE_WORKSHOP_PLUGIN_PACKAGE];
  const profileDependency = typeof dependency === 'string' ? dependency : undefined;
  const profileConfig = asObject(asObject(profileManifest?.dsh)?.profile);
  const layers = Array.isArray(profileConfig?.bundles) ? profileConfig.bundles : [];
  const bundleOccurrences = layers.filter((value) => value === IMAGE_WORKSHOP_PLUGIN_PACKAGE).length;
  if (!profileDependency) {
    errors.push(`profile dependency ${IMAGE_WORKSHOP_PLUGIN_PACKAGE} is not installed in the ${profile} profile`);
  } else if (!/^(file:|link:)/i.test(profileDependency)) {
    errors.push(`profile dependency ${IMAGE_WORKSHOP_PLUGIN_PACKAGE} is not pinned to the app-owned local bundle (file:/link:); a bare or npm specifier could resolve from the public registry`);
  } else {
    // A file:/link: spec alone proves nothing; resolve it against the profile
    // directory (covering Windows absolute paths and relative package specs)
    // and require it to be the exact app-owned source bundle.
    const spec = profileDependency.replace(/^(file|link):/i, '');
    const targetReal = await realpath(resolve(profileDir, spec)).catch(() => undefined);
    const bundleRealForDependency = await realpath(bundleDir).catch(() => bundleDir);
    if (!targetReal || !sameCanonicalPath(targetReal, bundleRealForDependency, platform)) {
      errors.push(`profile dependency ${IMAGE_WORKSHOP_PLUGIN_PACKAGE} does not resolve to the app-owned local bundle (got ${profileDependency})`);
    }
  }
  if (bundleOccurrences !== 0) errors.push(`profile contains ${bundleOccurrences} global ${IMAGE_WORKSHOP_PLUGIN_PACKAGE} bundle layers; the image tools must be Agent-scoped through the asset-workshop composition, never mounted globally`);

  // A package.json dependency entry alone proves nothing about the linked copy.
  // Verify the installed profile node_modules entry exists, resolves to the
  // app-owned program root, and matches the pinned prebuilt identity, entrypoint,
  // and release hash. A broken or misdirected link therefore fails verification
  // and is repaired instead of being accepted as valid.
  const installedDir = profilePackageDir(profileDir);
  let installedResolved: string | undefined;
  if (!(await exists(installedDir))) {
    errors.push(`installed profile package ${IMAGE_WORKSHOP_PLUGIN_PACKAGE} was not found under the ${profile} profile`);
  } else {
    const ownedReal = await realpath(paths.programRoot).catch(() => paths.programRoot);
    const installedReal = await realpath(installedDir).catch(() => undefined);
    installedResolved = installedReal ?? installedDir;
    // DSH rc.7 installs a file: dependency in one of two supported forms:
    // (a) a link resolving to the exact app-owned bundle, or (b) an ordinary
    // exact-hash package copy at the canonical profile node_modules path.
    // A broken or misdirected link (resolving elsewhere) is rejected and
    // repaired instead of being accepted as valid.
    const canonicalProfile = await realpath(profileDir).catch(() => profileDir);
    const canonicalInstalled = join(canonicalProfile, 'node_modules', IMAGE_WORKSHOP_PLUGIN_PACKAGE);
    const linkedToOwned = installedReal !== undefined
      && (sameCanonicalPath(installedReal, ownedReal, platform) || isWithinCanonicalPath(installedReal, ownedReal, platform));
    const canonicalCopy = installedReal !== undefined && sameCanonicalPath(installedReal, canonicalInstalled, platform);
    if (!linkedToOwned && !canonicalCopy) {
      errors.push(`installed profile package does not resolve to the app-owned program root or the canonical profile copy (got ${installedReal ?? 'unresolvable'})`);
    }
    const installedManifest = await readJson(join(installedReal ?? installedDir, 'package.json'));
    const installedName = typeof installedManifest?.name === 'string' ? installedManifest.name : undefined;
    const installedVersion = typeof installedManifest?.version === 'string' ? installedManifest.version : undefined;
    const installedEntry = typeof installedManifest?.main === 'string' ? installedManifest.main : undefined;
    if (installedName !== IMAGE_WORKSHOP_PLUGIN_PACKAGE || installedVersion !== IMAGE_WORKSHOP_PLUGIN_VERSION) {
      errors.push(`installed profile package identity is ${installedName ?? 'missing'}@${installedVersion ?? 'missing'}, expected ${IMAGE_WORKSHOP_PLUGIN_PACKAGE}@${IMAGE_WORKSHOP_PLUGIN_VERSION}`);
    }
    if (!installedEntry || !(await exists(join(installedReal ?? installedDir, installedEntry)))) {
      errors.push(`installed profile package entrypoint ${installedEntry ?? IMAGE_WORKSHOP_PLUGIN_ENTRYPOINT} was not found`);
    }
    const installedSha = await imageWorkshopBundleDigest(installedReal ?? installedDir).catch(() => undefined);
    if (installedSha !== IMAGE_WORKSHOP_PLUGIN_SHA256) {
      errors.push(`installed profile package release hash mismatch (got ${installedSha?.slice(0, 12) ?? 'none'}); the installed copy is not the pinned prebuilt bundle`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    packageDir: installedResolved,
    packageVersion,
    profileDependency,
    bundleOccurrences,
    entrypoint,
    ownedPath,
    sha256
  };
}

async function linkImageWorkshopPlugin(options: ImageWorkshopPluginOptions, paths: HarnessPaths, bundleDir: string, platform: string, env: Record<string, string | undefined>): Promise<void> {
  const pnpm = await preparePnpmRuntime(options, paths);
  const dsh = options.dshExecutable ?? env.DSH_EXECUTABLE ?? await findDshExecutable(paths.runtimeDir, platform);
  if (!dsh) throw new Error('Pinned DSH executable was not found; cannot link the app-owned image tool plugin into the profile.');
  const profile = options.profile ?? IMAGE_WORKSHOP_PLUGIN_PROFILE;
  const invocation = await resolveDshInvocation(dsh, options, env);
  const args = ['plugin', '--profile', profile, 'add', '--save-exact', '--ignore-scripts', `file:${bundleDir}`];
  const runner = options.commandRunner ?? runCommand;
  let result;
  try {
    result = await runner(invocation.command, [...invocation.prefix, ...args], {
      cwd: paths.dshHome,
      env: pnpm.env,
      platform,
      timeoutMs: 15 * 60_000
    });
  } catch (error) {
    throw new Error(redactSensitive(`Image tool plugin manager could not start: ${error instanceof Error ? error.message : String(error)}`, env));
  }
  if (result.exitCode !== 0) throw new Error(redactSensitive(commandFailure(invocation.command, args, result, env).message, env));
}

/** Install or repair the app-owned image tool plugin into the DSH profile. */
export async function prepareImageWorkshopPlugin(options: ImageWorkshopPluginOptions = {}): Promise<ImageWorkshopPluginVerification> {
  const paths = resolveHarnessPaths(options);
  const platform = options.platform ?? process.platform;
  const env = pluginEnvironment(options.env ?? process.env);
  await mkdir(paths.dshHome, { recursive: true });
  const target = resolve(options.bundleDir ?? imageWorkshopBundleDirFor(paths));
  const current = await verifyImageWorkshopPlugin({ ...options, bundleDir: target });
  if (current.valid) return current;

  const source = resolve(options.bundleDir ?? defaultImageWorkshopBundleDir());
  if (source !== target) {
    await mkdir(dirname(target), { recursive: true });
    const staging = `${target}.staging-${Date.now()}`;
    await rm(staging, { recursive: true, force: true });
    await cp(source, staging, { recursive: true });
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
  }
  const profile = options.profile ?? IMAGE_WORKSHOP_PLUGIN_PROFILE;
  const profileDir = profileDirFor(paths, profile);
  const snapshot = await snapshotImageWorkshopProfile(paths, profileDir);
  try {
    await linkImageWorkshopPlugin(options, paths, target, platform, env);
    const installed = await verifyImageWorkshopPlugin({ ...options, bundleDir: target });
    if (!installed.valid) throw new Error(`Image tool plugin installation completed but verification failed: ${installed.errors.join('; ')}`);
    return installed;
  } catch (error) {
    const original = error instanceof Error ? error : new Error(String(error));
    try {
      await restoreImageWorkshopProfile(snapshot);
    } catch (restoreError) {
      throw new Error(`${original.message}; image tool plugin profile rollback failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
    }
    throw original;
  } finally {
    await rm(snapshot.root, { recursive: true, force: true });
  }
}

export function imageWorkshopPluginSummary(verification: ImageWorkshopPluginVerification): string {
  return verification.valid
    ? `App-owned image tool plugin ${IMAGE_WORKSHOP_PLUGIN_PACKAGE}@${verification.packageVersion} is linked into the ${IMAGE_WORKSHOP_PLUGIN_PROFILE} profile and scoped to asset-workshop`
    : `App-owned image tool plugin is not usable: ${verification.errors.join('; ') || 'unknown reason'}`;
}
