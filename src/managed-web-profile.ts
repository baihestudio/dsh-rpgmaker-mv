import { cp, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, win32 } from 'node:path';

import { findDshExecutable } from './bootstrap';
import { resolveHarnessPaths, type HarnessPaths, type PathOptions } from './config';
import { withHarnessOperationLock } from './lock';
import { commandFailure, redactSensitive, runCommand, type CommandRunner } from './process';
import {
  verifyWorkspaceMcpBundle,
  verifyWorkspaceMcpSource,
  workspaceMcpBundleDirFor,
  WORKSPACE_MCP_PACKAGE,
  WORKSPACE_MCP_VERSION,
  canonicalExistingPath,
  canonicalPath,
  isRegularFile,
  pathIsStrictlyWithin,
  pathIsWithin,
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

export const DSH_WEB_PACKAGE = '@guionai/dsh-web';
export const DSH_WEB_VERSION = '0.3.1';
export const DSH_IMAGEGEN_PACKAGE = '@lamplitisles/dsh-imagegen';
export const DSH_IMAGEGEN_VERSION = '0.2.1';
export const DSH_BRAND_PACKAGE = '@baihestudio/dsh-rpgmaker-brand';
export const DSH_BRAND_VERSION = '0.1.0';
export const DSH_BRAND_BUNDLE_RELATIVE = join('bundle', 'dsh-rpgmaker-brand');

export interface ManagedWebProfileOptions extends PathOptions {
  dshExecutable?: string;
  npmExecutable?: string;
  pnpmExecutable?: string;
  pnpmRuntimeDir?: string;
  nodeExecutable?: string;
  bunExecutable?: string;
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

type ManagedProfileMutationGuard = () => Promise<void>;
type ManagedProfileStructureGuard = () => Promise<void>;

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
  valid: boolean;
  errors: string[];
  dshHomeReal: string;
  profilesRoot: string;
  profilesRootReal: string;
  profileDir: string;
  profileDirReal: string;
  dataRoot: string;
  dataRootReal: string;
  workspaceBundleDir: string;
  workspaceBundleReal: string;
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
    valid: errors.length === 0,
    errors,
    dshHomeReal,
    profilesRoot,
    profilesRootReal,
    profileDir,
    profileDirReal,
    dataRoot,
    dataRootReal,
    workspaceBundleDir,
    workspaceBundleReal
  };
}

