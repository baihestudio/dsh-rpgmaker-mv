import { cp, lstat, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';

/**
 * The host is built in the separate dsh-electronbun repository.  The product
 * release only consumes its already-built Windows payload at this boundary.
 * Keep these facts in one place so packaging and installation cannot silently
 * pair a host from a different contract.
 */
export const ELECTROBUN_HOST_COMMIT = '03543ce0deeaa8c322dfbe2b5e45c03fd7c1da33';
export const ELECTROBUN_BUN_VERSION = '1.3.14';
export const ELECTROBUN_PRODUCT_IDENTIFIER = 'dev.baihestudio.dsh-rpgmaker-mv';
export const ELECTROBUN_PRODUCT_VERSION = '0.1.0';

/** Relative directory used inside a Release ZIP and the installed program. */
export const DESKTOP_HOST_PAYLOAD_RELATIVE = 'desktop-host';
export const ELECTROBUN_SIDECAR_RELATIVE = 'payload/sidecar/dsh-rpgmaker-sidecar.js';
export const ELECTROBUN_SUPERVISOR_RELATIVE = 'bin/dsh-sidecar-supervisor.exe';
/** JSON sidecar describing the prebuilt host and its pinned contract. */
export const DESKTOP_HOST_MANIFEST_NAME = 'desktop-host.json';
export const DESKTOP_HOST_MANIFEST_RELATIVE = `${DESKTOP_HOST_PAYLOAD_RELATIVE}/${DESKTOP_HOST_MANIFEST_NAME}`;
/** Common aliases accepted when a maintainer exports a host payload. */
export const DESKTOP_HOST_MANIFEST_ALIASES = [
  DESKTOP_HOST_MANIFEST_NAME,
  'manifest.json',
  'host-manifest.json',
  'product.manifest.json',
  'dsh-rpgmaker-desktop-host.json'
] as const;

export const DESKTOP_HOST_FORMAT = 1;

export interface DesktopHostManifest {
  format?: number;
  owner?: string;
  product?: string;
  hostCommit?: string;
  bunVersion?: string;
  productVersion?: string;
  app?: {
    identifier?: string;
    version?: string;
    executable?: string;
    launchTarget?: string;
  };
  /** Relative path to the executable users should launch. */
  launchTarget?: string;
  /** Relative paths retained for host-contract verification. */
  sidecarEntrypoint?: string;
  supervisorExecutable?: string;
  sidecar?: { entrypoint?: string };
  supervisor?: { executable?: string };
  [key: string]: unknown;
}

export interface DesktopHostVerification {
  valid: boolean;
  errors: string[];
  payloadRoot: string;
  manifestPath?: string;
  manifest?: DesktopHostManifest;
  launchTarget?: string;
  launchPath?: string;
  hostCommit?: string;
  bunVersion?: string;
  productVersion?: string;
  sidecarEntrypoint?: string;
  supervisorExecutable?: string;
}

export interface DesktopHostPayloadOptions {
  /** Optional external prebuilt payload directory supplied by a maintainer. */
  desktopHostRoot?: string;
  /** Override the product version required for version-coherent pairing. */
  productVersion?: string;
}

export interface DesktopHostCopyResult extends DesktopHostVerification {
  /** Relative installed path, including the payload directory. */
  installedLaunchTarget: string;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function regularFile(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    return metadata.isFile();
  } catch {
    return false;
  }
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/');
}

function pathInside(parent: string, child: string): boolean {
  const parentKey = normalizePath(resolve(parent)).replace(/\/$/, '').toLowerCase();
  const childKey = normalizePath(resolve(child)).replace(/\/$/, '').toLowerCase();
  return childKey === parentKey || childKey.startsWith(`${parentKey}/`);
}

function relativePayloadPath(value: unknown, label: string, errors: string[]): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || /[\u0000-\u001f\u007f]/.test(value)) {
    errors.push(`${label} must be a non-empty relative path`);
    return undefined;
  }
  const normalized = normalizePath(value);
  if (
    normalized.startsWith('/')
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    errors.push(`${label} must be a relative path without traversal`);
    return undefined;
  }
  return normalized;
}

async function findManifest(payloadRoot: string): Promise<{ path: string; value: DesktopHostManifest } | undefined> {
  for (const name of DESKTOP_HOST_MANIFEST_ALIASES) {
    const path = join(payloadRoot, name);
    if (!(await regularFile(path))) continue;
    try {
      const value = object(JSON.parse(await readFile(path, 'utf8')));
      if (value) return { path, value: value as DesktopHostManifest };
    } catch {
      // The caller receives a useful missing/invalid descriptor diagnostic.
      return { path, value: {} };
    }
  }
  return undefined;
}

async function findSymlink(root: string): Promise<string | undefined> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) return path;
    if (entry.isDirectory()) {
      const nested = await findSymlink(path);
      if (nested) return nested;
    }
  }
  return undefined;
}

