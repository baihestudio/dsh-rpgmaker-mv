import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { bootstrapRuntime, findDshExecutable } from '../src/bootstrap';
import { resolveExecutable } from '../src/executable';
import { findCodeComposition, installPreset, renderPresetOnlyPatch } from '../src/rpgmaker';
import { runCommand } from '../src/process';
import { prepareVisionToolkit, verifyVisionToolkit } from '../src/vision-toolkit';

const root = await mkdtemp(join(tmpdir(), 'dsh-rpgmaker-phase8-real-'));
const dshHome = join(root, 'dsh-home');
const runtime = join(root, 'runtime');
const safeEnvironment: Record<string, string> = {};
for (const key of ['PATH', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'SystemRoot', 'ComSpec', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL', 'TERM', 'BUN_INSTALL', 'NODE_PATH', 'NODE_OPTIONS']) {
  const value = process.env[key];
  if (value !== undefined) safeEnvironment[key] = value;
}
safeEnvironment.DSH_HOME = dshHome;
try {
  const boot = await bootstrapRuntime({ platform: process.platform, env: safeEnvironment, dshHome, runtimeDir: runtime, bunExecutable: 'bun' });
  if (!boot.verification.valid) throw new Error(`DSH bootstrap failed: ${boot.verification.errors.join('; ')}`);
  const dsh = await findDshExecutable(runtime, process.platform);
  if (!dsh) throw new Error('Pinned DSH executable was not found after bootstrap.');

  const installedVision = await prepareVisionToolkit({
    platform: process.platform,
    env: safeEnvironment,
    dshHome,
    runtimeDir: runtime,
    dshExecutable: dsh,
    commandRunner: runCommand
  });
  if (!installedVision.valid || !installedVision.managedRuntimeReady) {
    throw new Error(`Vision Toolkit preparation failed: ${installedVision.errors.join('; ') || `runtimeReady=${installedVision.managedRuntimeReady}`}`);
  }

  const codePreset = await findCodeComposition(runtime);
  for (const presetId of ['rpgmaker', 'playtest-debug', 'asset-workshop', 'build-release']) {
    await installPreset(join(process.cwd(), 'presets', presetId), dshHome, codePreset, presetId);
  }
  const profilePatch = join(dshHome, 'profiles', 'web', 'cordis.patch.yml');
  await writeFile(profilePatch, renderPresetOnlyPatch(join(dshHome, '.agent-presets'), 'rpgmaker'));

  const dshLib = join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib');
  const profileFileName = (await readdir(dshLib)).find((file) => file.startsWith('profile-boot-') && file.endsWith('.js'));
  if (!profileFileName) throw new Error('Compiled DSH profile boot module was not found.');
  const environmentModule = join(runtime, 'node_modules', '@deepseek-ai', 'dsh-launch-environment', 'lib', 'index.js');
  const node = await resolveExecutable('node', { platform: process.platform, env: safeEnvironment });
  if (!node) throw new Error('Node.js was not found for the real DSH compatibility probe.');
  const probe = await runCommand(node, [join(process.cwd(), 'scripts', 'phase8-real-mount.mjs')], {
    cwd: root,
    env: {
      ...safeEnvironment,
      PROFILE_FILE: join(dshLib, profileFileName),
      ENVIRONMENT_MODULE: environmentModule,
      DSH_HOME: dshHome
    },
    platform: process.platform,
    timeoutMs: 300_000
  });
  if (probe.exitCode !== 0) throw new Error(`Vision Toolkit DSH compatibility probe failed: ${probe.stderr || probe.stdout}`);
  const line = probe.stdout.split(/\r?\n/).map((value) => value.trim()).find((value) => value.startsWith('{"ok"'));
  if (!line) throw new Error(`Vision Toolkit compatibility probe returned no structured result: ${probe.stdout}`);
  const result = JSON.parse(line) as { ok?: boolean; activated?: Array<{ presetId: string; tools: string[] }> };
  if (result.ok !== true || result.activated?.length !== 4) throw new Error(`Vision Toolkit compatibility probe returned an incomplete result: ${JSON.stringify(result)}`);
  const final = await verifyVisionToolkit({ platform: process.platform, env: safeEnvironment, dshHome, runtimeDir: runtime });
  console.log(JSON.stringify({ ok: true, package: final.packageVersion, bundleLayers: final.bundleOccurrences, managedRuntimeReady: final.managedRuntimeReady, activatedPresets: result.activated.map((entry) => entry.presetId), remoteProviderCalled: false }));
} finally {
  await rm(root, { recursive: true, force: true });
}
