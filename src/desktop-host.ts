import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';

/**
 * The host is built in the separate dsh-electronbun repository.  The product
 * release only consumes its already-built Windows payload at this boundary.
 * Keep these facts in one place so packaging and installation cannot silently
 * pair a host from a different contract.
 */
export const ELECTROBUN_HOST_COMMIT = '92427e72ae6b49e4d6046fa92a4d034f41b03f2f';
export const ELECTROBUN_BUN_VERSION = '1.3.14';
export const ELECTROBUN_PRODUCT_IDENTIFIER = 'dev.baihestudio.dsh-rpgmaker-mv';
export const ELECTROBUN_PRODUCT_VERSION = '0.3.0';

/** Relative directory used inside a Release ZIP and the installed program. */
export const DESKTOP_HOST_PAYLOAD_RELATIVE = 'desktop-host';
export const DESKTOP_HOST_SIDECAR_RELATIVE = 'Resources/app/payload/sidecar/dsh-rpgmaker-sidecar.js';
export const DESKTOP_HOST_SUPERVISOR_RELATIVE = 'Resources/app/bin/dsh-sidecar-supervisor.exe';
/** JSON sidecar describing the prebuilt host and its pinned contract. */
export const DESKTOP_HOST_MANIFEST_NAME = 'desktop-host.json';
export const DESKTOP_HOST_MANIFEST_RELATIVE = `${DESKTOP_HOST_PAYLOAD_RELATIVE}/${DESKTOP_HOST_MANIFEST_NAME}`;

export const DESKTOP_HOST_FORMAT = 1;
/** Schema for the product adapter/source pairing recorded by native builds. */
export const DESKTOP_HOST_PROVENANCE_SCHEMA_VERSION = 1;

export interface DesktopHostSidecarProvenance {
  schemaVersion: number;
  /** SHA-256 of the current product adapter source entrypoint. */
  adapterSourceSha256: string;
  /** SHA-256 of the bundled sidecar entrypoint in the native payload. */
  sidecarSha256: string;
}

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
  /** Required relative path to the staged sidecar entrypoint. */
  sidecarEntrypoint: string;
  /** Required relative path to the staged supervisor executable. */
  supervisorExecutable: string;
  /** Exact product adapter/source pairing supplied by the native build. */
  sidecarProvenance?: DesktopHostSidecarProvenance;
  executable?: string;
  entrypoint?: string;
  bun?: { version?: string };
  build?: { hostCommit?: string };
  adapter?: { hostCommit?: string };
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
  adapterSourceSha256?: string;
  sidecarSha256?: string;
  sidecarProvenance?: DesktopHostSidecarProvenance;
}

export interface DesktopHostPayloadOptions {
  /** Optional external prebuilt payload directory supplied by a maintainer. */
  desktopHostRoot?: string;
  /** Override the product version required for version-coherent pairing. */
  productVersion?: string;
  /** Product adapter source file whose digest must match the payload. */
  adapterSourcePath?: string;
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

async function sha256File(path: string): Promise<string | undefined> {
  try {
    return createHash('sha256').update(await readFile(path)).digest('hex');
  } catch {
    return undefined;
  }
}

const DESKTOP_HOST_PROVENANCE_FIELDS = new Set(['schemaVersion', 'adapterSourceSha256', 'sidecarSha256']);

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
  const path = join(payloadRoot, DESKTOP_HOST_MANIFEST_NAME);
  if (!(await regularFile(path))) return undefined;
  try {
    const value = object(JSON.parse(await readFile(path, 'utf8')));
    if (value) return { path, value: value as unknown as DesktopHostManifest };
  } catch {
    // The caller receives a useful invalid descriptor diagnostic.
  }
  return { path, value: {} as DesktopHostManifest };
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
    errors.push(`desktop host payload descriptor is missing (expected ${DESKTOP_HOST_MANIFEST_NAME})`);
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

