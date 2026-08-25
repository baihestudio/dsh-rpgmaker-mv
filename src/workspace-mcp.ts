import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
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
} from './profile';

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
/** Archive entries always use POSIX separators, including on Windows. */
export const WORKSPACE_MCP_BUNDLE_ARCHIVE_RELATIVE = 'bundle/dsh-workspace-mcp';

/** Host env contract consumed by the prebuilt workspace bundle. */
export const MCPORTER_RUNTIME_ENV = 'DSH_RPGMAKER_MCPORTER_RUNTIME';
export const XEROLO_RUNTIME_ENV = 'DSH_RPGMAKER_XEROLO_RUNTIME';
export const JS_RUNNER_ENV = 'DSH_RPGMAKER_JS_RUNNER';

export interface WorkspaceMcpBundleOptions extends PathOptions {
  platform?: string;
  env?: Record<string, string | undefined>;
  commandRunner?: CommandRunner;
  dshExecutable?: string;
  npmExecutable?: string;
  pnpmExecutable?: string;
  pnpmRuntimeDir?: string;
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

export function workspaceMcpBundleDirFor(paths: HarnessPaths): string {
  return join(paths.programRoot, WORKSPACE_MCP_BUNDLE_RELATIVE);
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
export async function workspaceMcpBundleDigest(bundleDir: string): Promise<string> {
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
  return join(profileDir, 'node_modules', WORKSPACE_MCP_PACKAGE);
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

interface WorkspaceMcpProfileSnapshotEntry {
  source: string;
  backup: string;
  existed: boolean;
}

interface WorkspaceMcpProfileSnapshot {
  root: string;
  entries: WorkspaceMcpProfileSnapshotEntry[];
}

async function snapshotWorkspaceMcpProfile(paths: HarnessPaths, profileDir: string): Promise<WorkspaceMcpProfileSnapshot> {
  const root = await mkdtemp(join(paths.dshHome, '.workspace-mcp-profile-rollback-'));
  const sources = [
    join(profileDir, 'package.json'),
    join(profileDir, 'pnpm-lock.yaml'),
    join(profileDir, 'cordis.patch.yml'),
    profilePackageDir(profileDir)
  ];
  const entries: WorkspaceMcpProfileSnapshotEntry[] = [];
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

async function restoreWorkspaceMcpProfile(snapshot: WorkspaceMcpProfileSnapshot): Promise<void> {
  for (const entry of snapshot.entries) {
    await rm(entry.source, { recursive: true, force: true });
    if (entry.existed) {
      await mkdir(dirname(entry.source), { recursive: true });
      await cp(entry.backup, entry.source, { recursive: true, force: false, errorOnExist: true });
    }
  }
}

export async function verifyWorkspaceMcpBundle(options: WorkspaceMcpBundleOptions = {}): Promise<WorkspaceMcpBundleVerification> {
  const paths = resolveHarnessPaths(options);
  const platform = options.platform ?? process.platform;
  const bundleDir = resolve(options.bundleDir ?? workspaceMcpBundleDirFor(paths));
  const errors: string[] = [];
  const manifest = await readJson(join(bundleDir, 'package.json'));
  const packageName = typeof manifest?.name === 'string' ? manifest.name : undefined;
  const packageVersion = typeof manifest?.version === 'string' ? manifest.version : undefined;
  const main = typeof manifest?.main === 'string' ? manifest.main : undefined;
  const entrypoint = main && await exists(join(bundleDir, main)) ? join(bundleDir, main) : undefined;
  const agentEntrypoint = await exists(join(bundleDir, WORKSPACE_MCP_AGENT_ENTRYPOINT));
  const bundleManifest = asObject(asObject(manifest?.dsh)?.bundle);
  const bundlePatch = typeof bundleManifest?.patch === 'string' ? bundleManifest.patch : undefined;
  if (packageName !== WORKSPACE_MCP_PACKAGE) errors.push(`bundle identity is ${packageName ?? 'missing'}, expected ${WORKSPACE_MCP_PACKAGE}`);
  if (packageVersion !== WORKSPACE_MCP_VERSION) errors.push(`bundle version is ${packageVersion ?? 'missing'}, expected ${WORKSPACE_MCP_VERSION}`);
  if (manifest?.license !== WORKSPACE_MCP_LICENSE) errors.push(`bundle license is ${String(manifest?.license ?? 'missing')}, expected ${WORKSPACE_MCP_LICENSE}`);
  if (!entrypoint) errors.push(`bundle entrypoint ${WORKSPACE_MCP_ENTRYPOINT} was not found`);
  if (!agentEntrypoint) errors.push(`bundle Agent entrypoint ${WORKSPACE_MCP_AGENT_ENTRYPOINT} was not found`);
  if (bundlePatch !== WORKSPACE_MCP_BUNDLE_PATCH) errors.push(`bundle dsh.bundle.patch is not ${WORKSPACE_MCP_BUNDLE_PATCH}`);
  else if (!(await exists(join(bundleDir, bundlePatch)))) errors.push(`bundle patch file ${bundlePatch} was not found`);
  const sha256 = await workspaceMcpBundleDigest(bundleDir).catch(() => undefined);
  if (sha256 !== WORKSPACE_MCP_SHA256) errors.push(`bundle release hash mismatch (got ${sha256?.slice(0, 12) ?? 'none'}, expected ${WORKSPACE_MCP_SHA256.slice(0, 12)}); the prebuilt package must not be edited by hand`);
  let ownedPath = false;
  const programRoot = await realpath(paths.programRoot).catch(() => paths.programRoot);
  const bundleReal = await realpath(bundleDir).catch(() => bundleDir);
  ownedPath = bundleReal === programRoot || bundleReal.startsWith(`${programRoot}${sep}`);
  if (!ownedPath) errors.push(`bundle path ${bundleDir} is not inside the app-owned program root ${paths.programRoot}`);

  const profile = options.profile ?? WORKSPACE_MCP_PROFILE;
  const profileDir = profileDirFor(paths, profile);
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
    const targetReal = await realpath(resolve(profileDir, spec)).catch(() => undefined);
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
    const ownedReal = await realpath(paths.programRoot).catch(() => paths.programRoot);
    const installedReal = await realpath(installedDir).catch(() => undefined);
    installedResolved = installedReal ?? installedDir;
    const canonicalProfile = await realpath(profileDir).catch(() => profileDir);
    const canonicalInstalled = join(canonicalProfile, 'node_modules', WORKSPACE_MCP_PACKAGE);
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
    if (installedName !== WORKSPACE_MCP_PACKAGE || installedVersion !== WORKSPACE_MCP_VERSION) {
      errors.push(`installed profile package identity is ${installedName ?? 'missing'}@${installedVersion ?? 'missing'}, expected ${WORKSPACE_MCP_PACKAGE}@${WORKSPACE_MCP_VERSION}`);
    }
    if (!installedEntry || !(await exists(join(installedReal ?? installedDir, installedEntry)))) {
      errors.push(`installed profile package entrypoint ${installedEntry ?? WORKSPACE_MCP_ENTRYPOINT} was not found`);
    }
    if (!(await exists(join(installedReal ?? installedDir, WORKSPACE_MCP_AGENT_ENTRYPOINT)))) {
      errors.push(`installed profile package Agent entrypoint ${WORKSPACE_MCP_AGENT_ENTRYPOINT} was not found`);
    }
    const installedSha = await workspaceMcpBundleDigest(installedReal ?? installedDir).catch(() => undefined);
    if (installedSha !== WORKSPACE_MCP_SHA256) {
      errors.push(`installed profile package release hash mismatch (got ${installedSha?.slice(0, 12) ?? 'none'}); the installed copy is not the pinned prebuilt bundle`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    packageDir: installedResolved,
    packageVersion,
    bundleOccurrences,
    entrypoint,
    ownedPath,
    sha256
  };
}

async function linkWorkspaceMcpBundle(options: WorkspaceMcpBundleOptions, paths: HarnessPaths, bundleDir: string, platform: string, env: Record<string, string | undefined>): Promise<void> {
  const pnpm = await preparePnpmRuntime({ ...options, useAppOwnedPnpm: true }, paths);
  const dsh = options.dshExecutable ?? env.DSH_EXECUTABLE ?? await findDshExecutable(paths.runtimeDir, platform);
  if (!dsh) throw new Error('Pinned DSH executable was not found; cannot link the app-owned workspace MCP bundle into the profile.');
  const profile = options.profile ?? WORKSPACE_MCP_PROFILE;
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
    throw new Error(redactSensitive(`Workspace MCP plugin manager could not start: ${error instanceof Error ? error.message : String(error)}`, env));
  }
  if (result.exitCode !== 0) throw new Error(redactSensitive(commandFailure(invocation.command, args, result, env).message, env));
}

/** Install or repair the app-owned workspace MCP bundle layer in the web profile. */
export async function prepareWorkspaceMcpBundle(options: WorkspaceMcpBundleOptions = {}): Promise<WorkspaceMcpBundleVerification> {
  const paths = resolveHarnessPaths(options);
  const platform = options.platform ?? process.platform;
  const env = pluginEnvironment(options.env ?? process.env);
  await mkdir(paths.dshHome, { recursive: true });
  const target = resolve(options.bundleDir ?? workspaceMcpBundleDirFor(paths));
  const current = await verifyWorkspaceMcpBundle({ ...options, bundleDir: target });
  if (current.valid) return current;

  const source = resolve(options.bundleDir ?? defaultWorkspaceMcpBundleDir());
  if (source !== target) {
    await mkdir(dirname(target), { recursive: true });
    const staging = `${target}.staging-${Date.now()}`;
    await rm(staging, { recursive: true, force: true });
    await cp(source, staging, { recursive: true });
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
  }
  const profile = options.profile ?? WORKSPACE_MCP_PROFILE;
  const profileDir = profileDirFor(paths, profile);
  const snapshot = await snapshotWorkspaceMcpProfile(paths, profileDir);
  try {
    // A file: dependency with the same path/version may be reused by pnpm;
    // remove the exact profile entry so a stale copied bundle cannot survive a
    // repair. The snapshot above restores it if linking fails.
    await rm(profilePackageDir(profileDir), { recursive: true, force: true });
    await linkWorkspaceMcpBundle(options, paths, target, platform, env);
    const installed = await verifyWorkspaceMcpBundle({ ...options, bundleDir: target });
    if (!installed.valid) throw new Error(`Workspace MCP bundle installation completed but verification failed: ${installed.errors.join('; ')}`);
    return installed;
  } catch (error) {
    const original = error instanceof Error ? error : new Error(String(error));
    try {
      await restoreWorkspaceMcpProfile(snapshot);
    } catch (restoreError) {
      throw new Error(`${original.message}; workspace MCP bundle profile rollback failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
    }
    throw original;
  } finally {
    await rm(snapshot.root, { recursive: true, force: true });
  }
}

export function workspaceMcpSummary(verification: WorkspaceMcpBundleVerification): string {
  return verification.valid
    ? `App-owned workspace MCP bundle ${WORKSPACE_MCP_PACKAGE}@${verification.packageVersion} is linked as one host-level layer of the ${WORKSPACE_MCP_PROFILE} profile`
    : `App-owned workspace MCP bundle is not usable: ${verification.errors.join('; ') || 'unknown reason'}`;
}
