import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';

import { DSH_NPM_INTEGRITY, DSH_PACKAGE_NAME, DSH_VERSION, resolveHarnessPaths } from '../src/config';
import { buildReleaseZip, inspectReleaseZip, installWindowsRelease } from '../src/release-gate';
import { PrerequisiteConsentError, verifyWindowsPrerequisites } from '../src/prerequisites';
import { launchProject } from '../src/launcher';
import { runDoctor } from '../src/doctor';
import { ensureFixedPortAvailable, ExistingDshSessionError, ensureHarnessLayout, recordRecentProject, readRecentProjects, uninstallHarness } from '../src/windows';

async function temp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

async function project(root: string): Promise<string> {
  const path = join(root, '选择 project with spaces');
  await mkdir(join(path, 'data'), { recursive: true });
  await mkdir(join(path, 'js'), { recursive: true });
  await writeFile(join(path, 'Game.rpgproject'), '{}\n');
  return path;
}

async function dshRuntime(runtime: string): Promise<void> {
  await mkdir(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib'), { recursive: true });
  await mkdir(join(runtime, 'node_modules', 'koffi'), { recursive: true });
  await mkdir(join(runtime, 'node_modules', '.bin'), { recursive: true });
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ dependencies: { [DSH_PACKAGE_NAME]: DSH_VERSION } }));
  await writeFile(join(runtime, 'bun.lock'), JSON.stringify({
    workspaces: { '': { dependencies: { [DSH_PACKAGE_NAME]: DSH_VERSION } } },
    packages: { [DSH_PACKAGE_NAME]: [`${DSH_PACKAGE_NAME}@${DSH_VERSION}`, '', {}, DSH_NPM_INTEGRITY] }
  }));
  await writeFile(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({ version: DSH_VERSION, bin: { dsh: 'lib/bin.js' } }));
  await writeFile(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), 'fixture');
  await writeFile(join(runtime, 'node_modules', '.bin', 'dsh.cmd'), '@echo off\r\n');
  await writeFile(join(runtime, 'node_modules', 'koffi', 'package.json'), JSON.stringify({ version: '2.12.0' }));
}

function child(): EventEmitter & { exitCode: number | null; signalCode: string | null } {
  const value = new EventEmitter() as EventEmitter & { exitCode: number | null; signalCode: string | null };
  value.exitCode = null;
  value.signalCode = null;
  return value;
}

async function prerequisiteBin(root: string): Promise<{ bin: string; env: Record<string, string> }> {
  const bin = join(root, 'fake prerequisite bin');
  await mkdir(bin, { recursive: true });
  for (const name of ['node.exe', 'npm.cmd', 'bun.exe', 'pwsh.exe', 'git.exe', 'coreutils-manager.exe', 'find.exe', 'grep.exe']) await writeFile(join(bin, name), 'fixture');
  return { bin, env: { PATH: bin, LOCALAPPDATA: join(root, 'Local AppData'), APPDATA: join(root, 'Roaming AppData') } };
}

function prerequisiteRunner() {
  return async (command: string, args: string[], options: { cwd?: string }) => {
    const name = basename(command).toLowerCase();
    if (args[0] === 'add') {
      await dshRuntime(options.cwd!);
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'pm') return { exitCode: 0, stdout: '', stderr: '' };
    if (args[0] === '-e') return { exitCode: 0, stdout: 'loaded', stderr: '' };
    if (name === 'node.exe') return { exitCode: 0, stdout: 'v20.18.0', stderr: '' };
    if (name === 'npm.cmd') return { exitCode: 0, stdout: '10.8.2', stderr: '' };
    if (name === 'bun.exe') return { exitCode: 0, stdout: '1.3.14', stderr: '' };
    if (name === 'pwsh.exe') return { exitCode: 0, stdout: 'PowerShell 7.4.6', stderr: '' };
    if (name === 'git.exe') return { exitCode: 0, stdout: 'git version 2.45.0', stderr: '' };
    if (name === 'coreutils-manager.exe' && args[0] === '--help') return { exitCode: 0, stdout: 'Manage coreutils utilities and PowerShell profiles\n enable\n disable\n status\n', stderr: '' };
    if (name === 'coreutils-manager.exe' && args[0] === 'status') return { exitCode: 0, stdout: 'find enabled\ngrep enabled\n', stderr: '' };
    return { exitCode: 0, stdout: `${name} 0.1.0`, stderr: '' };
  };
}

