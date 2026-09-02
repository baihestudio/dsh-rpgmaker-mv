import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { bootstrapRuntime, DSH_RUNTIME_MANIFEST_RELATIVE, DSH_RUNTIME_PEER_DEPENDENCIES, findDshExecutable, verifyRuntime } from '../src/bootstrap';
import { DSH_NPM_INTEGRITY, DSH_PACKAGE_NAME, DSH_VERSION, PRODUCT_VERSION } from '../src/config';
import { launchProject } from '../src/launcher';
import { acquireHarnessLock } from '../src/lock';
import { runCli } from '../src/cli';
import { installerArguments } from '../src/installer';
import { childExitCode, executeCommand, prepareProcessInvocation, ProcessTerminationError } from '../src/process';
import { validateMvProject } from '../src/project';

async function disposableDirectory(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

async function makeMvProject(parent: string, name = '游戏 project with spaces'): Promise<string> {
  const project = join(parent, name);
  await mkdir(join(project, 'data'), { recursive: true });
  await mkdir(join(project, 'js'), { recursive: true });
  await writeFile(join(project, 'Game.rpgproject'), '{}\n');
  return project;
}

async function makeRuntime(runtime: string, version = DSH_VERSION): Promise<void> {
  await mkdir(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib'), { recursive: true });
  await mkdir(join(runtime, 'node_modules', 'koffi'), { recursive: true });
  await mkdir(join(runtime, 'node_modules', '.bin'), { recursive: true });
  await writeFile(
    join(runtime, 'package.json'),
    JSON.stringify({
      name: 'dsh-rpgmaker-runtime',
      private: true,
      dependencies: { [DSH_PACKAGE_NAME]: version, ...DSH_RUNTIME_PEER_DEPENDENCIES }
    })
  );
  await writeFile(
    join(runtime, 'package-lock.json'),
    JSON.stringify({
      name: 'dsh-rpgmaker-runtime',
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { [DSH_PACKAGE_NAME]: version, ...DSH_RUNTIME_PEER_DEPENDENCIES } },
        [`node_modules/${DSH_PACKAGE_NAME}`]: { version, integrity: version === DSH_VERSION ? DSH_NPM_INTEGRITY : 'sha512-old-runtime' },
        ...Object.fromEntries(Object.entries(DSH_RUNTIME_PEER_DEPENDENCIES).map(([name, peerVersion]) => [`node_modules/${name}`, { version: peerVersion }]))
      }
    })
  );
  await writeFile(
    join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
    JSON.stringify({ name: DSH_PACKAGE_NAME, version, bin: { dsh: 'lib/bin.js' } })
  );
  await writeFile(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), '#!/usr/bin/env node\n');
  await writeFile(join(runtime, 'node_modules', 'koffi', 'package.json'), JSON.stringify({ name: 'koffi', version: '2.12.0' }));
  await writeFile(join(runtime, 'node_modules', '.bin', 'dsh'), '#!/usr/bin/env node\n');
}