async function requireManagedWebProfileStructure(paths: HarnessPaths, platform: string): Promise<ManagedWebProfileStructure> {
  const structure = await inspectManagedWebProfileStructure(paths, platform);
  if (!structure.valid) {
    throw new Error(`Managed Web profile repair refused because managed roots are unsafe: ${structure.errors.join('; ')}`);
  }
  return structure;
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

/**
 * Real pnpm file: dependencies can be represented by raw profile links to a
 * package inside the profile's virtual store. Keep that exception narrow:
 * only the app-owned source, the exact canonical raw package path, or a
 * strict descendant of a canonical in-profile .pnpm root is accepted.
 */
async function localPackageInstallAllowed(
  profileDir: string,
  packageName: string,
  installedReal: string,
  sourceReal: string,
  platform: string
): Promise<boolean> {
  if (samePath(installedReal, sourceReal, platform)) return true;
  const profileCanonical = await canonicalPath(profileDir);
  const rawPackagePath = join(profileCanonical, 'node_modules', ...packageName.split('/'));
  if (samePath(installedReal, rawPackagePath, platform)) return true;
  const nodeModulesReal = await canonicalPath(join(profileCanonical, 'node_modules'));
  const virtualStoreReal = await canonicalPath(join(profileCanonical, 'node_modules', '.pnpm'));
  return pathIsStrictlyWithin(profileCanonical, nodeModulesReal, platform)
    && pathIsStrictlyWithin(nodeModulesReal, virtualStoreReal, platform)
    && pathIsStrictlyWithin(virtualStoreReal, installedReal, platform);
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
    const installedManifest = await readJson(join(installedReal, 'package.json'));
    const installedName = typeof installedManifest?.name === 'string' ? installedManifest.name : undefined;
    installedVersion = typeof installedManifest?.version === 'string' ? installedManifest.version : undefined;
    if (installedName !== desired.packageName || installedVersion !== desired.version) {
      packageErrors.push(`installed profile package identity is ${installedName ?? 'missing'}@${installedVersion ?? 'missing'}, expected ${desired.packageName}@${desired.version}`);
    }
    const main = typeof installedManifest?.main === 'string' ? installedManifest.main : undefined;
    const mainPath = main ? resolve(installedReal, main) : undefined;
    const mainTarget = mainPath ? await canonicalExistingPath(mainPath) : undefined;
    if (!main || !mainPath || !mainTarget) {
      packageErrors.push(`installed profile package entrypoint ${main ?? 'missing'} was not found`);
    } else if (!pathIsWithin(installedReal, mainTarget, platform)) {
      packageErrors.push(`installed profile package ${desired.packageName} entrypoint ${main} escapes its canonical package directory`);
    } else if (!(await isRegularFile(mainPath))) {
      packageErrors.push(`installed profile package entrypoint ${main} is not a regular file`);
    }
    const bundle = asObject(asObject(installedManifest?.dsh)?.bundle);
    const patch = typeof bundle?.patch === 'string' ? bundle.patch : undefined;
    const patchPath = patch ? resolve(installedReal, patch) : undefined;
    const patchTarget = patchPath ? await canonicalExistingPath(patchPath) : undefined;
    if (!patch || !patchPath || !patchTarget) {
      packageErrors.push(`installed profile package ${desired.packageName} dsh.bundle.patch ${patch ?? 'missing'} was not found`);
    } else if (!pathIsWithin(installedReal, patchTarget, platform)) {
      packageErrors.push(`installed profile package ${desired.packageName} dsh.bundle.patch ${patch} escapes its canonical package directory`);
    } else if (!(await isRegularFile(patchPath))) {
      packageErrors.push(`installed profile package ${desired.packageName} dsh.bundle.patch ${patch} is not a regular file`);
    }
    if (desired.source === 'brand') {
      const clientPath = join(installedReal, 'lib', 'client.js');
      const clientTarget = await canonicalExistingPath(clientPath);
      if (!clientTarget) {
        packageErrors.push(`installed profile package ${desired.packageName} client entrypoint lib/client.js was not found`);
      } else if (!pathIsWithin(installedReal, clientTarget, platform)) {
        packageErrors.push(`installed profile package ${desired.packageName} client entrypoint lib/client.js escapes its canonical package directory`);
      } else if (!(await isRegularFile(clientPath))) {
        packageErrors.push(`installed profile package ${desired.packageName} client entrypoint lib/client.js is not a regular file`);
      }
    }
  }

  if (!desired.source && dependency !== expectedDependencyValue) {
    packageErrors.push(`profile dependency ${desired.packageName} is not pinned to ${desired.packageName}@${desired.version}`);
  }

  if (sourceDir) {
    const sourceReal = await canonicalPath(sourceDir);
    if (!(await exists(sourceDir))) {
      packageErrors.push(`app-owned ${desired.packageName} bundle was not found at ${sourceDir}`);
    } else if (!dependency || !/^file:/i.test(dependency)) {
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
    if (installedExists) {
      if (!(await localPackageInstallAllowed(profileDir, desired.packageName, installedReal, sourceReal, platform))) {
        packageErrors.push(`installed profile package ${desired.packageName} does not resolve to the app-owned bundle, canonical profile copy, or its in-profile pnpm virtual store`);
      }
    }
  } else if (installedExists) {
    const profileCanonical = await canonicalPath(profileDir);
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

interface ManagedBrandSourceVerification {
  valid: boolean;
  errors: string[];
}

async function verifyBrandSource(bundleDir: string, platform: string, programRoot: string): Promise<ManagedBrandSourceVerification> {
  const errors: string[] = [];
  if (!(await exists(bundleDir))) {
    errors.push(`app-owned RPG Maker Agent brand bundle was not found at ${bundleDir}`);
    return { valid: false, errors };
  }
  const sourceReal = await canonicalPath(bundleDir);
  const programReal = await canonicalPath(programRoot);
  if (!pathIsWithin(programReal, sourceReal, platform)) {
    errors.push(`brand bundle path ${bundleDir} is not inside the app-owned program root ${programRoot}`);
    return { valid: false, errors };
  }
  const manifestPath = join(bundleDir, 'package.json');
  const manifestTarget = await canonicalExistingPath(manifestPath);
  if (!manifestTarget) {
    errors.push('brand bundle manifest package.json was not found');
    return { valid: false, errors };
  }
  if (!pathIsWithin(sourceReal, manifestTarget, platform)) {
    errors.push('brand bundle manifest package.json escapes its canonical bundle directory');
    return { valid: false, errors };
  }
  if (!(await isRegularFile(manifestPath))) {
    errors.push('brand bundle manifest package.json is not a regular file');
    return { valid: false, errors };
  }
  const manifest = await readJson(manifestPath);
  if (manifest?.name !== DSH_BRAND_PACKAGE || manifest?.version !== DSH_BRAND_VERSION) errors.push(`brand bundle identity is ${String(manifest?.name ?? 'missing')}@${String(manifest?.version ?? 'missing')}, expected ${DSH_BRAND_PACKAGE}@${DSH_BRAND_VERSION}`);
  const main = typeof manifest?.main === 'string' ? manifest.main : undefined;
  const mainPath = main ? resolve(bundleDir, main) : undefined;
  const mainTarget = mainPath ? await canonicalExistingPath(mainPath) : undefined;
  if (!main || !mainPath || !mainTarget) {
    errors.push(`brand bundle entrypoint ${main ?? 'missing'} was not found`);
  } else if (!pathIsWithin(sourceReal, mainTarget, platform)) {
    errors.push(`brand bundle entrypoint ${main} escapes its canonical bundle directory`);
  } else if (!(await isRegularFile(mainPath))) {
    errors.push(`brand bundle entrypoint ${main} is not a regular file`);
  }
  const clientPath = join(bundleDir, 'lib', 'client.js');
  const clientTarget = await canonicalExistingPath(clientPath);
  if (!clientTarget) {
    errors.push('brand bundle client entrypoint lib/client.js was not found');
  } else if (!pathIsWithin(sourceReal, clientTarget, platform)) {
    errors.push('brand bundle client entrypoint lib/client.js escapes its canonical bundle directory');
  } else if (!(await isRegularFile(clientPath))) {
    errors.push('brand bundle client entrypoint lib/client.js is not a regular file');
  }
  const patch = asObject(asObject(manifest?.dsh)?.bundle)?.patch;
  const patchPath = typeof patch === 'string' ? resolve(bundleDir, patch) : undefined;
  const patchTarget = patchPath ? await canonicalExistingPath(patchPath) : undefined;
  if (patch !== './cordis.patch.yml' || !patchPath || !patchTarget) {
    errors.push('brand bundle dsh.bundle patch is missing or invalid');
  } else if (!pathIsWithin(sourceReal, patchTarget, platform)) {
    errors.push('brand bundle dsh.bundle patch escapes its canonical bundle directory');
  } else if (!(await isRegularFile(patchPath))) {
    errors.push('brand bundle dsh.bundle patch is not a regular file');
  }
  return { valid: errors.length === 0, errors };
}

interface ManagedWebSourceVerification {
  valid: boolean;
  errors: string[];
  workspaceSource: string;
}

/**
 * Fixed product preflight for the two app-owned bundles consumed by profile
 * repair. It deliberately does not inspect mutable profile or target state.
 */
async function verifyManagedWebSources(paths: HarnessPaths, platform: string): Promise<ManagedWebSourceVerification> {
  const brandBundleDir = resolve(join(paths.programRoot, DSH_BRAND_BUNDLE_RELATIVE));
  const brand = await verifyBrandSource(brandBundleDir, platform, paths.programRoot);
  const workspace = await verifyWorkspaceMcpSource({
    platform,
    programRoot: paths.programRoot,
    mutableRoot: paths.mutableRoot,
    dshHome: paths.dshHome,
    runtimeDir: paths.runtimeDir
  });
  const errors = [...brand.errors, ...workspace.errors];
  return { valid: errors.length === 0, errors, workspaceSource: workspace.sourceDir };
}

async function requireManagedWebSources(paths: HarnessPaths, platform: string): Promise<ManagedWebSourceVerification> {
  const sources = await verifyManagedWebSources(paths, platform);
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
  const paths = resolveHarnessPaths(options);
  const platform = options.platform ?? process.platform;
  const structure = await inspectManagedWebProfileStructure(paths, platform);
  const { profileDir, workspaceBundleDir } = structure;
  const brandBundleDir = resolve(join(paths.programRoot, DSH_BRAND_BUNDLE_RELATIVE));
  const errors: string[] = [];
  errors.push(...structure.errors);
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
  if (!rawBundles || rawBundles.length !== MANAGED_WEB_PROFILE_BUNDLE_NAMES.length || rawBundles.some((name, index) => name !== MANAGED_WEB_PROFILE_BUNDLE_NAMES[index])) {
    errors.push(`managed ${MANAGED_WEB_PROFILE} profile bundle registrations are not exact; expected ${MANAGED_WEB_PROFILE_BUNDLE_NAMES.join(', ')}`);
  }

  errors.push(...(await verifyBrandSource(brandBundleDir, platform, paths.programRoot)).errors);
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

async function snapshotManagedWebProfile(
  paths: HarnessPaths,
  profileDir: string,
  bundleDir: string,
  beforeMutation: ManagedProfileMutationGuard
): Promise<ManagedProfileSnapshot> {
  await beforeMutation();
  const root = await mkdtemp(join(paths.dshHome, '.managed-web-profile-rollback-'));
  const profileBackup = join(root, 'profile');
  const bundleBackup = join(root, 'workspace-bundle');
  const profileExisted = await exists(profileDir);
  const bundleExisted = await exists(bundleDir);
  try {
    if (profileExisted) {
      await beforeMutation();
      await cp(profileDir, profileBackup, { recursive: true, force: false, errorOnExist: true });
    }
    if (bundleExisted) {
      await beforeMutation();
      await cp(bundleDir, bundleBackup, { recursive: true, force: false, errorOnExist: true });
    }
    return { root, profileDir, profileBackup, profileExisted, bundleDir, bundleBackup, bundleExisted };
  } catch (error) {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function restoreManagedWebProfile(snapshot: ManagedProfileSnapshot, beforeRestore: ManagedProfileStructureGuard): Promise<void> {
  await beforeRestore();
  await rm(snapshot.profileDir, { recursive: true, force: true });
  if (snapshot.profileExisted) {
    await beforeRestore();
    await mkdir(dirname(snapshot.profileDir), { recursive: true });
    await beforeRestore();
    await cp(snapshot.profileBackup, snapshot.profileDir, { recursive: true, force: false, errorOnExist: true });
  }
  await beforeRestore();
  await rm(snapshot.bundleDir, { recursive: true, force: true });
  if (snapshot.bundleExisted) {
    await beforeRestore();
    await mkdir(dirname(snapshot.bundleDir), { recursive: true });
    await beforeRestore();
    await cp(snapshot.bundleBackup, snapshot.bundleDir, { recursive: true, force: false, errorOnExist: true });
  }
}

async function replaceWorkspaceBundle(source: string, target: string, platform: string, beforeMutation: ManagedProfileMutationGuard): Promise<void> {
  if (samePath(source, target, platform)) return;
  const parent = dirname(target);
  await beforeMutation();
  await mkdir(parent, { recursive: true });
  const staging = `${target}.staging-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await beforeMutation();
  await rm(staging, { recursive: true, force: true });
  try {
    await beforeMutation();
    await cp(source, staging, { recursive: true, force: false, errorOnExist: true });
    await beforeMutation();
    await rm(target, { recursive: true, force: true });
    await beforeMutation();
    await rename(staging, target);
  } finally {
    await beforeMutation().then(() => rm(staging, { recursive: true, force: true })).catch(() => undefined);
  }
}

async function addProfilePackage(
  options: ManagedWebProfileOptions,
  paths: HarnessPaths,
  invocation: { command: string; prefix: string[] },
  env: Record<string, string | undefined>,
  pnpmEnv: Record<string, string | undefined>,
  packageSpec: string,
  beforeMutation: ManagedProfileMutationGuard
): Promise<void> {
  const args = ['plugin', '--profile', MANAGED_WEB_PROFILE, 'add', '--save-exact', '--ignore-scripts', packageSpec];
  const runner = options.commandRunner ?? runCommand;
  let result;
  try {
    await beforeMutation();
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

async function writeManagedBundleRegistrations(profileDir: string, beforeMutation: ManagedProfileMutationGuard): Promise<void> {
  const manifestPath = join(profileDir, 'package.json');
  const manifest = await readJson(manifestPath);
  if (!manifest) throw new Error(`Managed Web profile package manager produced no readable manifest at ${manifestPath}`);
  const dsh = asObject(manifest.dsh) ?? {};
  const profile = asObject(dsh.profile) ?? {};
  profile.bundles = [...MANAGED_WEB_PROFILE_BUNDLE_NAMES];
  dsh.profile = profile;
  manifest.dsh = dsh;
  await beforeMutation();
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

/** Materialize the complete exact Web profile, preserving the prior profile on failure. */
export async function ensureManagedWebProfile(options: ManagedWebProfileOptions = {}): Promise<ManagedWebProfileResult> {
  const paths = resolveHarnessPaths(options);
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
  const initialSources = await requireManagedWebSources(paths, platform);
  const brandBundleDir = resolve(join(paths.programRoot, DSH_BRAND_BUNDLE_RELATIVE));
  const workspaceBundleDir = resolve(workspaceMcpBundleDirFor(paths));
  const workspaceSource = initialSources.workspaceSource;
  await mkdir(paths.dshHome, { recursive: true });
  const current = await verifyManagedWebProfile({ ...options, env });
  if (current.valid) return { ...current, materialized: false };

  // The app-owned pnpm runtime is resolved exactly once for this attempt and
  // its environment is reused for all four DSH plugin additions.
  await requireManagedWebProfileStructure(paths, platform);
  const sourcesBeforePnpm = await requireManagedWebSources(paths, platform);
  if (!samePath(sourcesBeforePnpm.workspaceSource, workspaceSource, platform)) {
    throw new Error('Managed Web profile repair refused because the app-owned workspace MCP source changed during preflight');
  }
  const pnpm = await preparePnpmRuntime({ ...options, env, useAppOwnedPnpm: true }, paths);
  const dsh = options.dshExecutable ?? env.DSH_EXECUTABLE ?? await findDshExecutable(paths.runtimeDir, platform);
  if (!dsh) throw new Error('Pinned DSH executable was not found; cannot materialize the managed Web profile.');
  const invocation = await resolveDshInvocation(dsh, options, env);
  const profileDir = profileDirFor(paths, MANAGED_WEB_PROFILE);
  const beforeRestore = async (): Promise<void> => {
    await requireManagedWebProfileStructure(paths, platform);
  };
  const beforeMutation = async (): Promise<void> => {
    await beforeRestore();
    const sources = await requireManagedWebSources(paths, platform);
    if (!samePath(sources.workspaceSource, workspaceSource, platform)) {
      throw new Error('Managed Web profile repair refused because the app-owned workspace MCP source changed during preflight');
    }
  };
  await beforeMutation();
  const snapshot = await snapshotManagedWebProfile(paths, profileDir, workspaceBundleDir, beforeMutation);
  try {
    await replaceWorkspaceBundle(workspaceSource, workspaceBundleDir, platform, beforeMutation);
    await beforeMutation();
    await rm(profileDir, { recursive: true, force: true });
    await mkdir(paths.dshHome, { recursive: true });
    for (const desired of DESIRED_PACKAGES) {
      const spec = desired.source === 'brand'
        ? localDependencySpec(brandBundleDir)
        : desired.source === 'workspace'
          ? localDependencySpec(workspaceBundleDir)
          : `${desired.packageName}@${desired.version}`;
      await addProfilePackage(options, paths, invocation, env, pnpm.env, spec, beforeMutation);
    }
    await writeManagedBundleRegistrations(profileDir, beforeMutation);
    const verification = await verifyManagedWebProfile({ ...options, env });
    if (!verification.valid) throw new Error(`Managed Web profile materialization completed but verification failed: ${verification.errors.join('; ')}`);
    // Snapshot cleanup is best effort after successful verification. A cleanup
    // error must never turn a successful materialization into a rollback.
    await rm(snapshot.root, { recursive: true, force: true }).catch(() => undefined);
    return { ...verification, materialized: true };
  } catch (error) {
    const original = error instanceof Error ? error : new Error(String(error));
    try {
      await restoreManagedWebProfile(snapshot, beforeRestore);
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
