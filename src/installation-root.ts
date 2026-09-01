import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, stat, statfs, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, win32 } from 'node:path';

import { redactSensitive } from './process';
import { PRODUCT_NAME, PROGRAM_OWNER, resolveHarnessPaths, type HarnessPaths, type PathOptions } from './config';

export const INSTALLATION_RECEIPT_SCHEMA_VERSION = 1;
export const INSTALLATION_RECEIPT_NAME = 'installation-location.json';
/** Fixed product-owned reserve for staging and rollback copies. */
export const INSTALLATION_STAGING_HEADROOM_BYTES = 512 * 1024 * 1024;
export const INSTALLATION_CAPACITY_FORMULA = 'requiredBytes = measuredReleasePayloadBytes + headroomBytes';
export const INSTALLATION_CAPACITY_BASIS = 'Measured extracted Release payload plus the product-owned 512 MiB staging/rollback reserve.';

export interface InstallationReceipt {
  schemaVersion: number;
  product: string;
  owner: string;
  installationRoot: string;
  programRoot: string;
  localStateRoot: string;
  committedAt: string;
}

export interface InstallationRootValidation {
  valid: boolean;
  root: string;
  payloadBytes: number;
  headroomBytes: number;
  requiredBytes: number;
  availableBytes?: number;
  capacityFormula: string;
  capacityBasis: string;
  errors: string[];
  probePath?: string;
}

export interface InstallationCapacity {
  payloadBytes: number;
  headroomBytes: number;
  requiredBytes: number;
  availableBytes?: number;
  formula: string;
  basis: string;
}

export interface InstallationRootValidationOptions {
  platform?: string;
  localStateRoot: string;
  releaseRoot?: string;
  requiredBytes?: number;
  availableBytes?: number;
  headroomBytes?: number;
  /** Injected filesystem probe for ordinary tests. */
  writableProbe?: (root: string) => Promise<void>;
}

function normalizeInstallationPath(value: string, platform: string): string {
  const slash = value.replaceAll('\\', '/').replace(/\/+$/, '');
  return platform === 'win32' ? slash.toLowerCase() : resolve(slash);
}

function pathWithin(parent: string, child: string, platform: string): boolean {
  const p = normalizeInstallationPath(parent, platform);
  const c = normalizeInstallationPath(child, platform);
  return c === p || c.startsWith(`${p}/`);
}

function absoluteSupported(root: string, platform: string): boolean {
  if (platform === 'win32') {
    // Contract tests run the Windows seams on a POSIX host with disposable
    // POSIX roots.  Native Windows still takes the win32 branch below.
    const hostSimulation = process.platform !== 'win32' && isAbsolute(root);
    return (win32.isAbsolute(root) || hostSimulation) && !/^\\\\\?\\/i.test(root) && !/^\\\\\.\\/i.test(root);
  }
  return isAbsolute(root);
}

export async function measureReleasePayloadBytes(root: string): Promise<number> {
  let total = 0;
  async function walk(path: string): Promise<void> {
    const entries = await import('node:fs/promises').then(({ readdir }) => readdir(path, { withFileTypes: true })).catch(() => [] as import('node:fs').Dirent[]);
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) total += (await stat(child).catch(() => undefined))?.size ?? 0;
    }
  }
  await walk(root);
  return total;
}

/** Calculate Release payload plus the fixed staging/rollback reserve. */
export async function estimateInstallationBytes(releaseRoot?: string, headroomBytes = INSTALLATION_STAGING_HEADROOM_BYTES): Promise<number> {
  const payload = releaseRoot ? await measureReleasePayloadBytes(resolve(releaseRoot)) : 0;
  return payload + headroomBytes;
}

async function freeBytes(root: string): Promise<number | undefined> {
  try {
    const value = await statfs(root);
    return Number(value.bavail) * Number(value.bsize);
  } catch {
    return undefined;
  }
}

