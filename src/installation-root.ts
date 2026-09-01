import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, stat, statfs, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, win32 } from 'node:path';

import { redactSensitive } from './process';
import { PRODUCT_NAME, PROGRAM_OWNER } from './config';

export const INSTALLATION_RECEIPT_SCHEMA_VERSION = 1;
export const INSTALLATION_RECEIPT_NAME = 'installation-location.json';
/** Fixed product-owned reserve for staging and rollback copies. */
export const INSTALLATION_STAGING_HEADROOM_BYTES = 512 * 1024 * 1024;

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
  requiredBytes: number;
  availableBytes?: number;
  errors: string[];
  probePath?: string;
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

export interface ResolveInstallationRootOptions {
  platform?: string;
  env?: Record<string, string | undefined>;
  installationRoot?: string;
  localStateRoot: string;
  releaseRoot?: string;
  nonInteractive?: boolean;
  picker?: (defaultPath: string) => Promise<string | undefined>;
  prompt?: (defaultPath: string) => Promise<string | undefined>;
}

function normal(value: string, platform: string): string {
  const slash = value.replaceAll('\\', '/').replace(/\/+$/, '');
  return platform === 'win32' ? slash.toLowerCase() : resolve(slash);
}

function pathWithin(parent: string, child: string, platform: string): boolean {
  const p = normal(parent, platform);
  const c = normal(child, platform);
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

async function releaseBytes(root: string): Promise<number> {
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
  const payload = releaseRoot ? await releaseBytes(resolve(releaseRoot)) : 0;
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
  const requiredBytes = options.requiredBytes ?? await estimateInstallationBytes(options.releaseRoot, options.headroomBytes);
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
  return { valid: errors.length === 0, root, requiredBytes, ...(availableBytes === undefined ? {} : { availableBytes }), errors, ...(probePath ? { probePath } : {}) };
}

export function installationReceiptPath(localStateRoot: string): string {
  return join(resolve(localStateRoot), INSTALLATION_RECEIPT_NAME);
}

export async function readInstallationReceipt(localStateRoot: string): Promise<InstallationReceipt | undefined> {
  try {
    const parsed = JSON.parse(await readFile(installationReceiptPath(localStateRoot), 'utf8')) as Partial<InstallationReceipt>;
    if (parsed.schemaVersion !== INSTALLATION_RECEIPT_SCHEMA_VERSION
      || parsed.product !== PRODUCT_NAME
      || parsed.owner !== PROGRAM_OWNER
      || typeof parsed.installationRoot !== 'string'
      || typeof parsed.programRoot !== 'string'
      || typeof parsed.localStateRoot !== 'string'
      || normal(parsed.localStateRoot, process.platform) !== normal(resolve(localStateRoot), process.platform)) return undefined;
    const platform = process.platform;
    if (!absoluteSupported(parsed.installationRoot, platform) || !absoluteSupported(parsed.programRoot, platform)) return undefined;
    // A receipt may only point at a replaceable program tree owned by the
    // selected installation root.  Keep the direct program-root seam valid
    // for explicit maintenance callers while rejecting arbitrary escapes.
    if (!pathWithin(parsed.installationRoot, parsed.programRoot, platform)
      || pathWithin(parsed.installationRoot, parsed.localStateRoot, platform)
      || pathWithin(parsed.localStateRoot, parsed.installationRoot, platform)) return undefined;
    return parsed as InstallationReceipt;
  } catch {
    return undefined;
  }
}

/** Atomically commit the selected root only after final verification. */
export async function commitInstallationReceipt(receipt: Omit<InstallationReceipt, 'schemaVersion' | 'committedAt'> & Partial<Pick<InstallationReceipt, 'committedAt'>>): Promise<InstallationReceipt> {
  const { product, owner, installationRoot, programRoot, localStateRoot } = receipt;
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

export async function resolveRecordedInstallationRoot(localStateRoot: string, explicitRoot?: string, platform = process.platform): Promise<{ installationRoot: string; receipt?: InstallationReceipt }> {
  const receipt = await readInstallationReceipt(localStateRoot);
  if (receipt) {
    if (explicitRoot && normal(explicitRoot, platform) !== normal(receipt.installationRoot, platform)) {
      throw new Error(`The recorded installation root is ${receipt.installationRoot}; refusing to relocate it to ${explicitRoot}.`);
    }
    return { installationRoot: receipt.installationRoot, receipt };
  }
  if (!explicitRoot) throw new Error('No installation root is recorded. Choose an installation root before the first installation.');
  return { installationRoot: explicitRoot };
}

/**
 * Resolve the first-install destination.  The native picker is injected by
 * the Windows adapter; this function remains deterministic and testable.
 */
export async function chooseInstallationRoot(options: ResolveInstallationRootOptions): Promise<{ installationRoot?: string; cancelled: boolean; defaultPath: string }> {
  const defaultPath = options.installationRoot ?? defaultInstallationRoot(options.env ?? process.env);
  if (options.installationRoot || options.nonInteractive) return { installationRoot: options.installationRoot ?? defaultPath, cancelled: false, defaultPath };
  const selected = options.picker ? await options.picker(defaultPath) : options.prompt ? await options.prompt(defaultPath) : defaultPath;
  if (!selected) return { cancelled: true, defaultPath };
  return { installationRoot: selected, cancelled: false, defaultPath };
}

export function defaultInstallationRoot(env: Record<string, string | undefined> = process.env): string {
  const local = env.LOCALAPPDATA ?? env.USERPROFILE ?? process.cwd();
  return resolve(join(local, 'Programs', 'BaiheStudio', 'DSH-RPGMaker-MV'));
}

export function defaultLocalStateRoot(env: Record<string, string | undefined> = process.env): string {
  const local = env.LOCALAPPDATA ?? env.USERPROFILE ?? process.cwd();
  return resolve(join(local, 'BaiheStudio', 'DSH-RPGMaker-MV'));
}
