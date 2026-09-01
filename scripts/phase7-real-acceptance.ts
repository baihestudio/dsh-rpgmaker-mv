import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { strict as assert } from 'node:assert';

import { bootstrapRuntime, findDshExecutable } from '../src/bootstrap';
import { DSH_VERSION } from '../src/config';
import { findCodeComposition, installPreset, renderPresetOnlyPatch } from '../src/rpgmaker';
import { runCommand } from '../src/process';

const DATABASE_TYPES = ['Actors', 'Classes', 'Skills', 'Items', 'Weapons', 'Armors', 'Enemies', 'Troops', 'States', 'Animations', 'Tilesets', 'CommonEvents'];
if (process.platform !== 'win32') throw new Error('Phase 7 real acceptance is supported on Windows only.');
const root = await mkdtemp(join(tmpdir(), 'dsh-rpgmaker-phase7-real-'));
const safeEnv: Record<string, string> = {};
for (const key of ['PATH', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'SystemRoot', 'ComSpec', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL', 'TERM', 'BUN_INSTALL', 'NODE_PATH', 'NODE_OPTIONS']) {
  const value = process.env[key];
  if (value !== undefined) safeEnv[key] = value;
}
const dshHome = join(root, 'state');
safeEnv.DSH_HOME = dshHome;
const installationRoot = join(root, 'installation');
const programRoot = join(installationRoot, 'program');
const project = join(root, '选择 project with spaces');
const runtime = join(programRoot, 'runtime', 'dsh');
const mcpRuntime = join(programRoot, 'runtime', 'mcp');

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

async function mount(compositionPath: string, preset: string, dshLib: string, environmentModule: string): Promise<Record<string, unknown>> {
  const profileFile = (await readdir(dshLib)).find((file) => file.startsWith('profile-boot-') && file.endsWith('.js'));
  assert.ok(profileFile, 'compiled DSH profile boot module missing');
  const probe = await runCommand(process.env.NODE_EXECUTABLE ?? 'node', [join(process.cwd(), 'scripts', 'phase7-real-mount.mjs')], {
    cwd: project,
    env: { ...safeEnv, PROFILE_FILE: join(dshLib, profileFile), ENVIRONMENT_MODULE: environmentModule, COMPOSITION_FILE: compositionPath, EXPECTED_PRESET: preset },
    platform: 'win32',
    timeoutMs: 120_000
  });
  if (probe.exitCode !== 0) throw new Error(`${preset} DSH mount failed: ${probe.stderr || probe.stdout}`);
  const line = probe.stdout.split('\n').map((value) => value.trim()).find((value) => value.startsWith('{"ok"'));
  assert.ok(line, `${preset} mount returned no structured result`);
  return JSON.parse(line) as Record<string, unknown>;
}

try {
  await cp(join(process.cwd(), 'runtime-manifests'), join(programRoot, 'runtime-manifests'), { recursive: true });
  await makeFixture();
  const boot = await bootstrapRuntime({ platform: 'win32', dshHome, installationRoot, runtimeDir: runtime, mutableRoot: root, env: safeEnv });
  assert.equal(boot.verification.dshPackageVersion, DSH_VERSION);
  const dsh = await findDshExecutable(runtime, 'win32');
  assert.ok(dsh, 'real DSH executable not found after pinned install');
  const dshLib = join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib');
  const environmentModule = join(runtime, 'node_modules', '@deepseek-ai', 'dsh-launch-environment', 'lib', 'index.js');
  const codePreset = await findCodeComposition(runtime);
  const mounted: Record<string, unknown>[] = [];
  for (const preset of ['rpgmaker']) {
    const installed = await installPreset(join(process.cwd(), 'presets', preset), dshHome, codePreset, preset);
    const compositionPath = join(dshHome, 'rpgmaker-mv', 'cordis.patch.yml');
    await mkdir(join(dshHome, 'rpgmaker-mv'), { recursive: true });
    await writeFile(compositionPath, renderPresetOnlyPatch(installed.presetRoot, preset));
    mounted.push(await mount(compositionPath, preset, dshLib, environmentModule));
  }
  console.log(JSON.stringify({ ok: true, dsh: DSH_VERSION, presets: mounted, windowsNwjs: 'requires installed MV hardware fixture' }));
} finally {
  await rm(root, { recursive: true, force: true });
}
