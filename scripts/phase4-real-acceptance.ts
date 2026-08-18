import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { strict as assert } from 'node:assert';

import { bootstrapRuntime, findDshExecutable } from '../src/bootstrap';
import { findCodeComposition, installPreset, renderPresetOnlyPatch } from '../src/rpgmaker';
import { runCommand } from '../src/process';
import { DSH_VERSION } from '../src/config';

const root = await mkdtemp(join(tmpdir(), 'dsh-rpgmaker-phase4-real-'));
const safeEnv: Record<string, string> = {};
for (const key of ['PATH', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'SystemRoot', 'ComSpec', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL', 'TERM', 'BUN_INSTALL', 'NODE_PATH', 'NODE_OPTIONS']) {
  const value = process.env[key];
  if (value !== undefined) safeEnv[key] = value;
}
const dshHome = join(root, 'dsh-home');
safeEnv.DSH_HOME = dshHome;
const project = join(root, '选择 project with spaces');
try {
  await mkdir(join(project, 'data'), { recursive: true });
  await mkdir(join(project, 'js'), { recursive: true });
  await mkdir(join(project, 'assets'), { recursive: true });
  await writeFile(join(project, 'Game.rpgproject'), '{}\n');
  const specialAsset = join(project, 'assets', '源 文件.png');
  await writeFile(specialAsset, 'disposable image placeholder\n');

  const runtime = join(root, 'runtime');
  const boot = await bootstrapRuntime({ dshHome, runtimeDir: runtime, env: safeEnv, platform: process.platform });
  assert.equal(boot.verification.dshPackageVersion, DSH_VERSION);
  const dsh = await findDshExecutable(runtime, process.platform);
  if (!dsh) throw new Error('real DSH executable not found after pinned install');
  const codePreset = await findCodeComposition(runtime);
  const installed = await installPreset(join(process.cwd(), 'presets', 'asset-workshop'), dshHome, codePreset, 'asset-workshop');
  const compositionPath = join(dshHome, 'rpgmaker-mv', 'phase4-asset-only.patch.yml');
  await mkdir(join(dshHome, 'rpgmaker-mv'), { recursive: true });
  await writeFile(compositionPath, renderPresetOnlyPatch(installed.presetRoot, 'asset-workshop'));

  const dshLib = join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib');
  const profileFile = (await readdir(dshLib)).find((file) => file.startsWith('profile-boot-') && file.endsWith('.js'));
  if (!profileFile) throw new Error('compiled DSH profile boot module missing');
  const environmentModule = join(runtime, 'node_modules', '@deepseek-ai', 'dsh-launch-environment', 'lib', 'index.js');
  const probe = await runCommand(process.env.NODE_EXECUTABLE ?? 'node', [join(process.cwd(), 'scripts', 'phase4-real-mount.mjs')], {
    cwd: project,
    env: { ...safeEnv, PROFILE_FILE: join(dshLib, profileFile), ENVIRONMENT_MODULE: environmentModule, COMPOSITION_FILE: compositionPath, SPECIAL_ASSET_PATH: specialAsset },
    platform: process.platform,
    timeoutMs: 120_000
  });
  if (probe.exitCode !== 0) throw new Error(`official DSH asset-workshop mount failed: ${probe.stderr || probe.stdout}`);
  const line = probe.stdout.split('\n').map((value) => value.trim()).find((value) => value.startsWith('{"ok"'));
  if (!line) throw new Error(`real asset-workshop mount returned no structured result: ${probe.stdout}`);
  const result = JSON.parse(line);
  assert.equal(result.ok, true);
  assert.equal(result.preset, 'asset-workshop');
  assert.equal(result.mcpTools, 0);
  console.log(JSON.stringify({ ok: true, dsh: DSH_VERSION, preset: result.preset, cwd: result.cwd, mcpTools: result.mcpTools }));
} finally {
  await rm(root, { recursive: true, force: true });
}
