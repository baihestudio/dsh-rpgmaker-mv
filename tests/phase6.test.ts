import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildRelease,
  detectRpgMakerMvInstallation,
  inspectReleaseArtifact,
  ReleaseError,
  smokeWebArtifact,
  smokeWindowsArtifact,
  verifyRpgmPackerRuntime,
  RPGMPACKER_NPM_INTEGRITY,
  RPGMPACKER_SCRIPT,
  RPGMPACKER_VERSION
} from '../src/release';
import { isSuccessfulProjectValidation, prepareRpgMakerDeployment } from '../src/rpgmaker';
import { runCli } from '../src/cli';
import { DSH_VERSION } from '../src/config';
import type { CommandOptions, CommandResult } from '../src/process';

const REQUIRED_MCP_TOOLS = [
  'get_project_info', 'list_records', 'get_record', 'update_record', 'create_record',
  'create_event', 'get_event', 'update_event', 'add_dialogue', 'update_map', 'get_map',
  'configure_plugin', 'list_plugins', 'validate_project', 'list_backups', 'restore_backup',
  'playtest_start', 'playtest_status', 'playtest_log', 'playtest_stop'
];

async function temp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

async function makeProject(root: string, name = '选择 project with spaces'): Promise<string> {
  const project = join(root, name);
  await mkdir(join(project, 'data'), { recursive: true });
  await mkdir(join(project, 'js'), { recursive: true });
  await writeFile(join(project, 'Game.rpgproject'), '{}\n');
  await writeFile(join(project, 'index.html'), '<!doctype html><html><body>fixture</body></html>\n');
  await writeFile(join(project, 'data', 'System.json'), '{"gameTitle":"Fixture"}\n');
  await writeFile(join(project, 'js', 'main.js'), 'console.log("fixture");\n');
  return project;
}

async function makeInstallation(root: string): Promise<string> {
  const installation = join(root, 'RPG Maker MV 安装');
  await mkdir(join(installation, 'nwjs-win'), { recursive: true });
  await writeFile(join(installation, 'nwjs-win', 'Game.exe'), 'disposable Windows template\n');
  return installation;
}

async function writePackerRuntime(runtime: string): Promise<void> {
  await mkdir(join(runtime, 'node_modules', 'rpgmpacker', 'dist'), { recursive: true });
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ name: 'rpgmpacker-runtime', private: true, dependencies: { rpgmpacker: RPGMPACKER_VERSION } }));
  await writeFile(join(runtime, 'bun.lock'), JSON.stringify({
    lockfileVersion: 1,
    workspaces: { '': { dependencies: { rpgmpacker: RPGMPACKER_VERSION } } },
    packages: { rpgmpacker: [`rpgmpacker@${RPGMPACKER_VERSION}`, 'registry.npmjs.org', { bin: { rpgmpacket: RPGMPACKER_SCRIPT } }, RPGMPACKER_NPM_INTEGRITY] }
  }));
  await writeFile(join(runtime, 'node_modules', 'rpgmpacker', 'package.json'), JSON.stringify({ name: 'rpgmpacker', version: RPGMPACKER_VERSION, bin: { rpgmpacket: RPGMPACKER_SCRIPT } }));
  await writeFile(join(runtime, 'node_modules', 'rpgmpacker', 'dist', 'index.js'), 'fixture packer entry\n');
}

async function makePackerRuntime(root: string): Promise<string> {
  const runtime = join(root, 'packer runtime');
  await writePackerRuntime(runtime);
  return runtime;
}

async function makeJavaScriptRunner(root: string, name = 'bun'): Promise<string> {
  const runner = join(root, 'runtime with spaces', name);
  await mkdir(resolve(runner, '..'), { recursive: true });
  await writeFile(runner, 'disposable direct JavaScript runner\n');
  return runner;
}

async function makePackagedOutputs(output: string, targets: string[]): Promise<void> {
  for (const target of targets) {
    if (target === 'Windows') {
      await mkdir(join(output, 'Windows', 'www', 'data'), { recursive: true });
      await mkdir(join(output, 'Windows', 'www', 'js'), { recursive: true });
      await writeFile(join(output, 'Windows', 'Game.exe'), 'disposable game\n');
      await writeFile(join(output, 'Windows', 'www', 'index.html'), '<html>Windows</html>\n');
      await writeFile(join(output, 'Windows', 'www', 'data', 'System.json'), '{}\n');
      await writeFile(join(output, 'Windows', 'www', 'js', 'main.js'), 'console.log("Windows");\n');
    } else {
      await mkdir(join(output, 'Browser', 'data'), { recursive: true });
      await mkdir(join(output, 'Browser', 'js'), { recursive: true });
      await writeFile(join(output, 'Browser', 'index.html'), '<html>Browser</html>\n');
      await writeFile(join(output, 'Browser', 'data', 'System.json'), '{}\n');
      await writeFile(join(output, 'Browser', 'js', 'main.js'), 'console.log("Browser");\n');
    }
  }
}

