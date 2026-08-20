import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';

import { DSH_NPM_INTEGRITY, DSH_PACKAGE_NAME, DSH_VERSION, PROGRAM_OWNER, PROGRAM_OWNERSHIP_FILE, PRODUCT_NAME, resolveHarnessPaths, withEnvironmentPath } from '../src/config';
import { buildReleaseZip, inspectReleaseZip, installWindowsRelease, WINDOWS_GATE_CLEANUP_HELPER_RELATIVE } from '../src/release-gate';
import { MCPORTER_NPM_INTEGRITY, MCPORTER_PACKAGE, MCPORTER_VERSION } from '../src/mcport';
import { FREE_TEX_LOCK_INTEGRITY, FREE_TEX_PACKER_VERSION } from '../src/image-toolchain';
import { PNPM_VERSION } from '../src/profile';
import { findDshExecutable } from '../src/bootstrap';
import { CUSTOM_AGENT_PRESET_IDS, prepareRpgMakerLaunch, renderPresetOnlyPatch } from '../src/rpgmaker';
import { RPGMAKER_MCP_PACKAGE, RPGMAKER_MCP_VERSION } from '../src/rpgmaker';
import { RPGMPACKER_NPM_INTEGRITY, RPGMPACKER_PACKAGE, RPGMPACKER_SCRIPT, RPGMPACKER_VERSION } from '../src/release';
import { JS_RUNNER_ENV, XEROLO_RUNTIME_ENV, verifyWorkspaceMcpBundle, WORKSPACE_MCP_AGENT_ENTRYPOINT, WORKSPACE_MCP_BUNDLE_ARCHIVE_RELATIVE, WORKSPACE_MCP_BUNDLE_RELATIVE } from '../src/workspace-mcp';
import { installWindowsPrerequisites, PrerequisiteConsentError, verifyWindowsPrerequisites } from '../src/prerequisites';
import { addFixedWebBinding, launchProject } from '../src/launcher';
import { runCli } from '../src/cli';
import { runDoctor } from '../src/doctor';
import { runCommand } from '../src/process';
import { run as runProcessObservation } from '../scripts/process-observation.mjs';
import { cleanupInstalledGateWorkspace, resolveInstalledNode, runInstalledMount } from '../scripts/phase7-windows-installed-gate';
import { resolveExecutable, resolveWindowsPwsh, resolveWindowsSevenZip, parseSevenZipVersion } from '../src/executable';
import { ensureFixedPortAvailable, ExistingDshSessionError, ensureHarnessLayout, uninstallHarness, UninstallSafetyError } from '../src/windows';
import { OBSOLETE_VISION_TOOLKIT_PACKAGE, removeObsoleteVisionToolkitState } from '../src/profile-repair';

async function temp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

async function installedGateTemp(suffix = ''): Promise<string> {
  return mkdtemp(join(tmpdir(), `dsh-rpgmaker-phase7-installed-${suffix}`));
}

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const prepareAgentDependencies = async (): Promise<void> => undefined;

async function project(root: string): Promise<string> {
  const path = join(root, '选择 project with spaces');
  await mkdir(join(path, 'data'), { recursive: true });
  await mkdir(join(path, 'js'), { recursive: true });
  await writeFile(join(path, 'Game.rpgproject'), '{}\n');
  return path;
}

async function dshRuntime(runtime: string): Promise<void> {
  await mkdir(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib'), { recursive: true });
  await mkdir(join(runtime, 'node_modules', '@deepseek-ai', 'dsh-launch-environment', 'lib'), { recursive: true });
  await mkdir(join(runtime, 'node_modules', 'koffi'), { recursive: true });
  await mkdir(join(runtime, 'node_modules', '.bin'), { recursive: true });
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ dependencies: { [DSH_PACKAGE_NAME]: DSH_VERSION } }));
  await writeFile(join(runtime, 'bun.lock'), JSON.stringify({
    workspaces: { '': { dependencies: { [DSH_PACKAGE_NAME]: DSH_VERSION } } },
    packages: { [DSH_PACKAGE_NAME]: [`${DSH_PACKAGE_NAME}@${DSH_VERSION}`, '', {}, DSH_NPM_INTEGRITY] }
  }));
  await writeFile(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({ version: DSH_VERSION, bin: { dsh: 'lib/bin.js' } }));
  await writeFile(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), 'fixture');
  await writeFile(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'profile-boot-fixture.js'), 'fixture');
  await mkdir(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets', 'code'), { recursive: true });
  await writeFile(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets', 'code', 'agent.cordis.yml'), '- id: skill-filesystem\n  name: \'@deepseek-ai/dsh-skill-filesystem\'\n- id: persona\n  name: fixture persona\n');
  await writeFile(join(runtime, 'node_modules', '@deepseek-ai', 'dsh-launch-environment', 'lib', 'index.js'), 'fixture');
  await writeFile(join(runtime, 'node_modules', '.bin', 'dsh.cmd'), '@echo off\r\n');
  await writeFile(join(runtime, 'node_modules', 'koffi', 'package.json'), JSON.stringify({ version: '2.12.0' }));
}

function child(): EventEmitter & { exitCode: number | null; signalCode: string | null } {
  const value = new EventEmitter() as EventEmitter & { exitCode: number | null; signalCode: string | null };
  value.exitCode = null;
  value.signalCode = null;
  return value;
}

function runInteractive(command: string, args: string[], env: Record<string, string | undefined>, input: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    process.stdout.setEncoding('utf8');
    process.stderr.setEncoding('utf8');
    process.stdout.on('data', (chunk: string) => { stdout += chunk; });
    process.stderr.on('data', (chunk: string) => { stderr += chunk; });
    process.once('error', reject);
    process.once('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
    process.stdin.end(input);
  });
}

async function prerequisiteBin(root: string): Promise<{ bin: string; env: Record<string, string> }> {
  const bin = join(root, 'fake prerequisite bin');
  await mkdir(bin, { recursive: true });
  for (const name of ['node.exe', 'npm.cmd', 'python.exe', 'bun.exe', 'pwsh.exe', 'git.exe', 'coreutils-manager.exe', 'find.exe', 'grep.exe', '7z.exe']) await writeFile(join(bin, name), 'fixture');
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
    if (args.includes('--dump-config')) return { exitCode: 0, stdout: '- id: timeout-policy\n  name: "@deepseek-ai/dsh-tool-call-timeout-policy"\n- id: agent-presets\n', stderr: '' };
    if (args[0] === '-e') return { exitCode: 0, stdout: 'loaded', stderr: '' };
    if (name === 'node.exe') return { exitCode: 0, stdout: 'v20.18.0', stderr: '' };
    if (name === 'npm.cmd') return { exitCode: 0, stdout: '10.8.2', stderr: '' };
    if (name === 'python.exe') return { exitCode: 0, stdout: 'Python 3.13.15', stderr: '' };
    if (name === 'bun.exe') return { exitCode: 0, stdout: '1.3.14', stderr: '' };
    if (name === 'pwsh.exe') return { exitCode: 0, stdout: 'PowerShell 7.4.6', stderr: '' };
    if (name === 'git.exe') return { exitCode: 0, stdout: 'git version 2.45.0', stderr: '' };
    if (name === 'coreutils-manager.exe' && args[0] === '--help') return { exitCode: 0, stdout: 'Manage coreutils utilities and PowerShell profiles\n enable\n disable\n status\n', stderr: '' };
    if (name === 'coreutils-manager.exe' && args[0] === 'status') return { exitCode: 0, stdout: 'find enabled\ngrep enabled\n', stderr: '' };
    if (name === '7z.exe' && args[0] === 'i') return { exitCode: 0, stdout: '7-Zip 24.09 (x64) : Copyright (c) 1999-2025 Igor Pavlov\n', stderr: '' };
    return { exitCode: 0, stdout: `${name} 0.1.0`, stderr: '' };
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function writePinnedPackageRuntime(
  runtime: string,
  packageName: string,
  version: string,
  integrity: string,
  packageManifest: Record<string, unknown>,
  lockMetadata: Record<string, unknown> = {}
): Promise<void> {
  const packageDir = join(runtime, 'node_modules', ...packageName.split('/'));
  await mkdir(packageDir, { recursive: true });
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ private: true, dependencies: { [packageName]: version } }));
  await writeFile(join(runtime, 'bun.lock'), JSON.stringify({
    lockfileVersion: 1,
    workspaces: { '': { dependencies: { [packageName]: version } } },
    packages: { [packageName]: [`${packageName}@${version}`, '', lockMetadata, integrity] }
  }));
  await writeFile(join(packageDir, 'package.json'), JSON.stringify(packageManifest));
  const entry = typeof packageManifest.main === 'string'
    ? packageManifest.main
    : Object.values((packageManifest.bin ?? {}) as Record<string, unknown>).find((value): value is string => typeof value === 'string');
  if (entry) {
    await mkdir(dirname(join(packageDir, entry)), { recursive: true });
    await writeFile(join(packageDir, entry), 'export {}\n');
  }
}

async function writePnpmRuntime(runtime: string): Promise<void> {
  const packageDir = join(runtime, 'node_modules', 'pnpm');
  await mkdir(join(packageDir, 'bin'), { recursive: true });
  await mkdir(join(runtime, 'node_modules', '.bin'), { recursive: true });
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({ version: PNPM_VERSION, bin: { pnpm: 'bin/pnpm.cjs' } }));
  await writeFile(join(packageDir, 'bin', 'pnpm.cjs'), '/* fixture pnpm */\n');
  await writeFile(join(runtime, 'node_modules', '.bin', 'pnpm.cmd'), '@echo off\r\n');
}

