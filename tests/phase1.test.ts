import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { bootstrapRuntime, findDshExecutable } from '../src/bootstrap';
import { runDoctor } from '../src/doctor';
import { launchProject, pickProjectDirectory } from '../src/launcher';
import { runCli } from '../src/cli';
import { prepareProcessInvocation } from '../src/process';
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

async function makeRuntime(runtime: string, version = '0.1.0-rc.6'): Promise<void> {
  await mkdir(join(runtime, 'node_modules', '@deepseek-ai', 'dsh'), { recursive: true });
  await mkdir(join(runtime, 'node_modules', 'koffi'), { recursive: true });
  await mkdir(join(runtime, 'node_modules', '.bin'), { recursive: true });
  await writeFile(
    join(runtime, 'package.json'),
    JSON.stringify({
      name: 'dsh-rpgmaker-runtime',
      private: true,
      dependencies: { '@deepseek-ai/dsh': version }
    })
  );
  await writeFile(
    join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/dsh', version, bin: { dsh: 'bin/dsh.js' } })
  );
  await mkdir(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'bin'), { recursive: true });
  await writeFile(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'bin', 'dsh.js'), '#!/usr/bin/env bun\n');
  await writeFile(join(runtime, 'node_modules', 'koffi', 'package.json'), JSON.stringify({ name: 'koffi', version: '2.12.0' }));
  await writeFile(join(runtime, 'node_modules', '.bin', 'dsh'), '#!/usr/bin/env bun\n');
}

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
        runtimeDir: runtime,
        bunExecutable: 'bun',
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


  test('installs a fresh runtime when no active tree exists', async () => {
    const root = await disposableDirectory('runtime-fresh');
    try {
      const runtime = join(root, 'runtime');
      const calls: string[][] = [];
      const result = await bootstrapRuntime({
        runtimeDir: runtime,
        bunExecutable: 'bun',
        commandRunner: async (_command, args, options) => {
          calls.push(args);
          if (args[0] === 'add') await makeRuntime(options.cwd!);
          return { exitCode: 0, stdout: '', stderr: '' };
        }
      });
      expect(result.status).toBe('installed');
      expect(result.rollbackDir).toBeUndefined();
      expect(calls[0]).toEqual(['add', '--exact', '@deepseek-ai/dsh@0.1.0-rc.6']);
      expect(await readFile(join(runtime, 'package.json'), 'utf8')).toContain('0.1.0-rc.6');
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
        runtimeDir: runtime,
        bunExecutable: 'bun',
        commandRunner: async (_command, args, options) => {
          calls.push({ args, cwd: options.cwd });
          if (args[0] === 'add') {
            await makeRuntime(options.cwd!);
          }
          return { exitCode: 0, stdout: '', stderr: '' };
        }
      });
      expect(result.status).toBe('repaired');
      expect(result.rollbackDir).toBeString();
      expect(await readFile(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).toContain('0.1.0-rc.6');
      expect(await readFile(join(result.rollbackDir!, 'package.json'), 'utf8')).toBe(oldPackage);
      expect(calls.map((call) => call.args.slice(0, 2))).toEqual([
        ['add', '--exact'],
        ['pm', 'trust'],
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
          runtimeDir: join(root, 'runtime'),
          bunExecutable: 'bun',
          env: { DEEPSEEK_API_KEY: secret },
          commandRunner: async (_command, args) => {
            if (args[0] === 'add') return { exitCode: 1, stdout: '', stderr: `install failed for ${secret}` };
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
          runtimeDir: runtime,
          bunExecutable: 'bun',
          commandRunner: async (_command, args, options) => {
            if (args[0] === 'add') await makeRuntime(options.cwd!);
            if (args[0] === '-e') {
              evalCalls += 1;
              return { exitCode: evalCalls === 1 ? 0 : 1, stdout: '', stderr: '' };
            }
            return { exitCode: 0, stdout: '', stderr: '' };
          }
        })
      ).rejects.toThrow(/current runtime was restored/i);
      expect(await readFile(join(runtime, 'package.json'), 'utf8')).toBe(oldPackage);
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
          runtimeDir: runtime,
          bunExecutable: 'bun',
          commandRunner: async (_command, args, options) => {
            if (args[0] === 'add') await makeRuntime(options.cwd!);
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

describe('doctor and launcher seams', () => {
  test('doctor reports prerequisites and never echoes the credential value', async () => {
    const root = await disposableDirectory('doctor');
    try {
      const bin = join(root, 'bin');
      await mkdir(bin, { recursive: true });
      for (const name of ['pwsh', 'coreutils-manager', 'find', 'grep', 'git', 'bun']) {
        await writeFile(join(bin, name), '');
      }
      const runtime = join(root, 'runtime');
      await makeRuntime(runtime);
      const dshHome = join(root, 'dsh-home');
      await mkdir(dshHome, { recursive: true });
      await writeFile(join(dshHome, '.credentials.yaml'), 'provider: local\n');
      const secret = 'test-secret-must-not-appear';
      const report = await runDoctor({
        platform: 'darwin',
        env: { PATH: bin, DSH_HOME: dshHome, DEEPSEEK_API_KEY: secret },
        runtimeDir: runtime,
        commandRunner: async (command, args) => {
          const name = command.split(/[\\/]/).pop();
          if (name === 'pwsh') return { exitCode: 0, stdout: 'PowerShell 7.4.6', stderr: '' };
          if (name === 'bun') return { exitCode: 0, stdout: '1.3.14', stderr: '' };
          if (name === 'git') return { exitCode: 0, stdout: 'git version 2.45.0', stderr: '' };
          if (name === 'coreutils-manager') return { exitCode: 0, stdout: 'Microsoft Coreutils 0.1.0', stderr: '' };
          if (name === 'find') return { exitCode: 0, stdout: 'find (Microsoft Coreutils) 0.1.0', stderr: '' };
          if (name === 'grep') return { exitCode: 0, stdout: 'grep (Microsoft Coreutils) 0.1.0', stderr: '' };
          if (args[0] === '-e') return { exitCode: 0, stdout: 'loaded', stderr: '' };
          return { exitCode: 0, stdout: '', stderr: '' };
        }
      });
      expect(report.ok).toBe(true);
      expect(report.credentials.configured).toBe(true);
      expect(JSON.stringify(report)).not.toContain(secret);
      expect(report.checks.map((check) => check.id)).toEqual(expect.arrayContaining(['powershell', 'coreutils', 'git', 'bun', 'dsh-runtime', 'credentials']));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('launcher validates the selected project and passes it as cwd without a shell', async () => {
    const root = await disposableDirectory('launcher');
    try {
      const project = await makeMvProject(root);
      const dsh = join(root, 'dsh.exe');
      await writeFile(dsh, '');
      let launched: { command: string; args: string[]; cwd?: string; env?: Record<string, string | undefined> } | undefined;
      const result = await launchProject({
        platform: 'win32',
        projectPath: project,
        dshHome: join(root, 'dsh-home'),
        dshExecutable: dsh,
        env: {},
        dshArgs: ['--test'],
        spawnInteractive: (command, args, options) => {
          launched = { command, args, cwd: options.cwd, env: options.env };
          return { pid: 1234 };
        }
      });
      expect(result.projectPath).toBe(project);
      expect(launched).toMatchObject({ command: dsh, args: ['--test'], cwd: project });
      expect(launched!.env?.DSH_HOME).toBe(join(root, 'dsh-home'));
      expect(result.onboardingMessage).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });


  test('native Windows picker returns the selected path without shell interpolation', async () => {
    const root = await disposableDirectory('picker');
    try {
      const selected = join(root, '选择 project with spaces');
      const result = await pickProjectDirectory({
        platform: 'win32',
        env: {},
        pwshExecutable: 'pwsh.exe',
        commandRunner: async (_command, args) => {
          expect(args).toContain('-Command');
          expect(args.join(' ')).not.toContain(selected);
          return { exitCode: 0, stdout: `${selected}\r\n`, stderr: '' };
        }
      });
      expect(result).toBe(selected);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('CLI always prints the single-writer contract before launching', async () => {
    const root = await disposableDirectory('cli-launch');
    try {
      const project = await makeMvProject(root);
      const dsh = join(root, 'dsh.exe');
      await writeFile(dsh, '');
      let output = '';
      const code = await runCli(['launch', '--project', project, '--dsh-executable', dsh, '--dsh-home', join(root, 'dsh-home')], {
        platform: 'win32',
        env: {},
        io: { stdout: { write: (text) => { output += text; } }, stderr: { write: () => undefined } },
        spawnInteractive: () => ({ pid: 1234 })
      });
      expect(code).toBe(0);
      expect(output).toContain('The agent and RPG Maker MCP are the sole writers');
      expect(output).toContain('read-only');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });


  test('Windows .cmd DSH shims are invoked through cmd.exe without using the project path as command text', () => {
    const command = String.raw`C:\Program Files\DSH\dsh.cmd`;
    const invocation = prepareProcessInvocation(command, ['--version'], 'win32', { ComSpec: String.raw`C:\Windows\System32\cmd.exe` });
    expect(invocation.command).toBe(String.raw`C:\Windows\System32\cmd.exe`);
    expect(invocation.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(invocation.args[3]).toContain(`call "${command}" --version`);
    expect(invocation.args[3]).not.toContain('Game 游戏');
  });
  test('launcher rejects an invalid selected project before starting DSH', async () => {
    const root = await disposableDirectory('launcher-invalid');
    try {
      await expect(
        launchProject({
          platform: 'win32',
          projectPath: root,
          dshExecutable: join(root, 'dsh.exe'),
          spawnInteractive: () => ({ pid: 1234 })
        })
      ).rejects.toThrow(/not a valid RPG Maker MV project/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