describe('Windows release gate foundations', () => {
  test('resolves the branded program/mutable roots and state layout without using a live profile', async () => {
    const root = await temp('phase7-paths');
    try {
      const paths = resolveHarnessPaths({ platform: 'win32', env: { LOCALAPPDATA: root, APPDATA: join(root, 'appdata') } });
      expect(paths.programRoot).toBe(resolve(root, 'Programs', 'BaiheStudio', 'DSH-RPGMaker-MV'));
      expect(paths.mutableRoot).toBe(resolve(root, 'BaiheStudio', 'DSH-RPGMaker-MV'));
      expect(paths.dshHome).toBe(join(paths.mutableRoot, 'state'));
      expect(paths.logsDir).toBe(join(paths.mutableRoot, 'logs'));
      expect(paths.cacheDir).toBe(join(paths.mutableRoot, 'cache'));
      expect(paths.recentProjectsPath).toBe(join(paths.mutableRoot, 'recent-projects.json'));
      expect(paths.startMenuShortcutPath).toContain(join('BaiheStudio', 'DSH for RPG Maker MV.lnk'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('requires explicit consent before WinGet prerequisite installation and verifies all five identities', async () => {
    const root = await temp('phase7-prerequisites');
    try {
      const { bin, env } = await prerequisiteBin(root);
      const report = await verifyWindowsPrerequisites({ platform: 'win32', env, commandRunner: prerequisiteRunner() });
      expect(report.ok).toBe(true);
      expect(report.checks.map((check) => check.id)).toEqual(['node', 'bun', 'powershell', 'git', 'coreutils']);
      const missing = await verifyWindowsPrerequisites({ platform: 'win32', env: { PATH: join(root, 'missing') }, commandRunner: prerequisiteRunner() });
      expect(missing.ok).toBe(false);
      await expect((await import('../src/prerequisites')).installWindowsPrerequisites({ platform: 'win32', env: { PATH: join(root, 'missing') }, consent: false, commandRunner: prerequisiteRunner() })).rejects.toBeInstanceOf(PrerequisiteConsentError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('doctor includes Node/npm and the installed mutable layout without exposing credentials', async () => {
    const root = await temp('phase7-doctor');
    try {
      const { env } = await prerequisiteBin(root);
      const mutableRoot = join(root, 'mutable');
      const dshHome = join(mutableRoot, 'state');
      const programRoot = join(root, 'program');
      const runtime = join(programRoot, 'runtime', 'dsh');
      await dshRuntime(runtime);
      await ensureHarnessLayout({ platform: 'win32', env, mutableRoot, dshHome, programRoot, runtimeDir: runtime });
      await writeFile(join(dshHome, '.credentials.yaml'), 'provider: local\n');
      const report = await runDoctor({ platform: 'win32', env: { ...env, DEEPSEEK_API_KEY: 'never-report' }, mutableRoot, dshHome, programRoot, runtimeDir: runtime, commandRunner: prerequisiteRunner() });
      expect(report.ok).toBe(true);
      expect(report.checks.map((check) => check.id)).toContain('node');
      expect(report.checks.map((check) => check.id)).toContain('app-layout');
      expect(JSON.stringify(report)).not.toContain('never-report');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('installs from release source into program files, creates mutable state and shortcut, and keeps credentials out of metadata', async () => {
    const root = await temp('phase7-install');
    try {
      const { env } = await prerequisiteBin(root);
      const mutable = join(root, 'mutable');
      const program = join(root, 'Programs', 'BaiheStudio', 'DSH-RPGMaker-MV');
      const state = join(mutable, 'state');
      await mkdir(state, { recursive: true });
      await writeFile(join(state, '.credentials.yaml'), 'provider: local\n');
      const result = await installWindowsRelease({
        platform: 'win32',
        env: { ...env, DEEPSEEK_API_KEY: 'must-not-be-written' },
        releaseRoot: process.cwd(),
        programRoot: program,
        mutableRoot: mutable,
        dshHome: state,
        commandRunner: prerequisiteRunner(),
        consent: true,
        createShortcut: async (options) => {
          await mkdir(resolve(options.targetPath, '..'), { recursive: true });
          await writeFile(options.targetPath + '.shortcut-test', options.targetPath);
          return resolve(options.targetPath, '..', 'DSH for RPG Maker MV.lnk');
        }
      });
      expect(result.paths.programRoot).toBe(program);
      expect(await Bun.file(join(program, 'Install.cmd')).exists()).toBe(true);
      expect(await Bun.file(join(program, 'runtime', 'dsh', 'package.json')).exists()).toBe(true);
      expect((await stat(join(mutable, 'logs'))).isDirectory()).toBe(true);
      expect((await stat(join(mutable, 'cache'))).isDirectory()).toBe(true);
      expect(await readFile(join(program, 'install.json'), 'utf8')).not.toContain('must-not-be-written');
      expect(await readFile(join(state, '.credentials.yaml'), 'utf8')).toContain('provider: local');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('records recent projects and offers continue-last or choose-other without writing project metadata', async () => {
    const root = await temp('phase7-recent');
    try {
      const first = await project(root);
      const secondRoot = await temp('phase7-recent-second');
      try {
        const second = await project(secondRoot);
        const options = { platform: 'win32', mutableRoot: join(root, 'mutable'), dshHome: join(root, 'mutable', 'state'), programRoot: join(root, 'program') } as const;
        await recordRecentProject(first, options);
        await recordRecentProject(second, options);
        const recent = await readRecentProjects(options);
        expect(recent[0].path).toBe(resolve(second));
        expect(recent[1].path).toBe(resolve(first));
      } finally {
        await rm(secondRoot, { recursive: true, force: true });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('never changes the fixed web port and handles occupied-port choices truthfully', async () => {
    const opened: string[] = [];
    let probes = 0;
    await ensureFixedPortAvailable({
      platform: 'win32',
      portProbe: async (host, port) => { expect(host).toBe('127.0.0.1'); expect(port).toBe(3081); probes += 1; return probes === 1; },
      onConflict: () => 'retry'
    });
    expect(probes).toBe(2);
    await expect(ensureFixedPortAvailable({
      platform: 'win32',
      portProbe: async () => true,
      onConflict: () => 'open-existing',
      openExisting: async (url) => { opened.push(url); }
    })).rejects.toBeInstanceOf(ExistingDshSessionError);
    expect(opened).toEqual(['http://127.0.0.1:3081/']);
  });

  test('uninstall removes only program files/cache by default and purges state only explicitly', async () => {
    const root = await temp('phase7-uninstall');
    try {
      const program = join(root, 'program');
      const mutable = join(root, 'mutable');
      const state = join(mutable, 'state');
      const cache = join(mutable, 'cache');
      const projectPath = await project(root);
      const shortcut = join(root, 'Start Menu', 'DSH.lnk');
      await mkdir(program, { recursive: true });
      await mkdir(state, { recursive: true });
      await mkdir(cache, { recursive: true });
      await writeFile(join(state, '.credentials.yaml'), 'provider: local\n');
      await mkdir(resolve(shortcut, '..'), { recursive: true });
      await writeFile(shortcut, 'shortcut');
      const options = { platform: 'win32', programRoot: program, mutableRoot: mutable, dshHome: state, startMenuShortcutPath: shortcut };
      const first = await uninstallHarness(options);
      expect(first.purged).toBe(false);
      expect(await Bun.file(program).exists()).toBe(false);
      expect(await Bun.file(cache).exists()).toBe(false);
      expect(await Bun.file(join(state, '.credentials.yaml')).exists()).toBe(true);
      expect((await stat(projectPath)).isDirectory()).toBe(true);
      await mkdir(program, { recursive: true });
      await mkdir(cache, { recursive: true });
      const purged = await uninstallHarness({ ...options, purge: true });
      expect(purged.purged).toBe(true);
      expect(await Bun.file(mutable).exists()).toBe(false);
      expect((await stat(projectPath)).isDirectory()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('builds and inspects a real Release ZIP from the checked-in journey files', async () => {
    const root = await temp('phase7-zip');
    try {
      const zip = join(root, 'DSH-RPGMaker-MV-Windows.zip');
      const archive = await buildReleaseZip({ sourceRoot: process.cwd(), outputZip: zip, platform: process.platform });
      const inspection = await inspectReleaseZip({ zipPath: archive, platform: process.platform });
      expect(inspection.valid).toBe(true);
      expect(inspection.entries).toContain('Install.cmd');
      expect(inspection.entries).toContain('src/cli.ts');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('adds fixed binding args only for the DSH web launch and records the selected project outside it', async () => {
    const root = await temp('phase7-launch');
    try {
      const selected = await project(root);
      const dsh = join(root, 'dsh.exe');
      await writeFile(dsh, 'fixture');
      const launched = child();
      let args: string[] = [];
      const result = await launchProject({
        platform: 'win32',
        projectPath: selected,
        dshHome: join(root, 'mutable', 'state'),
        mutableRoot: join(root, 'mutable'),
        programRoot: join(root, 'program'),
        dshExecutable: dsh,
        bindWeb: true,
        portProbe: async () => false,
        dshArgs: ['--profile', 'web', '--patch', 'composition.yml'],
        env: {},
        spawnInteractive: (_command, received) => { args = received; return launched; }
      });
      expect(args).toEqual(['--profile', 'web', '--patch', 'composition.yml', '--host', '127.0.0.1', '--port', '3081']);
      expect(await readFile(join(root, 'mutable', 'recent-projects.json'), 'utf8')).toContain('选择 project with spaces');
      launched.exitCode = 0;
      launched.emit('exit', 0);
      await result.releaseSession();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
