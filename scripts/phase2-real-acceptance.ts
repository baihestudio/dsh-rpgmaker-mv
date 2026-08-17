import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { strict as assert } from 'node:assert';

import { findDshExecutable } from '../src/bootstrap';
import { prepareRpgMakerDeployment } from '../src/rpgmaker';
import { runCommand } from '../src/process';

const DATABASE_TYPES = ['Actors', 'Classes', 'Skills', 'Items', 'Weapons', 'Armors', 'Enemies', 'Troops', 'States', 'Animations', 'Tilesets', 'CommonEvents'];

function json(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

async function makeFixture(root: string): Promise<string> {
  const project = join(root, '选择 %! project with spaces');
  await mkdir(join(project, 'data'), { recursive: true });
  await mkdir(join(project, 'js', 'plugins'), { recursive: true });
  await writeFile(join(project, 'Game.rpgproject'), '{}\n');
  await writeFile(join(project, 'data', 'System.json'), json({ gameTitle: 'Real Phase 2 Probe', startMapId: 1, switches: [null], variables: [null] }));
  for (const type of DATABASE_TYPES) await writeFile(join(project, 'data', `${type}.json`), type === 'Actors' ? json([null, { id: 1, name: 'Hero' }]) : '[null]\n');
  await writeFile(join(project, 'data', 'MapInfos.json'), json([null, { id: 1, name: 'Start', parentId: 0, order: 1, expanded: false }]));
  await writeFile(join(project, 'data', 'Map001.json'), json({ displayName: 'Start', width: 17, height: 13, data: new Array(17 * 13 * 6).fill(0), events: [null, { id: 1, name: 'Guide', x: 1, y: 1, pages: [{ list: [{ code: 0, indent: 0, parameters: [] }] }] }] }));
  await writeFile(join(project, 'js', 'plugins.js'), 'var $plugins =\n[{"name":"TestPlugin","status":true,"description":"","parameters":{}}\n];\n');
  await writeFile(join(project, 'js', 'plugins', 'TestPlugin.js'), '// phase2 real probe\n');
  return project;
}

const root = await mkdtemp(join(tmpdir(), 'dsh-rpgmaker-phase2-real-'));
const allowedEnvironment = ['PATH', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'SystemRoot', 'ComSpec', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL', 'TERM', 'BUN_INSTALL', 'NODE_PATH', 'NODE_OPTIONS'];
const safeEnv: Record<string, string> = {};
for (const key of allowedEnvironment) {
  const value = process.env[key];
  if (value !== undefined) safeEnv[key] = value;
}
safeEnv.DSH_HOME = join(root, 'dsh-home');
try {
  const project = await makeFixture(root);
  const runtime = join(root, 'runtime');
  const mcpRuntime = join(root, 'mcp-runtime');
  await mkdir(runtime, { recursive: true });
  await mkdir(mcpRuntime, { recursive: true });
  const install = await runCommand('bun', ['init', '-y'], { cwd: runtime, env: safeEnv, timeoutMs: 60_000 });
  if (install.exitCode !== 0) throw new Error(install.stderr);
  const addDsh = await runCommand('bun', ['add', '--exact', '@deepseek-ai/dsh@0.1.0-rc.6'], { cwd: runtime, env: safeEnv, timeoutMs: 15 * 60_000 });
  if (addDsh.exitCode !== 0) throw new Error(addDsh.stderr || addDsh.stdout);
  const trust = await runCommand('bun', ['pm', 'trust', '--all'], { cwd: runtime, env: safeEnv, timeoutMs: 15 * 60_000 });
  if (trust.exitCode !== 0) throw new Error(trust.stderr || trust.stdout);
  const installMcp = await runCommand('bun', ['init', '-y'], { cwd: mcpRuntime, env: safeEnv, timeoutMs: 60_000 });
  if (installMcp.exitCode !== 0) throw new Error(installMcp.stderr);
  const addMcp = await runCommand('bun', ['add', '--exact', '@xerolo44/rpgmaker-mv-mcp@0.1.0'], { cwd: mcpRuntime, env: safeEnv, timeoutMs: 15 * 60_000 });
  if (addMcp.exitCode !== 0) throw new Error(addMcp.stderr || addMcp.stdout);
  const platform = process.platform;
  const dsh = await findDshExecutable(runtime, platform);
  if (!dsh) throw new Error('real DSH executable not found after Bun install');
  const deployment = await prepareRpgMakerDeployment({
    platform,
    dshHome: join(root, 'dsh-home'),
    runtimeDir: runtime,
    mcpRuntimeDir: mcpRuntime,
    dshExecutable: dsh,
    env: safeEnv,
    projectPath: project,
    sourceRoot: join(process.cwd(), 'presets', 'rpgmaker')
  });
  assert.equal(deployment.mcpPackageVersion, '0.1.0');
  assert.equal(deployment.toolNames.length, 41);

  const dshLib = join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib');
  const profileFile = (await readdir(dshLib)).find((file) => file.startsWith('profile-boot-') && file.endsWith('.js'));
  assert.ok(profileFile, 'compiled DSH profile boot module missing');
  const environmentModulePath = join(runtime, 'node_modules', '@deepseek-ai', 'dsh-launch-environment', 'lib', 'index.js');
  const mountProbe = await runCommand(process.env.NODE_EXECUTABLE ?? 'node', [join(process.cwd(), 'scripts', 'phase2-real-mount.mjs')], {
    cwd: project,
    env: { ...safeEnv, DSH_HOME: join(root, 'dsh-home'), PROFILE_FILE: join(dshLib, profileFile), ENVIRONMENT_MODULE: environmentModulePath, COMPOSITION_FILE: deployment.compositionPath },
    platform,
    timeoutMs: 120_000
  });
  if (mountProbe.exitCode !== 0) throw new Error(`official DSH mount probe failed: ${mountProbe.stderr || mountProbe.stdout}`);
  const mountLine = mountProbe.stdout.split(String.fromCharCode(10)).map((line) => line.trim()).find((line) => line.startsWith('{"ok"'));
  assert.ok(mountLine, `official DSH mount probe returned no structured result: ${mountProbe.stdout}`);
  const mountResult = JSON.parse(mountLine);
  assert.equal(mountResult.ok, true);
  assert.equal(mountResult.preset, 'rpgmaker');
  assert.ok(mountResult.mcpTools >= 41, `official DSH registered only ${mountResult.mcpTools} RPG Maker tools`);

  console.log(JSON.stringify({ ok: true, mountedPreset: mountResult.preset, mountedTools: mountResult.mcpTools, mutation: mountResult.mutation, restored: mountResult.restored, composition: deployment.compositionPath }));
} finally {
  await rm(root, { recursive: true, force: true });
}