export async function validateInstallationRoot(rootInput: string, options: InstallationRootValidationOptions): Promise<InstallationRootValidation> {
  const platform = options.platform ?? process.platform;
  const root = rootInput.trim();
  const errors: string[] = [];
  const headroomBytes = options.headroomBytes ?? INSTALLATION_STAGING_HEADROOM_BYTES;
  const payloadBytes = options.releaseRoot ? await measureReleasePayloadBytes(resolve(options.releaseRoot)) : 0;
  const requiredBytes = options.requiredBytes ?? payloadBytes + headroomBytes;
  if (!root) errors.push('An installation root is required.');
  else if (!absoluteSupported(root, platform)) errors.push('The installation root must be an absolute Windows filesystem path.');
  const localState = resolve(options.localStateRoot);
  if (root && pathWithin(localState, root, platform)) errors.push('The installation root must be outside the fixed local state root.');
  if (root && pathWithin(root, localState, platform)) errors.push('The local state root must not be nested under the installation root.');
  if (root && options.releaseRoot && (pathWithin(root, resolve(options.releaseRoot), platform) || pathWithin(resolve(options.releaseRoot), root, platform))) {
    errors.push('The installation root must be separate from the extracted Release root.');
  }
  if (options.releaseRoot && (pathWithin(resolve(options.releaseRoot), localState, platform) || pathWithin(localState, resolve(options.releaseRoot), platform))) {
    errors.push('The fixed local state root must be separate from the extracted Release root.');
  }

  let availableBytes = options.availableBytes;
  let probePath: string | undefined;
  if (errors.length === 0) {
    try {
      await mkdir(root, { recursive: true });
      const rootStat = await lstat(root);
      if (rootStat.isSymbolicLink()) throw new Error('the installation root is a symbolic link');
      probePath = join(root, `.write-probe-${randomUUID()}`);
      if (options.writableProbe) await options.writableProbe(root);
      else {
        const probe = probePath;
        await writeFile(probe, 'probe', { encoding: 'utf8', flag: 'wx' });
        await import('node:fs/promises').then(({ rm }) => rm(probe, { force: true }));
      }
    } catch (error) {
      errors.push(`The installation root is not writable: ${redactSensitive(error instanceof Error ? error.message : String(error))}`);
    }
    availableBytes ??= await freeBytes(root);
    if (availableBytes !== undefined && availableBytes < requiredBytes) {
      errors.push(`The installation root does not have enough free space: ${requiredBytes} bytes required, ${availableBytes} bytes available.`);
    }
  }
  return {
    valid: errors.length === 0,
    root,
    payloadBytes,
    headroomBytes,
    requiredBytes,
    ...(availableBytes === undefined ? {} : { availableBytes }),
    capacityFormula: INSTALLATION_CAPACITY_FORMULA,
    capacityBasis: INSTALLATION_CAPACITY_BASIS,
    errors,
    ...(probePath ? { probePath } : {})
  };
}

export function installationReceiptPath(localStateRoot: string): string {
  return join(resolve(localStateRoot), INSTALLATION_RECEIPT_NAME);
}

export async function readInstallationReceipt(localStateRoot: string): Promise<InstallationReceipt | undefined> {
  const path = installationReceiptPath(localStateRoot);
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return undefined;
    throw new Error(`Could not read the installation location receipt at ${path}: ${redactSensitive(error instanceof Error ? error.message : String(error))}`, { cause: error });
  }
  try {
    const parsed = JSON.parse(content) as Partial<InstallationReceipt>;
    if (parsed.schemaVersion !== INSTALLATION_RECEIPT_SCHEMA_VERSION
      || parsed.product !== PRODUCT_NAME
      || parsed.owner !== PROGRAM_OWNER
      || typeof parsed.installationRoot !== 'string'
      || typeof parsed.programRoot !== 'string'
      || typeof parsed.localStateRoot !== 'string'
      || typeof parsed.committedAt !== 'string'
      || normalizeInstallationPath(parsed.localStateRoot, process.platform) !== normalizeInstallationPath(resolve(localStateRoot), process.platform)) {
      throw new Error('schema or ownership fields are invalid');
    }
    const platform = process.platform;
    if (!absoluteSupported(parsed.installationRoot, platform) || !absoluteSupported(parsed.programRoot, platform)) {
      throw new Error('installation and program roots must be absolute supported filesystem paths');
    }
    const expectedProgramRoot = join(resolve(parsed.installationRoot), 'program');
    if (normalizeInstallationPath(parsed.programRoot, platform) !== normalizeInstallationPath(expectedProgramRoot, platform)) {
      throw new Error('programRoot must be the distinct program child of installationRoot');
    }
    if (pathWithin(parsed.installationRoot, parsed.localStateRoot, platform)
      || pathWithin(parsed.localStateRoot, parsed.installationRoot, platform)) {
      throw new Error('installationRoot and localStateRoot must be separate');
    }
    return parsed as InstallationReceipt;
  } catch (error) {
    throw new Error(`Installation location receipt at ${path} is invalid; refusing to start another installation: ${redactSensitive(error instanceof Error ? error.message : String(error))}`, { cause: error });
  }
}

