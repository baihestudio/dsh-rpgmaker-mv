import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep, win32 } from 'node:path';

import { resolveDshEntrypoint } from './bootstrap';
import { resolveReceiptBackedHarnessPaths } from './installation-root';
import { DSH_VERSION, type HarnessPaths, type PathOptions } from './config';
import { isRegularFile } from './files';
import { withHarnessOperationLock } from './lock';
import { commandFailure, redactSensitive, runCommand, type CommandRunner } from './process';
import {
  workspaceMcpBundleDirFor,
  WORKSPACE_MCP_AGENT_ENTRYPOINT,
  WORKSPACE_MCP_BUNDLE_PATCH,
  WORKSPACE_MCP_BUNDLE_RELATIVE,
  WORKSPACE_MCP_LICENSE,
  WORKSPACE_MCP_PACKAGE,
  WORKSPACE_MCP_VERSION,
} from './workspace-mcp';
import {
  pluginEnvironment,
  preparePnpmRuntime,
  profileDirFor,
  resolveDshInvocation
} from './profile';

/** The one DSH profile owned by this product. */
export const MANAGED_WEB_PROFILE = 'web';

export const DSH_WEB_PACKAGE = '@guionai/dsh-web';
export const DSH_WEB_VERSION = '0.3.2';
export const DSH_IMAGEGEN_PACKAGE = '@lamplitisles/dsh-imagegen';
export const DSH_IMAGEGEN_VERSION = '0.2.2';
export const DSH_BRAND_PACKAGE = '@baihestudio/dsh-rpgmaker-brand';
export const DSH_BRAND_VERSION = '0.1.0';
export const DSH_BRAND_BUNDLE_RELATIVE = join('bundle', 'dsh-rpgmaker-brand');
const DSH_RUNTIME_MARKER = 'dshRpgMaker';
const DSH_RUNTIME_MARKER_REVISION = 3;

export interface ManagedWebProfileOptions extends PathOptions {
  dshExecutable?: string;
  npmExecutable?: string;
  pnpmExecutable?: string;
  pnpmRuntimeDir?: string;
  manifestRoot?: string;
  nodeExecutable?: string;
  commandRunner?: CommandRunner;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
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
  license?: string;
  patch?: string;
  requiredFiles?: readonly string[];
}

const DESIRED_PACKAGES: readonly DesiredPackage[] = [
  { packageName: DSH_WEB_PACKAGE, version: DSH_WEB_VERSION },
  { packageName: DSH_IMAGEGEN_PACKAGE, version: DSH_IMAGEGEN_VERSION },
  {
    packageName: DSH_BRAND_PACKAGE,
    version: DSH_BRAND_VERSION,
    source: 'brand',
    patch: './cordis.patch.yml',
    requiredFiles: ['lib/client.js']
  },
  {
    packageName: WORKSPACE_MCP_PACKAGE,
    version: WORKSPACE_MCP_VERSION,
    source: 'workspace',
    license: WORKSPACE_MCP_LICENSE,
    patch: WORKSPACE_MCP_BUNDLE_PATCH,
    requiredFiles: [WORKSPACE_MCP_AGENT_ENTRYPOINT]
  }
] as const;

export const MANAGED_WEB_PROFILE_PACKAGE_NAMES = DESIRED_PACKAGES.map(({ packageName }) => packageName) as readonly string[];
export const MANAGED_WEB_PROFILE_BUNDLE_NAMES = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  ...MANAGED_WEB_PROFILE_PACKAGE_NAMES
] as readonly string[];

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

/** Resolve an existing path, including symlinked ancestors of a missing leaf. */
async function canonicalPath(path: string): Promise<string> {
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
        // Continue until an existing ancestor can be canonicalized.
      }
    }
  }
}

async function canonicalExistingPath(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}

function pathIsWithin(parent: string, child: string, platform: string): boolean {
  const parentKey = platform === 'win32' ? parent.toLowerCase() : parent;
  const childKey = platform === 'win32' ? child.toLowerCase() : child;
  const prefix = parentKey.endsWith(sep) ? parentKey : `${parentKey}${sep}`;
  return childKey === parentKey || childKey.startsWith(prefix);
}

