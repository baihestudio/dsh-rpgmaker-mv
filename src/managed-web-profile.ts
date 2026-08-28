import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep, win32 } from 'node:path';

import { findDshExecutable } from './bootstrap';
import { resolveHarnessPaths, type HarnessPaths, type PathOptions } from './config';
import { commandFailure, redactSensitive, runCommand, type CommandRunner } from './process';
import {
  defaultWorkspaceMcpBundleDir,
  verifyWorkspaceMcpBundle,
  workspaceMcpBundleDirFor,
  WORKSPACE_MCP_BUNDLE_RELATIVE,
  WORKSPACE_MCP_PACKAGE,
  WORKSPACE_MCP_VERSION,
  type WorkspaceMcpBundleVerification
} from './workspace-mcp';
import {
  pluginEnvironment,
  preparePnpmRuntime,
  profileDirFor,
  resolveDshInvocation
} from './profile';

/** The one DSH profile owned by this product. */
export const MANAGED_WEB_PROFILE = 'web';
/** Alias used by callers that describe the profile by its DSH name. */
export const MANAGED_WEB_PROFILE_NAME = MANAGED_WEB_PROFILE;

// The desired package set is deliberately declared beside the materializer;
// package-shaped modules only re-export these constants for release/test code.
export const DSH_WEB_PACKAGE = '@guionai/dsh-web';
export const DSH_WEB_VERSION = '0.3.1';
export const DSH_WEB_PROFILE = MANAGED_WEB_PROFILE;
export const DSH_IMAGEGEN_PACKAGE = '@lamplitisles/dsh-imagegen';
export const DSH_IMAGEGEN_VERSION = '0.2.1';
export const DSH_IMAGEGEN_PROFILE = MANAGED_WEB_PROFILE;
export const DSH_BRAND_PACKAGE = '@baihestudio/dsh-rpgmaker-brand';
export const DSH_BRAND_VERSION = '0.1.0';
export const DSH_BRAND_PROFILE = MANAGED_WEB_PROFILE;
export const DSH_BRAND_BUNDLE_RELATIVE = join('bundle', 'dsh-rpgmaker-brand');

export interface ManagedWebProfileOptions extends PathOptions {
  dshExecutable?: string;
  npmExecutable?: string;
  pnpmExecutable?: string;
  pnpmRuntimeDir?: string;
  nodeExecutable?: string;
  bunExecutable?: string;
  commandRunner?: CommandRunner;
}

export interface ManagedWebPackageVerification {
  packageName: string;
  expectedVersion: string;
  dependency: string | undefined;
  installedVersion: string | undefined;
  installedDir: string | undefined;
  valid: boolean;
  errors: string[];
}

export interface ManagedWebProfileVerification {
  valid: boolean;
  errors: string[];
  profile: string;
  profileDir: string;
  dependencies: Record<string, string>;
  bundles: string[];
  packages: ManagedWebPackageVerification[];
  workspaceMcpBundle: WorkspaceMcpBundleVerification;
}

export interface ManagedWebProfileResult extends ManagedWebProfileVerification {
  materialized: boolean;
}

interface JsonObject {
  [key: string]: unknown;
}

interface ManagedProfileSnapshot {
  root: string;
  profileDir: string;
  profileBackup: string;
  profileExisted: boolean;
  bundleDir: string;
  bundleBackup: string;
  bundleExisted: boolean;
}

interface DesiredPackage {
  packageName: string;
  version: string;
  source?: 'brand' | 'workspace';
}

const DESIRED_PACKAGES: readonly DesiredPackage[] = [
  { packageName: DSH_WEB_PACKAGE, version: DSH_WEB_VERSION },
  { packageName: DSH_IMAGEGEN_PACKAGE, version: DSH_IMAGEGEN_VERSION },
  { packageName: DSH_BRAND_PACKAGE, version: DSH_BRAND_VERSION, source: 'brand' },
  { packageName: WORKSPACE_MCP_PACKAGE, version: WORKSPACE_MCP_VERSION, source: 'workspace' }
] as const;

export const MANAGED_WEB_PROFILE_PACKAGES = DESIRED_PACKAGES;
export const MANAGED_WEB_PROFILE_PACKAGE_NAMES = DESIRED_PACKAGES.map(({ packageName }) => packageName) as readonly string[];

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

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function packageDir(profileDir: string, packageName: string): string {
  return join(profileDir, 'node_modules', ...packageName.split('/'));
}

