import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

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

export async function isHarnessLockHeld(lockPathInput: string): Promise<boolean> {
  try {
    return (await stat(resolve(lockPathInput))).isDirectory();
  } catch {
    return false;
  }
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
