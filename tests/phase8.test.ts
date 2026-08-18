import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';

import {
  prepareVisionToolkit,
  verifyVisionToolkit,
  VISION_TOOLKIT_BUNDLE_PATCH,
  VISION_TOOLKIT_NPM_INTEGRITY,
  VISION_TOOLKIT_PACKAGE,
  VISION_TOOLKIT_VERSION
} from '../src/vision-toolkit';
import { visionToolkitActivationFixture } from './fixtures/vision-toolkit';

async function temp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

function fakeChild(): EventEmitter & { exitCode: number | null; signalCode: NodeJS.Signals | null; stdout: PassThrough; stderr: PassThrough } {
  const child = new EventEmitter() as EventEmitter & { exitCode: number | null; signalCode: NodeJS.Signals | null; stdout: PassThrough; stderr: PassThrough };
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

async function writeInstalledProfile(dshHome: string): Promise<void> {
  const profile = join(dshHome, 'profiles', 'web');
  const packageDir = join(profile, 'node_modules', '@anionex', 'dsh-vision-toolkit');
  await mkdir(packageDir, { recursive: true });
  await writeFile(join(profile, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-web',
    private: true,
    dependencies: { [VISION_TOOLKIT_PACKAGE]: VISION_TOOLKIT_VERSION },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', VISION_TOOLKIT_PACKAGE] } }
  }, null, 2)}\n`);
  await writeFile(join(profile, 'pnpm-lock.yaml'), [
    'lockfileVersion: 9.0',
    'importers:',
    '  .:',
    '    dependencies:',
    `      ${VISION_TOOLKIT_PACKAGE}:`,
    `        specifier: ${VISION_TOOLKIT_VERSION}`,
    `        version: ${VISION_TOOLKIT_VERSION}`,
    'packages:',
    `  ${VISION_TOOLKIT_PACKAGE}@${VISION_TOOLKIT_VERSION}:`,
    `    resolution: {integrity: ${VISION_TOOLKIT_NPM_INTEGRITY}}`,
    ''
  ].join('\n'));
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({
    name: VISION_TOOLKIT_PACKAGE,
    version: VISION_TOOLKIT_VERSION,
    license: 'MIT',
    dsh: { bundle: { patch: VISION_TOOLKIT_BUNDLE_PATCH } }
  }));
}

describe('Vision Toolkit profile integration', () => {
  test('installs the exact bundle through the DSH plugin command and reuses it idempotently', async () => {
    const root = await temp('vision-toolkit-profile');
    try {
      const dshHome = join(root, 'dsh-home');
      const programRoot = join(root, 'program');
      const dsh = join(root, 'dsh.exe');
      const pnpm = join(root, 'pnpm.exe');
      await mkdir(programRoot, { recursive: true });
      await writeFile(dsh, 'fixture');
      await writeFile(pnpm, 'fixture');
      let pluginCalls = 0;
      const commandRunner = async (command: string, args: string[]) => {
        expect(command).toBe(dsh);
        expect(args).toEqual(['plugin', '--profile', 'web', 'add', '--save-exact', '--ignore-scripts', `${VISION_TOOLKIT_PACKAGE}@${VISION_TOOLKIT_VERSION}`]);
        pluginCalls += 1;
        await writeInstalledProfile(dshHome);
        return { exitCode: 0, stdout: '', stderr: '' };
      };

      const first = await prepareVisionToolkit({
        platform: 'win32',
        dshHome,
        programRoot,
        runtimeDir: join(programRoot, 'runtime', 'dsh'),
        dshExecutable: dsh,
        pnpmExecutable: pnpm,
        prepareRuntime: false,
        activationCheck: async () => visionToolkitActivationFixture(),
        commandRunner
      });
      expect(first.valid).toBe(true);
      expect(first.bundleOccurrences).toBe(1);
      expect(first.provider.baseUrl).toBe('https://vision.anionex.me/v1');
      expect(first.provider.credential).toBe('ANIONEX_FREE_VISION');
      expect(pluginCalls).toBe(1);

      const second = await prepareVisionToolkit({
        platform: 'win32',
        dshHome,
        programRoot,
        runtimeDir: join(programRoot, 'runtime', 'dsh'),
        dshExecutable: dsh,
        pnpmExecutable: pnpm,
        prepareRuntime: false,
        activationCheck: async () => visionToolkitActivationFixture(),
        commandRunner
      });
      expect(second.valid).toBe(true);
      expect(pluginCalls).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('installs an app-owned pnpm fallback before invoking the standard plugin manager', async () => {
    const root = await temp('vision-toolkit-pnpm');
    try {
      const dshHome = join(root, 'dsh-home');
      const programRoot = join(root, 'program');
      const dsh = join(root, 'dsh.exe');
      const npm = join(root, 'npm.cmd');
      await mkdir(programRoot, { recursive: true });
      await writeFile(dsh, 'fixture');
      await writeFile(npm, 'fixture');
      const commandRunner = async (command: string, args: string[], options: { cwd?: string; env?: Record<string, string | undefined> }) => {
        if (command === npm) {
          const pnpmRoot = join(options.cwd!, 'node_modules', 'pnpm');
          await mkdir(join(pnpmRoot, 'bin'), { recursive: true });
          await mkdir(join(options.cwd!, 'node_modules', '.bin'), { recursive: true });
          await writeFile(join(pnpmRoot, 'package.json'), JSON.stringify({ version: '10.15.1', bin: { pnpm: 'bin/pnpm.cjs' } }));
          await writeFile(join(pnpmRoot, 'bin', 'pnpm.cjs'), 'fixture');
          await writeFile(join(options.cwd!, 'node_modules', '.bin', 'pnpm.cmd'), 'fixture');
          return { exitCode: 0, stdout: '', stderr: '' };
        }
        expect(command).toBe(dsh);
        expect(Object.keys(options.env ?? {}).filter((key) => key.toLowerCase() === 'path')).toEqual(['PATH']);
        expect(options.env?.PATH).toContain(join('runtime', 'pnpm', 'node_modules', '.bin'));
        expect(options.env?.PATH).toContain(join(root, 'native bun bin'));
        await writeInstalledProfile(dshHome);
        return { exitCode: 0, stdout: '', stderr: '' };
      };
      const result = await prepareVisionToolkit({
        platform: 'win32',
        dshHome,
        programRoot,
        runtimeDir: join(programRoot, 'runtime', 'dsh'),
        dshExecutable: dsh,
        npmExecutable: npm,
        prepareRuntime: false,
        activationCheck: async () => visionToolkitActivationFixture(),
        env: { Path: join(root, 'native bun bin') },
        commandRunner
      });
      expect(result.valid).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('executes the managed Python and rejects an unsupported marker version', async () => {
    const root = await temp('vision-toolkit-python');
    try {
      const dshHome = join(root, 'dsh-home');
      const runtime = join(dshHome, 'cache', 'dsh-vision-toolkit', 'python', '3.13');
      await writeInstalledProfile(dshHome);
      await mkdir(join(runtime, 'Scripts'), { recursive: true });
      await writeFile(join(runtime, 'runtime.json'), JSON.stringify({ schemaVersion: 1, upstreamCommit: 'commit', upstreamContentSha256: 'a'.repeat(64), requirementsSha256: 'b'.repeat(64), pythonVersion: '3.13.15' }));
      const interpreter = join(runtime, 'Scripts', 'python.exe');
      await writeFile(interpreter, 'fixture');
      const calls: string[] = [];
      const result = await verifyVisionToolkit({
        platform: 'win32',
        dshHome,
        programRoot: join(root, 'program'),
        runtimeDir: join(root, 'runtime'),
        commandRunner: async (command) => {
          calls.push(command);
          return { exitCode: 0, stdout: 'Python 3.13.15\\n', stderr: '' };
        }
      });
      expect(result.managedRuntimeReady).toBe(true);
      expect(calls).toEqual([interpreter]);

      await writeFile(join(runtime, 'runtime.json'), JSON.stringify({ schemaVersion: 1, upstreamCommit: 'commit', upstreamContentSha256: 'a'.repeat(64), requirementsSha256: 'b'.repeat(64), pythonVersion: '3.10.0' }));
      expect((await verifyVisionToolkit({ platform: 'win32', dshHome, programRoot: join(root, 'program'), runtimeDir: join(root, 'runtime'), commandRunner: async () => ({ exitCode: 0, stdout: 'Python 3.13.15\\n', stderr: '' }) })).managedRuntimeReady).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('restores the profile when activation verification fails', async () => {
    const root = await temp('vision-toolkit-activation-rollback');
    try {
      const dshHome = join(root, 'dsh-home');
      const programRoot = join(root, 'program');
      const dsh = join(root, 'dsh.exe');
      const pnpm = join(root, 'pnpm.exe');
      await mkdir(programRoot, { recursive: true });
      const profile = join(dshHome, 'profiles', 'web');
      await mkdir(profile, { recursive: true });
      await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'user-profile', dependencies: { 'user-plugin': '1.0.0' } }));
      await writeFile(join(profile, 'pnpm-lock.yaml'), 'user lock\n');
      await writeFile(dsh, 'fixture');
      await writeFile(pnpm, 'fixture');
      await expect(prepareVisionToolkit({
        platform: 'win32',
        dshHome,
        programRoot,
        runtimeDir: join(programRoot, 'runtime', 'dsh'),
        dshExecutable: dsh,
        pnpmExecutable: pnpm,
        prepareRuntime: false,
        activationCheck: async () => ({ valid: false, errors: ['fixture activation failure'], settingsReady: false, attachmentAdmissionReady: false, tools: [] }),
        commandRunner: async () => {
          await writeInstalledProfile(dshHome);
          return { exitCode: 0, stdout: '', stderr: '' };
        }
      })).rejects.toThrow(/fixture activation failure/);
      expect(await Bun.file(join(profile, 'package.json')).text()).toContain('user-plugin');
      expect(await Bun.file(join(profile, 'pnpm-lock.yaml')).text()).toBe('user lock\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('preserves the warmup failure when process cleanup also fails', async () => {
    const root = await temp('vision-toolkit-warmup-cleanup');
    try {
      const dshHome = join(root, 'dsh-home');
      const programRoot = join(root, 'program');
      const dsh = join(root, 'dsh.exe');
      await writeInstalledProfile(dshHome);
      await mkdir(programRoot, { recursive: true });
      await writeFile(dsh, 'fixture');
      const child = fakeChild();
      await expect(prepareVisionToolkit({
        platform: 'win32',
        dshHome,
        programRoot,
        runtimeDir: join(programRoot, 'runtime', 'dsh'),
        dshExecutable: dsh,
        runtimeWarmupTimeoutMs: 1,
        spawnProcess: (() => child) as never,
        terminateProcessTree: async () => { throw new Error('cleanup failure'); },
        activationCheck: async () => visionToolkitActivationFixture()
      })).rejects.toThrow(/timed out/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('reports a duplicate bundle layer and does not call the provider', async () => {
    const root = await temp('vision-toolkit-verify');
    try {
      const dshHome = join(root, 'dsh-home');
      await writeInstalledProfile(dshHome);
      const profile = join(dshHome, 'profiles', 'web', 'package.json');
      const manifest = JSON.parse(await Bun.file(profile).text()) as Record<string, unknown>;
      const dsh = manifest.dsh as Record<string, unknown>;
      const profileConfig = dsh.profile as Record<string, unknown>;
      profileConfig.bundles = [...(profileConfig.bundles as string[]), VISION_TOOLKIT_PACKAGE];
      await writeFile(profile, `${JSON.stringify(manifest, null, 2)}\n`);
      const result = await verifyVisionToolkit({ platform: 'win32', dshHome, programRoot: join(root, 'program') });
      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toMatch(/exactly one/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