describe('validate_project result boundary', () => {
  test('requires a non-error result with ok true and no validation errors', () => {
    expect(isSuccessfulProjectValidation({ isError: false, ok: true })).toBe(true);
    expect(isSuccessfulProjectValidation({ ok: true, errors: [] })).toBe(true);
    expect(isSuccessfulProjectValidation({ isError: true, ok: true })).toBe(false);
    expect(isSuccessfulProjectValidation({ isError: false, ok: true, errors: ['missing System.json'] })).toBe(false);
    expect(isSuccessfulProjectValidation({ isError: false, ok: true, errors: 'none' })).toBe(false);
    expect(isSuccessfulProjectValidation({ isError: false, content: [{ type: 'text', text: '{"ok":true,"errors":[]}' }] })).toBe(true);
    expect(isSuccessfulProjectValidation({ isError: false, content: [{ type: 'text', text: '{"ok":true,"errors":["broken"]}' }] })).toBe(false);
  });

  test('does not retain the unrequested release CLI alias', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    await expect(runCli(['release'], {
      env: {},
      io: { stdout: { write: (text) => { stdout.push(text); } }, stderr: { write: (text) => { stderr.push(text); } } }
    })).resolves.toBe(2);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toContain('build-release');
  });
});

function fakePackerRunner(projectPath: string, order: string[], mode: 'success' | 'failure' | 'invalid' | 'mutate' = 'success') {
  return async (command: string, args: string[], options: CommandOptions): Promise<CommandResult> => {
    const first = args[0] ?? '';
    if (first === 'add') {
      await writePackerRuntime(options.cwd!);
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (first.endsWith('dist/index.js')) {
      order.push('package');
      expect(args).toContain('--input');
      expect(args[args.indexOf('--input') + 1]).toBe(await realpath(projectPath));
      if (mode === 'failure') return { exitCode: 17, stdout: '', stderr: 'template copy failed' };
      const output = args[args.indexOf('--output') + 1];
      const platformIndex = args.indexOf('--platforms');
      const targets = args.slice(platformIndex + 1);
      if (mode === 'invalid') {
        await mkdir(output, { recursive: true });
      } else {
        await makePackagedOutputs(output, targets);
      }
      if (mode === 'mutate') await writeFile(join(projectPath, 'data', 'System.json'), 'packager changed the source\n');
      return { exitCode: 0, stdout: 'Finished with Platform', stderr: '' };
    }
    throw new Error(`unexpected command ${command} ${args.join(' ')}`);
  };
}

function fakeChild(exitCode: number | null = null): EventEmitter & { exitCode: number | null; signalCode: string | null } {
  const child = new EventEmitter() as EventEmitter & { exitCode: number | null; signalCode: string | null };
  child.exitCode = exitCode;
  child.signalCode = null;
  return child;
}

async function makeDshRuntime(root: string): Promise<string> {
  const runtime = join(root, 'dsh runtime');
  await mkdir(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets', 'code'), { recursive: true });
  await writeFile(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: DSH_VERSION, bin: { dsh: 'lib/bin.js' } }));
  await mkdir(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib'), { recursive: true });
  await writeFile(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), 'fixture');
  await writeFile(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets', 'code', 'agent.cordis.yml'), "- id: code-tool\n  name: fake-code-tool\n- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n");
  return runtime;
}

async function makeMcpRuntime(runtime: string): Promise<void> {
  await mkdir(join(runtime, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp', 'dist'), { recursive: true });
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ dependencies: { '@xerolo44/rpgmaker-mv-mcp': '0.1.0' } }));
  await writeFile(join(runtime, 'bun.lock'), JSON.stringify({
    lockfileVersion: 1,
    workspaces: { '': { dependencies: { '@xerolo44/rpgmaker-mv-mcp': '0.1.0' } } },
    packages: { '@xerolo44/rpgmaker-mv-mcp': ['@xerolo44/rpgmaker-mv-mcp@0.1.0', 'registry.npmjs.org', { bin: { 'rpgmaker-mv-mcp': 'dist/index.js' } }, 'sha512-oXdkSGKGiYAtexcoZBXhyUQub6zoYQ4tMU2aKTjAcqeKhUpQ4BypjuS0EYJ78/7zmOq3TwFNBkEaZyb8q+SGuA=='] }
  }));
  await writeFile(join(runtime, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp', 'package.json'), JSON.stringify({ version: '0.1.0', bin: { 'rpgmaker-mv-mcp': 'dist/index.js' } }));
  await writeFile(join(runtime, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp', 'dist', 'index.js'), 'fixture');
}

describe('build-release packaging boundary', () => {
  test('requires a detected MV installation and rejects a missing explicit path', async () => {
    const root = await temp('phase6-missing-mv');
    try {
      await expect(detectRpgMakerMvInstallation({ installationPath: join(root, 'missing'), targets: ['Windows', 'Browser'] })).rejects.toThrow(/RPG Maker MV installation/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('verifies the pinned rpgmpacker entry and lock integrity', async () => {
    const root = await temp('phase6-packer-lock');
    try {
      const runtime = await makePackerRuntime(root);
      const valid = await verifyRpgmPackerRuntime(runtime);
      expect(valid).toMatchObject({ valid: true, version: RPGMPACKER_VERSION, script: join(runtime, 'node_modules', 'rpgmpacker', RPGMPACKER_SCRIPT) });
      await writeFile(join(runtime, 'bun.lock'), (await readFile(join(runtime, 'bun.lock'), 'utf8')).replace(RPGMPACKER_NPM_INTEGRITY, 'sha512-tampered'));
      expect((await verifyRpgmPackerRuntime(runtime)).errors.join(' ')).toContain('integrity');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('validates through the existing MCP before packaging special paths and leaves the source unchanged', async () => {
    const root = await temp('phase6-special-path');
    try {
      const project = await makeProject(root);
      const installation = await makeInstallation(root);
      const runner = await makeJavaScriptRunner(root);
      const output = join(root, 'build output with spaces', '发布物');
      const releaseRuntime = join(root, 'release runtime');
      const order: string[] = [];
      let validated = false;
      const sourceBefore = await readFile(join(project, 'data', 'System.json'), 'utf8');
      const result = await buildRelease({
        platform: 'darwin',
        env: { PATH: '' },
        projectPath: project,
        outputRoot: output,
        targets: ['Windows', 'Browser'],
        rpgmakerInstallationPath: installation,
        releaseRuntimeDir: releaseRuntime,
        jsExecutable: runner,
        prepareDeployment: async () => { order.push('prepare'); },
        validateProject: async () => { validated = true; order.push('validate'); },
        commandRunner: fakePackerRunner(project, order)
      });
      expect(validated).toBe(true);
      expect(order).toEqual(['prepare', 'validate', 'package']);
      expect(result.validation).toBe('existing-rpgmaker-mcp');
      expect(result.packer.script.endsWith('/rpgmpacker/dist/index.js')).toBe(true);
      expect(result.packer.args).not.toContain('--exclude');
      expect(result.packer.args).not.toContain('--hardlinks');
      expect(result.packer.args).not.toContain('--encryptImages');
      expect(result.packer.args).toContain(installation);
      expect(result.artifacts[0].smoke).toMatchObject({ status: 'unsupported', cleanup: 'not-run' });
      expect(result.artifacts[1].smoke).toMatchObject({ status: 'passed', cleanup: 'confirmed' });
      expect(await readFile(join(project, 'data', 'System.json'), 'utf8')).toBe(sourceBefore);
      expect(await readFile(join(output, 'Browser', 'index.html'), 'utf8')).toContain('Browser');
      await expect(buildRelease({
        platform: 'darwin', env: { PATH: '' }, projectPath: project, outputRoot: output,
        rpgmakerInstallationPath: installation, releaseRuntimeDir: releaseRuntime, jsExecutable: runner,
        prepareDeployment: async () => undefined, validateProject: async () => undefined,
        commandRunner: fakePackerRunner(project, [])
      })).rejects.toThrow(/fresh destination|overwrite/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('reports packager failures and invalid artifact output without claiming a build', async () => {
    const root = await temp('phase6-packaging-errors');
    try {
      const project = await makeProject(root);
      const installation = await makeInstallation(root);
      const runner = await makeJavaScriptRunner(root);
      for (const mode of ['failure', 'invalid', 'mutate'] as const) {
        const output = join(root, `output-${mode}`);
        await expect(buildRelease({
          platform: 'darwin', env: { PATH: '' }, projectPath: project, outputRoot: output,
          targets: ['Browser'], rpgmakerInstallationPath: installation,
          releaseRuntimeDir: join(root, `runtime-${mode}`), jsExecutable: runner,
          prepareDeployment: async () => undefined, validateProject: async () => undefined,
          commandRunner: fakePackerRunner(project, [], mode)
        })).rejects.toThrow(mode === 'failure' ? /exit code 17|template copy failed/i : mode === 'invalid' ? /Invalid Browser artifact/i : /Source project changed/i);
        expect(await Bun.file(output).exists()).toBe(false);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects output paths inside the source project before invoking the packer', async () => {
    const root = await temp('phase6-source-boundary');
    try {
      const project = await makeProject(root);
      const installation = await makeInstallation(root);
      const runner = await makeJavaScriptRunner(root);
      let called = false;
      await expect(buildRelease({
        platform: 'darwin', env: { PATH: '' }, projectPath: project, outputRoot: join(project, 'release'),
        rpgmakerInstallationPath: installation, jsExecutable: runner,
        prepareDeployment: async () => undefined, validateProject: async () => undefined,
        commandRunner: async () => { called = true; return { exitCode: 0, stdout: '', stderr: '' }; }
      })).rejects.toThrow(/outside the source project|source mutation|overlapping/i);
      expect(called).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('canonicalizes project aliases and rejects output parent symlink aliases', async () => {
    const root = await temp('phase6-symlink-boundary');
    try {
      const project = await makeProject(root);
      const projectAlias = join(root, 'project alias');
      await symlink(project, projectAlias, 'dir');
      const installation = await makeInstallation(root);
      const runner = await makeJavaScriptRunner(root);
      const output = join(root, 'release output');
      const result = await buildRelease({
        platform: 'darwin', env: { PATH: '' }, projectPath: projectAlias, outputRoot: output,
        targets: ['Browser'], rpgmakerInstallationPath: installation, releaseRuntimeDir: join(root, 'runtime'),
        jsExecutable: runner, prepareDeployment: async () => undefined, validateProject: async () => undefined,
        commandRunner: fakePackerRunner(project, [])
      });
      expect(result.projectPath).toBe(await realpath(project));

      const sourceOutputAlias = join(root, 'source output alias');
      await symlink(project, sourceOutputAlias, 'dir');
      await expect(buildRelease({
        platform: 'darwin', env: { PATH: '' }, projectPath: projectAlias, outputRoot: join(sourceOutputAlias, 'release'),
        targets: ['Browser'], rpgmakerInstallationPath: installation, jsExecutable: runner,
        prepareDeployment: async () => undefined, validateProject: async () => undefined,
        commandRunner: async () => ({ exitCode: 0, stdout: '', stderr: '' })
      })).rejects.toThrow(/physically overlapping|source project/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('build-release smoke seams', () => {
  test('inspects and serves the Browser artifact over loopback, then closes the server', async () => {
    const root = await temp('phase6-web-smoke');
    try {
      const artifact = join(root, 'Browser');
      await mkdir(join(artifact, 'data'), { recursive: true });
      await mkdir(join(artifact, 'js'), { recursive: true });
      await writeFile(join(artifact, 'index.html'), '<!doctype html>smoke\n');
      await writeFile(join(artifact, 'data', 'System.json'), '{}\n');
      await writeFile(join(artifact, 'js', 'main.js'), 'fixture\n');
      expect(await inspectReleaseArtifact(artifact, 'Browser')).toMatchObject({ requiredPaths: ['index.html', 'data/System.json', 'js/main.js'] });
      await expect(smokeWebArtifact(artifact)).resolves.toMatchObject({ kind: 'web', status: 'passed', cleanup: 'confirmed', probedPaths: ['/index.html', '/'] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('launches only the owned Windows artifact process and confirms cleanup', async () => {
    const root = await temp('phase6-windows-smoke');
    try {
      const artifact = join(root, 'Windows');
      await mkdir(join(artifact, 'www', 'data'), { recursive: true });
      await mkdir(join(artifact, 'www', 'js'), { recursive: true });
      await writeFile(join(artifact, 'Game.exe'), 'fixture');
      await writeFile(join(artifact, 'www', 'index.html'), 'fixture');
      await writeFile(join(artifact, 'www', 'data', 'System.json'), '{}');
      await writeFile(join(artifact, 'www', 'js', 'main.js'), 'fixture');
      let launched: string | undefined;
      const child = fakeChild();
      await expect(smokeWindowsArtifact(artifact, {
        platform: 'win32', timeoutMs: 5,
        spawnProcess: (command) => { launched = command; return child; },
        terminateProcessTree: async () => { child.exitCode = 0; child.emit('close', 0); }
      })).resolves.toMatchObject({ kind: 'windows', status: 'passed', cleanup: 'confirmed', entryPath: 'Game.exe' });
      expect(launched).toBe(join(artifact, 'Game.exe'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('reports immediate launch failure and unverified cleanup without killing unrelated processes', async () => {
    const root = await temp('phase6-smoke-failures');
    try {
      const artifact = join(root, 'Windows');
      await mkdir(join(artifact, 'www', 'data'), { recursive: true });
      await mkdir(join(artifact, 'www', 'js'), { recursive: true });
      await writeFile(join(artifact, 'Game.exe'), 'fixture');
      await writeFile(join(artifact, 'www', 'index.html'), 'fixture');
      await writeFile(join(artifact, 'www', 'data', 'System.json'), '{}');
      await writeFile(join(artifact, 'www', 'js', 'main.js'), 'fixture');
      const exited = fakeChild(1);
      await expect(smokeWindowsArtifact(artifact, { platform: 'win32', timeoutMs: 2, spawnProcess: () => exited, terminateProcessTree: async () => { throw new Error('must not be called'); } })).rejects.toThrow(/exited immediately/i);
      const live = fakeChild();
      let terminated = false;
      await expect(smokeWindowsArtifact(artifact, { platform: 'win32', timeoutMs: 2, spawnProcess: () => live, terminateProcessTree: async () => { terminated = true; throw new Error('taskkill denied'); } })).rejects.toThrow(/cleanup is unverified/i);
      expect(terminated).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('marks Windows launch as unsupported rather than pretending macOS is Windows hardware', async () => {
    const root = await temp('phase6-platform-gap');
    try {
      const artifact = join(root, 'Windows');
      await mkdir(join(artifact, 'www', 'data'), { recursive: true });
      await mkdir(join(artifact, 'www', 'js'), { recursive: true });
      await writeFile(join(artifact, 'Game.exe'), 'fixture');
      await writeFile(join(artifact, 'www', 'index.html'), 'fixture');
      await writeFile(join(artifact, 'www', 'data', 'System.json'), '{}');
      await writeFile(join(artifact, 'www', 'js', 'main.js'), 'fixture');
      await expect(smokeWindowsArtifact(artifact, { platform: 'darwin' })).resolves.toMatchObject({ status: 'unsupported', cleanup: 'not-run' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('build-release preset mount', () => {
  test('selects build-release without adding another MCP service', async () => {
    const root = await temp('phase6-preset');
    try {
      const project = await makeProject(root);
      const dshRuntime = await makeDshRuntime(root);
      const mcpRuntime = join(root, 'mcp runtime');
      const dsh = join(root, 'dsh.exe');
      const bun = await makeJavaScriptRunner(root, 'bun.exe');
      await writeFile(dsh, 'fixture');
      let dumpCalls = 0;
      const deployment = await prepareRpgMakerDeployment({
        platform: 'win32', env: { PATH: '' }, dshHome: join(root, 'dsh-home'), runtimeDir: dshRuntime,
        mcpRuntimeDir: mcpRuntime, projectPath: project, dshExecutable: dsh, jsExecutable: bun,
        agentPreset: 'build-release', sourceRoot: join(process.cwd(), 'presets', 'rpgmaker'),
        commandRunner: async (command, args, options) => {
          if (args[0] === 'add') await makeMcpRuntime(options.cwd!);
          if (args.includes('--dump-config')) {
            dumpCalls += 1;
            return { exitCode: 0, stdout: '- id: mcp-rpgmaker-mv\n- id: agent-presets\n', stderr: '' };
          }
          return { exitCode: 0, stdout: '', stderr: '' };
        },
        schemaProbe: async () => ({ tools: REQUIRED_MCP_TOOLS.map((name) => ({ name, inputSchema: { type: 'object' } })) })
      });
      expect(deployment.agentPreset).toBe('build-release');
      expect(dumpCalls).toBe(1);
      expect(await readFile(join(deployment.presetDir, 'preset.yml'), 'utf8')).toContain('Build and Release Agent');
      const composition = await readFile(deployment.compositionPath, 'utf8');
      expect(composition).toContain('default: build-release');
      expect((composition.match(/id: mcp-rpgmaker-mv/g) ?? [])).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