export interface InstallationReceiptInspection {
  receipt?: InstallationReceipt;
  error?: Error;
}

/** Inspect the receipt without throwing so callers can enter their failure boundary first. */
export async function inspectInstallationReceipt(localStateRoot: string): Promise<InstallationReceiptInspection> {
  try {
    const receipt = await readInstallationReceipt(localStateRoot);
    return receipt ? { receipt } : {};
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/** Atomically commit the selected root only after final verification. */
export interface InstallationReceiptInput extends Omit<InstallationReceipt, 'schemaVersion' | 'committedAt'> {
  committedAt?: string;
}

export async function commitInstallationReceipt(receipt: InstallationReceiptInput): Promise<InstallationReceipt> {
  const { product, owner, installationRoot, programRoot, localStateRoot } = receipt;
  if (normalizeInstallationPath(programRoot, process.platform) !== normalizeInstallationPath(join(resolve(installationRoot), 'program'), process.platform)) {
    throw new Error('Cannot commit an installation receipt whose programRoot is not the distinct program child of installationRoot.');
  }
  const value: InstallationReceipt = {
    schemaVersion: INSTALLATION_RECEIPT_SCHEMA_VERSION,
    product,
    owner,
    installationRoot,
    programRoot,
    localStateRoot,
    committedAt: receipt.committedAt ?? new Date().toISOString()
  };
  const path = installationReceiptPath(value.localStateRoot);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
  return value;
}

export interface RecordedInstallationRootResolution {
  installationRoot: string;
  receipt?: InstallationReceipt;
}

export async function resolveRecordedInstallationRoot(localStateRoot: string, explicitRoot?: string, platform = process.platform): Promise<RecordedInstallationRootResolution> {
  const receipt = await readInstallationReceipt(localStateRoot);
  if (receipt) {
    if (explicitRoot && normalizeInstallationPath(explicitRoot, platform) !== normalizeInstallationPath(receipt.installationRoot, platform)) {
      throw new Error(`The recorded installation root is ${receipt.installationRoot}; refusing to relocate it to ${explicitRoot}.`);
    }
    return { installationRoot: receipt.installationRoot, receipt };
  }
  if (!explicitRoot) throw new Error('No installation root is recorded. Choose an installation root before the first installation.');
  return { installationRoot: explicitRoot };
}

export interface ReceiptBackedHarnessPaths {
  paths: HarnessPaths;
  receipt?: InstallationReceipt;
}

/** Resolve normal maintenance paths, following the strict receipt when no explicit root is supplied. */
export async function resolveReceiptBackedHarnessPaths(options: PathOptions = {}): Promise<ReceiptBackedHarnessPaths> {
  const initialPaths = resolveHarnessPaths(options);
  const receipt = await readInstallationReceipt(initialPaths.mutableRoot);
  if (receipt) {
    if (options.installationRoot && normalizeInstallationPath(options.installationRoot, options.platform ?? process.platform) !== normalizeInstallationPath(receipt.installationRoot, options.platform ?? process.platform)) {
      throw new Error(`The recorded installation root is ${receipt.installationRoot}; refusing to relocate it to ${options.installationRoot}.`);
    }
    return {
      receipt,
      paths: resolveHarnessPaths({
        ...options,
        installationRoot: receipt.installationRoot,
        localStateRoot: receipt.localStateRoot,
        mutableRoot: receipt.localStateRoot
      })
    };
  }
  return { paths: initialPaths, ...(receipt ? { receipt } : {}) };
}

export function defaultInstallationRoot(env: Record<string, string | undefined> = process.env): string {
  const local = env.LOCALAPPDATA ?? env.USERPROFILE ?? process.cwd();
  return resolve(join(local, 'Programs', 'BaiheStudio', 'DSH-RPGMaker-MV'));
}

export function defaultLocalStateRoot(env: Record<string, string | undefined> = process.env): string {
  const local = env.LOCALAPPDATA ?? env.USERPROFILE ?? process.cwd();
  return resolve(join(local, 'BaiheStudio', 'DSH-RPGMaker-MV'));
}
