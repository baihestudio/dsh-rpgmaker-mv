import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { installPreset, prepareRpgMakerDeployment, launchRpgmakerProject, RpgMakerStartupError, resolveMcpRunner, verifyMcpRuntime, type McpToolDefinition } from '../src/rpgmaker';
import { runCommand } from '../src/process';
import { DSH_VERSION } from '../src/config';
import { backupIgnoreGuidance } from '../src/project';
import { JS_RUNNER_ENV, MCPORTER_RUNTIME_ENV, XEROLO_RUNTIME_ENV } from '../src/workspace-mcp';

async function temp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

async function makeProject(root: string): Promise<string> {
  const project = join(root, '选择 project with spaces');
  await mkdir(join(project, 'data'), { recursive: true });
  await mkdir(join(project, 'js', 'plugins'), { recursive: true });
  await writeFile(join(project, 'Game.rpgproject'), '{}\n');
  await writeFile(join(project, 'data', 'System.json'), JSON.stringify({ gameTitle: 'Fixture', startMapId: 1, switches: [null], variables: [null] }));
  await writeFile(join(project, 'data', 'Actors.json'), JSON.stringify([null, { id: 1, name: 'Hero' }]));
  await writeFile(join(project, 'data', 'MapInfos.json'), JSON.stringify([null, { id: 1, name: 'Start', parentId: 0, order: 1 }]));
  await writeFile(join(project, 'data', 'Map001.json'), JSON.stringify({ displayName: 'Start', width: 17, height: 13, data: [], events: [null, { id: 1, name: 'Guide', x: 1, y: 1, pages: [{ list: [{ code: 0, indent: 0, parameters: [] }] }] }] }));
  await writeFile(join(project, 'js', 'plugins.js'), 'var $plugins =\n[{"name":"TestPlugin","status":true,"description":"","parameters":{}}\n];\n');
  await writeFile(join(project, 'js', 'plugins', 'TestPlugin.js'), '// fixture\n');
  return project;
}