async function writeObsoleteVisionProfileState(dshHome: string): Promise<void> {
  const profile = join(dshHome, 'profiles', 'web');
  const obsoletePackage = join(profile, 'node_modules', ...OBSOLETE_VISION_TOOLKIT_PACKAGE.split('/'));
  const workspacePackage = join(profile, 'node_modules', '@baihestudio', 'dsh-workspace-mcp');
  await mkdir(join(obsoletePackage, 'lib'), { recursive: true });
  await mkdir(join(profile, 'node_modules', '.pnpm', '@anionex+dsh-vision-toolkit@0.1.31', 'node_modules', '@anionex', 'dsh-vision-toolkit'), { recursive: true });
  await mkdir(workspacePackage, { recursive: true });
  await writeFile(join(obsoletePackage, 'package.json'), JSON.stringify({ name: OBSOLETE_VISION_TOOLKIT_PACKAGE, version: '0.1.31' }));
  await writeFile(join(workspacePackage, 'package.json'), JSON.stringify({ name: '@baihestudio/dsh-workspace-mcp', version: '0.1.0' }));
  await writeFile(join(profile, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-web',
    private: true,
    dependencies: {
      [OBSOLETE_VISION_TOOLKIT_PACKAGE]: '0.1.31',
      '@baihestudio/dsh-workspace-mcp': 'file:../../bundle/dsh-workspace-mcp'
    },
    dsh: { profile: { bundles: [OBSOLETE_VISION_TOOLKIT_PACKAGE, '@baihestudio/dsh-workspace-mcp'] } }
  }, null, 2)}\n`);
  await writeFile(join(profile, 'pnpm-lock.yaml'), [
    'lockfileVersion: 9.0',
    'importers:',
    '  .:',
    '    dependencies:',
    `      ${OBSOLETE_VISION_TOOLKIT_PACKAGE}:`,
    '        specifier: 0.1.31',
    '        version: 0.1.31',
    '      @baihestudio/dsh-workspace-mcp:',
    '        specifier: file:../../bundle/dsh-workspace-mcp',
    '        version: link:../../bundle/dsh-workspace-mcp',
    'packages:',
    `  ${OBSOLETE_VISION_TOOLKIT_PACKAGE}@0.1.31:`,
    '    resolution: {integrity: sha512-obsolete}',
    '  @baihestudio/dsh-workspace-mcp@0.1.0:',
    '    resolution: {integrity: sha512-workspace}',
    ''
  ].join('\n'));
  await writeFile(join(profile, 'cordis.patch.yml'), [
    `- id: vision-toolkit-activation\n  name: '${OBSOLETE_VISION_TOOLKIT_PACKAGE}'\n`,
    "- id: workspace-mcp\n  name: '@baihestudio/dsh-workspace-mcp'\n"
  ].join(''));
  await mkdir(join(dshHome, 'cache', 'dsh-vision-toolkit', 'python', '3.13'), { recursive: true });
  await writeFile(join(dshHome, 'cache', 'dsh-vision-toolkit', 'python', '3.13', 'runtime.json'), 'obsolete runtime');
}

async function writeProfilePlugin(
  dshHome: string,
  packageName: string,
  version: string,
  integrity: string,
  source?: string
): Promise<void> {
  const profile = join(dshHome, 'profiles', 'web');
  const installed = join(profile, 'node_modules', ...packageName.split('/'));
  await mkdir(dirname(installed), { recursive: true });
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    manifest = { name: 'dsh-profile-web', private: true, version: '0.1.0' };
  }
  const dependencies = { ...((manifest.dependencies ?? {}) as Record<string, string>), [packageName]: source ? `file:${source}` : version };
  manifest.dependencies = dependencies;
  const dsh = (manifest.dsh ?? {}) as Record<string, unknown>;
  const profileConfig = (dsh.profile ?? {}) as Record<string, unknown>;
  const bundles = Array.isArray(profileConfig.bundles)
    ? profileConfig.bundles.filter((value) => value !== OBSOLETE_VISION_TOOLKIT_PACKAGE)
    : [];
  if (packageName === '@baihestudio/dsh-workspace-mcp') bundles.push(packageName);
  profileConfig.bundles = [...new Set(bundles)];
  dsh.profile = profileConfig;
  manifest.dsh = dsh;
  if (source) {
    await rm(installed, { recursive: true, force: true });
    await cp(source, installed, { recursive: true });
  } else {
    await mkdir(join(installed, 'lib'), { recursive: true });
    await writeFile(join(installed, 'package.json'), JSON.stringify({
      name: packageName,
      version,
      license: 'MIT',
      main: 'lib/index.js',
      dsh: { bundle: { patch: './cordis.patch.yml' } }
    }));
    await writeFile(join(installed, 'lib', 'index.js'), 'export {}\n');
  }
  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(profile, 'pnpm-lock.yaml'), `${packageName}@${version}\n${integrity}\n`);
}

function defaultInstallRunner(context: { dshHome: string }, calls: Array<{ command: string; args: string[]; cwd?: string }>) {
  const base = prerequisiteRunner();
  return async (command: string, args: string[], options: { cwd?: string }) => {
    calls.push({ command, args: [...args], cwd: options.cwd });
    const cwd = options.cwd;
    const packageSpec = args.find((value) => value.includes('@') && !value.startsWith('--'));
    if (args[0] === 'install' && packageSpec === `pnpm@${PNPM_VERSION}`) {
      await writePnpmRuntime(cwd!);
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'add' && packageSpec === `${MCPORTER_PACKAGE}@${MCPORTER_VERSION}`) {
      await writePinnedPackageRuntime(cwd!, MCPORTER_PACKAGE, MCPORTER_VERSION, MCPORTER_NPM_INTEGRITY, { version: MCPORTER_VERSION, main: 'dist/index.js' });
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'add' && packageSpec === `${RPGMAKER_MCP_PACKAGE}@${RPGMAKER_MCP_VERSION}`) {
      await writePinnedPackageRuntime(cwd!, RPGMAKER_MCP_PACKAGE, RPGMAKER_MCP_VERSION, 'sha512-oXdkSGKGiYAtexcoZBXhyUQub6zoYQ4tMU2aKTjAcqeKhUpQ4BypjuS0EYJ78/7zmOq3TwFNBkEaZyb8q+SGuA==', { version: RPGMAKER_MCP_VERSION, bin: { 'rpgmaker-mv-mcp': 'dist/index.js' } }, { bin: { 'rpgmaker-mv-mcp': 'dist/index.js' } });
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'add' && packageSpec === `${RPGMPACKER_PACKAGE}@${RPGMPACKER_VERSION}`) {
      await writePinnedPackageRuntime(cwd!, RPGMPACKER_PACKAGE, RPGMPACKER_VERSION, RPGMPACKER_NPM_INTEGRITY, { version: RPGMPACKER_VERSION, bin: { rpgmpacket: RPGMPACKER_SCRIPT } }, { bin: { rpgmpacket: RPGMPACKER_SCRIPT } });
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'add' && packageSpec === `free-tex-packer-core@${FREE_TEX_PACKER_VERSION}`) {
      await writePinnedPackageRuntime(cwd!, 'free-tex-packer-core', FREE_TEX_PACKER_VERSION, FREE_TEX_LOCK_INTEGRITY, { version: FREE_TEX_PACKER_VERSION });
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'add' && packageSpec === `${DSH_PACKAGE_NAME}@${DSH_VERSION}`) {
      await dshRuntime(cwd!);
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'pm') return { exitCode: 0, stdout: '', stderr: '' };
    if (args[0] === 'plugin') {
      const local = args.find((value) => value.startsWith('file:'))?.slice('file:'.length);
      if (!local) throw new Error(`unexpected plugin fixture args: ${args.join(' ')}`);
      const localManifest = JSON.parse(await readFile(join(local, 'package.json'), 'utf8')) as { name?: string; version?: string };
      if (!localManifest.name || !localManifest.version) throw new Error(`local plugin fixture has no package identity: ${local}`);
      await writeProfilePlugin(context.dshHome, localManifest.name, localManifest.version, '', local);
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    const name = basename(command).toLowerCase();
    if (name === 'magick.exe') return { exitCode: 0, stdout: 'ImageMagick 7.1.2-29 Q16 x64\n', stderr: '' };
    if (name === 'oxipng.exe') return { exitCode: 0, stdout: 'oxipng 10.2.0\n', stderr: '' };
    if (name === 'python.exe') return { exitCode: 0, stdout: 'Python 3.13.15\n', stderr: '' };
    if (args[0] === '-e') return { exitCode: 0, stdout: 'loaded', stderr: '' };
    if (args[0] === 'add') throw new Error(`unexpected dependency fixture args: ${args.join(' ')}`);
    return base(command, args, options);
  };
}

describe('Windows release gate foundations', () => {
  test('normalizes Windows PATH to one canonical environment key', () => {
    const out = withEnvironmentPath({ Path: 'a;b', DSH_HOME: 'c' }, 'x;y', 'win32');
    expect(Object.keys(out).filter((key) => key.toLowerCase() === 'path')).toEqual(['PATH']);
    expect(out.PATH).toBe('x;y');
    expect(Object.prototype.hasOwnProperty.call(out, 'Path')).toBe(false);
    expect(out.DSH_HOME).toBe('c');
    expect(withEnvironmentPath({ PATH: 'a' }, 'x', 'darwin').PATH).toBe('x');
  });

  test('waits for process observation cleanup after a timeout', async () => {
    const observer = child() as unknown as EventEmitter & { exitCode: number | null; signalCode: string | null; kill: () => boolean };
    let killed = false;
    observer.kill = () => {
      killed = true;
      return true;
    };
    const observation = runProcessObservation('fixture', [], {}, 1, () => observer);
    let settled = false;
    observation.then(() => { settled = true; }, () => { settled = true; });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    expect(killed).toBe(true);
    expect(settled).toBe(false);
    observer.exitCode = 1;
    observer.emit('exit', 1, null);
    observer.emit('close', 1);
    await expect(observation).rejects.toThrow(/process observation command timed out/);
  });

  test('validates PowerShell identity before literal native cleanup and proves absence', async () => {
    const root = await installedGateTemp('100%! & ;()[]$');
    try {
      await writeFile(join(root, 'fixture.txt'), 'fixture');
      const calls: Array<{ command: string; args: string[]; cwd?: string; env?: Record<string, string | undefined> }> = [];
      const sourceEnv = {
        USERPROFILE: root,
        TEMP: root,
        TMP: root,
        DEEPSEEK_API_KEY: 'secret-value'
      };
      const pwsh = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
      await cleanupInstalledGateWorkspace(root, {
        platform: 'win32',
        env: sourceEnv,
        pwshExecutable: pwsh,
        commandRunner: async (command, args, options) => {
          calls.push({ command, args: [...args], cwd: options.cwd, env: options.env });
          if (args[0] === '--version') return { exitCode: 0, stdout: 'PowerShell 7.4.6\n', stderr: '' };
          await rm(args.at(-1)!, { recursive: true, force: true });
          return { exitCode: 0, stdout: '', stderr: '' };
        }
      });

      expect(calls).toHaveLength(2);
      expect(calls[0]?.command).toBe(pwsh);
      expect(calls[0]?.args).toEqual(['--version']);
      expect(calls[1]?.command).toBe(pwsh);
      expect(calls[1]?.args).toEqual([
        '-NoLogo', '-NoProfile', '-NonInteractive', '-File',
        join(REPOSITORY_ROOT, WINDOWS_GATE_CLEANUP_HELPER_RELATIVE),
        '-LiteralPath', resolve(root)
      ]);
      expect(calls[1]?.args.filter((value) => value === resolve(root))).toEqual([resolve(root)]);
      expect(calls[0]?.cwd).toBe(dirname(resolve(root)));
      expect(calls[1]?.cwd).toBe(dirname(resolve(root)));
      expect(calls[1]?.env?.USERPROFILE).toBe(dirname(resolve(root)));
      expect(calls[1]?.env?.TEMP).toBe(dirname(resolve(root)));
      expect(calls[1]?.env?.TMP).toBe(dirname(resolve(root)));
      expect(calls[1]?.env?.DEEPSEEK_API_KEY).toBeUndefined();
      await expect(stat(root)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects outside, wrong-prefix, relative, and ambiguous roots before invoking PowerShell', async () => {
    const expectedTempRoot = await temp('phase7-gate-cleanup-expected-parent');
    const outsideParent = await temp('phase7-gate-cleanup-outside-parent');
    const outside = await mkdtemp(join(outsideParent, 'dsh-rpgmaker-phase7-installed-'));
    const wrongPrefix = await mkdtemp(join(expectedTempRoot, 'phase7-gate-cleanup-wrong-prefix-'));
    const ambiguousBase = await mkdtemp(join(expectedTempRoot, 'dsh-rpgmaker-phase7-installed-ambiguous-'));
    const cases = [
      { label: 'outside', root: outside },
      { label: 'wrong prefix', root: wrongPrefix },
      { label: 'relative', root: 'relative/dsh-rpgmaker-phase7-installed-fixture' },
      { label: 'ambiguous', root: `${ambiguousBase}/.` }
    ];
    let invoked = 0;
    try {
      for (const scenario of cases) {
        await expect(cleanupInstalledGateWorkspace(scenario.root, {
          platform: 'win32',
          tempRoot: expectedTempRoot,
          pwshExecutable: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
          commandRunner: async () => {
            invoked += 1;
            throw new Error('PowerShell must not be invoked for an unowned root');
          }
        })).rejects.toThrow(/temporary|absolute|prefix|owned/i);
      }
      expect(invoked).toBe(0);
    } finally {
      await rm(expectedTempRoot, { recursive: true, force: true });
      await rm(outsideParent, { recursive: true, force: true });
    }
  });

  test('rejects injected non-native or unverified PowerShell before helper deletion', async () => {
    const scenarios = [
      { label: 'bun runner', executable: 'C:\\tools\\bun.exe', output: 'PowerShell 7.4.6\n', probes: 0 },
      { label: 'fake PowerShell basename', executable: 'C:\\tools\\fake-pwsh.exe', output: 'PowerShell 7.4.6\n', probes: 0 },
      { label: 'WindowsApps execution alias', executable: 'C:\\Program Files\\WindowsApps\\pwsh.exe', output: 'PowerShell 7.4.6\n', probes: 0 },
      { label: 'unrecognized identity', executable: 'C:\\tools\\pwsh.exe', output: 'Fake PowerShell 7.4.6\n', probes: 1 },
      { label: 'wrong version', executable: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', output: 'PowerShell 7.3.9\n', probes: 1 }
    ];

    for (const scenario of scenarios) {
      const root = await installedGateTemp(`rejected-${scenario.label.replaceAll(' ', '-')}`);
      let probes = 0;
      let helperCalls = 0;
      try {
        let failure: Error | undefined;
        try {
          await cleanupInstalledGateWorkspace(root, {
            platform: 'win32',
            env: { DEEPSEEK_API_KEY: 'secret-value' },
            pwshExecutable: scenario.executable,
            commandRunner: async (_command, args) => {
              if (args[0] === '--version') {
                probes += 1;
                return { exitCode: 0, stdout: scenario.output, stderr: 'secret-value' };
              }
              helperCalls += 1;
              return { exitCode: 0, stdout: '', stderr: '' };
            }
          });
        } catch (error) {
          failure = error instanceof Error ? error : new Error(String(error));
        }
        expect(failure).toBeDefined();
        expect(failure?.message).not.toContain('secret-value');
        expect(probes).toBe(scenario.probes);
        expect(helperCalls).toBe(0);
        await expect(stat(root)).resolves.toBeDefined();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  test('retries a classified native sharing failure before confirming absence', async () => {
    const root = await installedGateTemp('transient');
    try {
      await writeFile(join(root, 'fixture.txt'), 'fixture');
      const delays: number[] = [];
      let attempts = 0;
      await cleanupInstalledGateWorkspace(root, {
        platform: 'win32',
        pwshExecutable: 'pwsh.exe',
        commandRunner: async (_command, args) => {
          if (args[0] === '--version') return { exitCode: 0, stdout: 'PowerShell 7.4.6', stderr: '' };
          attempts += 1;
          if (attempts === 1) return { exitCode: 1, stdout: '', stderr: `ERROR_SHARING_VIOLATION: ${resolve(root)}` };
          await rm(resolve(root), { recursive: true, force: true });
          return { exitCode: 0, stdout: '', stderr: '' };
        },
        delay: async (milliseconds) => { delays.push(milliseconds); }
      });
      expect(attempts).toBe(2);
      expect(delays).toEqual([100]);
      await expect(stat(root)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('fails immediately on a persistent native removal error with the exact root', async () => {
    const root = await installedGateTemp('persistent');
    try {
      const delays: number[] = [];
      let attempts = 0;
      await expect(cleanupInstalledGateWorkspace(root, {
        platform: 'win32',
        pwshExecutable: 'pwsh.exe',
        commandRunner: async (_command, args) => {
          if (args[0] === '--version') return { exitCode: 0, stdout: 'PowerShell 7.4.6', stderr: '' };
          attempts += 1;
          return { exitCode: 1, stdout: '', stderr: `UnauthorizedAccessException: access denied for ${resolve(root)}` };
        },
        delay: async (milliseconds) => { delays.push(milliseconds); }
      })).rejects.toThrow(new RegExp(`temporary gate workspace cleanup failed.*${resolve(root).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      expect(attempts).toBe(1);
      expect(delays).toEqual([]);
      await expect(stat(root)).resolves.toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('runs the installed mount probe with native Node while keeping Bun as the Xerolo runner', async () => {
    const root = await temp('phase7-installed-mount-runner');
    try {
      const { bin } = await prerequisiteBin(root);
      const bun = join(bin, 'bun.exe');
      const node = join(bin, 'node.exe');
      expect(await resolveInstalledNode({ PATH: bin })).toBe(node);
      await expect(resolveInstalledNode({ PATH: join(root, 'missing node bin') })).rejects.toThrow(/node\.exe was not found/i);
      await expect(resolveInstalledNode({ PATH: bin, NODE_EXECUTABLE: bun })).rejects.toThrow(/direct native node\.exe runner/i);

      const installedRoot = join(root, 'program');
      const dshHome = join(root, 'state');
      const neutralLanding = join(installedRoot, 'neutral');
      const workspace = join(root, '游戏 workspace with spaces');
      const dshLib = join(installedRoot, 'runtime', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib');
      await mkdir(dshLib, { recursive: true });
      await writeFile(join(dshLib, 'profile-boot-fixture.js'), 'export {}\n');
      const mcpRuntime = join(installedRoot, 'runtime', 'mcp');
      await writePinnedPackageRuntime(
        mcpRuntime,
        RPGMAKER_MCP_PACKAGE,
        RPGMAKER_MCP_VERSION,
        'sha512-oXdkSGKGiYAtexcoZBXhyUQub6zoYQ4tMU2aKTjAcqeKhUpQ4BypjuS0EYJ78/7zmOq3TwFNBkEaZyb8q+SGuA==',
        { version: RPGMAKER_MCP_VERSION, bin: { 'rpgmaker-mv-mcp': 'dist/index.js' } },
        { bin: { 'rpgmaker-mv-mcp': 'dist/index.js' } }
      );
      const mountScript = join(installedRoot, 'scripts', 'phase2-real-mount.mjs');
      await mkdir(dirname(mountScript), { recursive: true });
      await writeFile(mountScript, '');

      let invocation: { command: string; args: string[]; cwd?: string; env?: Record<string, string | undefined> } | undefined;
      const result = await runInstalledMount(
        installedRoot,
        dshHome,
        neutralLanding,
        workspace,
        { BUN_EXECUTABLE: bun },
        node,
        async (command, args, options) => {
          invocation = { command, args: [...args], cwd: options.cwd, env: options.env };
          return { exitCode: 0, stdout: '{"ok":true}\n', stderr: '' };
        }
      );
      expect(result.ok).toBe(true);
      expect(invocation?.command).toBe(node);
      expect(invocation?.args).toEqual([mountScript]);
      expect(invocation?.cwd).toBe(neutralLanding);
      expect(invocation?.env?.[JS_RUNNER_ENV]).toBe(bun);
      expect(invocation?.env?.[XEROLO_RUNTIME_ENV]).toBe(mcpRuntime);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects a non-Node runner at the installed mount helper boundary', async () => {
    let invoked = false;
    await expect(runInstalledMount(
      'installed root',
      'dsh home',
      'neutral landing',
      'workspace',
      { BUN_EXECUTABLE: 'bun.exe' },
      'bun.exe',
      async () => {
        invoked = true;
        return { exitCode: 0, stdout: '{"ok":true}\n', stderr: '' };
      }
    )).rejects.toThrow(/direct native node\.exe runner/i);
    expect(invoked).toBe(false);
  });

  test('prefers a real PowerShell 7 install over the WindowsApps execution alias', async () => {
    const root = await temp('phase7-pwsh-alias');
    try {
      const apps = join(root, 'WindowsApps');
      const ps7 = join(root, 'Program Files', 'PowerShell', '7');
      const store = join(root, 'Program Files', 'WindowsApps', 'Microsoft.PowerShell_7.6.5.0_x64__8wekyb3d8bbwe');
      await mkdir(apps, { recursive: true });
      await mkdir(ps7, { recursive: true });
      await mkdir(store, { recursive: true });
      await writeFile(join(apps, 'pwsh.exe'), 'alias');
      await writeFile(join(ps7, 'pwsh.exe'), 'real');
      const env = { PATH: apps, ProgramFiles: join(root, 'Program Files') };
      expect(await resolveWindowsPwsh({ platform: 'win32', env })).toBe(join(ps7, 'pwsh.exe'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('falls back to the Microsoft Store PowerShell package when only the WindowsApps alias exists', async () => {
    const root = await temp('phase7-pwsh-store');
    try {
      const apps = join(root, 'WindowsApps');
      const older = join(root, 'Program Files', 'WindowsApps', 'Microsoft.PowerShell_7.4.0.0_x64__8wekyb3d8bbwe');
      const newest = join(root, 'Program Files', 'WindowsApps', 'Microsoft.PowerShell_7.6.5.0_x64__8wekyb3d8bbwe');
      await mkdir(apps, { recursive: true });
      await mkdir(older, { recursive: true });
      await mkdir(newest, { recursive: true });
      await writeFile(join(apps, 'pwsh.exe'), 'alias');
      await writeFile(join(newest, 'pwsh.exe'), 'newest');
      const env = { PATH: apps, ProgramFiles: join(root, 'Program Files') };
      expect(await resolveWindowsPwsh({ platform: 'win32', env })).toBe(join(newest, 'pwsh.exe'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('resolves Windows executables from a case-insensitive Path environment key', async () => {
    const root = await temp('windows-path-case');
    try {
      const npm = join(root, 'npm.cmd');
      await writeFile(npm, 'fixture');
      expect(await resolveExecutable('npm', { platform: 'win32', env: { Path: root } })).toBe(npm);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('resolves installed 7-Zip from Program Files (x86) and per-user roots before PATH', async () => {
    const root = await temp('phase7-sevenzip-roots');
    try {
      const x86 = join(root, 'Program Files (x86)', '7-Zip', '7z.exe');
      await mkdir(dirname(x86), { recursive: true });
      await writeFile(x86, 'fixture');
      const perUser = join(root, 'Local AppData', 'Programs', '7-Zip', '7z.exe');
      await mkdir(dirname(perUser), { recursive: true });
      await writeFile(perUser, 'fixture');
      const env = {
        PATH: join(root, 'no-sevenzip-on-path'),
        ProgramFiles: join(root, 'Program Files'),
        'ProgramFiles(x86)': join(root, 'Program Files (x86)'),
        ProgramW6432: join(root, 'Program Files'),
        LOCALAPPDATA: join(root, 'Local AppData')
      };
      expect(await resolveWindowsSevenZip({ platform: 'win32', env })).toBe(x86);
      await rm(dirname(x86), { recursive: true, force: true });
      expect(await resolveWindowsSevenZip({ platform: 'win32', env })).toBe(perUser);
      expect(parseSevenZipVersion('7-Zip 24.09 (x64) : Copyright (c) 1999-2025 Igor Pavlov\n')).toEqual([24, 9, 0]);
      expect(parseSevenZipVersion('7-Zip [64] 19.00 (x64) : Copyright (c) 1999-2019 Igor Pavlov\n')).toEqual([19, 0, 0]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('accepts legacy and modern 7-Zip banners and rejects an unrelated 7z shim', async () => {
    const root = await temp('phase7-sevenzip-banners');
    try {
      const { env } = await prerequisiteBin(root);
      const base = prerequisiteRunner();
      const legacy = await verifyWindowsPrerequisites({
        platform: 'win32', env, commandRunner: async (command, args, options) => {
          if (basename(command).toLowerCase() === '7z.exe' && args[0] === 'i') return { exitCode: 0, stdout: '7-Zip [64] 19.00 (x64) : Copyright (c) 1999-2019 Igor Pavlov\n', stderr: '' };
          return base(command, args, options);
        }
      });
      const legacySevenZip = legacy.checks.find((item) => item.id === '7zip');
      expect(legacySevenZip?.ok).toBe(true);
      expect(legacySevenZip?.version).toBe('19.00');
      const shim = await verifyWindowsPrerequisites({
        platform: 'win32', env, commandRunner: async (command, args, options) => {
          if (basename(command).toLowerCase() === '7z.exe' && args[0] === 'i') return { exitCode: 0, stdout: 'acme archiver 1.0\n', stderr: '' };
          return base(command, args, options);
        }
      });
      expect(shim.checks.find((item) => item.id === '7zip')?.ok).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('resolves installed 7-Zip from the 7-Zip registry key before PATH (custom WinGet location)', async () => {
    const root = await temp('phase7-sevenzip-registry');
    try {
      const custom = join(root, '解压', '7-Zip', '7z.exe');
      await mkdir(dirname(custom), { recursive: true });
      await writeFile(custom, 'fixture');
      const env = { PATH: join(root, 'no-sevenzip-on-path') };
      const runner = async (command: string, args: string[]) => {
        if (basename(command).toLowerCase() === 'reg.exe' && args[0] === 'query' && args[1] === 'HKLM\\SOFTWARE\\7-Zip') {
          return { exitCode: 0, stdout: `\r\n    Path    REG_SZ    ${dirname(custom)}\r\n`, stderr: '' };
        }
        return { exitCode: 0, stdout: '', stderr: '' };
      };
      expect(await resolveWindowsSevenZip({ platform: 'win32', env, commandRunner: runner })).toBe(custom);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('falls back to PATH when the 7-Zip registry key is missing or malformed', async () => {
    const root = await temp('phase7-sevenzip-registry-missing');
    try {
      const bin = join(root, 'bin');
      await mkdir(bin, { recursive: true });
      await writeFile(join(bin, '7z.exe'), 'fixture');
      const env = { PATH: bin };
      const runner = async () => ({ exitCode: 1, stdout: '', stderr: 'ERROR: The system was unable to find the specified registry key or value.' });
      expect(await resolveWindowsSevenZip({ platform: 'win32', env, commandRunner: runner })).toBe(join(bin, '7z.exe'));

      const malformed = async (command: string) => (basename(command).toLowerCase() === 'reg.exe'
        ? { exitCode: 0, stdout: '\r\n    Path    REG_SZ    %NOT_SET%\\7-Zip\r\n', stderr: '' }
        : { exitCode: 1, stdout: '', stderr: '' });
      expect(await resolveWindowsSevenZip({ platform: 'win32', env, commandRunner: malformed })).toBe(join(bin, '7z.exe'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('prefers a standard 7-Zip root over the registry key', async () => {
    const root = await temp('phase7-sevenzip-registry-priority');
    try {
      const standard = join(root, 'Program Files', '7-Zip', '7z.exe');
      await mkdir(dirname(standard), { recursive: true });
      await writeFile(standard, 'fixture');
      const custom = join(root, 'custom', '7z.exe');
      await mkdir(dirname(custom), { recursive: true });
      await writeFile(custom, 'fixture');
      const env = { PATH: join(root, 'no-sevenzip-on-path'), ProgramFiles: join(root, 'Program Files') };
      const runner = async () => ({ exitCode: 0, stdout: `\r\n    Path    REG_SZ    ${dirname(custom)}\r\n`, stderr: '' });
      expect(await resolveWindowsSevenZip({ platform: 'win32', env, commandRunner: runner })).toBe(standard);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects an unrelated 7z shim resolved through the registry key', async () => {
    const root = await temp('phase7-sevenzip-registry-shim');
    try {
      const custom = join(root, 'shim', '7z.exe');
      await mkdir(dirname(custom), { recursive: true });
      await writeFile(custom, 'fixture');
      const { env } = await prerequisiteBin(root);
      const base = prerequisiteRunner();
      const report = await verifyWindowsPrerequisites({
        platform: 'win32', env, commandRunner: async (command, args, options) => {
          if (basename(command).toLowerCase() === 'reg.exe' && args[1]?.includes('7-Zip')) {
            return { exitCode: 0, stdout: `\r\n    Path    REG_SZ    ${dirname(custom)}\r\n`, stderr: '' };
          }
          if (basename(command).toLowerCase() === '7z.exe' && args[0] === 'i') {
            return { exitCode: 0, stdout: 'acme archiver 1.0\n', stderr: '' };
          }
          return base(command, args, options);
        }
      });
      expect(report.checks.find((item) => item.id === '7zip')?.ok).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('resolves the branded program/mutable roots and state layout without using a live profile', async () => {
    const root = await temp('phase7-paths');
    try {
      const paths = resolveHarnessPaths({ platform: 'win32', env: { LOCALAPPDATA: root, APPDATA: join(root, 'appdata') } });
      expect(paths.programRoot).toBe(resolve(root, 'Programs', 'BaiheStudio', 'DSH-RPGMaker-MV'));
      expect(paths.mutableRoot).toBe(resolve(root, 'BaiheStudio', 'DSH-RPGMaker-MV'));
      expect(paths.dshHome).toBe(join(paths.mutableRoot, 'state'));
      expect(paths.logsDir).toBe(join(paths.mutableRoot, 'logs'));
      expect(paths.cacheDir).toBe(join(paths.mutableRoot, 'cache'));
      expect(paths.neutralLandingDir).toBe(join(paths.programRoot, 'neutral'));
      expect(paths.startMenuShortcutPath).toContain(join('BaiheStudio', 'DSH for RPG Maker MV.lnk'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('requires explicit consent before WinGet prerequisite installation and verifies all seven identities', async () => {
    const root = await temp('phase7-prerequisites');
    try {
      const { bin, env } = await prerequisiteBin(root);
      const report = await verifyWindowsPrerequisites({ platform: 'win32', env, commandRunner: prerequisiteRunner() });
      expect(report.ok).toBe(true);
      expect(report.checks.map((check) => check.id)).toEqual(['node', 'python', 'bun', 'powershell', 'git', 'coreutils', '7zip']);
      const missing = await verifyWindowsPrerequisites({ platform: 'win32', env: { PATH: join(root, 'missing') }, commandRunner: prerequisiteRunner() });
      expect(missing.ok).toBe(false);
      await expect(installWindowsPrerequisites({ platform: 'win32', env: { PATH: join(root, 'missing') }, consent: false, commandRunner: prerequisiteRunner() })).rejects.toBeInstanceOf(PrerequisiteConsentError);
      let wingetCalls = 0;
      const baseRunner = prerequisiteRunner();
      const wrongVersionRunner = async (command: string, args: string[], options: { cwd?: string }) => {
        if (args[0] === 'install') {
          wingetCalls += 1;
          return { exitCode: 0, stdout: '', stderr: '' };
        }
        if (basename(command).toLowerCase() === 'node.exe' && args[0] === '--version') return { exitCode: 0, stdout: 'v16.20.0', stderr: '' };
        if (basename(command).toLowerCase() === 'node.exe' && args[0] === '-p') return { exitCode: 0, stdout: 'false', stderr: '' };
        return baseRunner(command, args, options);
      };
      await expect(installWindowsPrerequisites({ platform: 'win32', env, consent: false, wingetExecutable: 'winget.exe', commandRunner: wrongVersionRunner })).rejects.toBeInstanceOf(PrerequisiteConsentError);
      expect(wingetCalls).toBe(0);
      await expect(installWindowsPrerequisites({ platform: 'win32', env, consent: true, wingetExecutable: 'winget.exe', commandRunner: wrongVersionRunner })).rejects.toThrow(/verification still fails/i);
      expect(wingetCalls).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('resolves find/grep from the verified Microsoft Coreutils root even when System32 precedes it on PATH', async () => {
    const root = await temp('phase7-coreutils-shadow');
    try {
      const system32 = join(root, 'System32');
      const coreutilsBin = join(root, 'Program Files', 'coreutils', 'bin');
      await mkdir(system32, { recursive: true });
      await mkdir(coreutilsBin, { recursive: true });
      const { bin, env } = await prerequisiteBin(root);
      for (const name of ['coreutils-manager.exe', 'find.exe', 'grep.exe']) {
        await writeFile(join(coreutilsBin, name), 'fixture');
      }
      await writeFile(join(system32, 'find.exe'), 'fixture windows find');
      // A clean WinGet install appends Coreutils after the inherited System32
      // directory; refreshWindowsEnvironment keeps the old PATH prefix first.
      const shadowed = { ...env, PATH: `${system32};${coreutilsBin};${bin}` };
      const report = await verifyWindowsPrerequisites({ platform: 'win32', env: shadowed, commandRunner: prerequisiteRunner() });
      const coreutils = report.checks.find((check) => check.id === 'coreutils');
      expect(coreutils?.ok).toBe(true);
      expect(coreutils?.executable).toContain('coreutils');
      expect(report.ok).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('reports the resolved non-owned path when Coreutils find/grep are missing', async () => {
    const root = await temp('phase7-coreutils-diagnostic');
    try {
      const system32 = join(root, 'System32');
      const coreutilsBin = join(root, 'Program Files', 'coreutils', 'bin');
      await mkdir(system32, { recursive: true });
      await mkdir(coreutilsBin, { recursive: true });
      const { bin, env } = await prerequisiteBin(root);
      await writeFile(join(coreutilsBin, 'coreutils-manager.exe'), 'fixture');
      await writeFile(join(system32, 'find.exe'), 'fixture windows find');
      const report = await verifyWindowsPrerequisites({ platform: 'win32', env: { ...env, PATH: `${system32};${coreutilsBin};${bin}` }, commandRunner: prerequisiteRunner() });
      const coreutils = report.checks.find((check) => check.id === 'coreutils');
      expect(coreutils?.ok).toBe(false);
      expect(coreutils?.detail).toContain('find resolved to');
      expect(coreutils?.detail).toContain('outside the Coreutils root');
      expect(coreutils?.detail).not.toContain(env.LOCALAPPDATA!);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('Windows install wrappers pass explicit consent to the CLI without touching live roots', async () => {
    if (process.platform !== 'win32') return;
    const root = await temp('phase7-wrapper-100%!');
    try {
      const bin = join(root, 'bin');
      const release = join(root, 'release 100%!');
      const local = join(root, 'local appdata');
      const appdata = join(root, 'roaming appdata');
      const capture = join(root, 'wrapper-argv.json');
      await mkdir(join(release, 'src'), { recursive: true });
      await mkdir(bin, { recursive: true });
      await cp(process.execPath, join(bin, 'bun.exe'));
      await writeFile(join(release, 'install.ps1'), await readFile(join(REPOSITORY_ROOT, 'install.ps1')));
      await writeFile(join(release, 'Install.cmd'), await readFile(join(REPOSITORY_ROOT, 'Install.cmd')));
      await writeFile(join(release, 'src', 'cli.ts'), 'await Bun.write(process.env.WRAPPER_CAPTURE!, JSON.stringify(process.argv));\n');
      const env: Record<string, string | undefined> = { ...process.env, PATH: `${bin};${process.env.PATH ?? ''}`, LOCALAPPDATA: local, APPDATA: appdata, WRAPPER_CAPTURE: capture };
      const powershell = process.env.PWSH_EXECUTABLE ?? 'powershell.exe';
      const direct = await runInteractive(powershell, ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(release, 'install.ps1'), '-NoPause'], env, 'Y\n');
      expect(direct.exitCode).toBe(0);
      const directArgs = JSON.parse(await readFile(capture, 'utf8')) as string[];
      expect(directArgs).toEqual(expect.arrayContaining(['install', '--release-root', release, '--yes']));
      const command = env.ComSpec ?? env.COMSPEC ?? 'cmd.exe';
      const viaCmd = await runCommand(command, ['/d', '/v:off', '/s', '/c', `call "${join(release, 'Install.cmd')}" -Yes -NoPause`], { env, platform: 'win32', timeoutMs: 30_000 });
      expect(viaCmd.exitCode).toBe(0);
      const cmdArgs = JSON.parse(await readFile(capture, 'utf8')) as string[];
      expect(cmdArgs).toEqual(expect.arrayContaining(['install', '--release-root', release, '--yes']));
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
      const presetRoot = join(dshHome, '.agent-presets');
      await mkdir(join(dshHome, 'rpgmaker-mv'), { recursive: true });
      await writeFile(join(dshHome, 'rpgmaker-mv', 'cordis.patch.yml'), renderPresetOnlyPatch(presetRoot, 'rpgmaker'));
      for (const presetId of CUSTOM_AGENT_PRESET_IDS) {
        await mkdir(join(presetRoot, presetId), { recursive: true });
        await writeFile(join(presetRoot, presetId, 'agent.cordis.yml'), '- id: persona\n');
      }
      const report = await runDoctor({
        platform: 'win32', env: { ...env, DEEPSEEK_API_KEY: 'never-report' }, mutableRoot, dshHome, programRoot, runtimeDir: runtime, commandRunner: prerequisiteRunner(),
        verifyAgentDependencies: async () => ({
          mcp: { id: 'rpgmaker-mcp', label: 'RPG Maker MV MCP runtime', ok: true, detail: 'fixture MCP verified' },
          image: { id: 'image-toolchain', label: 'Image asset toolchain', ok: true, detail: 'fixture image tools verified' },
          packager: { id: 'rpgmpacker', label: 'RPG Maker build packager', ok: true, detail: 'fixture packager verified' }
        }),
        verifyImageWorkshopPlugin: async () => ({
          valid: true,
          errors: [],
          packageDir: join(root, 'program', 'bundle', 'dsh-image-workshop'),
          packageVersion: '0.1.0',
          profileDependency: 'link:../../../../program/bundle/dsh-image-workshop',
          bundleOccurrences: 0,
          entrypoint: join(root, 'program', 'bundle', 'dsh-image-workshop', 'lib', 'index.js'),
          ownedPath: true,
          sha256: 'edd700c03856033e08d5886830d6bfee3f7f3e603f94cc10f011849ef0dde05a'
        })
      });
      expect(report.ok).toBe(true);
      expect(report.checks.map((check) => check.id)).toContain('node');
      expect(report.checks.map((check) => check.id)).toContain('python');
      expect(report.checks.map((check) => check.id)).toContain('image-tool-plugin');
      expect(report.executablePaths.python).toContain('python.exe');
      expect(report.checks.map((check) => check.id)).toContain('app-layout');
      expect(report.checks.map((check) => check.id)).not.toContain('vision-toolkit-profile');
      expect(report.checks.map((check) => check.id)).not.toContain('vision-toolkit-provider');
      expect(report.checks.map((check) => check.id)).not.toContain('vision-toolkit-activation');
      expect(report.checks.map((check) => check.id)).not.toContain('vision-toolkit-runtime');
      expect(JSON.stringify(report)).not.toContain('never-report');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('repairs obsolete remote image profile state without touching workspace, credentials, presets, or projects', async () => {
    const root = await temp('phase7-obsolete-image-repair');
    try {
      const dshHome = join(root, 'state');
      const projectPath = await project(root);
      const credential = join(dshHome, '.credentials.yaml');
      const customPreset = join(dshHome, '.agent-presets', 'custom-agent', 'agent.cordis.yml');
      await mkdir(dirname(credential), { recursive: true });
      await writeFile(credential, 'provider: local\n');
      await mkdir(dirname(customPreset), { recursive: true });
      await writeFile(customPreset, 'custom identity\n');
      await writeObsoleteVisionProfileState(dshHome);

      const first = await removeObsoleteVisionToolkitState({ platform: 'win32', dshHome, programRoot: join(root, 'program'), mutableRoot: join(root, 'mutable') });
      expect(first.removed).toBe(true);
      const profile = join(dshHome, 'profiles', 'web');
      const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; dsh?: { profile?: { bundles?: string[] } } };
      expect(manifest.dependencies?.[OBSOLETE_VISION_TOOLKIT_PACKAGE]).toBeUndefined();
      expect(manifest.dependencies?.['@baihestudio/dsh-workspace-mcp']).toBe('file:../../bundle/dsh-workspace-mcp');
      expect(manifest.dsh?.profile?.bundles).toEqual(['@baihestudio/dsh-workspace-mcp']);
      const lock = await readFile(join(profile, 'pnpm-lock.yaml'), 'utf8');
      expect(lock).not.toContain(OBSOLETE_VISION_TOOLKIT_PACKAGE);
      expect(lock).toContain('@baihestudio/dsh-workspace-mcp');
      const patch = await readFile(join(profile, 'cordis.patch.yml'), 'utf8');
      expect(patch).not.toContain(OBSOLETE_VISION_TOOLKIT_PACKAGE);
      expect(patch).toContain('workspace-mcp');
      expect(await Bun.file(join(profile, 'node_modules', '@anionex', 'dsh-vision-toolkit', 'package.json')).exists()).toBe(false);
      expect(await Bun.file(join(profile, 'node_modules', '@baihestudio', 'dsh-workspace-mcp', 'package.json')).exists()).toBe(true);
      expect(await Bun.file(join(profile, 'node_modules', '.pnpm', '@anionex+dsh-vision-toolkit@0.1.31')).exists()).toBe(false);
      expect(await Bun.file(join(dshHome, 'cache', 'dsh-vision-toolkit')).exists()).toBe(false);
      expect(await readFile(credential, 'utf8')).toBe('provider: local\n');
      expect(await readFile(customPreset, 'utf8')).toBe('custom identity\n');
      expect((await stat(projectPath)).isDirectory()).toBe(true);

      const second = await removeObsoleteVisionToolkitState({ platform: 'win32', dshHome, programRoot: join(root, 'program'), mutableRoot: join(root, 'mutable') });
      expect(second.removed).toBe(false);
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
      let dependencyPreparations = 0;
      const result = await installWindowsRelease({
        platform: 'win32',
        env: { ...env, DEEPSEEK_API_KEY: 'must-not-be-written' },
        releaseRoot: REPOSITORY_ROOT,
        programRoot: program,
        mutableRoot: mutable,
        dshHome: state,
        commandRunner: prerequisiteRunner(),
        consent: true,
        prepareAgentDependencies: async ({ paths, bunExecutable }) => {
          dependencyPreparations += 1;
          expect(paths.programRoot).toBe(program);
          expect(bunExecutable.toLowerCase()).toContain('bun');
        },
        createShortcut: async (options) => {
          await mkdir(resolve(options.targetPath, '..'), { recursive: true });
          await writeFile(options.targetPath + '.shortcut-test', options.targetPath);
          return resolve(options.targetPath, '..', 'DSH for RPG Maker MV.lnk');
        }
      });
      expect(result.paths.programRoot).toBe(program);
      expect(dependencyPreparations).toBe(1);
      expect(await Bun.file(join(program, 'Install.cmd')).exists()).toBe(true);
      expect(await Bun.file(join(program, PROGRAM_OWNERSHIP_FILE)).exists()).toBe(true);
      const metadata = JSON.parse(await readFile(join(program, 'install.json'), 'utf8'));
      expect(metadata.owner).toBe(PROGRAM_OWNER);
      expect(metadata.prerequisites.some((item: { id: string }) => item.id === 'python')).toBe(true);
      expect(await Bun.file(join(program, 'runtime', 'dsh', 'package.json')).exists()).toBe(true);
      expect(await Bun.file(join(program, WORKSPACE_MCP_BUNDLE_RELATIVE, 'package.json')).exists()).toBe(true);
      expect(await Bun.file(join(program, WORKSPACE_MCP_BUNDLE_RELATIVE, 'lib', 'xerolo-manifest.js')).exists()).toBe(true);
      expect((await stat(join(mutable, 'logs'))).isDirectory()).toBe(true);
      expect((await stat(join(mutable, 'cache'))).isDirectory()).toBe(true);
      expect(await readFile(join(program, 'install.json'), 'utf8')).not.toContain('must-not-be-written');
      expect(await readFile(join(state, '.credentials.yaml'), 'utf8')).toContain('provider: local');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('default install and repair prepare owned pnpm, MCPorter, and Xerolo runtimes', async () => {
    const root = await temp('phase7-default-dependencies');
    try {
      const { bin, env: prerequisiteEnv } = await prerequisiteBin(root);
      const imageMagick = join(bin, 'magick.exe');
      const oxipng = join(bin, 'oxipng.exe');
      await writeFile(imageMagick, 'fixture ImageMagick');
      await writeFile(oxipng, 'fixture oxipng');
      const mutable = join(root, 'mutable');
      const program = join(root, 'Programs', 'BaiheStudio', 'DSH-RPGMaker-MV');
      const state = join(mutable, 'state');
      await writeObsoleteVisionProfileState(state);
      const bun = join(bin, 'bun.exe');
      const npm = join(bin, 'npm.cmd');
      const node = join(bin, 'node.exe');
      const env = {
        ...prerequisiteEnv,
        BUN_EXECUTABLE: bun,
        NPM_EXECUTABLE: npm,
        NODE_EXECUTABLE: node,
        DSH_IMAGE_MAGICK: imageMagick,
        DSH_IMAGE_MAGICK_SHA256: sha256('fixture ImageMagick'),
        DSH_OXIPNG: oxipng,
        DSH_OXIPNG_SHA256: sha256('fixture oxipng')
      };
      const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
      const commandRunner = defaultInstallRunner({ dshHome: state }, calls);
      const install = () => installWindowsRelease({
        platform: 'win32',
        env,
        releaseRoot: REPOSITORY_ROOT,
        programRoot: program,
        mutableRoot: mutable,
        dshHome: state,
        bunExecutable: bun,
        npmExecutable: npm,
        commandRunner,
        consent: true,
        createShortcut: async ({ targetPath }) => {
          const shortcut = join(root, 'Start Menu', 'DSH for RPG Maker MV.lnk');
          await mkdir(dirname(shortcut), { recursive: true });
          await writeFile(shortcut, targetPath);
          return shortcut;
        }
      });

      await install();
      expect(calls.some((call) => call.args.includes(`pnpm@${PNPM_VERSION}`))).toBe(true);
      expect(calls.some((call) => call.args.includes(OBSOLETE_VISION_TOOLKIT_PACKAGE))).toBe(false);
      expect(await Bun.file(join(state, 'profiles', 'web', 'node_modules', '@anionex', 'dsh-vision-toolkit')).exists()).toBe(false);
      expect(await Bun.file(join(state, 'cache', 'dsh-vision-toolkit')).exists()).toBe(false);
      expect(calls.some((call) => call.args.includes(`${MCPORTER_PACKAGE}@${MCPORTER_VERSION}`))).toBe(true);
      expect(calls.some((call) => call.args.includes(`${RPGMAKER_MCP_PACKAGE}@${RPGMAKER_MCP_VERSION}`))).toBe(true);
      expect(await Bun.file(join(program, 'runtime', 'pnpm', 'node_modules', 'pnpm', 'package.json')).exists()).toBe(true);
      expect(await Bun.file(join(program, 'runtime', 'mcporter', 'node_modules', MCPORTER_PACKAGE, 'dist', 'index.js')).exists()).toBe(true);
      expect(await Bun.file(join(program, 'runtime', 'mcp', 'node_modules', ...RPGMAKER_MCP_PACKAGE.split('/'), 'dist', 'index.js')).exists()).toBe(true);

      calls.length = 0;
      await install();
      expect(calls.some((call) => call.args.includes(`${MCPORTER_PACKAGE}@${MCPORTER_VERSION}`))).toBe(true);
      expect(await Bun.file(join(program, 'runtime', 'mcporter', 'package.json')).exists()).toBe(true);
      expect(await Bun.file(join(program, 'runtime', 'mcp', 'package.json')).exists()).toBe(true);
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

  test('rejects every caller binding bypass form and emits one canonical fixed binding', async () => {
    const rejected = [
      ['--host', '0.0.0.0'],
      ['--host=0.0.0.0'],
      ['--port', '3082'],
      ['--port=3082']
    ];
    for (const args of rejected) expect(() => addFixedWebBinding(args)).toThrow(/fixed at 127\.0\.0\.1:3081/i);
    expect(addFixedWebBinding(['--host', '127.0.0.1', '--port=3081', '--profile', 'web'])).toEqual(['--profile', 'web', '--host', '127.0.0.1', '--port', '3081']);
    let stderr = '';
    for (const argv of [
      ['launch', '--host', '0.0.0.0'],
      ['launch', '--host=0.0.0.0'],
      ['launch', '--port', '3082'],
      ['launch', '--port=3082'],
      ['launch', '--host=0.0.0.0', '--host=127.0.0.1']
    ]) {
      await expect(runCli(argv, {
        platform: 'win32',
        io: { stdout: { write: () => undefined }, stderr: { write: (text) => { stderr += text; } } }
      })).resolves.toBe(1);
    }
    expect(stderr).toMatch(/fixed at 127\.0\.0\.1:3081/i);
  });

  test('post-swap bootstrap, metadata, and shortcut failures restore the old tree and retain the failed tree', async () => {
    for (const failure of ['bootstrap', 'metadata', 'shortcut'] as const) {
      const root = await temp(`phase7-transaction-${failure}`);
      try {
        const { env } = await prerequisiteBin(root);
        const program = join(root, 'Programs', 'BaiheStudio', 'DSH-RPGMaker-MV');
        const mutable = join(root, 'mutable');
        const state = join(mutable, 'state');
        await mkdir(join(program, 'tools', 'image-workshop', 'native-tools'), { recursive: true });
        await writeFile(join(program, 'old-tree.txt'), `prior ${failure}\n`);
        await writeFile(join(program, 'tools', 'image-workshop', 'native-tools', 'preserved-tool.txt'), 'verified dependency fixture\n');
        const baseRunner = prerequisiteRunner();
        const commandRunner = failure === 'bootstrap'
          ? async (command: string, args: string[], options: { cwd?: string }) => args[0] === 'add'
            ? { exitCode: 1, stdout: '', stderr: 'bootstrap fixture failure' }
            : baseRunner(command, args, options)
          : baseRunner;
        const installOptions = {
          platform: 'win32',
          env,
          releaseRoot: REPOSITORY_ROOT,
          programRoot: program,
          mutableRoot: mutable,
          dshHome: state,
          commandRunner,
          consent: true,
          prepareAgentDependencies,
          ...(failure === 'metadata' ? { writeInstallMetadata: async () => { throw new Error('metadata fixture failure'); } } : {}),
          ...(failure === 'shortcut' ? { createShortcut: async () => { throw new Error('shortcut fixture failure'); } } : {})
        };
        await expect(installWindowsRelease(installOptions)).rejects.toThrow(/prior program tree was restored|recovery is degraded/i);
        expect(await readFile(join(program, 'old-tree.txt'), 'utf8')).toBe(`prior ${failure}\n`);
        const entries = await readdir(dirname(program));
        const failed = entries.find((entry) => entry.startsWith(`${basename(program)}.failed-`));
        expect(failed).toBeDefined();
        expect(await Bun.file(join(dirname(program), failed!, 'Install.cmd')).exists()).toBe(true);
        expect(await readFile(join(dirname(program), failed!, 'tools', 'image-workshop', 'native-tools', 'preserved-tool.txt'), 'utf8')).toBe('verified dependency fixture\n');
        expect(await Bun.file(join(program, 'install.json')).exists()).toBe(false);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  test('first-install post-swap failure reports no prior tree and preserves diagnostics', async () => {
    const root = await temp('phase7-first-install-failure');
    try {
      const { env } = await prerequisiteBin(root);
      const program = join(root, 'Programs', 'BaiheStudio', 'DSH-RPGMaker-MV');
      const mutable = join(root, 'mutable');
      await expect(installWindowsRelease({
        platform: 'win32',
        env,
        releaseRoot: REPOSITORY_ROOT,
        programRoot: program,
        mutableRoot: mutable,
        dshHome: join(mutable, 'state'),
        commandRunner: prerequisiteRunner(),
        consent: true,
        prepareAgentDependencies,
        writeInstallMetadata: async () => { throw new Error('first install metadata failure'); }
      })).rejects.toThrow(/no prior program tree existed; the install path is inactive/i);
      expect(await Bun.file(program).exists()).toBe(false);
      const entries = await readdir(dirname(program));
      const failed = entries.find((entry) => entry.startsWith(`${basename(program)}.failed-`));
      expect(failed).toBeDefined();
      expect(await Bun.file(join(dirname(program), failed!, 'Install.cmd')).exists()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
      const options = { platform: 'win32', programRoot: program, mutableRoot: mutable, dshHome: state, runtimeDir: join(program, 'runtime', 'dsh'), startMenuShortcutPath: shortcut };
      await writeFile(join(program, PROGRAM_OWNERSHIP_FILE), `${JSON.stringify({ owner: PROGRAM_OWNER, product: PRODUCT_NAME, format: 1 })}\n`);
      await writeFile(join(program, 'install.json'), `${JSON.stringify({ owner: PROGRAM_OWNER, product: PRODUCT_NAME, format: 1, programRoot: program, mutableRoot: mutable, dshHome: state, runtimeDir: join(program, 'runtime', 'dsh') })}\n`);
      const outerRollback = `${program}.rollback-old`;
      await mkdir(outerRollback, { recursive: true });
      await writeFile(join(outerRollback, 'old-runtime.txt'), 'preserve me');
      const nestedRollback = join(program, 'runtime', 'dsh.rollback-old');
      await mkdir(nestedRollback, { recursive: true });
      await writeFile(join(nestedRollback, 'old-runtime.txt'), 'preserve nested me');
      const first = await uninstallHarness(options);
      expect(first.purged).toBe(false);
      expect(await Bun.file(program).exists()).toBe(false);
      expect(await Bun.file(cache).exists()).toBe(false);
      expect(await Bun.file(join(state, '.credentials.yaml')).exists()).toBe(true);
      expect(await Bun.file(join(outerRollback, 'old-runtime.txt')).exists()).toBe(true);
      expect(first.preserved).toContain(outerRollback);
      expect(first.preserved.some((entry) => entry.includes('.recovery-'))).toBe(true);
      expect((await stat(projectPath)).isDirectory()).toBe(true);
      await mkdir(cache, { recursive: true });
      const purged = await uninstallHarness({ ...options, purge: true });
      expect(purged.purged).toBe(true);
      expect(await Bun.file(mutable).exists()).toBe(false);
      expect((await stat(projectPath)).isDirectory()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('uninstall refuses an unowned program tree before deleting any app state', async () => {
    const root = await temp('phase7-uninstall-safety');
    try {
      const program = join(root, 'program');
      const mutable = join(root, 'mutable');
      const cache = join(mutable, 'cache');
      const shortcut = join(root, 'Start Menu', 'DSH.lnk');
      await mkdir(program, { recursive: true });
      await mkdir(cache, { recursive: true });
      await mkdir(dirname(shortcut), { recursive: true });
      await writeFile(join(program, 'user-file.txt'), 'must remain');
      await writeFile(join(cache, 'cache.txt'), 'must remain');
      await writeFile(shortcut, 'must remain');
      await expect(uninstallHarness({ platform: 'win32', programRoot: program, mutableRoot: mutable, dshHome: join(mutable, 'state'), startMenuShortcutPath: shortcut })).rejects.toBeInstanceOf(UninstallSafetyError);
      expect(await Bun.file(join(program, 'user-file.txt')).exists()).toBe(true);
      expect(await Bun.file(join(cache, 'cache.txt')).exists()).toBe(true);
      expect(await Bun.file(shortcut).exists()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('builds and inspects a real Release ZIP from the checked-in journey files', async () => {
    const root = await temp('phase7-zip');
    try {
      const zip = join(root, 'DSH-RPGMaker-MV-Windows.zip');
      const archive = await buildReleaseZip({ sourceRoot: REPOSITORY_ROOT, outputZip: zip, platform: process.platform });
      const inspection = await inspectReleaseZip({ zipPath: archive, platform: process.platform });
      expect(inspection.valid).toBe(true);
      expect(inspection.entries).toContain('Install.cmd');
      expect(inspection.entries).toContain('src/cli.ts');
      expect(inspection.entries).toContain('src/profile.ts');
      expect(inspection.entries).toContain('src/profile-repair.ts');
      expect(inspection.entries).not.toContain('src/vision-toolkit.ts');
      expect(inspection.entries.some((entry) => entry.includes('phase8') || entry.includes('vision-toolkit'))).toBe(false);
      expect(inspection.entries).toContain(WINDOWS_GATE_CLEANUP_HELPER_RELATIVE);
      expect(inspection.entries).toContain(`${WORKSPACE_MCP_BUNDLE_ARCHIVE_RELATIVE}/package.json`);
      expect(inspection.entries).toContain(`${WORKSPACE_MCP_BUNDLE_ARCHIVE_RELATIVE}/cordis.patch.yml`);
      expect(inspection.entries).toContain(`${WORKSPACE_MCP_BUNDLE_ARCHIVE_RELATIVE}/${WORKSPACE_MCP_AGENT_ENTRYPOINT}`);
      expect(inspection.entries).toContain(`${WORKSPACE_MCP_BUNDLE_ARCHIVE_RELATIVE}/lib/index.js`);
      expect(inspection.entries).toContain(`${WORKSPACE_MCP_BUNDLE_ARCHIVE_RELATIVE}/lib/mcport-host.js`);
      expect(inspection.entries).toContain(`${WORKSPACE_MCP_BUNDLE_ARCHIVE_RELATIVE}/lib/xerolo-manifest.js`);
      const windowsListing = inspection.entries.map((entry) => entry.replaceAll('/', '\\')).join('\r\n');
      const windowsInspection = await inspectReleaseZip({
        zipPath: archive,
        platform: 'win32',
        unzipExecutable: 'fixture-unzip.exe',
        commandRunner: async () => ({ exitCode: 0, stdout: windowsListing, stderr: '' })
      });
      expect(windowsInspection.valid).toBe(true);
      expect(windowsInspection.requiredEntries.every((entry) => !entry.includes('\\'))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('repairs the installed web-profile bundle after a Release ZIP extraction and deliberate link break', async () => {
    const root = await temp('phase7-release-repair-选择');
    try {
      const archive = join(root, 'DSH-RPGMaker-MV-Windows.zip');
      await buildReleaseZip({ sourceRoot: REPOSITORY_ROOT, outputZip: archive, platform: process.platform });
      const extracted = join(root, 'extracted Release 选择 with spaces');
      await mkdir(extracted, { recursive: true });
      const extractor = process.platform === 'win32' ? await resolveExecutable('tar', { platform: process.platform, env: process.env }) : await resolveExecutable('unzip', { platform: process.platform, env: process.env });
      expect(extractor).toBeDefined();
      const extractedResult = process.platform === 'win32'
        ? await runCommand(extractor!, ['-xf', archive, '-C', extracted], { platform: process.platform, env: process.env, timeoutMs: 60_000 })
        : await runCommand(extractor!, ['-q', archive, '-d', extracted], { platform: process.platform, env: process.env, timeoutMs: 60_000 });
      expect(extractedResult.exitCode).toBe(0);
      expect(await Bun.file(join(extracted, 'Launch.cmd')).exists()).toBe(true);

      const { bin, env: prerequisiteEnv } = await prerequisiteBin(root);
      const imageMagick = join(bin, 'magick.exe');
      const oxipng = join(bin, 'oxipng.exe');
      await writeFile(imageMagick, 'fixture ImageMagick');
      await writeFile(oxipng, 'fixture oxipng');
      const mutable = join(root, 'Mutable state 选择 with spaces');
      const program = join(root, 'Programs', 'BaiheStudio', 'DSH-RPGMaker-MV');
      const state = join(mutable, 'state');
      await writeObsoleteVisionProfileState(state);
      const bun = join(bin, 'bun.exe');
      const npm = join(bin, 'npm.cmd');
      const env = {
        ...prerequisiteEnv,
        BUN_EXECUTABLE: bun,
        NPM_EXECUTABLE: npm,
        NODE_EXECUTABLE: join(bin, 'node.exe'),
        DSH_IMAGE_MAGICK: imageMagick,
        DSH_IMAGE_MAGICK_SHA256: sha256('fixture ImageMagick'),
        DSH_OXIPNG: oxipng,
        DSH_OXIPNG_SHA256: sha256('fixture oxipng')
      };
      const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
      const runner = defaultInstallRunner({ dshHome: state }, calls);
      const shortcut = join(root, 'Start Menu', 'DSH for RPG Maker MV.lnk');
      await installWindowsRelease({
        platform: 'win32',
        env,
        releaseRoot: extracted,
        programRoot: program,
        mutableRoot: mutable,
        dshHome: state,
        bunExecutable: bun,
        npmExecutable: npm,
        commandRunner: runner,
        consent: true,
        createShortcut: async () => {
          await mkdir(dirname(shortcut), { recursive: true });
          await writeFile(shortcut, 'fixture shortcut');
          return shortcut;
        }
      });

      const dshExecutable = await findDshExecutable(join(program, 'runtime', 'dsh'), 'win32');
      expect(dshExecutable).toBeDefined();
      const launchRunner = async (command: string, args: string[], options: { cwd?: string; env?: Record<string, string | undefined>; platform?: string; timeoutMs?: number }) => {
        if (args.includes('--dump-config')) return { exitCode: 0, stdout: '- id: timeout-policy\n  name: "@deepseek-ai/dsh-tool-call-timeout-policy"\n- id: agent-presets\n', stderr: '' };
        return runner(command, args, options);
      };
      const launchOptions = {
        platform: 'win32',
        env,
        dshHome: state,
        programRoot: program,
        mutableRoot: mutable,
        runtimeDir: join(program, 'runtime', 'dsh'),
        mcporterRuntimeDir: join(program, 'runtime', 'mcporter'),
        mcpRuntimeDir: join(program, 'runtime', 'mcp'),
        dshExecutable,
        bunExecutable: bun,
        npmExecutable: npm,
        sourceRoot: join(program, 'presets', 'rpgmaker'),
        commandRunner: launchRunner
      } as const;

      const firstPreparation = await prepareRpgMakerLaunch(launchOptions);
      expect(firstPreparation.workspaceMcpBundle.valid).toBe(true);
      const profilePackage = join(state, 'profiles', 'web', 'node_modules', '@baihestudio', 'dsh-workspace-mcp');
      await rm(profilePackage, { recursive: true, force: true });
      const broken = await verifyWorkspaceMcpBundle({ platform: 'win32', env, dshHome: state, programRoot: program, mutableRoot: mutable, runtimeDir: join(program, 'runtime', 'dsh') });
      expect(broken.valid).toBe(false);
      expect(broken.errors.join(' ')).toMatch(/installed profile package/i);

      const repairedPreparation = await prepareRpgMakerLaunch(launchOptions);
      expect(repairedPreparation.workspaceMcpBundle.valid).toBe(true);
      expect((await verifyWorkspaceMcpBundle({ platform: 'win32', env, dshHome: state, programRoot: program, mutableRoot: mutable, runtimeDir: join(program, 'runtime', 'dsh') })).valid).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('adds fixed binding args only for the project-neutral DSH web launch', async () => {
    const root = await temp('phase7-launch');
    try {
      const dsh = join(root, 'dsh.exe');
      await writeFile(dsh, 'fixture');
      const launched = child();
      let args: string[] = [];
      let probes = 0;
      const opened: string[] = [];
      const result = await launchProject({
        platform: 'win32',
        dshHome: join(root, 'mutable', 'state'),
        mutableRoot: join(root, 'mutable'),
        programRoot: join(root, 'program'),
        dshExecutable: dsh,
        bindWeb: true,
        portProbe: async () => { probes += 1; return probes > 1; },
        openExistingSession: async (url) => { opened.push(url); },
        dshArgs: ['--profile', 'web', '--patch', 'composition.yml'],
        env: {},
        spawnInteractive: (_command, received) => { args = received; return launched; }
      });
      expect(args).toEqual(['--profile', 'web', '--patch', 'composition.yml', '--host', '127.0.0.1', '--port', '3081']);
      expect(opened).toEqual(['http://127.0.0.1:3081/']);
      expect(result.cwd).toBe(join(root, 'program', 'neutral'));
      await expect(Bun.file(join(root, 'mutable', 'recent-projects.json')).exists()).resolves.toBe(false);
      launched.exitCode = 0;
      launched.emit('exit', 0);
      await result.releaseSession();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
