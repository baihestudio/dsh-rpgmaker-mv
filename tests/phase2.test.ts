import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { installPreset, launchRpgmakerProject, RpgMakerStartupError, resolveMcpRunner, verifyRpgMakerMcpRuntime, RPGMAKER_MV_MCP_PACKAGE, RPGMAKER_MV_MCP_VERSION, RPGMAKER_MV_MCP_INTEGRITY, RPGMAKER_MZ_MCP_PACKAGE, RPGMAKER_MZ_MCP_VERSION, RPGMAKER_MZ_MCP_INTEGRITY } from '../src/rpgmaker';
import { DSH_VERSION } from '../src/config';
import { backupIgnoreGuidance } from '../src/project';

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
  await mkdir(join(runtime, 'node_modules', 'rpgmaker-mz-mcp', 'dist'), { recursive: true });
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ name: 'rpgmaker-mcp-runtime', private: true, dependencies: { [RPGMAKER_MV_MCP_PACKAGE]: RPGMAKER_MV_MCP_VERSION, [RPGMAKER_MZ_MCP_PACKAGE]: RPGMAKER_MZ_MCP_VERSION } }));
  await writeFile(join(runtime, 'bun.lock'), JSON.stringify({ lockfileVersion: 1, workspaces: { '': { dependencies: { [RPGMAKER_MV_MCP_PACKAGE]: RPGMAKER_MV_MCP_VERSION, [RPGMAKER_MZ_MCP_PACKAGE]: RPGMAKER_MZ_MCP_VERSION } } }, packages: {
    [RPGMAKER_MV_MCP_PACKAGE]: [`${RPGMAKER_MV_MCP_PACKAGE}@${RPGMAKER_MV_MCP_VERSION}`, 'registry.npmjs.org', { bin: { 'rpgmaker-mv-mcp': 'dist/index.js' } }, RPGMAKER_MV_MCP_INTEGRITY],
    [RPGMAKER_MZ_MCP_PACKAGE]: [`${RPGMAKER_MZ_MCP_PACKAGE}@${RPGMAKER_MZ_MCP_VERSION}`, 'registry.npmjs.org', { bin: { 'rpgmaker-mz-mcp': 'dist/index.js' } }, RPGMAKER_MZ_MCP_INTEGRITY]
  } }));
  await writeFile(join(runtime, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp', 'package.json'), JSON.stringify({ name: RPGMAKER_MV_MCP_PACKAGE, version: RPGMAKER_MV_MCP_VERSION, bin: { 'rpgmaker-mv-mcp': 'dist/index.js' } }));
  await writeFile(join(runtime, 'node_modules', 'rpgmaker-mz-mcp', 'package.json'), JSON.stringify({ name: RPGMAKER_MZ_MCP_PACKAGE, version: RPGMAKER_MZ_MCP_VERSION, bin: { 'rpgmaker-mz-mcp': 'dist/index.js' } }));
  await writeFile(join(runtime, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp', 'bin', 'server.js'), '#!/usr/bin/env bun\n');
  await writeFile(join(runtime, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp', 'dist', 'index.js'), '#!/usr/bin/env bun\n');
  await writeFile(join(runtime, 'node_modules', 'rpgmaker-mz-mcp', 'dist', 'index.js'), '#!/usr/bin/env bun\n');
  await writeFile(join(runtime, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp', 'bin', 'server.cmd'), '@echo off\r\n');
  await writeFile(join(runtime, 'node_modules', '.bin', 'rpgmaker-mv-mcp.cmd'), '@echo off\r\n');
}

describe('RPG Maker MCP runtime, preset composition, and launch', () => {
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
      expect((await verifyRpgMakerMcpRuntime(runtime, 'win32')).valid).toBe(false);
      await makeMcpRuntime(runtime);
      await writeFile(join(runtime, 'bun.lock'), JSON.stringify({ lockfileVersion: 1, workspaces: { '': { dependencies: { '@xerolo44/rpgmaker-mv-mcp': '9.9.9' } } }, packages: {} }));
      const tampered = await verifyRpgMakerMcpRuntime(runtime, 'win32');
      expect(tampered.valid).toBe(false);
      expect(tampered.errors.join(' ')).toContain('bun.lock');
      await makeMcpRuntime(runtime);
      await writeFile(join(runtime, 'bun.lock'), JSON.stringify({ lockfileVersion: 1, workspaces: { '': { dependencies: { '@xerolo44/rpgmaker-mv-mcp': '0.1.0' } } }, packages: { '@xerolo44/rpgmaker-mv-mcp': ['@xerolo44/rpgmaker-mv-mcp@0.1.0', 'different-source', { bin: { 'rpgmaker-mv-mcp': 'dist/index.js' } }, 'sha512-wrong'] } }));
      const wrongIntegrity = await verifyRpgMakerMcpRuntime(runtime, 'win32');
      expect(wrongIntegrity.valid).toBe(false);
      expect(wrongIntegrity.errors.join(' ')).toContain('npm integrity');
      await makeMcpRuntime(runtime);
      await writeFile(join(runtime, 'bun.lock'), JSON.stringify({ lockfileVersion: 1, workspaces: { '': { dependencies: { '@xerolo44/rpgmaker-mv-mcp': '0.1.0' } } }, packages: { '@xerolo44/rpgmaker-mv-mcp': ['@xerolo44/rpgmaker-mv-mcp@0.1.0', 'different-source', { bin: { 'rpgmaker-mv-mcp': 'wrong.js' } }, 'sha512-oXdkSGKGiYAtexcoZBXhyUQub6zoYQ4tMU2aKTjAcqeKhUpQ4BypjuS0EYJ78/7zmOq3TwFNBkEaZyb8q+SGuA=='] } }));
      const wrongBin = await verifyRpgMakerMcpRuntime(runtime, 'win32');
      expect(wrongBin.valid).toBe(false);
      expect(wrongBin.errors.join(' ')).toContain('bin');
      await makeMcpRuntime(runtime);
      const futureLock = JSON.parse(await readFile(join(runtime, 'bun.lock'), 'utf8')) as { lockfileVersion: number; packages: Record<string, unknown[]> };
      futureLock.lockfileVersion = 99;
      futureLock.packages[RPGMAKER_MV_MCP_PACKAGE][1] = 'another-source';
      futureLock.packages[RPGMAKER_MV_MCP_PACKAGE][2] = { dependencies: { completely: 'different' }, bin: { 'rpgmaker-mv-mcp': 'dist/index.js' } };
      await writeFile(join(runtime, 'bun.lock'), JSON.stringify(futureLock));
      expect((await verifyRpgMakerMcpRuntime(runtime, 'win32')).valid).toBe(true);
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
      const verification = await verifyRpgMakerMcpRuntime(runtime, 'win32');
      expect(verification.valid).toBe(false);
      expect(verification.engines.mv.executable).toBeUndefined();
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
        openWebBrowser: false,
        agentPreset: 'rpgmaker',
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
          const mv = { engine: 'mv' as const, package: RPGMAKER_MV_MCP_PACKAGE, version: RPGMAKER_MV_MCP_VERSION, integrity: RPGMAKER_MV_MCP_INTEGRITY, bin: 'rpgmaker-mv-mcp', valid: true, errors: [], packageVersion: RPGMAKER_MV_MCP_VERSION, executable: join(runtimeDir, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp', 'dist', 'index.js') };
          const mz = { engine: 'mz' as const, package: RPGMAKER_MZ_MCP_PACKAGE, version: RPGMAKER_MZ_MCP_VERSION, integrity: RPGMAKER_MZ_MCP_INTEGRITY, bin: 'rpgmaker-mz-mcp', valid: true, errors: [], packageVersion: RPGMAKER_MZ_MCP_VERSION, executable: join(runtimeDir, 'node_modules', RPGMAKER_MZ_MCP_PACKAGE, 'dist', 'index.js') };
          return {
            valid: true,
            errors: [],
            engines: { mv, mz }
          };
        },
        managedWebProfilePreparer: async (options) => {
          preparationHomes.bundle = options.env?.DSH_HOME;
          return {
            valid: true,
            errors: [],
            profile: 'web',
            profileDir: join(options.dshHome ?? root, 'profiles', 'web'),
            dependencies: {},
            bundles: [],
            packages: [],
            materialized: false
          };
        },
        commandRunner: async (_command, args, options) => {
          if (args.includes('--dump-config')) {
            preparationHomes.validation = options.env?.DSH_HOME;
            return { exitCode: 0, stdout: '- id: timeout-policy\n  name: "@deepseek-ai/dsh-tool-call-timeout-policy"\n- id: agent-presets\n  default: rpgmaker\n', stderr: '' };
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
      expect(result.deployment.agentPreset).toBe('rpgmaker');
      expect(launch?.cwd).toBe(neutral);
      expect(launch?.args.slice(0, 2)).toEqual(['--profile', 'web']);
      expect(launch?.args[2]).toBe('--patch');
      expect(launch?.args[3]).toBe(result.deployment.compositionPath);
      expect(launch?.args[4]).toBe('--no-open');
      expect(launch?.args.join(' ')).not.toContain('--project');
      expect(launch?.env?.DSH_HOME).toBe(dshHome);
      expect(launch?.env?.DSH_RPGMAKER_MCPORTER_RUNTIME).toBe(result.deployment.mcporterRuntimeDir);
      expect(launch?.env?.DSH_RPGMAKER_MCP_RUNTIME).toBe(result.deployment.rpgmakerRuntimeDir);
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