async function makeDshRuntime(root: string): Promise<string> {
  const runtime = join(root, 'dsh-runtime');
  await mkdir(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets', 'code'), { recursive: true });
  await mkdir(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib'), { recursive: true });
  await mkdir(join(runtime, 'node_modules', '.bin'), { recursive: true });
  await writeFile(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: DSH_VERSION, bin: { dsh: 'lib/bin.js' } }));
  await writeFile(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'), '#!/usr/bin/env bun\n');
  await writeFile(join(runtime, 'node_modules', '.bin', 'dsh.cmd'), '@echo off\r\n');
  await writeFile(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets', 'code', 'agent.cordis.yml'), "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: >-\n      generic Code persona\n- id: code-tool\n  name: fake-code-tool\n- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n");
  return runtime;
}

async function makeMcpRuntime(runtime: string): Promise<void> {
  await mkdir(join(runtime, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp', 'bin'), { recursive: true });
  await mkdir(join(runtime, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp', 'dist'), { recursive: true });
  await mkdir(join(runtime, 'node_modules', '.bin'), { recursive: true });
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ name: 'rpgmaker-mcp-runtime', private: true, dependencies: { '@xerolo44/rpgmaker-mv-mcp': '0.1.0' } }));
  await writeFile(join(runtime, 'bun.lock'), JSON.stringify({ lockfileVersion: 1, workspaces: { '': { dependencies: { '@xerolo44/rpgmaker-mv-mcp': '0.1.0' } } }, packages: { '@xerolo44/rpgmaker-mv-mcp': ['@xerolo44/rpgmaker-mv-mcp@0.1.0', 'registry.npmjs.org', { bin: { 'rpgmaker-mv-mcp': 'dist/index.js' } }, 'sha512-oXdkSGKGiYAtexcoZBXhyUQub6zoYQ4tMU2aKTjAcqeKhUpQ4BypjuS0EYJ78/7zmOq3TwFNBkEaZyb8q+SGuA=='] } }));
  await writeFile(join(runtime, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp', 'package.json'), JSON.stringify({ name: '@xerolo44/rpgmaker-mv-mcp', version: '0.1.0', bin: { 'rpgmaker-mv-mcp': 'dist/index.js' } }));
  await writeFile(join(runtime, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp', 'bin', 'server.js'), '#!/usr/bin/env bun\n');
  await writeFile(join(runtime, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp', 'dist', 'index.js'), '#!/usr/bin/env bun\n');
  await writeFile(join(runtime, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp', 'bin', 'server.cmd'), '@echo off\r\n');
  await writeFile(join(runtime, 'node_modules', '.bin', 'rpgmaker-mv-mcp.cmd'), '@echo off\r\n');
}

async function makePhase2MountFixture(root: string): Promise<{
  profileFile: string;
  environmentModule: string;
  bundleEntry: string;
  neutralLanding: string;
  traceFile: string;
}> {
  const runtime = join(root, 'phase2-runtime');
  const profileFile = join(runtime, 'dsh', 'lib', 'profile-boot-fixture.mjs');
  const environmentModule = join(runtime, 'environment.mjs');
  const bundleEntry = join(runtime, 'workspace-bundle.mjs');
  const dshAgent = join(runtime, 'dsh-agent', 'lib', 'index.js');
  const neutralLanding = join(root, 'neutral');
  const traceFile = join(root, 'mount-trace.jsonl');
  await mkdir(join(runtime, 'dsh', 'lib'), { recursive: true });
  await mkdir(join(runtime, 'dsh-agent', 'lib'), { recursive: true });
  await mkdir(neutralLanding, { recursive: true });
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ type: 'module' }));
  await writeFile(dshAgent, 'export function assembleContextFor(agent) { return agent; }\n');
  await writeFile(environmentModule, 'export function createLaunchEnvironmentSnapshot(layers) { return Object.assign({}, ...layers.map((layer) => layer.values)); }\n');
  await writeFile(bundleEntry, `
export const MCPORTER_RUNTIME_ENV = ${JSON.stringify(MCPORTER_RUNTIME_ENV)};
export const XEROLO_RUNTIME_ENV = ${JSON.stringify(XEROLO_RUNTIME_ENV)};
export const JS_RUNNER_ENV = ${JSON.stringify(JS_RUNNER_ENV)};
export function resolveRuntimePaths(env = process.env) {
  const values = {
    [MCPORTER_RUNTIME_ENV]: env[MCPORTER_RUNTIME_ENV],
    [XEROLO_RUNTIME_ENV]: env[XEROLO_RUNTIME_ENV],
    [JS_RUNNER_ENV]: env[JS_RUNNER_ENV]
  };
  const missing = Object.entries(values).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length > 0) throw new Error('dsh-workspace-mcp: the app-owned runtime environment is incomplete; missing ' + missing.join(', '));
  return { mcporterRuntime: values[MCPORTER_RUNTIME_ENV], xeroloRuntime: values[XEROLO_RUNTIME_ENV], runner: values[JS_RUNNER_ENV] };
}
export const XEROLO_TOOL_NAMES = [];
`);
  await writeFile(profileFile, `
import { appendFile } from 'node:fs/promises';

export async function runProfile(options) {
  await appendFile(process.env.TRACE_FILE, JSON.stringify({ profile: options.profile, args: options.args }) + '\\n');
  if (JSON.stringify(options.args) !== JSON.stringify(['--port', '0'])) {
    throw new Error('listen EADDRINUSE 127.0.0.1:3080');
  }
  return {
    ctx: { get() { return undefined; } },
    shutdown: {
      async shutdown(code) {
        await appendFile(process.env.TRACE_FILE, JSON.stringify({ shutdown: code }) + '\\n');
      }
    }
  };
}
`);
  return { profileFile, environmentModule, bundleEntry, neutralLanding, traceFile };
}

function toolNames(): McpToolDefinition[] {
  return ['get_project_info', 'list_records', 'get_record', 'update_record', 'create_record', 'create_event', 'get_event', 'update_event', 'add_dialogue', 'update_map', 'get_map', 'configure_plugin', 'list_plugins', 'validate_project', 'list_backups', 'restore_backup', 'playtest_start', 'playtest_status', 'playtest_log', 'playtest_stop'].map((name) => ({ name, inputSchema: { type: 'object' } }));
}

describe('RPG Maker MCP deployment', () => {
  test('installs the pinned MCP, generates fail-loud Cordis composition, and mounts rpgmaker from Code', async () => {
    const root = await temp('phase2-deployment');
    try {
      const project = await makeProject(root);
      const runtime = await makeDshRuntime(root);
      const dshHome = join(root, 'dsh-home');
      await writeFile(join(root, 'bun.exe'), '');
      const sourceRoot = join(process.cwd(), 'presets', 'rpgmaker');
      let addCalls = 0;
      const requests: Array<{ command: string; args: string[]; cwd?: string }> = [];
      const commandRunner = async (command: string, args: string[], options: { cwd?: string }) => {
        requests.push({ command, args, cwd: options.cwd });
        if (args[0] === 'add') {
          addCalls += 1;
          await makeMcpRuntime(options.cwd!);
        }
        if (args.includes('--dump-config')) return { exitCode: 0, stdout: '- id: mcp-rpgmaker-mv\n- id: agent-presets\n  default: rpgmaker\n', stderr: '' };
        return { exitCode: 0, stdout: '', stderr: '' };
      };
      const schemaProbe = async (request: { command: string; args: string[]; cwd: string }) => {
        expect(request.args[0].endsWith('.js')).toBe(true);
        expect(request.args.slice(1)).toEqual(['--project', project]);
        expect(request.cwd).toBe(project);
        return { tools: toolNames() };
      };

      const deployment = await prepareRpgMakerDeployment({
        platform: 'win32',
        dshHome,
        runtimeDir: runtime,
        projectPath: project,
        sourceRoot,
        commandRunner,
        bunExecutable: 'bun',
        jsExecutable: join(root, 'bun.exe'),
        schemaProbe
      });
      expect(addCalls).toBe(1);
      expect(requests.some((request) => request.args[0] === 'pm')).toBe(false);
      expect(deployment.mcpPackageVersion).toBe('0.1.0');
      expect(deployment.mcpScript.endsWith('.js')).toBe(true);
      expect(deployment.mcpArgs.slice(1)).toEqual(['--project', project]);
      expect(deployment.toolNames).toContain('update_record');
      expect(await readFile(deployment.compositionPath, 'utf8')).toContain("name: '@deepseek-ai/dsh-mcp-client'");
      const composition = await readFile(deployment.compositionPath, 'utf8');
      expect(composition).toContain('serverName: rpgmaker_mv');
      expect(composition).toContain('failOnStartupError: true');
      expect(composition).toContain('args: [');
      expect(composition).toContain("'--project', !!js process.cwd()");
      expect(composition).not.toContain('.cmd');
      expect(composition).not.toContain('cmd.exe');
      expect(composition).toContain('- patch:\n    id: agent-presets');
      expect(composition).toContain('default: rpgmaker');
      expect((composition.match(/id: mcp-rpgmaker-mv/g) ?? [])).toHaveLength(1);
      const presetComposition = await readFile(join(deployment.presetDir, 'agent.cordis.yml'), 'utf8');
      expect(presetComposition).toContain('code-tool');
      expect(presetComposition).not.toContain('dsh-mcp-client');
      expect(presetComposition).toContain('customSkillDirs');
      expect(await readFile(join(deployment.presetDir, 'skills', 'rpgmaker-mv', 'SKILL.md'), 'utf8')).toContain('validate_project');
      const specializedPresets = [
        { id: 'rpgmaker', name: 'RPG Maker MV 开发助手', fact: '默认入口和轻量协调者' },
        { id: 'playtest-debug', name: '游戏测试与调试助手', fact: '静态验证、进程启动、状态与日志证据' },
        { id: 'asset-workshop', name: '游戏图片素材助手', fact: '确定性图片素材处理' },
        { id: 'build-release', name: '游戏构建与发布助手', fact: '可复现 Windows 和 Web 构建' }
      ];
      for (const specialized of specializedPresets) {
        const installedDir = join(deployment.presetRoot, specialized.id);
        expect(await readFile(join(installedDir, 'preset.yml'), 'utf8')).toContain(`name: ${specialized.name}`);
        const installedComposition = await readFile(join(installedDir, 'agent.cordis.yml'), 'utf8');
        expect((installedComposition.match(/^- id: persona$/gm) ?? [])).toHaveLength(1);
        expect(installedComposition).toContain(specialized.fact);
        expect(installedComposition).toContain('code-tool');
        expect(installedComposition).toContain('customSkillDirs');
        expect(installedComposition).not.toContain('generic Code persona');
        expect(installedComposition).not.toContain('dsh-mcp-client');
      }
      expect(composition).not.toContain('DEEPSEEK_API_KEY');
      expect(deployment.presetRoot).toContain('.agent-presets');
      expect(JSON.parse(await readFile(join(deployment.presetDir, '.dsh-rpgmaker-owned.json'), 'utf8')).owner).toBe('dsh-rpgmaker-mv');

      await prepareRpgMakerDeployment({
        platform: 'win32',
        dshHome,
        runtimeDir: runtime,
        projectPath: project,
        sourceRoot,
        commandRunner,
        bunExecutable: 'bun',
        jsExecutable: join(root, 'bun.exe'),
        schemaProbe
      });
      expect(addCalls).toBe(1);
      const debug = await prepareRpgMakerDeployment({
        platform: 'win32',
        dshHome,
        runtimeDir: runtime,
        projectPath: project,
        sourceRoot,
        agentPreset: 'playtest-debug',
        commandRunner,
        jsExecutable: join(root, 'bun.exe'),
        schemaProbe
      });
      expect(debug.agentPreset).toBe('playtest-debug');
      expect(debug.presetDir).toBe(join(dshHome, '.agent-presets', 'playtest-debug'));
      expect(await readFile(debug.compositionPath, 'utf8')).toContain('default: playtest-debug');
      expect(JSON.parse(await readFile(join(debug.presetDir, '.dsh-rpgmaker-owned.json'), 'utf8')).presetId).toBe('playtest-debug');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('fails closed when the pinned Code composition has no persona seam', async () => {
    const root = await temp('phase2-persona-seam');
    try {
      const runtime = await makeDshRuntime(root);
      const code = join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets', 'code', 'agent.cordis.yml');
      await writeFile(code, "- id: code-tool\n  name: fake-code-tool\n- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n");
      await expect(installPreset(join(process.cwd(), 'presets', 'rpgmaker'), join(root, 'dsh-home'), code, 'rpgmaker')).rejects.toThrow(/exactly one persona row/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects bun.cmd-only Windows runner paths without a shell fallback', async () => {
    const root = await temp('phase2-bun-shim');
    try {
      const bin = join(root, '含 %! spaces', 'bin');
      await mkdir(bin, { recursive: true });
      await writeFile(join(bin, 'bun.cmd'), '@echo off\r\n');
      await expect(resolveMcpRunner({ projectPath: 'C:\\含 %! spaces\\project', bunExecutable: 'bun' }, 'win32', { PATH: bin })).rejects.toThrow(/resolved bun.exe or node.exe/i);
      for (const badRunner of ['cmd.exe', 'command.com']) {
        const badPath = join(root, '含 %! spaces', badRunner);
        await writeFile(badPath, '');
        await expect(resolveMcpRunner({ projectPath: 'C:\\含 %! spaces\\project', jsExecutable: badPath }, 'win32', { PATH: bin })).rejects.toThrow(/resolved bun.exe or node.exe/i);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('fails closed for missing or tampered MCP bun.lock release facts', async () => {
    const root = await temp('phase2-lockfile');
    try {
      const runtime = join(root, 'mcp-runtime');
      await makeMcpRuntime(runtime);
      await rm(join(runtime, 'bun.lock'));
      expect((await verifyMcpRuntime(runtime, 'win32')).valid).toBe(false);
      await makeMcpRuntime(runtime);
      await writeFile(join(runtime, 'bun.lock'), JSON.stringify({ lockfileVersion: 1, workspaces: { '': { dependencies: { '@xerolo44/rpgmaker-mv-mcp': '9.9.9' } } }, packages: {} }));
      const tampered = await verifyMcpRuntime(runtime, 'win32');
      expect(tampered.valid).toBe(false);
      expect(tampered.errors.join(' ')).toContain('bun.lock');
      await makeMcpRuntime(runtime);
      await writeFile(join(runtime, 'bun.lock'), JSON.stringify({ lockfileVersion: 1, workspaces: { '': { dependencies: { '@xerolo44/rpgmaker-mv-mcp': '0.1.0' } } }, packages: { '@xerolo44/rpgmaker-mv-mcp': ['@xerolo44/rpgmaker-mv-mcp@0.1.0', 'different-source', { bin: { 'rpgmaker-mv-mcp': 'dist/index.js' } }, 'sha512-wrong'] } }));
      const wrongIntegrity = await verifyMcpRuntime(runtime, 'win32');
      expect(wrongIntegrity.valid).toBe(false);
      expect(wrongIntegrity.errors.join(' ')).toContain('npm integrity');
      await makeMcpRuntime(runtime);
      await writeFile(join(runtime, 'bun.lock'), JSON.stringify({ lockfileVersion: 1, workspaces: { '': { dependencies: { '@xerolo44/rpgmaker-mv-mcp': '0.1.0' } } }, packages: { '@xerolo44/rpgmaker-mv-mcp': ['@xerolo44/rpgmaker-mv-mcp@0.1.0', 'different-source', { bin: { 'rpgmaker-mv-mcp': 'wrong.js' } }, 'sha512-oXdkSGKGiYAtexcoZBXhyUQub6zoYQ4tMU2aKTjAcqeKhUpQ4BypjuS0EYJ78/7zmOq3TwFNBkEaZyb8q+SGuA=='] } }));
      const wrongBin = await verifyMcpRuntime(runtime, 'win32');
      expect(wrongBin.valid).toBe(false);
      expect(wrongBin.errors.join(' ')).toContain('bin');
      await makeMcpRuntime(runtime);
      await writeFile(join(runtime, 'bun.lock'), JSON.stringify({ lockfileVersion: 99, workspaces: { '': { dependencies: { '@xerolo44/rpgmaker-mv-mcp': '0.1.0' } } }, packages: { '@xerolo44/rpgmaker-mv-mcp': ['@xerolo44/rpgmaker-mv-mcp@0.1.0', 'another-source', { dependencies: { completely: 'different' }, bin: { 'rpgmaker-mv-mcp': 'dist/index.js' } }, 'sha512-oXdkSGKGiYAtexcoZBXhyUQub6zoYQ4tMU2aKTjAcqeKhUpQ4BypjuS0EYJ78/7zmOq3TwFNBkEaZyb8q+SGuA=='] } }));
      expect((await verifyMcpRuntime(runtime, 'win32')).valid).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('refuses to replace an unowned rpgmaker preset directory', async () => {
    const root = await temp('phase2-preset-owner');
    try {
      const project = await makeProject(root);
      const runtime = await makeDshRuntime(root);
      const dshHome = join(root, 'dsh-home');
      const bun = join(root, 'bun.exe');
      await writeFile(bun, '');
      const unowned = join(dshHome, '.agent-presets', 'rpgmaker');
      await mkdir(unowned, { recursive: true });
      await writeFile(join(unowned, 'user-note.txt'), 'keep me');
      await expect(prepareRpgMakerDeployment({
        platform: 'win32',
        dshHome,
        runtimeDir: runtime,
        projectPath: project,
        sourceRoot: join(process.cwd(), 'presets', 'rpgmaker'),
        jsExecutable: bun,
        commandRunner: async (_command, args, options) => {
          if (args[0] === 'add') await makeMcpRuntime(options.cwd!);
          if (args.includes('--dump-config')) return { exitCode: 0, stdout: '- id: mcp-rpgmaker-mv\n- id: agent-presets\n  default: rpgmaker\n', stderr: '' };
          return { exitCode: 0, stdout: '', stderr: '' };
        },
        schemaProbe: async () => ({ tools: toolNames() })
      })).rejects.toThrow(/unowned preset directory/i);
      expect(await readFile(join(unowned, 'user-note.txt'), 'utf8')).toBe('keep me');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects an MCP package bin that escapes the app-owned runtime', async () => {
    const root = await temp('phase2-mcp-trust');
    try {
      const runtime = join(root, 'mcp-runtime');
      await mkdir(join(runtime, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp'), { recursive: true });
      await writeFile(join(runtime, 'package.json'), JSON.stringify({ dependencies: { '@xerolo44/rpgmaker-mv-mcp': '0.1.0' } }));
      await writeFile(join(runtime, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp', 'package.json'), JSON.stringify({ version: '0.1.0', bin: { 'rpgmaker-mv-mcp': '../../outside.exe' } }));
      await writeFile(join(root, 'outside.exe'), 'not trusted');
      const verification = await verifyMcpRuntime(runtime, 'win32');
      expect(verification.valid).toBe(false);
      expect(verification.executable).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('fails visibly when MCP schemas are outside DSH supported JSON Schema', async () => {
    const root = await temp('phase2-schema-shape');
    try {
      const project = await makeProject(root);
      const runtime = await makeDshRuntime(root);
      const bun = join(root, 'bun.exe');
      await writeFile(bun, '');
      const tools = toolNames();
      tools[0] = { name: tools[0].name, inputSchema: { type: ['string', 'number'] } };
      await expect(prepareRpgMakerDeployment({
        platform: 'win32',
        dshHome: join(root, 'dsh-home'),
        runtimeDir: runtime,
        projectPath: project,
        sourceRoot: join(process.cwd(), 'presets', 'rpgmaker'),
        jsExecutable: bun,
        commandRunner: async (_command, args, options) => {
          if (args[0] === 'add') await makeMcpRuntime(options.cwd!);
          if (args.includes('--dump-config')) return { exitCode: 0, stdout: '- id: mcp-rpgmaker-mv\n- id: agent-presets\n  default: rpgmaker\n', stderr: '' };
          return { exitCode: 0, stdout: '', stderr: '' };
        },
        schemaProbe: async () => ({ tools })
      })).rejects.toThrow(/type array unsupported/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('fails visibly when schema discovery returns no usable tools', async () => {
    const root = await temp('phase2-schema-failure');
    try {
      const project = await makeProject(root);
      const runtime = await makeDshRuntime(root);
      await expect(prepareRpgMakerDeployment({
        platform: 'darwin',
        dshHome: join(root, 'dsh-home'),
        runtimeDir: runtime,
        projectPath: project,
        sourceRoot: join(process.cwd(), 'presets', 'rpgmaker'),
        commandRunner: async (_command, args, options) => {
          if (args[0] === 'add') await makeMcpRuntime(options.cwd!);
          return { exitCode: 0, stdout: '', stderr: '' };
        },
        schemaProbe: async () => ({ tools: [] })
      })).rejects.toBeInstanceOf(RpgMakerStartupError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('keeps the real Agent probe off the default Web port and shuts down a mounted Host', async () => {
    const root = await temp('phase2-real-mount');
    try {
      const project = await realpath(await makeProject(root));
      const fixture = await makePhase2MountFixture(root);
      const safeEnv: Record<string, string> = { PATH: process.env.PATH ?? '' };
      const result = await runCommand(process.execPath, [join(process.cwd(), 'scripts', 'phase2-real-mount.mjs')], {
        cwd: fixture.neutralLanding,
        env: {
          ...safeEnv,
          PROJECT_PATH: project,
          NEUTRAL_LANDING_DIR: fixture.neutralLanding,
          PROFILE_FILE: fixture.profileFile,
          ENVIRONMENT_MODULE: fixture.environmentModule,
          COMPOSITION_FILE: join(root, 'composition.yml'),
          [MCPORTER_RUNTIME_ENV]: join(root, 'mcporter-runtime'),
          [XEROLO_RUNTIME_ENV]: join(root, 'xerolo-runtime'),
          [JS_RUNNER_ENV]: process.execPath,
          XEROLO_ENTRY: join(root, 'xerolo-entry.mjs'),
          WORKSPACE_BUNDLE_ENTRY: fixture.bundleEntry,
          TRACE_FILE: fixture.traceFile
        },
        platform: process.platform,
        timeoutMs: 30_000
      });
      const diagnostics = `${result.stderr}\n${result.stdout}`;
      expect(result.exitCode).toBe(1);
      expect(diagnostics).toMatch(/official DSH agent preset service did not mount/);
      expect(diagnostics).not.toMatch(/EADDRINUSE|127\.0\.0\.1:3080/);
      const trace = (await readFile(fixture.traceFile, 'utf8')).trim().split(/\r?\n/).map((line) => JSON.parse(line));
      expect(trace).toEqual([
        { profile: 'web', args: ['--port', '0'] },
        { shutdown: 0 }
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects the old unprefixed runtime names before mounting the real probe', async () => {
    const root = await temp('phase2-runtime-contract');
    try {
      const project = await realpath(await makeProject(root));
      const fixture = await makePhase2MountFixture(root);
      const result = await runCommand(process.execPath, [join(process.cwd(), 'scripts', 'phase2-real-mount.mjs')], {
        cwd: fixture.neutralLanding,
        env: {
          PATH: process.env.PATH ?? '',
          PROJECT_PATH: project,
          NEUTRAL_LANDING_DIR: fixture.neutralLanding,
          PROFILE_FILE: fixture.profileFile,
          ENVIRONMENT_MODULE: fixture.environmentModule,
          COMPOSITION_FILE: join(root, 'composition.yml'),
          MCPORTER_RUNTIME: join(root, 'old-mcporter-runtime'),
          XEROLO_RUNTIME: join(root, 'old-xerolo-runtime'),
          JS_RUNNER: process.execPath,
          XEROLO_ENTRY: join(root, 'xerolo-entry.mjs'),
          WORKSPACE_BUNDLE_ENTRY: fixture.bundleEntry,
          TRACE_FILE: fixture.traceFile
        },
        platform: process.platform,
        timeoutMs: 30_000
      });
      expect(result.exitCode).toBe(1);
      expect(`${result.stderr}\n${result.stdout}`).toMatch(/missing DSH_RPGMAKER_MCPORTER_RUNTIME, DSH_RPGMAKER_XEROLO_RUNTIME, DSH_RPGMAKER_JS_RUNNER/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('uses the explicit DSH home for preparation and the spawned Host', async () => {
    const root = await temp('phase2-launch');
    try {
      const runtime = await makeDshRuntime(root);
      const dsh = join(root, 'dsh');
      const bun = join(root, 'bun.exe');
      await writeFile(dsh, '');
      await writeFile(bun, '');
      const child = new EventEmitter() as EventEmitter & { exitCode: number | null; signalCode: NodeJS.Signals | null };
      child.exitCode = null;
      child.signalCode = null;
      const dshHome = join(root, 'dsh-home');
      const ambientDshHome = join(root, 'ambient-dsh-home');
      const preparationHomes: Record<string, string | undefined> = {};
      let launch: { args: string[]; cwd?: string; env?: Record<string, string | undefined> } | undefined;
      const result = await launchRpgmakerProject({
        platform: 'win32',
        dshHome,
        env: { DSH_HOME: ambientDshHome },
        runtimeDir: runtime,
        dshExecutable: dsh,
        jsExecutable: bun,
        agentPreset: 'playtest-debug',
        sourceRoot: join(process.cwd(), 'presets', 'rpgmaker'),
        dshRuntimePreparer: async (options) => {
          preparationHomes.dsh = options.env?.DSH_HOME;
          return {
            status: 'unchanged',
            runtimeDir: runtime,
            verification: { valid: true, errors: [], dshPackageVersion: DSH_VERSION, dshExecutable: dsh, koffiLoaded: true }
          };
        },
        mcporterRuntimePreparer: async (options, runtimeDir) => {
          preparationHomes.mcporter = options.env?.DSH_HOME;
          return {
            valid: true,
            errors: [],
            packageVersion: '0.12.3',
            packageDir: join(runtimeDir, 'node_modules', 'mcporter'),
            entrypoint: join(runtimeDir, 'node_modules', 'mcporter', 'dist', 'index.js')
          };
        },
        mcpRuntimePreparer: async (options, runtimeDir) => {
          preparationHomes.mcp = options.env?.DSH_HOME;
          return {
            valid: true,
            errors: [],
            packageVersion: '0.1.0',
            executable: join(runtimeDir, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp', 'dist', 'index.js')
          };
        },
        workspaceMcpBundlePreparer: async (options) => {
          preparationHomes.bundle = options.env?.DSH_HOME;
          return {
            valid: true,
            errors: [],
            packageDir: join(options.programRoot ?? root, 'bundle', 'dsh-workspace-mcp'),
            packageVersion: '0.1.0',
            bundleOccurrences: 1,
            entrypoint: join(root, 'bundle', 'dsh-workspace-mcp', 'lib', 'index.js'),
            ownedPath: true,
            sha256: 'fixture'
          };
        },
        commandRunner: async (_command, args, options) => {
          if (args.includes('--dump-config')) {
            preparationHomes.validation = options.env?.DSH_HOME;
            return { exitCode: 0, stdout: '- id: agent-presets\n  default: playtest-debug\n', stderr: '' };
          }
          return { exitCode: 0, stdout: '', stderr: '' };
        },
        portProbe: (() => {
          let probes = 0;
          return async () => { probes += 1; return probes > 1; };
        })(),
        openExistingSession: async () => undefined,
        spawnInteractive: (_command, args, options) => {
          launch = { args, cwd: options.cwd, env: options.env };
          return child;
        }
      });
      const neutral = join(root, 'program', 'neutral');
      expect(preparationHomes).toEqual({
        dsh: dshHome,
        mcporter: dshHome,
        mcp: dshHome,
        bundle: dshHome,
        validation: dshHome
      });
      expect(result.deployment.agentPreset).toBe('playtest-debug');
      expect(launch?.cwd).toBe(neutral);
      expect(launch?.args.slice(0, 2)).toEqual(['--profile', 'web']);
      expect(launch?.args[2]).toBe('--patch');
      expect(launch?.args[3]).toBe(result.deployment.compositionPath);
      expect(launch?.args.join(' ')).not.toContain('--project');
      expect(launch?.env?.DSH_HOME).toBe(dshHome);
      expect(launch?.env?.DSH_RPGMAKER_MCPORTER_RUNTIME).toBe(result.deployment.mcporterRuntimeDir);
      expect(launch?.env?.DSH_RPGMAKER_XEROLO_RUNTIME).toBe(result.deployment.xeroloRuntimeDir);
      expect(launch?.env?.DSH_RPGMAKER_JS_RUNNER).toBe(bun);
      child.exitCode = 0;
      child.emit('exit', 0);
      await result.releaseSession();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('RPG Maker backup guidance', () => {
  test('reports .mcp-backups guidance without changing .gitignore', async () => {
    const root = await temp('phase2-ignore');
    try {
      const project = await makeProject(root);
      const before = await backupIgnoreGuidance(project);
      expect(before.configured).toBe(false);
      expect(before.needsConsent).toBe(true);
      expect(await readFile(join(project, '.gitignore'), 'utf8').catch(() => '')).toBe('');
      await writeFile(join(project, '.gitignore'), 'dist/\n');
      const existing = await backupIgnoreGuidance(project);
      expect(existing.configured).toBe(false);
      expect(existing.suggestedEntry).toBe('.mcp-backups/');
      await writeFile(join(project, '.gitignore'), 'dist/\n.mcp-backups/\n');
      expect((await backupIgnoreGuidance(project)).configured).toBe(true);
      expect(await readFile(join(project, '.gitignore'), 'utf8')).toBe('dist/\n.mcp-backups/\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
