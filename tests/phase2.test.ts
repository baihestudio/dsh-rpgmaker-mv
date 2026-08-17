import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { prepareRpgMakerDeployment, launchRpgmakerProject, RpgMakerStartupError, resolveMcpRunner, verifyMcpRuntime, type McpToolDefinition } from '../src/rpgmaker';
import { backupIgnoreGuidance, createRpgMakerEditingLoop } from '../src/mcp-loop';

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
  await mkdir(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'bin'), { recursive: true });
  await mkdir(join(runtime, 'node_modules', '.bin'), { recursive: true });
  await writeFile(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.0-rc.6', bin: { dsh: 'bin/dsh.js' } }));
  await writeFile(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'bin', 'dsh.js'), '#!/usr/bin/env bun\n');
  await writeFile(join(runtime, 'node_modules', '.bin', 'dsh.cmd'), '@echo off\r\n');
  await writeFile(join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets', 'code', 'agent.cordis.yml'), "- id: code-tool\n  name: fake-code-tool\n- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n");
  return runtime;
}

async function makeMcpRuntime(runtime: string): Promise<void> {
  await mkdir(join(runtime, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp', 'bin'), { recursive: true });
  await mkdir(join(runtime, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp', 'dist'), { recursive: true });
  await mkdir(join(runtime, 'node_modules', '.bin'), { recursive: true });
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ name: 'rpgmaker-mcp-runtime', private: true, dependencies: { '@xerolo44/rpgmaker-mv-mcp': '0.1.0' } }));
  await writeFile(join(runtime, 'bun.lock'), JSON.stringify({ lockfileVersion: 1, workspaces: { '': { dependencies: { '@xerolo44/rpgmaker-mv-mcp': '0.1.0' } } }, packages: { '@xerolo44/rpgmaker-mv-mcp': ['@xerolo44/rpgmaker-mv-mcp@0.1.0', '', { dependencies: { '@modelcontextprotocol/sdk': '^1.12.0', selfsigned: '^5.5.0', zod: '^3.24.0' }, bin: { 'rpgmaker-mv-mcp': 'dist/index.js' } }, 'sha512-oXdkSGKGiYAtexcoZBXhyUQub6zoYQ4tMU2aKTjAcqeKhUpQ4BypjuS0EYJ78/7zmOq3TwFNBkEaZyb8q+SGuA=='] } }));
  await writeFile(join(runtime, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp', 'package.json'), JSON.stringify({ name: '@xerolo44/rpgmaker-mv-mcp', version: '0.1.0', bin: { 'rpgmaker-mv-mcp': 'dist/index.js' } }));
  await writeFile(join(runtime, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp', 'bin', 'server.js'), '#!/usr/bin/env bun\n');
  await writeFile(join(runtime, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp', 'dist', 'index.js'), '#!/usr/bin/env bun\n');
  await writeFile(join(runtime, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp', 'bin', 'server.cmd'), '@echo off\r\n');
  await writeFile(join(runtime, 'node_modules', '.bin', 'rpgmaker-mv-mcp.cmd'), '@echo off\r\n');
}

function toolNames(): McpToolDefinition[] {
  return ['get_project_info', 'list_records', 'get_record', 'update_record', 'create_record', 'create_event', 'get_event', 'update_event', 'add_dialogue', 'update_map', 'get_map', 'configure_plugin', 'list_plugins', 'validate_project', 'list_backups', 'restore_backup'].map((name) => ({ name, inputSchema: { type: 'object' } }));
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

  test('rejects missing or tampered MCP bun.lock metadata', async () => {
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
      await writeFile(join(runtime, 'bun.lock'), JSON.stringify({ lockfileVersion: 1, workspaces: { '': { dependencies: { '@xerolo44/rpgmaker-mv-mcp': '0.1.0' } } }, packages: { '@xerolo44/rpgmaker-mv-mcp': ['@xerolo44/rpgmaker-mv-mcp@0.1.0', '', { dependencies: { '@modelcontextprotocol/sdk': '^1.12.0', selfsigned: '^5.5.0', zod: '^3.24.0' }, bin: { 'rpgmaker-mv-mcp': 'dist/index.js' } }, 'sha512-wrong'] } }));
      const wrongIntegrity = await verifyMcpRuntime(runtime, 'win32');
      expect(wrongIntegrity.valid).toBe(false);
      expect(wrongIntegrity.errors.join(' ')).toContain('npm integrity');
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

  test('passes the generated patch to DSH and retains project cwd/argv', async () => {
    const root = await temp('phase2-launch');
    try {
      const project = await makeProject(root);
      const runtime = await makeDshRuntime(root);
      const dsh = join(root, 'dsh');
      const bun = join(root, 'bun.exe');
      await writeFile(dsh, '');
      await writeFile(bun, '');
      const child = new EventEmitter() as EventEmitter & { exitCode: number | null; signalCode: NodeJS.Signals | null };
      child.exitCode = null;
      child.signalCode = null;
      let launch: { args: string[]; cwd?: string } | undefined;
      const result = await launchRpgmakerProject({
        platform: 'win32',
        dshHome: join(root, 'dsh-home'),
        runtimeDir: runtime,
        projectPath: project,
        dshExecutable: dsh,
        jsExecutable: bun,
        sourceRoot: join(process.cwd(), 'presets', 'rpgmaker'),
        commandRunner: async (_command, args, options) => {
          if (args[0] === 'add') await makeMcpRuntime(options.cwd!);
          if (args.includes('--dump-config')) return { exitCode: 0, stdout: '- id: mcp-rpgmaker-mv\n- id: agent-presets\n  default: rpgmaker\n', stderr: '' };
          return { exitCode: 0, stdout: '', stderr: '' };
        },
        schemaProbe: async () => ({ tools: toolNames() }),
        spawnInteractive: (_command, args, options) => {
          launch = { args, cwd: options.cwd };
          return child;
        }
      });
      expect(launch?.cwd).toBe(project);
      expect(launch?.args.slice(0, 2)).toEqual(['--profile', 'web']);
      expect(launch?.args[2]).toBe('--patch');
      expect(launch?.args[3]).toBe(result.deployment.compositionPath);
      child.exitCode = 0;
      child.emit('exit', 0);
      await result.releaseSession();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('RPG Maker mutation verification loop', () => {
  test('re-reads and validates representative database/event/dialogue/map/plugin/restore mutations', async () => {
    const root = await temp('phase2-loop');
    try {
      const project = await makeProject(root);
      const calls: string[] = [];
      const caller = async (tool: string, args: Record<string, unknown>): Promise<unknown> => {
        calls.push(tool);
        if (tool === 'validate_project') return { ok: true, errors: [], warnings: [] };
        if (tool === 'update_record') {
          const file = join(project, 'data', `${String(args.type).replace(/^./, (v) => v.toUpperCase())}.json`);
          const backup = join(project, '.mcp-backups', 'session-1', 'data', 'Actors.json');
          await mkdir(join(project, '.mcp-backups', 'session-1', 'data'), { recursive: true });
          await copyFile(file, backup);
          const records = JSON.parse(await readFile(file, 'utf8')) as Array<Record<string, unknown> | null>;
          records[Number(args.id)] = { ...records[Number(args.id)], ...(args.data as Record<string, unknown>) };
          await writeFile(file, JSON.stringify(records));
          return { ok: true };
        }
        if (tool === 'get_record') {
          const records = JSON.parse(await readFile(join(project, 'data', 'Actors.json'), 'utf8')) as unknown[];
          return records[Number(args.id)];
        }
        if (tool === 'add_dialogue') {
          const file = join(project, 'data', 'Map001.json');
          const map = JSON.parse(await readFile(file, 'utf8')) as { events: Array<{ pages: Array<{ list: unknown[] }> } | null> };
          map.events[Number(args.eventId)]!.pages[0].list.splice(-1, 0, { code: 101, parameters: [] }, { code: 401, parameters: [String((args.lines as string[])[0])] });
          await writeFile(file, JSON.stringify(map));
          return { ok: true };
        }
        if (tool === 'get_event') return JSON.parse(await readFile(join(project, 'data', 'Map001.json'), 'utf8'));
        if (tool === 'update_map') {
          const file = join(project, 'data', 'Map001.json');
          const map = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
          Object.assign(map, args.data);
          await writeFile(file, JSON.stringify(map));
          return { ok: true };
        }
        if (tool === 'get_map') return JSON.parse(await readFile(join(project, 'data', 'Map001.json'), 'utf8'));
        if (tool === 'configure_plugin') return { ok: true };
        if (tool === 'list_plugins') return [{ name: 'TestPlugin', status: false }];
        if (tool === 'restore_backup') {
          await copyFile(join(project, '.mcp-backups', 'session-1', 'data', 'Actors.json'), join(project, 'data', 'Actors.json'));
          return { ok: true };
        }
        if (tool === 'get_project_info') return { root: project };
        return { ok: true };
      };
      const loop = await createRpgMakerEditingLoop(project, caller);
      await loop.updateDatabaseRecord('actors', 1, { name: 'Hero Updated' });
      await loop.updateEventDialogue(1, 1, ['Welcome, hero.']);
      await loop.updateMapMetadata(1, { displayName: 'Opening' });
      await loop.configurePlugin('TestPlugin', { status: false });
      await loop.restoreBackup('session-1', undefined, { tool: 'get_project_info', args: {}, matches: (value) => (value as { root?: string }).root === project });
      expect(JSON.parse(await readFile(join(project, 'data', 'Actors.json'), 'utf8'))[1].name).toBe('Hero');
      expect(JSON.parse(await readFile(join(project, 'data', 'Map001.json'), 'utf8')).displayName).toBe('Opening');
      expect(calls).toEqual([
        'update_record', 'get_record', 'validate_project',
        'add_dialogue', 'get_event', 'validate_project',
        'update_map', 'get_map', 'validate_project',
        'configure_plugin', 'list_plugins', 'validate_project',
        'restore_backup', 'get_project_info', 'validate_project'
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects MCP isError and unchanged rereads before reporting success', async () => {
    const root = await temp('phase2-receipt-errors');
    try {
      const project = await makeProject(root);
      const loop = await createRpgMakerEditingLoop(project, async (tool) => {
        if (tool === 'update_record') return { isError: true, content: [{ type: 'text', text: 'mutation denied' }] };
        if (tool === 'get_record') return { id: 1, name: 'Old' };
        return { ok: true, errors: [] };
      });
      await expect(loop.updateDatabaseRecord('actors', 1, { name: 'New' })).rejects.toThrow(/mutation denied|isError/i);
      const unchangedLoop = await createRpgMakerEditingLoop(project, async (tool) => {
        if (tool === 'get_record') return { id: 1, name: 'Old' };
        return { ok: true, errors: [] };
      });
      await expect(unchangedLoop.updateDatabaseRecord('actors', 1, { name: 'New' })).rejects.toThrow(/did not reflect/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

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
