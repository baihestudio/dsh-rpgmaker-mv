import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { strict as assert } from 'node:assert';

import { bootstrapRuntime, findDshExecutable } from '../src/bootstrap';
import { DSH_VERSION } from '../src/config';
import { findCodeComposition, installPreset, prepareRpgMakerDeployment, renderPresetOnlyPatch } from '../src/rpgmaker';
import { runCommand } from '../src/process';

const DATABASE_TYPES = ['Actors', 'Classes', 'Skills', 'Items', 'Weapons', 'Armors', 'Enemies', 'Troops', 'States', 'Animations', 'Tilesets', 'CommonEvents'];
const root = await mkdtemp(join(tmpdir(), 'dsh-rpgmaker-phase7-real-'));
const safeEnv: Record<string, string> = {};
for (const key of ['PATH', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'SystemRoot', 'ComSpec', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL', 'TERM', 'BUN_INSTALL', 'NODE_PATH', 'NODE_OPTIONS']) {
  const value = process.env[key];
  if (value !== undefined) safeEnv[key] = value;
}
const dshHome = join(root, 'state');
safeEnv.DSH_HOME = dshHome;
const project = join(root, '选择 project with spaces');
const runtime = join(root, 'program', 'runtime', 'dsh');
const mcpRuntime = join(root, 'program', 'runtime', 'mcp');

function json(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

async function makeFixture(): Promise<void> {
  await mkdir(join(project, 'data'), { recursive: true });
  await mkdir(join(project, 'js', 'plugins'), { recursive: true });
  await writeFile(join(project, 'Game.rpgproject'), '{}\n');
  await writeFile(join(project, 'data', 'System.json'), json({ gameTitle: 'Phase 7 real preset probe', startMapId: 1, switches: [null], variables: [null] }));
  for (const type of DATABASE_TYPES) await writeFile(join(project, 'data', `${type}.json`), type === 'Actors' ? json([null, { id: 1, name: 'Hero' }]) : '[null]\n');
  await writeFile(join(project, 'data', 'MapInfos.json'), json([null, { id: 1, name: 'Start', parentId: 0, order: 1 }]));
  await writeFile(join(project, 'data', 'Map001.json'), json({ displayName: 'Start', width: 17, height: 13, data: [], events: [null] }));
  await writeFile(join(project, 'js', 'plugins.js'), 'var $plugins = [];\n');
}

async function mount(compositionPath: string, preset: string, expectedMcp: boolean, dshLib: string, environmentModule: string): Promise<Record<string, unknown>> {
  const profileFile = (await readdir(dshLib)).find((file) => file.startsWith('profile-boot-') && file.endsWith('.js'));
  assert.ok(profileFile, 'compiled DSH profile boot module missing');
  const probe = await runCommand(process.env.NODE_EXECUTABLE ?? 'node', [join(process.cwd(), 'scripts', 'phase7-real-mount.mjs')], {
    cwd: project,
    env: { ...safeEnv, PROFILE_FILE: join(dshLib, profileFile), ENVIRONMENT_MODULE: environmentModule, COMPOSITION_FILE: compositionPath, EXPECTED_PRESET: preset, EXPECTED_MCP: String(expectedMcp) },
    platform: process.platform,
    timeoutMs: 120_000
  });
  if (probe.exitCode !== 0) throw new Error(`${preset} DSH mount failed: ${probe.stderr || probe.stdout}`);
  const line = probe.stdout.split('\n').map((value) => value.trim()).find((value) => value.startsWith('{"ok"'));
  assert.ok(line, `${preset} mount returned no structured result`);
  return JSON.parse(line) as Record<string, unknown>;
}

try {
  await makeFixture();
  const boot = await bootstrapRuntime({ platform: process.platform, dshHome, runtimeDir: runtime, programRoot: join(root, 'program'), mutableRoot: root, env: safeEnv });
  assert.equal(boot.verification.dshPackageVersion, DSH_VERSION);
  const dsh = await findDshExecutable(runtime, process.platform);
  assert.ok(dsh, 'real DSH executable not found after pinned install');
  const dshLib = join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib');
  const environmentModule = join(runtime, 'node_modules', '@deepseek-ai', 'dsh-launch-environment', 'lib', 'index.js');
  const mounted: Record<string, unknown>[] = [];
  for (const preset of ['rpgmaker', 'playtest-debug', 'build-release']) {
    const deployment = await prepareRpgMakerDeployment({
      platform: process.platform,
      dshHome,
      mutableRoot: root,
      programRoot: join(root, 'program'),
      runtimeDir: runtime,
      mcpRuntimeDir: mcpRuntime,
      env: safeEnv,
      projectPath: project,
      sourceRoot: join(process.cwd(), 'presets', 'rpgmaker'),
      agentPreset: preset
    });
    mounted.push(await mount(deployment.compositionPath, preset, true, dshLib, environmentModule));
  }

  const codePreset = await findCodeComposition(runtime);
  const asset = await installPreset(join(process.cwd(), 'presets', 'asset-workshop'), dshHome, codePreset, 'asset-workshop');
  const assetPatch = join(dshHome, 'asset-only.patch.yml');
  await writeFile(assetPatch, renderPresetOnlyPatch(asset.presetRoot, 'asset-workshop'));
  mounted.push(await mount(assetPatch, 'asset-workshop', false, dshLib, environmentModule));

  console.log(JSON.stringify({ ok: true, dsh: DSH_VERSION, presets: mounted, windowsNwjs: process.platform === 'win32' ? 'requires installed MV hardware fixture' : 'unsupported hardware on this host; not claimed' }));
} finally {
  await rm(root, { recursive: true, force: true });
}