function pathIsStrictlyWithin(parent: string, child: string, platform: string): boolean {
  const parentKey = platform === 'win32' ? parent.toLowerCase() : parent;
  const childKey = platform === 'win32' ? child.toLowerCase() : child;
  return childKey !== parentKey && pathIsWithin(parent, child, platform);
}

function packageDir(profileDir: string, packageName: string): string {
  return join(profileDir, 'node_modules', ...packageName.split('/'));
}

function samePath(first: string, second: string, platform: string): boolean {
  return platform === 'win32' ? first.toLowerCase() === second.toLowerCase() : first === second;
}

function absolutePathFor(value: string, platform: string): boolean {
  return isAbsolute(value) || (platform === 'win32' && win32.isAbsolute(value));
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

interface ManagedWebProfileStructure {
  errors: string[];
  profileDir: string;
  workspaceBundleDir: string;
}

/**
 * Resolve and validate every mutable descendant that managed-profile repair
 * may remove, copy, replace, or hand to the package runner.
 */
async function inspectManagedWebProfileStructure(paths: HarnessPaths, platform: string): Promise<ManagedWebProfileStructure> {
  const dshHomeReal = await canonicalPath(paths.dshHome);
  const profilesRoot = resolve(join(paths.dshHome, 'profiles'));
  const profilesRootReal = await canonicalPath(profilesRoot);
  const profileDir = profileDirFor(paths, MANAGED_WEB_PROFILE);
  const profileDirReal = await canonicalPath(profileDir);
  const dataRoot = resolve(join(paths.dshHome, 'rpgmaker-mv'));
  const dataRootReal = await canonicalPath(dataRoot);
  const workspaceBundleDir = resolve(workspaceMcpBundleDirFor(paths));
  const workspaceBundleReal = await canonicalPath(workspaceBundleDir);
  const errors: string[] = [];

  if (!pathIsWithin(dshHomeReal, profilesRootReal, platform)) {
    errors.push(`managed profiles root ${profilesRoot} escapes canonical DSH_HOME ${paths.dshHome}`);
  }
  if (!pathIsStrictlyWithin(profilesRootReal, profileDirReal, platform)) {
    errors.push(`managed ${MANAGED_WEB_PROFILE} profile root ${profileDir} escapes the app-managed profiles directory ${profilesRoot}`);
  }
  if (!pathIsWithin(dshHomeReal, dataRootReal, platform)) {
    errors.push(`workspace MCP data root ${dataRoot} escapes canonical DSH_HOME ${paths.dshHome}`);
  }
  if (!pathIsStrictlyWithin(dataRootReal, workspaceBundleReal, platform)) {
    errors.push(`workspace MCP bundle target ${workspaceBundleDir} escapes the app-managed data root ${dataRoot}`);
  }

  return {
    errors,
    profileDir,
    workspaceBundleDir
  };
}

async function requireManagedWebProfileStructure(paths: HarnessPaths, platform: string): Promise<void> {
  const structure = await inspectManagedWebProfileStructure(paths, platform);
  if (structure.errors.length > 0) {
    throw new Error(`Managed Web profile repair refused because managed roots are unsafe: ${structure.errors.join('; ')}`);
  }
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

async function packageInstallIsCanonical(
  profileDir: string,
  packageName: string,
  installedReal: string,
  platform: string
): Promise<boolean> {
  const profileCanonical = await canonicalPath(profileDir);
  const rawPackagePath = join(profileCanonical, 'node_modules', ...packageName.split('/'));
  return samePath(installedReal, rawPackagePath, platform);
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
  const installedReal = await canonicalPath(installedDir);
  const installedExists = await exists(installedDir);
  let installedVersion: string | undefined;
  if (!installedExists) {
    packageErrors.push(`installed profile package ${desired.packageName} was not found under the ${MANAGED_WEB_PROFILE} profile`);
  } else {
    const installed = await verifyPackageRoot(desired, installedReal, `installed profile package ${desired.packageName}`, 'canonical package directory', platform);
    installedVersion = installed.version;
    packageErrors.push(...installed.errors);
    if (!(await packageInstallIsCanonical(profileDir, desired.packageName, installedReal, platform))) {
      packageErrors.push(`installed profile package ${desired.packageName} does not resolve to its canonical profile directory`);
    }
  }

  if (!desired.source && dependency !== expectedDependencyValue) {
    packageErrors.push(`profile dependency ${desired.packageName} is not pinned to ${desired.packageName}@${desired.version}`);
  }

  if (sourceDir) {
    const sourceReal = await canonicalPath(sourceDir);
    if (!(await exists(sourceDir))) {
      packageErrors.push(`app-owned ${desired.packageName} bundle was not found at ${sourceDir}`);
    } else {
      const source = await verifyPackageRoot(desired, sourceReal, `app-owned ${desired.packageName} bundle`, 'canonical bundle directory', platform);
      packageErrors.push(...source.errors);
      if (!dependency || !/^file:/i.test(dependency)) {
        packageErrors.push(`profile dependency ${desired.packageName} is not an app-owned local file source`);
      } else {
        const sourceSpec = dependency.replace(/^file:/i, '');
        if (!absolutePathFor(sourceSpec, platform)) {
          packageErrors.push(`profile dependency ${desired.packageName} is not an absolute app-owned local file source`);
        } else {
          const dependencyTarget = await canonicalPath(resolve(profileDir, sourceSpec));
          if (!samePath(dependencyTarget, sourceReal, platform)) packageErrors.push(`profile dependency ${desired.packageName} does not resolve to its app-owned bundle`);
        }
      }
    }
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

interface PackageRootVerification {
  errors: string[];
  version: string | undefined;
}

async function verifyContainedFile(
  rootReal: string,
  path: string | undefined,
  label: string,
  containment: string,
  platform: string,
  errors: string[]
): Promise<void> {
  const target = path ? await canonicalExistingPath(path) : undefined;
  if (!path || !target) {
    errors.push(`${label} was not found`);
  } else if (!pathIsWithin(rootReal, target, platform)) {
    errors.push(`${label} escapes its ${containment}`);
  } else if (!(await isRegularFile(path))) {
    errors.push(`${label} is not a regular file`);
  }
}

async function verifyPackageRoot(
  desired: DesiredPackage,
  root: string,
  label: string,
  containment: string,
  platform: string
): Promise<PackageRootVerification> {
  const errors: string[] = [];
  if (!(await exists(root))) {
    errors.push(`${label} was not found at ${root}`);
    return { errors, version: undefined };
  }
  const rootReal = await canonicalPath(root);
  const manifestPath = join(root, 'package.json');
  await verifyContainedFile(rootReal, manifestPath, `${label} manifest package.json`, containment, platform, errors);
  const manifest = await readJson(manifestPath);
  const name = typeof manifest?.name === 'string' ? manifest.name : undefined;
  const version = typeof manifest?.version === 'string' ? manifest.version : undefined;
  if (name !== desired.packageName || version !== desired.version) {
    errors.push(`${label} identity is ${name ?? 'missing'}@${version ?? 'missing'}, expected ${desired.packageName}@${desired.version}`);
  }
  if (desired.license && manifest?.license !== desired.license) {
    errors.push(`${label} license is ${String(manifest?.license ?? 'missing')}, expected ${desired.license}`);
  }
  const main = typeof manifest?.main === 'string' ? manifest.main : undefined;
  await verifyContainedFile(rootReal, main ? resolve(root, main) : undefined, `${label} entrypoint ${main ?? 'missing'}`, containment, platform, errors);
  const patch = asObject(asObject(manifest?.dsh)?.bundle)?.patch;
  const patchValue = typeof patch === 'string' ? patch : undefined;
  if (desired.patch && patchValue !== desired.patch) {
    errors.push(`${label} dsh.bundle.patch is ${patchValue ?? 'missing'}, expected ${desired.patch}`);
  }
  await verifyContainedFile(rootReal, patchValue ? resolve(root, patchValue) : undefined, `${label} dsh.bundle.patch ${patchValue ?? 'missing'}`, containment, platform, errors);
  for (const required of desired.requiredFiles ?? []) {
    const kind = required === 'lib/client.js' ? 'client entrypoint' : 'Agent entrypoint';
    await verifyContainedFile(rootReal, resolve(root, required), `${label} ${kind} ${required}`, containment, platform, errors);
  }
  return { errors, version };
}

interface ManagedWebSourceVerification {
  valid: boolean;
  errors: string[];
  brandSource: string;
  workspaceSource: string;
}

async function inspectManagedWebSources(paths: HarnessPaths, platform: string): Promise<ManagedWebSourceVerification> {
  const errors: string[] = [];
  const programRoot = await canonicalPath(paths.programRoot);
  const brandSource = resolve(join(paths.programRoot, DSH_BRAND_BUNDLE_RELATIVE));
  const brandReal = await canonicalPath(brandSource);
  if (!pathIsStrictlyWithin(programRoot, brandReal, platform)) {
    errors.push(`brand bundle path ${brandSource} is not inside the app-owned program root ${paths.programRoot}`);
  }

  const workspaceSource = resolve(join(paths.programRoot, WORKSPACE_MCP_BUNDLE_RELATIVE));
  const workspaceReal = await canonicalPath(workspaceSource);
  if (!pathIsStrictlyWithin(programRoot, workspaceReal, platform)) {
    errors.push(`workspace MCP source bundle ${workspaceSource} is outside its allowed app-owned root`);
  }
  return { valid: errors.length === 0, errors, brandSource, workspaceSource: workspaceReal };
}

async function requireManagedWebSources(paths: HarnessPaths, platform: string): Promise<ManagedWebSourceVerification> {
  const sources = await inspectManagedWebSources(paths, platform);
  const brand = DESIRED_PACKAGES.find(({ source }) => source === 'brand')!;
  const workspace = DESIRED_PACKAGES.find(({ source }) => source === 'workspace')!;
  sources.errors.push(...(await verifyPackageRoot(brand, sources.brandSource, 'brand bundle', 'canonical bundle directory', platform)).errors);
  sources.errors.push(...(await verifyPackageRoot(workspace, sources.workspaceSource, 'workspace MCP source bundle', 'canonical bundle directory', platform)).errors);
  sources.valid = sources.errors.length === 0;
  if (!sources.valid) {
    throw new Error(`Managed Web profile repair refused because app-owned sources are unsafe: ${sources.errors.join('; ')}`);
  }
  return sources;
}

/**
 * Read-only verification of the complete app-managed Web profile.
 *
 * This function deliberately never invokes pnpm/DSH and never repairs state;
 * it is shared by installation, startup, and Doctor.
 */
export async function verifyManagedWebProfile(options: ManagedWebProfileOptions = {}): Promise<ManagedWebProfileVerification> {
  const { paths } = await resolveReceiptBackedHarnessPaths(options);
  const platform = options.platform ?? process.platform;
  const structure = await inspectManagedWebProfileStructure(paths, platform);
  const { profileDir, workspaceBundleDir } = structure;
  const brandBundleDir = resolve(join(paths.programRoot, DSH_BRAND_BUNDLE_RELATIVE));
  const sources = await inspectManagedWebSources(paths, platform);
  const errors = [...structure.errors, ...sources.errors];
  if (sources.valid) {
    const workspace = DESIRED_PACKAGES.find(({ source }) => source === 'workspace')!;
    errors.push(...(await verifyPackageRoot(workspace, sources.workspaceSource, 'workspace MCP source bundle', 'canonical bundle directory', platform)).errors);
  }
  const manifest = await readJson(join(profileDir, 'package.json'));
  if (!manifest) errors.push(`managed ${MANAGED_WEB_PROFILE} profile manifest is missing or invalid at ${join(profileDir, 'package.json')}`);
  const runtimeMarker = asObject(manifest?.[DSH_RUNTIME_MARKER]);
  if (runtimeMarker?.dshVersion !== DSH_VERSION || runtimeMarker?.revision !== DSH_RUNTIME_MARKER_REVISION) {
    errors.push(`managed ${MANAGED_WEB_PROFILE} profile was not built for pinned DSH ${DSH_VERSION} and profile revision ${DSH_RUNTIME_MARKER_REVISION}`);
  }

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
  if (!rawBundles || rawBundles.length !== MANAGED_WEB_PROFILE_BUNDLE_NAMES.length || rawBundles.some((name, index) => name !== MANAGED_WEB_PROFILE_BUNDLE_NAMES[index])) {
    errors.push(`managed ${MANAGED_WEB_PROFILE} profile bundle registrations are not exact; expected ${MANAGED_WEB_PROFILE_BUNDLE_NAMES.join(', ')}`);
  }

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
    packages
  };
}

async function snapshotManagedWebProfile(
  paths: HarnessPaths,
  profileDir: string,
  bundleDir: string
): Promise<ManagedProfileSnapshot> {
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
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
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
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
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
  profile.bundles = [...MANAGED_WEB_PROFILE_BUNDLE_NAMES];
  dsh.profile = profile;
  manifest.dsh = dsh;
  manifest[DSH_RUNTIME_MARKER] = { dshVersion: DSH_VERSION, revision: DSH_RUNTIME_MARKER_REVISION };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

/** Materialize the complete exact Web profile, preserving the prior profile on failure. */
export async function ensureManagedWebProfile(options: ManagedWebProfileOptions = {}): Promise<ManagedWebProfileResult> {
  const { paths } = await resolveReceiptBackedHarnessPaths(options);
  return withHarnessOperationLock(paths.lockDir, paths.sessionLeaseDir, () => ensureManagedWebProfileUnlocked(options, paths), {
    timeoutMs: options.lockTimeoutMs ?? 15 * 60_000,
    retryMs: options.lockRetryMs
  });
}

async function ensureManagedWebProfileUnlocked(options: ManagedWebProfileOptions, paths: HarnessPaths): Promise<ManagedWebProfileResult> {
  const platform = options.platform ?? process.platform;
  const ambientEnv = options.env ?? process.env;
  const env = pluginEnvironment({ ...ambientEnv, DSH_HOME: paths.dshHome });
  await requireManagedWebProfileStructure(paths, platform);
  await mkdir(paths.dshHome, { recursive: true });
  const current = await verifyManagedWebProfile({ ...options, env });
  if (current.valid) {
    // A profile can survive independently of its app-owned package manager
    // (for example after a partial repair or a prior externally materialized
    // profile).  Always establish the exact pnpm runtime before declaring the
    // managed profile ready; system pnpm is never an acceptable substitute.
    await preparePnpmRuntime({ ...options, env, useAppOwnedPnpm: true }, paths);
    return { ...current, materialized: false };
  }

  const sources = await requireManagedWebSources(paths, platform);
  const brandBundleDir = resolve(join(paths.programRoot, DSH_BRAND_BUNDLE_RELATIVE));
  const workspaceBundleDir = resolve(workspaceMcpBundleDirFor(paths));
  const workspaceSource = sources.workspaceSource;

  // The app-owned pnpm runtime is resolved exactly once for this attempt and
  // its environment is reused for all four DSH plugin additions.
  const pnpm = await preparePnpmRuntime({ ...options, env, useAppOwnedPnpm: true }, paths);
  const dsh = options.dshExecutable ?? env.DSH_EXECUTABLE ?? await resolveDshEntrypoint(paths.runtimeDir, platform);
  if (!dsh) throw new Error('Pinned DSH executable was not found; cannot materialize the managed Web profile.');
  const invocation = await resolveDshInvocation(dsh, options, env);
  const profileDir = profileDirFor(paths, MANAGED_WEB_PROFILE);
  const snapshot = await snapshotManagedWebProfile(paths, profileDir, workspaceBundleDir);
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
    // Snapshot cleanup is best effort after successful verification. A cleanup
    // error must never turn a successful materialization into a rollback.
    await rm(snapshot.root, { recursive: true, force: true }).catch(() => undefined);
    return { ...verification, materialized: true };
  } catch (error) {
    const original = error instanceof Error ? error : new Error(String(error));
    try {
      await restoreManagedWebProfile(snapshot);
    } catch (restoreError) {
      throw new Error(`${original.message}; managed Web profile rollback failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}; rollback snapshot preserved at ${snapshot.root}`);
    }
    // Restoration succeeded, so cleanup is again best effort. Preserve the
    // original materialization error even if the rollback snapshot cannot be
    // removed.
    await rm(snapshot.root, { recursive: true, force: true }).catch(() => undefined);
    throw new Error(`${original.message}; the prior managed Web profile was restored`);
  }
}