function manifestLaunchTarget(manifest: DesktopHostManifest | undefined): unknown {
  return manifest?.launchTarget
    ?? manifest?.app?.launchTarget
    ?? manifest?.app?.executable
    ?? (typeof manifest?.executable === 'string' ? manifest.executable : undefined)
    ?? (typeof manifest?.entrypoint === 'string' ? manifest.entrypoint : undefined);
}

function manifestHostCommit(manifest: DesktopHostManifest | undefined): unknown {
  const build = object(manifest?.build);
  const adapter = object(manifest?.adapter);
  return manifest?.hostCommit ?? build?.hostCommit ?? adapter?.hostCommit;
}

function manifestBunVersion(manifest: DesktopHostManifest | undefined): unknown {
  const bun = object(manifest?.bun);
  return manifest?.bunVersion ?? bun?.version;
}

function manifestSidecar(manifest: DesktopHostManifest | undefined): unknown {
  return manifest?.sidecarEntrypoint ?? manifest?.sidecar?.entrypoint;
}

function manifestSupervisor(manifest: DesktopHostManifest | undefined): unknown {
  return manifest?.supervisorExecutable ?? manifest?.supervisor?.executable;
}

/**
 * Verify a prebuilt host payload without launching it.  This is intentionally
 * filesystem-only: native host build and smoke evidence remain outside this
 * product repository, while a Release ZIP cannot silently ship an arbitrary
 * executable or a host from a different revision.
 */
