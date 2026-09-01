import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export interface HarnessLockOptions {
  timeoutMs?: number;
  retryMs?: number;
  token?: string;
}

export interface HarnessLock {
  path: string;
  token: string;
  release: () => Promise<void>;
}

export interface HarnessSessionLeases {
  operation: HarnessLock;
  session: HarnessLock;
}

export class HarnessLockTimeoutError extends Error {
  constructor(path: string, timeoutMs: number) {
    super(`Another harness operation owns ${path}; waited ${timeoutMs}ms. Retry after it finishes or inspect the lock owner before removing the lock.`);
    this.name = 'HarnessLockTimeoutError';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

/**
 * Whether a process id still exists. `signal 0` probes liveness without
 * sending a signal; ESRCH means the process is gone. Permission errors
 * (EPERM) still mean the process exists, so they count as alive.
 */
export function processPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

interface LockOwner {
  pid: number;
  token: string;
}

async function lockOwner(lockPath: string): Promise<LockOwner | undefined> {
  try {
    const owner = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8')) as { pid?: unknown; token?: unknown };
    return typeof owner.pid === 'number' && typeof owner.token === 'string'
      ? { pid: owner.pid, token: owner.token }
      : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code && !['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code!)) {
      throw error;
    }
    return undefined;
  }
}

type StaleReclaimResult = 'contended' | 'held' | 'missing' | 'reclaimed';

async function reclaimStaleHarnessLock(lockPath: string): Promise<StaleReclaimResult> {
  try {
    if (!(await stat(lockPath)).isDirectory()) return 'missing';
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return 'missing';
    throw error;
  }
  const owner = await lockOwner(lockPath);
  if (!owner || processPidAlive(owner.pid)) return 'held';
  const ownerKey = createHash('sha256').update(`${owner.pid}\0${owner.token}`).digest('hex').slice(0, 16);
  const tombstonePath = `${lockPath}.stale-${ownerKey}`;
  try {
    await rename(lockPath, tombstonePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    if (['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) return 'contended';
    throw error;
  }
  await rm(tombstonePath, { recursive: true, force: true });
  return 'reclaimed';
}

/**
 * A lock is held only while its recorded owner process is alive. A stale lock
 * directory whose owner is gone (an abnormal termination that skipped the
 * release path) is reclaimed in place so the next acquisition does not wait
 * out the full timeout.
 */
export async function isHarnessLockHeld(lockPathInput: string): Promise<boolean> {
  const lockPath = resolve(lockPathInput);
  const result = await reclaimStaleHarnessLock(lockPath);
  return result === 'contended' || result === 'held';
}

export async function waitForHarnessLockRelease(lockPathInput: string, options: HarnessLockOptions = {}): Promise<void> {
  const lockPath = resolve(lockPathInput);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retryMs = options.retryMs ?? 25;
  const deadline = Date.now() + timeoutMs;
  while (await isHarnessLockHeld(lockPath)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new HarnessLockTimeoutError(lockPath, timeoutMs);
    await delay(Math.min(retryMs, remaining));
  }
}

export async function acquireHarnessLock(lockPathInput: string, options: HarnessLockOptions = {}): Promise<HarnessLock> {
  const lockPath = resolve(lockPathInput);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retryMs = options.retryMs ?? 25;
  const token = options.token ?? randomUUID();
  const deadline = Date.now() + timeoutMs;
  await mkdir(dirname(lockPath), { recursive: true });

  while (true) {
    try {
      await mkdir(lockPath);
      const ownerPath = join(lockPath, 'owner.json');
      try {
        await writeFile(ownerPath, `${JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() })}\n`);
      } catch (error) {
        // A stale-lock reclaimer can win the narrow window between mkdir and
        // owner.json creation. In that case the directory is gone and this
        // contender must retry instead of surfacing an ordinary race as a
        // failed acquisition (or removing a replacement owner).
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new HarnessLockTimeoutError(lockPath, timeoutMs);
          await delay(Math.min(retryMs, remaining));
          continue;
        }
        await rm(lockPath, { recursive: true, force: true });
        throw error;
      }
      let released = false;
      return {
        path: lockPath,
        token,
        release: async () => {
          if (released) return;
          released = true;
          try {
            const owner = JSON.parse(await readFile(ownerPath, 'utf8')) as { token?: string };
            if (owner.token === token) await rm(lockPath, { recursive: true, force: true });
          } catch {
            // A missing lock means another cleanup path already released it. Never remove an unowned lock.
          }
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (!(await isHarnessLockHeld(lockPath))) continue;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new HarnessLockTimeoutError(lockPath, timeoutMs);
      await delay(Math.min(retryMs, remaining));
    }
  }
}

export async function acquireHarnessSessionLeases(
  operationPathInput: string,
  sessionPathInput: string,
  options: HarnessLockOptions = {}
): Promise<HarnessSessionLeases> {
  const operationPath = resolve(operationPathInput);
  const sessionPath = resolve(sessionPathInput);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retryMs = options.retryMs ?? 25;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new HarnessLockTimeoutError(sessionPath, timeoutMs);
    const operation = await acquireHarnessLock(operationPath, { ...options, timeoutMs: remaining });
    if (await isHarnessLockHeld(sessionPath)) {
      await operation.release();
      await waitForHarnessLockRelease(sessionPath, { retryMs, timeoutMs: Math.max(1, deadline - Date.now()) });
      continue;
    }
    try {
      const session = await acquireHarnessLock(sessionPath, { ...options, timeoutMs: 0 });
      return { operation, session };
    } catch (error) {
      await operation.release();
      if (!(error instanceof HarnessLockTimeoutError)) throw error;
      await waitForHarnessLockRelease(sessionPath, { retryMs, timeoutMs: Math.max(1, deadline - Date.now()) });
    }
  }
}

export async function withHarnessOperationLock<T>(
  operationPathInput: string,
  sessionPathInput: string,
  operation: () => Promise<T>,
  options: HarnessLockOptions = {}
): Promise<T> {
  const operationPath = resolve(operationPathInput);
  const sessionPath = resolve(sessionPathInput);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retryMs = options.retryMs ?? 25;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new HarnessLockTimeoutError(sessionPath, timeoutMs);
    const lock = await acquireHarnessLock(operationPath, { ...options, timeoutMs: remaining });
    if (await isHarnessLockHeld(sessionPath)) {
      await lock.release();
      await waitForHarnessLockRelease(sessionPath, { retryMs, timeoutMs: Math.max(1, deadline - Date.now()) });
      continue;
    }
    try {
      return await operation();
    } finally {
      await lock.release();
    }
  }
}

export async function withHarnessLock<T>(
  lockPath: string,
  operation: () => Promise<T>,
  options: HarnessLockOptions = {}
): Promise<T> {
  const lock = await acquireHarnessLock(lockPath, options);
  try {
    return await operation();
  } finally {
    await lock.release();
  }
}