  const sidecarTarget = relativePayloadPath(manifest?.sidecarEntrypoint, 'desktop host sidecarEntrypoint', errors);
  if (sidecarTarget && sidecarTarget !== DESKTOP_HOST_SIDECAR_RELATIVE) {
    errors.push(`desktop host sidecarEntrypoint is ${sidecarTarget}, expected ${DESKTOP_HOST_SIDECAR_RELATIVE}`);
  }
  const sidecarPath = sidecarTarget ? join(payloadRoot, sidecarTarget) : undefined;
  if (sidecarPath && (!(await pathInside(payloadRoot, sidecarPath)) || !(await regularFile(sidecarPath)))) {
    errors.push(`desktop host sidecarEntrypoint is missing or outside the payload: ${sidecarPath}`);
  }

  const provenanceValue = manifest?.sidecarProvenance;
  const provenanceObject = object(provenanceValue);
  let provenance: DesktopHostSidecarProvenance | undefined;
  let adapterSourceSha256: string | undefined;
  let sidecarSha256: string | undefined;
  if (provenanceValue === undefined) {
    errors.push('desktop host sidecar provenance is missing');
  } else if (!provenanceObject) {
    errors.push('desktop host sidecar provenance must be an object');
  } else {
    const unsupportedFields = Object.keys(provenanceObject).filter((field) => !DESKTOP_HOST_PROVENANCE_FIELDS.has(field));
    if (unsupportedFields.length > 0) {
      errors.push(`desktop host sidecar provenance contains unsupported fields: ${unsupportedFields.join(', ')}`);
    }
    const declaredSchemaVersion = provenanceObject.schemaVersion;
    if (declaredSchemaVersion !== DESKTOP_HOST_PROVENANCE_SCHEMA_VERSION) {
      errors.push(`desktop host sidecar provenance schemaVersion is ${String(declaredSchemaVersion ?? 'missing')}, expected ${DESKTOP_HOST_PROVENANCE_SCHEMA_VERSION}`);
    }
    const declaredSource = provenanceObject.adapterSourceSha256;
    if (typeof declaredSource !== 'string' || !/^[a-f0-9]{64}$/.test(declaredSource)) {
      errors.push('desktop host sidecar provenance adapterSourceSha256 must be a lowercase SHA-256 digest');
    } else {
      adapterSourceSha256 = declaredSource;
    }
    const declaredSidecar = provenanceObject.sidecarSha256;
    if (typeof declaredSidecar !== 'string' || !/^[a-f0-9]{64}$/.test(declaredSidecar)) {
      errors.push('desktop host sidecar provenance sidecarSha256 must be a lowercase SHA-256 digest');
    } else {
      sidecarSha256 = declaredSidecar;
    }
    provenance = provenanceObject as unknown as DesktopHostSidecarProvenance;
  }
  if (sidecarPath && await regularFile(sidecarPath)) {
    const actualSidecarSha256 = await sha256File(sidecarPath);
    if (actualSidecarSha256) {
      if (sidecarSha256 && sidecarSha256 !== actualSidecarSha256) {
        errors.push(`desktop host sidecar provenance sidecarSha256 does not match the packaged sidecar (${actualSidecarSha256})`);
      }
      sidecarSha256 = actualSidecarSha256;
    }
  }
  if (options.adapterSourcePath) {
    const actualAdapterSourceSha256 = await sha256File(resolve(options.adapterSourcePath));
    if (!actualAdapterSourceSha256) {
      errors.push(`desktop host adapter source is missing or unreadable: ${resolve(options.adapterSourcePath)}`);
    } else {
      if (adapterSourceSha256 && adapterSourceSha256 !== actualAdapterSourceSha256) {
        errors.push(`desktop host sidecar provenance adapterSourceSha256 does not match the current adapter source (${actualAdapterSourceSha256})`);
      }
      adapterSourceSha256 = actualAdapterSourceSha256;
    }
  }
  const supervisorTarget = relativePayloadPath(manifest?.supervisorExecutable, 'desktop host supervisorExecutable', errors);
  if (supervisorTarget && supervisorTarget !== DESKTOP_HOST_SUPERVISOR_RELATIVE) {
    errors.push(`desktop host supervisorExecutable is ${supervisorTarget}, expected ${DESKTOP_HOST_SUPERVISOR_RELATIVE}`);
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
    supervisorExecutable: supervisorTarget,
    ...(adapterSourceSha256 ? { adapterSourceSha256 } : {}),
    ...(sidecarSha256 ? { sidecarSha256 } : {}),
    ...(provenance ? { sidecarProvenance: provenance } : {})
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