const dshManifestRoot = join(process.cwd(), DSH_RUNTIME_MANIFEST_RELATIVE);
function makeTrackedChild(pid = 1234): EventEmitter & { pid: number; exitCode: number | null; signalCode: NodeJS.Signals | null } {
  const child = new EventEmitter() as EventEmitter & { pid: number; exitCode: number | null; signalCode: NodeJS.Signals | null };
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  return child;
}

  test('timeout does not resolve until process-tree termination completes', async () => {
    const child = new EventEmitter() as EventEmitter & { pid: number; exitCode: number | null; signalCode: NodeJS.Signals | null };
    child.pid = 4123;
    child.exitCode = null;
    child.signalCode = null;
    let releaseTermination: (() => void) | undefined;
    let terminationStarted = false;
    const command = executeCommand('fake-process', [], { platform: 'win32', timeoutMs: 5 }, {
      spawnProcess: (() => child) as never,
      terminateProcessTree: async () => {
        terminationStarted = true;
        await new Promise<void>((resolve) => { releaseTermination = resolve; });
        child.exitCode = 1;
        child.emit('close', 1);
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(terminationStarted).toBe(true);
    let resolved = false;
    void command.then(() => { resolved = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(resolved).toBe(false);
    releaseTermination?.();
    await expect(command).resolves.toMatchObject({ exitCode: 124 });
  });
  test('child exit code observes an already-exited process-like child', async () => {
    const child = makeTrackedChild();
    child.exitCode = 23;
    await expect(childExitCode(child)).resolves.toBe(23);
  });
  test('bootstrap preserves staging when installer process-tree termination is unconfirmed', async () => {
    const root = await disposableDirectory('runtime-timeout-preserve');
    try {
      let caught: unknown;
      try {
        await bootstrapRuntime({
          platform: 'win32',
          runtimeDir: join(root, 'runtime'),
          manifestRoot: dshManifestRoot,
          commandRunner: async (_command, args) => {
            if (args[0] === 'ci') throw new ProcessTerminationError('installer descendants are still running');
            return { exitCode: 0, stdout: '', stderr: '' };
          }
        });
      } catch (error) {
        caught = error;
      }
      const entries = await readdir(root);
      expect(String(caught)).toContain('staging was preserved');
      expect(entries.some((entry) => entry.startsWith('.runtime.staging-'))).toBe(true);
      await expect(readFile(join(root, 'runtime', 'package.json'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
describe('RPG Maker MV project boundary', () => {
  test('accepts a project marker and data/js directories in a path with spaces and CJK', async () => {
    const root = await disposableDirectory('mv-project');
    try {
      const project = await makeMvProject(root);
      await expect(validateMvProject(project)).resolves.toMatchObject({ valid: true, projectPath: project });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('reports missing marker and required directories', async () => {
    const root = await disposableDirectory('invalid-mv-project');
    try {
      const result = await validateMvProject(root);
      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(['Game.rpgproject', 'data', 'js']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('staged DSH runtime bootstrap', () => {
  test('leaves a valid runtime unchanged on repeat bootstrap', async () => {
    const root = await disposableDirectory('runtime-idempotent');
    try {
      const runtime = join(root, 'runtime');
      await makeRuntime(runtime);
      const calls: string[][] = [];
      const result = await bootstrapRuntime({
        platform: 'win32',
        runtimeDir: runtime,
        manifestRoot: dshManifestRoot,
        commandRunner: async (_command, args) => {
          calls.push(args);
          return { exitCode: 0, stdout: 'koffi loaded', stderr: '' };
        }
      });
      expect(result.status).toBe('unchanged');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain('-e');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });


  test('requires the pinned DSH lock entry and npm integrity', async () => {
    const root = await disposableDirectory('runtime-integrity');
    try {
      const runtime = join(root, 'runtime');
      await makeRuntime(runtime);
      const commandRunner = async () => ({ exitCode: 0, stdout: 'koffi loaded', stderr: '' });
      expect((await verifyRuntime(runtime, { commandRunner })).valid).toBe(true);
      const lockPath = join(runtime, 'package-lock.json');
      const lock = await readFile(lockPath, 'utf8');
      await writeFile(lockPath, lock.replace(DSH_NPM_INTEGRITY, 'sha512-tampered'));
      const tampered = await verifyRuntime(runtime, { commandRunner });
      expect(tampered.valid).toBe(false);
      expect(tampered.errors.join(' ')).toContain('npm integrity');
      await rm(lockPath);
      const missing = await verifyRuntime(runtime, { commandRunner });
      expect(missing.valid).toBe(false);
      expect(missing.errors.join(' ')).toContain('package-lock.json');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('installs a fresh runtime when no active tree exists', async () => {
    const root = await disposableDirectory('runtime-fresh');
    try {
      const runtime = join(root, 'runtime');
      const calls: string[][] = [];
      const result = await bootstrapRuntime({
        platform: 'win32',
        runtimeDir: runtime,
        manifestRoot: dshManifestRoot,
        commandRunner: async (_command, args, options) => {
          calls.push(args);
          if (args[0] === 'ci') await makeRuntime(options.cwd!);
          return { exitCode: 0, stdout: '', stderr: '' };
        }
      });
      expect(result.status).toBe('installed');
      expect(result.rollbackDir).toBeUndefined();
      expect(calls[0]).toEqual(['ci', '--legacy-peer-deps', '--no-audit', '--no-fund']);
      expect(await readFile(join(runtime, 'package.json'), 'utf8')).toContain(DSH_VERSION);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('prefers the Windows generated DSH shim over the package JavaScript entry', async () => {
    const root = await disposableDirectory('runtime-shim');
    try {
      const runtime = join(root, 'runtime');
      await makeRuntime(runtime);
      const shim = join(runtime, 'node_modules', '.bin', 'dsh.cmd');
      await writeFile(shim, '@echo off\r\n');
      expect(await findDshExecutable(runtime, 'win32')).toBe(shim);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  test('builds in staging, swaps atomically, and retains the prior runtime', async () => {
    const root = await disposableDirectory('runtime-repair');
    try {
      const runtime = join(root, 'runtime');
      await makeRuntime(runtime, '0.1.0-rc.5');
      const oldPackage = await readFile(join(runtime, 'package.json'), 'utf8');
      const calls: Array<{ args: string[]; cwd?: string }> = [];
      const result = await bootstrapRuntime({
        platform: 'win32',
        runtimeDir: runtime,
        manifestRoot: dshManifestRoot,
        commandRunner: async (_command, args, options) => {
          calls.push({ args, cwd: options.cwd });
          if (args[0] === 'ci') {
            await makeRuntime(options.cwd!);
          }
          return { exitCode: 0, stdout: '', stderr: '' };
        }
      });
      expect(result.status).toBe('repaired');
      expect(result.rollbackDir).toBeString();
      expect(await readFile(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).toContain(DSH_VERSION);
      expect(await readFile(join(result.rollbackDir!, 'package.json'), 'utf8')).toBe(oldPackage);
      expect(calls.map((call) => call.args.slice(0, 2))).toEqual([
        ['ci', '--legacy-peer-deps'],
        ['-e', "import('koffi').then(() => process.exit(0)).catch(() => process.exit(1))"],
        ['-e', "import('koffi').then(() => process.exit(0)).catch(() => process.exit(1))"]
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });


  test('failed bootstrap diagnostics redact the credential value', async () => {
    const root = await disposableDirectory('runtime-secret');
    try {
      const secret = 'fake-key-never-log-this';
      let caught: unknown;
      try {
        await bootstrapRuntime({
          platform: 'win32',
          runtimeDir: join(root, 'runtime'),
          manifestRoot: dshManifestRoot,
          env: { DEEPSEEK_API_KEY: secret },
          commandRunner: async (_command, args) => {
            if (args[0] === 'ci') return { exitCode: 1, stdout: '', stderr: `install failed for ${secret}` };
            return { exitCode: 0, stdout: '', stderr: '' };
          }
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeDefined();
      expect(String(caught)).not.toContain(secret);
      expect(String(caught)).toContain('[redacted]');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });


  test('restores the previous runtime if post-swap verification fails', async () => {
    const root = await disposableDirectory('runtime-post-swap');
    try {
      const runtime = join(root, 'runtime');
      await makeRuntime(runtime, '0.1.0-rc.5');
      const oldPackage = await readFile(join(runtime, 'package.json'), 'utf8');
      let evalCalls = 0;
      await expect(
        bootstrapRuntime({
          platform: 'win32',
          runtimeDir: runtime,
          manifestRoot: dshManifestRoot,
          commandRunner: async (_command, args, options) => {
            if (args[0] === 'ci') await makeRuntime(options.cwd!);
            if (args[0] === '-e') {
              evalCalls += 1;
              return { exitCode: evalCalls === 1 ? 0 : 1, stdout: '', stderr: '' };
            }
            return { exitCode: 0, stdout: '', stderr: '' };
          }
        })
      ).rejects.toThrow(/prior runtime was restored/i);
      expect(await readFile(join(runtime, 'package.json'), 'utf8')).toBe(oldPackage);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('reports degraded state and preserves paths when rollback restoration fails', async () => {
    const root = await disposableDirectory('runtime-degraded');
    try {
      const runtime = join(root, 'runtime');
      await makeRuntime(runtime, '0.1.0-rc.5');
      let renameCalls = 0;
      let caught: unknown;
      try {
        await bootstrapRuntime({
          platform: 'win32',
          runtimeDir: runtime,
          manifestRoot: dshManifestRoot,
          renamePath: async (from, to) => {
            renameCalls += 1;
            if (renameCalls === 2 || renameCalls === 3) throw new Error(`injected rename failure ${renameCalls}`);
            await rename(from, to);
          },
          commandRunner: async (_command, args, options) => {
            if (args[0] === 'ci') await makeRuntime(options.cwd!);
            return { exitCode: 0, stdout: '', stderr: '' };
          }
        });
      } catch (error) {
        caught = error;
      }
      const entries = await readdir(root);
      expect(String(caught)).toContain('DEGRADED');
      expect(String(caught)).toContain('active runtime is missing');
      expect(String(caught)).not.toContain('current runtime was not changed');
      expect(renameCalls).toBe(3);
      expect(entries.some((entry) => entry.startsWith('runtime.rollback-'))).toBe(true);
      expect(entries.some((entry) => entry.startsWith('.runtime.staging-'))).toBe(true);
      await expect(readFile(join(runtime, 'package.json'), 'utf8')).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  test('keeps the current runtime usable when staged verification fails', async () => {
    const root = await disposableDirectory('runtime-rollback');
    try {
      const runtime = join(root, 'runtime');
      await makeRuntime(runtime, '0.1.0-rc.5');
      const oldPackage = await readFile(join(runtime, 'package.json'), 'utf8');
      await expect(
        bootstrapRuntime({
          platform: 'win32',
          runtimeDir: runtime,
          manifestRoot: dshManifestRoot,
          commandRunner: async (_command, args, options) => {
            if (args[0] === 'ci') await makeRuntime(options.cwd!);
            if (args[0] === '-e') return { exitCode: 1, stdout: '', stderr: 'koffi failed' };
            return { exitCode: 0, stdout: '', stderr: '' };
          }
        })
      ).rejects.toThrow(/current runtime was not changed/i);
      expect(await readFile(join(runtime, 'package.json'), 'utf8')).toBe(oldPackage);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});


describe('runtime access lock', () => {

  test('reclaims a stale session lock whose owner process is gone', async () => {
    const root = await disposableDirectory('runtime-stale-lock');
    try {
      const runtime = join(root, 'runtime');
      const dshHome = join(root, 'dsh-home');
      await makeRuntime(runtime, '0.1.0-rc.5');
      const sessionLeaseDir = `${runtime}.session`;
      await mkdir(sessionLeaseDir, { recursive: true });
      // A dead owner (pid 999999) records the lock but cannot release it.
      await writeFile(join(sessionLeaseDir, 'owner.json'), `${JSON.stringify({ pid: 999999, token: 'stale', startedAt: new Date().toISOString() })}\n`);

      const result = await bootstrapRuntime({
        platform: 'win32',
        runtimeDir: runtime,
        dshHome,
        manifestRoot: dshManifestRoot,
        lockTimeoutMs: 500,
        lockRetryMs: 5,
        commandRunner: async (_command, args, options) => {
          if (args[0] === 'ci') await makeRuntime(options.cwd!);
          return { exitCode: 0, stdout: '', stderr: '' };
        }
      });
      expect(result.status).toBe('repaired');
      await expect(stat(sessionLeaseDir)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('serializes concurrent contenders while reclaiming one stale lock', async () => {
    const root = await disposableDirectory('runtime-concurrent-stale-lock');
    const lockPath = join(root, 'runtime.lock');
    try {
      await mkdir(lockPath);
      await writeFile(join(lockPath, 'owner.json'), `${JSON.stringify({ pid: 999999, token: 'stale' })}\n`);
      let activeOwners = 0;
      let maximumOwners = 0;

      await Promise.all(Array.from({ length: 8 }, async () => {
        const lock = await acquireHarnessLock(lockPath, { timeoutMs: 2_000, retryMs: 1 });
        activeOwners += 1;
        maximumOwners = Math.max(maximumOwners, activeOwners);
        await new Promise((resolve) => setTimeout(resolve, 2));
        activeOwners -= 1;
        await lock.release();
      }));

      expect(maximumOwners).toBe(1);
      await expect(stat(lockPath)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('an interrupted stale-lock tombstone does not block a new owner', async () => {
    const root = await disposableDirectory('runtime-interrupted-reclaim');
    const lockPath = join(root, 'runtime.lock');
    try {
      const tombstonePath = `${lockPath}.stale-interrupted`;
      await mkdir(tombstonePath);
      await writeFile(join(tombstonePath, 'owner.json'), `${JSON.stringify({ pid: 999999, token: 'stale' })}\n`);

      const lock = await acquireHarnessLock(lockPath, { timeoutMs: 500, retryMs: 1 });
      expect(lock.path).toBe(lockPath);
      await lock.release();
      expect(await stat(tombstonePath)).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('launch failure releases the session lease so bootstrap can recover', async () => {
    const root = await disposableDirectory('runtime-session-failure');
    try {
      const runtime = join(root, 'runtime');
      const dshHome = join(root, 'dsh-home');
      const node = join(root, 'node.exe');
      await writeFile(node, 'fixture');
      await makeRuntime(runtime, '0.1.0-rc.5');
      await expect(
        launchProject({
          platform: 'win32',
          runtimeDir: runtime,
          dshHome,
          nodeExecutable: node,
          env: { DSH_HOME: dshHome },
          spawnInteractive: () => { throw new Error('spawn failed'); }
        })
      ).rejects.toThrow(/spawn failed/i);

      const result = await bootstrapRuntime({
        platform: 'win32',
        runtimeDir: runtime,
        dshHome,
        manifestRoot: dshManifestRoot,
        lockTimeoutMs: 500,
        lockRetryMs: 5,
        commandRunner: async (_command, args, options) => {
          if (args[0] === 'ci') await makeRuntime(options.cwd!);
          return { exitCode: 0, stdout: '', stderr: '' };
        }
      });
      expect(result.status).toBe('repaired');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('launcher waits while bootstrap owns the swap transaction', async () => {
    const root = await disposableDirectory('runtime-lock');
    try {
      const runtime = join(root, 'runtime');
      const dshHome = join(root, 'dsh-home');
      const bin = join(root, 'bin');
      await mkdir(bin, { recursive: true });
      for (const name of ['node', 'pwsh', 'coreutils-manager', 'find', 'grep', 'git']) await writeFile(join(bin, name), '');

      let signalBootstrapHold: (() => void) | undefined;
      let releaseBootstrapHold: (() => void) | undefined;
      const bootstrapHoldStarted = new Promise<void>((resolve) => { signalBootstrapHold = resolve; });
      const bootstrapHold = new Promise<void>((resolve) => { releaseBootstrapHold = resolve; });
      const commandRunner = async (command: string, args: string[], options: { cwd?: string }) => {
        if (args[0] === 'ci') {
          await makeRuntime(options.cwd!);
          signalBootstrapHold?.();
          await bootstrapHold;
          return { exitCode: 0, stdout: '', stderr: '' };
        }
        if (args[0] === '-e') return { exitCode: 0, stdout: 'loaded', stderr: '' };
        const name = command.split(/[\\/]/).pop();
        if (name === 'pwsh') return { exitCode: 0, stdout: 'PowerShell 7.4.6', stderr: '' };
        if (name === 'git') return { exitCode: 0, stdout: 'git version 2.45.0', stderr: '' };
        if (name === 'coreutils-manager' && args[0] === '--help') return { exitCode: 0, stdout: "coreutils-manager 0.1.0\nManage coreutils utilities and PowerShell profiles\nUsage: coreutils-manager <COMMAND>\nCommands:\n  enable    Enable one or more utilities\n  disable   Disable one or more utilities\n  status    List all utilities with their status\n", stderr: '' };
        if (name === 'coreutils-manager' && args[0] === 'status') return { exitCode: 0, stdout: "find            enabled\ngrep            enabled\n", stderr: '' };
        if (name === 'find' || name === 'grep') return { exitCode: 0, stdout: `${name} 0.1.0`, stderr: '' };
        return { exitCode: 0, stdout: '', stderr: '' };
      };

      const installing = bootstrapRuntime({
        platform: 'win32',
        runtimeDir: runtime,
        dshHome,
        env: { PATH: bin, DSH_HOME: dshHome },
        manifestRoot: dshManifestRoot,
        commandRunner,
        lockTimeoutMs: 1000,
        lockRetryMs: 5
      });
      await bootstrapHoldStarted;

      let launched = false;
      const launchChild = makeTrackedChild(99);
      const launch = launchProject({
        platform: 'win32',
        runtimeDir: runtime,
        dshHome,
        env: { PATH: bin, DSH_HOME: dshHome },
        commandRunner,
        spawnInteractive: () => { launched = true; return launchChild; },
        lockTimeoutMs: 1000,
        lockRetryMs: 5
      });

      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(launched).toBe(false);
      releaseBootstrapHold?.();

      await installing;
      const launchResult = await launch;
      expect(launched).toBe(true);
      launchChild.exitCode = 0;
      launchChild.emit('exit', 0);
      await launchResult.releaseSession();
      expect(await readFile(join(runtime, 'package.json'), 'utf8')).toContain(DSH_VERSION);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  test('bootstrap waits for a live DSH session and swaps after child exit', async () => {
    const root = await disposableDirectory('runtime-session-lease');
    try {
      const runtime = join(root, 'runtime');
      const dshHome = join(root, 'dsh-home');
      const node = join(root, 'node.exe');
      await writeFile(node, 'fixture');
      await makeRuntime(runtime, '0.1.0-rc.5');
      const child = makeTrackedChild(701);
      const launch = await launchProject({
        platform: 'win32',
        runtimeDir: runtime,
        dshHome,
        nodeExecutable: node,
        env: { DSH_HOME: dshHome },
        spawnInteractive: () => child
      });

      let swapStarted = false;
      const installing = bootstrapRuntime({
        platform: 'win32',
        runtimeDir: runtime,
        dshHome,
        manifestRoot: dshManifestRoot,
        lockTimeoutMs: 1000,
        lockRetryMs: 5,
        commandRunner: async (_command, args, options) => {
          if (args[0] === 'ci') {
            swapStarted = true;
            await makeRuntime(options.cwd!);
          }
          return { exitCode: 0, stdout: '', stderr: '' };
        }
      });

      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(swapStarted).toBe(false);
      expect(await readFile(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).toContain('0.1.0-rc.5');

      child.exitCode = 0;
      child.emit('exit', 0);
      await launch.releaseSession();
      const result = await installing;
      expect(result.status).toBe('repaired');
      expect(await readFile(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).toContain(DSH_VERSION);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
describe('doctor and launcher seams', () => {
  test('project-neutral launcher uses the app-owned landing cwd without project validation', async () => {
    const root = await disposableDirectory('launcher');
    try {
      const dsh = join(root, 'dsh.exe');
      await writeFile(dsh, '');
      let launched: { command: string; args: string[]; cwd?: string; env?: Record<string, string | undefined> } | undefined;
      const child = makeTrackedChild();
      const result = await launchProject({
        platform: 'win32',
        dshHome: join(root, 'dsh-home'),
        dshExecutable: dsh,
        env: {},
        dshArgs: ['--test'],
        spawnInteractive: (command, args, options) => {
          launched = { command, args, cwd: options.cwd, env: options.env };
          return child;
        }
      });
      const neutral = join(root, 'program', 'neutral');
      expect(result.cwd).toBe(neutral);
      expect(launched).toMatchObject({ command: dsh, args: ['--test'], cwd: neutral });
      expect(launched!.env?.DSH_HOME).toBe(join(root, 'dsh-home'));
      expect(result.onboardingMessage).toBeDefined();
      child.exitCode = 0;
      child.emit('exit', 0);
      await result.releaseSession();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('CLI rejects project and preset selection and prints the single-writer contract for a neutral launch', async () => {
    const root = await disposableDirectory('cli-launch');
    try {
      const project = await makeMvProject(root);
      const dsh = join(root, 'dsh.exe');
      await writeFile(dsh, '');
      let output = '';
      let errorOutput = '';
      const rejected = await runCli(['launch', '--project', project, '--dsh-executable', dsh, '--dsh-home', join(root, 'dsh-home')], {
        platform: 'win32',
        env: {},
        rpgmaker: false,
        io: { stdout: { write: (text) => { output += text; } }, stderr: { write: (text) => { errorOutput += text; } } }
      });
      expect(rejected).toBe(1);
      expect(errorOutput).toMatch(/project-neutral.*does not accept --project/i);
      errorOutput = '';
      const rejectedPreset = await runCli(['launch', '--preset', 'game-design', '--dsh-executable', dsh, '--dsh-home', join(root, 'dsh-home')], {
        platform: 'win32',
        env: {},
        rpgmaker: false,
        io: { stdout: { write: () => undefined }, stderr: { write: (text) => { errorOutput += text; } } }
      });
      expect(rejectedPreset).toBe(1);
      expect(errorOutput).toMatch(/single default rpgmaker.*does not accept --preset/i);
      const code = await runCli(['launch', '--dsh-executable', dsh, '--dsh-home', join(root, 'dsh-home')], {
        platform: 'win32',
        env: {},
        rpgmaker: false,
        io: { stdout: { write: (text) => { output += text; } }, stderr: { write: () => undefined } },
        spawnInteractive: () => {
          const child = makeTrackedChild();
          setTimeout(() => { child.exitCode = 0; child.emit('exit', 0); }, 0);
          return child;
        }
      });
      expect(code).toBe(0);
      expect(output).toContain('its RPG Maker tools are the sole writers');
      expect(output).toContain('read-only');
      expect(output).toContain('neutral landing directory');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('CLI rejects Release ZIP commands outside Windows', async () => {
    let stdout = '';
    let stderr = '';
    const code = await runCli(['release-zip'], {
      platform: 'linux',
      io: {
        stdout: { write: (text) => { stdout += text; } },
        stderr: { write: (text) => { stderr += text; } }
      }
    });
    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('supported on Windows only');
  });

  test('redirected stdout automatically selects plain installation events and reports capacity', async () => {
    const root = await disposableDirectory('cli-redirected-install');
    try {
      const release = join(root, 'release');
      const installation = join(root, 'installation');
      const localState = join(root, 'local-state');
      await mkdir(release, { recursive: true });
      let stdout = '';
      let stderr = '';
      const code = await runCli([
        'install',
        '--release-root', release,
        '--installation-root', installation,
        '--local-state-root', localState
      ], {
        platform: 'win32',
        env: { LOCALAPPDATA: join(root, 'LocalAppData'), TEMP: root, TMP: root },
        io: {
          stdout: { isTTY: false, write: (text) => { stdout += text; } },
          stderr: { isTTY: false, write: (text) => { stderr += text; } }
        },
        commandRunner: async () => ({ exitCode: 0, stdout: '', stderr: '' })
      });
      expect(code).toBe(1);
      expect(stdout).toMatch(/PHASE 1\/8 destination started/);
      expect(stdout).toMatch(/estimated capacity: .* bytes required/);
      expect(stdout).not.toContain('\u001b');
      expect(stderr).toMatch(/prerequisite|WinGet|Node/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('compiled installer defaults its release root beside the executable', () => {
    const executable = join('/tmp', 'release build', 'installer.exe');
    expect(installerArguments([], executable)).toEqual(['install', '--release-root', join('/tmp', 'release build')]);
    expect(installerArguments(['doctor'], executable)).toEqual(['doctor']);
  });

  test('rejects the removed direct program-root CLI seam', async () => {
    let stderr = '';
    const code = await runCli(['install', '--program-root', '/tmp/legacy-program-root'], {
      platform: 'win32',
      io: { stdout: { write: () => undefined }, stderr: { write: (text) => { stderr += text; } } }
    });
    expect(code).toBe(1);
    expect(stderr).toMatch(/program-root was removed/i);
  });

  test('timing records keep product and runtime versions distinct', async () => {
    expect(PRODUCT_VERSION).not.toBe(DSH_VERSION);
  });

  test('Windows .cmd DSH shims are invoked through cmd.exe without using the project path as command text', () => {
    const command = String.raw`C:\Program Files\DSH\dsh.cmd`;
    const invocation = prepareProcessInvocation(command, ['--version'], 'win32', { ComSpec: String.raw`C:\Windows\System32\cmd.exe` });
    expect(invocation.command).toBe(String.raw`C:\Windows\System32\cmd.exe`);
    expect(invocation.args.slice(0, 4)).toEqual(['/d', '/v:off', '/s', '/c']);
    expect(invocation.args[4]).toBe(`""${command}" --version"`);
    expect(invocation.args[4]).not.toContain('Game 游戏');
  });
  test('Windows .cmd argv preserves percent and exclamation characters at the cmd boundary', () => {
    const command = String.raw`C:\Program Files\DSH\dsh.cmd`;
    const userPath = 'C:\\Users\\tester\\100%\\!important!\\选择 project';
    const invocation = prepareProcessInvocation(command, ['--project', userPath], 'win32', { ComSpec: String.raw`C:\Windows\System32\cmd.exe` });
    expect(invocation.args.slice(0, 4)).toEqual(['/d', '/v:off', '/s', '/c']);
    expect(invocation.args[4]).toContain('100^%\\!important!\\选择 project');
    expect(invocation.args[4]).not.toContain('call ');
  });
});