function samePath(first: string, second: string, platform: string): boolean {
  return platform === 'win32' ? first.toLowerCase() === second.toLowerCase() : first === second;
}

function pathIsWithin(parent: string, child: string, platform: string): boolean {
  const parentKey = platform === 'win32' ? parent.toLowerCase() : parent;
  const childKey = platform === 'win32' ? child.toLowerCase() : child;
  return childKey === parentKey || childKey.startsWith(`${parentKey}${sep}`);
}

function absolutePathFor(value: string, platform: string): boolean {
  return isAbsolute(value) || (platform === 'win32' && win32.isAbsolute(value));
}

async function canonical(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

function localDependencySpec(bundleDir: string): string {
  return `file:${resolve(bundleDir)}`;
}

function dependencyObject(value: unknown): Record<string, string> {
  const object = asObject(value);
  if (!object) return {};
  return Object.fromEntries(Object.entries(object).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function profileDependencies(manifest: JsonObject | undefined): Record<string, string> {
  return dependencyObject(manifest?.dependencies);
}

function secondaryDependencyNames(manifest: JsonObject | undefined): string[] {
  const names: string[] = [];
  for (const section of ['devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const dependencies = asObject(manifest?.[section]);
    for (const name of Object.keys(dependencies ?? {})) names.push(`${section}:${name}`);
  }
  return names.sort();
}

function profileBundles(manifest: JsonObject | undefined): string[] {
  const profile = asObject(asObject(manifest?.dsh)?.profile);
  return Array.isArray(profile?.bundles) ? profile.bundles.filter((value): value is string => typeof value === 'string') : [];
}

function rawProfileBundles(manifest: JsonObject | undefined): unknown[] | undefined {
  const profile = asObject(asObject(manifest?.dsh)?.profile);
  return Array.isArray(profile?.bundles) ? profile.bundles : undefined;
}

function expectedDependency(desired: DesiredPackage, brandBundleDir: string, workspaceBundleDir: string): string {
  if (desired.source === 'brand') return localDependencySpec(brandBundleDir);
  if (desired.source === 'workspace') return localDependencySpec(workspaceBundleDir);
  return desired.version;
}

function expectedSource(desired: DesiredPackage, brandBundleDir: string, workspaceBundleDir: string): string | undefined {
  if (desired.source === 'brand') return brandBundleDir;
  if (desired.source === 'workspace') return workspaceBundleDir;
  return undefined;
}

async function verifyBundlePackage(
  desired: DesiredPackage,
  profileDir: string,
  dependency: string | undefined,
  expectedDependencyValue: string,
  sourceDir: string | undefined,
  platform: string,
  errors: string[]
): Promise<ManagedWebPackageVerification> {
  const packageErrors: string[] = [];
  const installedDir = packageDir(profileDir, desired.packageName);
  const installedReal = await canonical(installedDir);
  const installedExists = await exists(installedDir);
  let installedVersion: string | undefined;
  if (!installedExists) {
    packageErrors.push(`installed profile package ${desired.packageName} was not found under the ${MANAGED_WEB_PROFILE} profile`);
  } else {
    const installedManifest = await readJson(join(installedReal, 'package.json'));
    const installedName = typeof installedManifest?.name === 'string' ? installedManifest.name : undefined;
    installedVersion = typeof installedManifest?.version === 'string' ? installedManifest.version : undefined;
    if (installedName !== desired.packageName || installedVersion !== desired.version) {
      packageErrors.push(`installed profile package identity is ${installedName ?? 'missing'}@${installedVersion ?? 'missing'}, expected ${desired.packageName}@${desired.version}`);
    }
    const main = typeof installedManifest?.main === 'string' ? installedManifest.main : undefined;
    if (!main || !(await exists(join(installedReal, main)))) packageErrors.push(`installed profile package entrypoint ${main ?? 'missing'} was not found`);
  }

  if (!desired.source && dependency !== expectedDependencyValue) {
    packageErrors.push(`profile dependency ${desired.packageName} is not pinned to ${desired.packageName}@${desired.version}`);
  }

  if (sourceDir) {
    const sourceReal = await canonical(sourceDir);
    if (!(await exists(sourceDir))) {
      packageErrors.push(`app-owned ${desired.packageName} bundle was not found at ${sourceDir}`);
    } else if (!dependency || !/^file:/i.test(dependency)) {
      packageErrors.push(`profile dependency ${desired.packageName} is not an app-owned local file source`);
    } else {
      const sourceSpec = dependency.replace(/^file:/i, '');
      if (!absolutePathFor(sourceSpec, platform)) {
        packageErrors.push(`profile dependency ${desired.packageName} is not an absolute app-owned local file source`);
      } else {
        const dependencyTarget = await canonical(resolve(profileDir, sourceSpec));
        if (!samePath(dependencyTarget, sourceReal, platform)) packageErrors.push(`profile dependency ${desired.packageName} does not resolve to its app-owned bundle`);
      }
    }
    if (installedExists) {
      const profileCanonical = await canonical(profileDir);
      const isCanonicalCopy = samePath(installedReal, join(profileCanonical, 'node_modules', ...desired.packageName.split('/')), platform);
      if (!samePath(installedReal, sourceReal, platform) && !isCanonicalCopy && !pathIsWithin(sourceReal, installedReal, platform)) {
        packageErrors.push(`installed profile package ${desired.packageName} does not resolve to the app-owned bundle or canonical profile copy`);
      }
    }
  } else if (installedExists) {
    const profileCanonical = await canonical(profileDir);
    if (!pathIsWithin(profileCanonical, installedReal, platform)) packageErrors.push(`installed profile package ${desired.packageName} resolves outside the canonical profile tree`);
  }

  errors.push(...packageErrors);
  return {
    packageName: desired.packageName,
    expectedVersion: desired.version,
    dependency,
    installedVersion,
    installedDir: installedExists ? installedReal : undefined,
    valid: packageErrors.length === 0,
    errors: packageErrors
  };
}

async function verifyBrandSource(bundleDir: string, platform: string, programRoot: string, errors: string[]): Promise<void> {
  if (!(await exists(bundleDir))) {
    errors.push(`app-owned RPG Maker Agent brand bundle was not found at ${bundleDir}`);
    return;
  }
  const sourceReal = await canonical(bundleDir);
  const programReal = await canonical(programRoot);
  if (!pathIsWithin(programReal, sourceReal, platform)) errors.push(`brand bundle path ${bundleDir} is not inside the app-owned program root ${programRoot}`);
  const manifest = await readJson(join(bundleDir, 'package.json'));
  if (manifest?.name !== DSH_BRAND_PACKAGE || manifest?.version !== DSH_BRAND_VERSION) errors.push(`brand bundle identity is ${String(manifest?.name ?? 'missing')}@${String(manifest?.version ?? 'missing')}, expected ${DSH_BRAND_PACKAGE}@${DSH_BRAND_VERSION}`);
  const main = typeof manifest?.main === 'string' ? manifest.main : undefined;
  if (!main || !(await exists(join(bundleDir, main)))) errors.push(`brand bundle entrypoint ${main ?? 'missing'} was not found`);
  const client = await exists(join(bundleDir, 'lib', 'client.js'));
  if (!client) errors.push('brand bundle client entrypoint lib/client.js was not found');
  const patch = asObject(asObject(manifest?.dsh)?.bundle)?.patch;
  if (patch !== './cordis.patch.yml' || !(await exists(join(bundleDir, './cordis.patch.yml')))) errors.push('brand bundle dsh.bundle patch is missing or invalid');
}

/**
 * Read-only verification of the complete app-managed Web profile.
 *
 * This function deliberately never invokes pnpm/DSH and never repairs state;
 * it is shared by installation, startup, and Doctor.
 */
export async function verifyManagedWebProfile(options: ManagedWebProfileOptions = {}): Promise<ManagedWebProfileVerification> {
  const paths = resolveHarnessPaths(options);
  const platform = options.platform ?? process.platform;
  const profileDir = profileDirFor(paths, MANAGED_WEB_PROFILE);
  const workspaceBundleDir = resolve(workspaceMcpBundleDirFor(paths));
  const brandBundleDir = resolve(join(paths.programRoot, DSH_BRAND_BUNDLE_RELATIVE));
  const errors: string[] = [];
  const manifest = await readJson(join(profileDir, 'package.json'));
  if (!manifest) errors.push(`managed ${MANAGED_WEB_PROFILE} profile manifest is missing or invalid at ${join(profileDir, 'package.json')}`);

  const dependencies = profileDependencies(manifest);
  const bundles = profileBundles(manifest);
  const rawBundles = rawProfileBundles(manifest);
  const desiredNames = DESIRED_PACKAGES.map(({ packageName }) => packageName);
  const dependencyNames = Object.keys(asObject(manifest?.dependencies) ?? {}).sort();
  const secondaryNames = secondaryDependencyNames(manifest);
  if (dependencyNames.length !== desiredNames.length || dependencyNames.some((name) => !desiredNames.includes(name)) || secondaryNames.length > 0) {
    const found = [...dependencyNames, ...secondaryNames].join(', ');
    errors.push(`managed ${MANAGED_WEB_PROFILE} profile dependencies are not exact; expected ${desiredNames.join(', ')}, found ${found || 'none'}`);
  }
  if (!rawBundles || rawBundles.length !== desiredNames.length || rawBundles.some((name, index) => name !== desiredNames[index])) {
    errors.push(`managed ${MANAGED_WEB_PROFILE} profile bundle registrations are not exact; expected ${desiredNames.join(', ')}`);
  }

  await verifyBrandSource(brandBundleDir, platform, paths.programRoot, errors);
  const workspaceMcpBundle = await verifyWorkspaceMcpBundle({
    ...options,
    profile: MANAGED_WEB_PROFILE,
    bundleDir: workspaceBundleDir
  });
  errors.push(...workspaceMcpBundle.errors);

  const packages: ManagedWebPackageVerification[] = [];
  for (const desired of DESIRED_PACKAGES) {
    packages.push(await verifyBundlePackage(
      desired,
      profileDir,
      dependencies[desired.packageName],
      expectedDependency(desired, brandBundleDir, workspaceBundleDir),
      expectedSource(desired, brandBundleDir, workspaceBundleDir),
      platform,
      errors
    ));
  }

  return {
    valid: errors.length === 0,
    errors,
    profile: MANAGED_WEB_PROFILE,
    profileDir,
    dependencies,
    bundles,
    packages,
    workspaceMcpBundle
  };
}

async function snapshotManagedWebProfile(paths: HarnessPaths, profileDir: string, bundleDir: string): Promise<ManagedProfileSnapshot> {
  const root = await mkdtemp(join(paths.dshHome, '.managed-web-profile-rollback-'));
  const profileBackup = join(root, 'profile');
  const bundleBackup = join(root, 'workspace-bundle');
  const profileExisted = await exists(profileDir);
  const bundleExisted = await exists(bundleDir);
  try {
    if (profileExisted) await cp(profileDir, profileBackup, { recursive: true, force: false, errorOnExist: true });
    if (bundleExisted) await cp(bundleDir, bundleBackup, { recursive: true, force: false, errorOnExist: true });
    return { root, profileDir, profileBackup, profileExisted, bundleDir, bundleBackup, bundleExisted };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

async function restoreManagedWebProfile(snapshot: ManagedProfileSnapshot): Promise<void> {
  await rm(snapshot.profileDir, { recursive: true, force: true });
  if (snapshot.profileExisted) {
    await mkdir(dirname(snapshot.profileDir), { recursive: true });
    await cp(snapshot.profileBackup, snapshot.profileDir, { recursive: true, force: false, errorOnExist: true });
  }
  await rm(snapshot.bundleDir, { recursive: true, force: true });
  if (snapshot.bundleExisted) {
    await mkdir(dirname(snapshot.bundleDir), { recursive: true });
    await cp(snapshot.bundleBackup, snapshot.bundleDir, { recursive: true, force: false, errorOnExist: true });
  }
}

async function replaceWorkspaceBundle(source: string, target: string, platform: string): Promise<void> {
  if (samePath(source, target, platform)) return;
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const staging = `${target}.staging-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await rm(staging, { recursive: true, force: true });
  try {
    await cp(source, staging, { recursive: true, force: false, errorOnExist: true });
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function addProfilePackage(
  options: ManagedWebProfileOptions,
  paths: HarnessPaths,
  invocation: { command: string; prefix: string[] },
  env: Record<string, string | undefined>,
  pnpmEnv: Record<string, string | undefined>,
  packageSpec: string
): Promise<void> {
  const args = ['plugin', '--profile', MANAGED_WEB_PROFILE, 'add', '--save-exact', '--ignore-scripts', packageSpec];
  const runner = options.commandRunner ?? runCommand;
  let result;
  try {
    result = await runner(invocation.command, [...invocation.prefix, ...args], {
      cwd: paths.dshHome,
      env: pnpmEnv,
      platform: options.platform,
      timeoutMs: 15 * 60_000
    });
  } catch (error) {
    throw new Error(redactSensitive(`Managed Web profile materialization could not add ${packageSpec}: ${error instanceof Error ? error.message : String(error)}`, env));
  }
  if (result.exitCode !== 0) throw new Error(redactSensitive(commandFailure(invocation.command, [...invocation.prefix, ...args], result, env).message, env));
}

async function writeManagedBundleRegistrations(profileDir: string): Promise<void> {
  const manifestPath = join(profileDir, 'package.json');
  const manifest = await readJson(manifestPath);
  if (!manifest) throw new Error(`Managed Web profile package manager produced no readable manifest at ${manifestPath}`);
  const dsh = asObject(manifest.dsh) ?? {};
  const profile = asObject(dsh.profile) ?? {};
  profile.bundles = [...MANAGED_WEB_PROFILE_PACKAGE_NAMES];
  dsh.profile = profile;
  manifest.dsh = dsh;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

/** Materialize the complete exact Web profile, preserving the prior profile on failure. */
export async function ensureManagedWebProfile(options: ManagedWebProfileOptions = {}): Promise<ManagedWebProfileResult> {
  const paths = resolveHarnessPaths(options);
  const platform = options.platform ?? process.platform;
  const ambientEnv = options.env ?? process.env;
  const env = pluginEnvironment({ ...ambientEnv, DSH_HOME: paths.dshHome });
  await mkdir(paths.dshHome, { recursive: true });
  const current = await verifyManagedWebProfile({ ...options, env });
  if (current.valid) return { ...current, materialized: false };

  const brandBundleDir = resolve(join(paths.programRoot, DSH_BRAND_BUNDLE_RELATIVE));
  const workspaceBundleDir = resolve(workspaceMcpBundleDirFor(paths));
  const installedWorkspaceSource = resolve(join(paths.programRoot, WORKSPACE_MCP_BUNDLE_RELATIVE));
  const workspaceSource = await exists(installedWorkspaceSource) ? installedWorkspaceSource : resolve(defaultWorkspaceMcpBundleDir());
  if (!(await exists(workspaceSource))) throw new Error(`Managed Web profile materialization cannot find the app-owned workspace MCP bundle at ${workspaceSource}`);
  if (!(await exists(brandBundleDir))) throw new Error(`Managed Web profile materialization cannot find the app-owned RPG Maker Agent brand bundle at ${brandBundleDir}`);

  // The app-owned pnpm runtime is resolved exactly once for this attempt and
  // its environment is reused for all four DSH plugin additions.
  const pnpm = await preparePnpmRuntime({ ...options, env, useAppOwnedPnpm: true }, paths);
  const dsh = options.dshExecutable ?? env.DSH_EXECUTABLE ?? await findDshExecutable(paths.runtimeDir, platform);
  if (!dsh) throw new Error('Pinned DSH executable was not found; cannot materialize the managed Web profile.');
  const invocation = await resolveDshInvocation(dsh, options, env);
  const profileDir = profileDirFor(paths, MANAGED_WEB_PROFILE);
  const snapshot = await snapshotManagedWebProfile(paths, profileDir, workspaceBundleDir);
  let restored = false;
  try {
    await replaceWorkspaceBundle(workspaceSource, workspaceBundleDir, platform);
    await rm(profileDir, { recursive: true, force: true });
    await mkdir(paths.dshHome, { recursive: true });
    for (const desired of DESIRED_PACKAGES) {
      const spec = desired.source === 'brand'
        ? localDependencySpec(brandBundleDir)
        : desired.source === 'workspace'
          ? localDependencySpec(workspaceBundleDir)
          : `${desired.packageName}@${desired.version}`;
      await addProfilePackage(options, paths, invocation, env, pnpm.env, spec);
    }
    await writeManagedBundleRegistrations(profileDir);
    const verification = await verifyManagedWebProfile({ ...options, env });
    if (!verification.valid) throw new Error(`Managed Web profile materialization completed but verification failed: ${verification.errors.join('; ')}`);
    await rm(snapshot.root, { recursive: true, force: true });
    return { ...verification, materialized: true };
  } catch (error) {
    const original = error instanceof Error ? error : new Error(String(error));
    try {
      await restoreManagedWebProfile(snapshot);
      restored = true;
    } catch (restoreError) {
      throw new Error(`${original.message}; managed Web profile rollback failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}; rollback snapshot preserved at ${snapshot.root}`);
    }
    throw new Error(`${original.message}; the prior managed Web profile was restored${restored ? '' : ' unsuccessfully'}`);
  } finally {
    if (restored) await rm(snapshot.root, { recursive: true, force: true });
  }
}

/** Descriptive alias for callers that use the preparation vocabulary. */
export const prepareManagedWebProfile = ensureManagedWebProfile;
