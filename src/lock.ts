import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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

export class HarnessLockTimeoutError extends Error {
  constructor(path: string, timeoutMs: number) {
    super(`Another harness operation owns ${path}; waited ${timeoutMs}ms. Retry after it finishes or inspect the lock owner before removing the lock.`);
    this.name = 'HarnessLockTimeoutError';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
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