export async function verifyDesktopHostPayload(
  payloadRootInput: string,
  options: DesktopHostPayloadOptions = {},
): Promise<DesktopHostVerification> {
  const payloadRoot = resolve(payloadRootInput);
  const errors: string[] = [];
  if (!(await exists(payloadRoot))) {
    errors.push(`desktop host payload is missing: ${payloadRoot}`);
    return { valid: false, errors, payloadRoot };
  }
  try {
    const rootStat = await lstat(payloadRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) errors.push(`desktop host payload must be a real directory: ${payloadRoot}`);
  } catch {
    errors.push(`desktop host payload is not readable: ${payloadRoot}`);
  }
  const symlink = await findSymlink(payloadRoot);
  if (symlink) errors.push(`desktop host payload contains an unsupported symbolic link: ${symlink}`);

  const descriptor = await findManifest(payloadRoot);
  const manifest = descriptor?.value;
  if (!descriptor) {
    errors.push(`desktop host payload descriptor is missing (expected ${DESKTOP_HOST_MANIFEST_ALIASES.join(', ')})`);
  } else if (!manifest || Object.keys(manifest).length === 0) {
    errors.push(`desktop host payload descriptor is not valid JSON: ${descriptor.path}`);
  }

  const format = manifest?.format;
  if (format !== undefined && format !== DESKTOP_HOST_FORMAT) errors.push(`desktop host payload format is ${String(format)}, expected ${DESKTOP_HOST_FORMAT}`);
  if (manifest?.owner !== undefined && manifest.owner !== 'dsh-rpgmaker-mv') errors.push(`desktop host payload owner is ${manifest.owner}, expected dsh-rpgmaker-mv`);
  if (manifest?.product !== undefined && manifest.product !== 'DSH-RPGMaker-MV') errors.push(`desktop host payload product is ${manifest.product}, expected DSH-RPGMaker-MV`);
  const hostCommit = manifestHostCommit(manifest);
  const bunVersion = manifestBunVersion(manifest);
  if (hostCommit !== ELECTROBUN_HOST_COMMIT) errors.push(`desktop host payload host commit is ${hostCommit ?? 'missing'}, expected ${ELECTROBUN_HOST_COMMIT}`);
  if (bunVersion !== ELECTROBUN_BUN_VERSION) errors.push(`desktop host payload Bun version is ${bunVersion ?? 'missing'}, expected ${ELECTROBUN_BUN_VERSION}`);
  const declaredProductVersion = manifest?.productVersion ?? manifest?.app?.version;
  const expectedProductVersion = options.productVersion ?? ELECTROBUN_PRODUCT_VERSION;
  if (declaredProductVersion !== expectedProductVersion) {
    errors.push(`desktop host payload product version is ${declaredProductVersion ?? 'missing'}, expected ${expectedProductVersion}`);
  }
  if (manifest?.app?.identifier !== ELECTROBUN_PRODUCT_IDENTIFIER) {
    errors.push(`desktop host payload app identifier is ${manifest?.app?.identifier ?? 'missing'}, expected ${ELECTROBUN_PRODUCT_IDENTIFIER}`);
  }

  const launchTarget = relativePayloadPath(manifestLaunchTarget(manifest), 'desktop host launchTarget', errors);
  const launchPath = launchTarget ? join(payloadRoot, launchTarget) : undefined;
  if (launchTarget && extname(launchTarget).toLowerCase() !== '.exe') {
    errors.push(`desktop host launchTarget must be a Windows executable: ${launchTarget}`);
  }
  if (launchPath && !pathInside(payloadRoot, launchPath)) errors.push('desktop host launchTarget escapes the payload root');
  if (launchPath && !(await regularFile(launchPath))) errors.push(`desktop host launchTarget is missing or not a regular file: ${launchPath}`);

  const sidecarTarget = relativePayloadPath(manifestSidecar(manifest), 'desktop host sidecarEntrypoint', errors);
  if (sidecarTarget && sidecarTarget !== ELECTROBUN_SIDECAR_RELATIVE) {
    errors.push(`desktop host sidecarEntrypoint is ${sidecarTarget}, expected ${ELECTROBUN_SIDECAR_RELATIVE}`);
  }
  const sidecarPath = sidecarTarget ? join(payloadRoot, sidecarTarget) : undefined;
  if (sidecarPath && (!(await pathInside(payloadRoot, sidecarPath)) || !(await regularFile(sidecarPath)))) {
    errors.push(`desktop host sidecarEntrypoint is missing or outside the payload: ${sidecarPath}`);
  }
  const supervisorTarget = relativePayloadPath(manifestSupervisor(manifest), 'desktop host supervisorExecutable', errors);
  if (supervisorTarget && supervisorTarget !== ELECTROBUN_SUPERVISOR_RELATIVE) {
    errors.push(`desktop host supervisorExecutable is ${supervisorTarget}, expected ${ELECTROBUN_SUPERVISOR_RELATIVE}`);
  }
  const supervisorPath = supervisorTarget ? join(payloadRoot, supervisorTarget) : undefined;
  if (supervisorPath && (!(await pathInside(payloadRoot, supervisorPath)) || !(await regularFile(supervisorPath)))) {
    errors.push(`desktop host supervisorExecutable is missing or outside the payload: ${supervisorPath}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    payloadRoot,
    manifestPath: descriptor?.path,
    manifest,
    launchTarget,
    launchPath,
    hostCommit: typeof hostCommit === 'string' ? hostCommit : undefined,
    bunVersion: typeof bunVersion === 'string' ? bunVersion : undefined,
    productVersion: typeof declaredProductVersion === 'string' ? declaredProductVersion : undefined,
    sidecarEntrypoint: sidecarTarget,
    supervisorExecutable: supervisorTarget
  };
}

/** Find the canonical payload in a source Release tree or an explicit root. */
export async function resolveDesktopHostPayload(
  sourceRootInput: string,
  options: DesktopHostPayloadOptions = {},
): Promise<string | undefined> {
  if (options.desktopHostRoot) return resolve(options.desktopHostRoot);
  const sourceRoot = resolve(sourceRootInput);
  const candidate = join(sourceRoot, DESKTOP_HOST_PAYLOAD_RELATIVE);
  return (await exists(candidate)) ? candidate : undefined;
}

/** Copy and verify the host payload into a replaceable program tree. */
export async function copyDesktopHostPayload(
  sourceRoot: string,
  destinationProgramRoot: string,
  options: DesktopHostPayloadOptions = {},
): Promise<DesktopHostCopyResult | undefined> {
  const payloadRoot = await resolveDesktopHostPayload(sourceRoot, options);
  if (!payloadRoot) return undefined;
  const verification = await verifyDesktopHostPayload(payloadRoot, options);
  if (!verification.valid || !verification.launchTarget) {
    throw new Error(`Desktop host payload is not usable: ${verification.errors.join('; ')}`);
  }
  const destination = join(resolve(destinationProgramRoot), DESKTOP_HOST_PAYLOAD_RELATIVE);
  await mkdir(dirname(destination), { recursive: true });
  await cp(payloadRoot, destination, { recursive: true, force: false, errorOnExist: true });
  const installedLaunchTarget = normalizePath(join(DESKTOP_HOST_PAYLOAD_RELATIVE, verification.launchTarget));
  const installed = await verifyDesktopHostPayload(destination, options);
  if (!installed.valid || !installed.launchTarget) {
    throw new Error(`Copied desktop host payload is not usable: ${installed.errors.join('; ')}`);
  }
  return { ...installed, installedLaunchTarget };
}

/** Return a stable path for metadata/shortcut assertions. */
export function desktopHostLaunchPath(programRoot: string, launchTarget: string): string {
  const normalized = normalizePath(launchTarget).replace(/^\/+/, '');
  return resolve(programRoot, ...normalized.split('/'));
}

export function desktopHostPayloadPath(programRoot: string): string {
  return join(resolve(programRoot), DESKTOP_HOST_PAYLOAD_RELATIVE);
}
