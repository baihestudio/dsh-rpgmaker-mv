import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { strict as assert } from 'node:assert';

import { bootstrapRuntime, findDshExecutable } from '../src/bootstrap';
import { buildRelease } from '../src/release';
import { DSH_VERSION } from '../src/config';

function requiredOption(argv: string[], name: string): string {
  const prefix = `--${name}=`;
  const inline = argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(`--${name}`);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`Usage: bun run scripts/phase6-windows-manual-gate.ts --${name} <installed RPG Maker MV path>`);
  return value;
}

async function json(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value)}\n`);
}

async function makeProject(root: string): Promise<string> {
  const project = join(root, 'manual gate project with spaces and CJK 游戏');
  await mkdir(join(project, 'data'), { recursive: true });
  await mkdir(join(project, 'js', 'plugins'), { recursive: true });
  await writeFile(join(project, 'Game.rpgproject'), '{}\n');
  await writeFile(join(project, 'index.html'), '<!doctype html><html><body>Windows manual gate</body></html>\n');
  await json(join(project, 'data', 'System.json'), { gameTitle: 'Windows manual gate', startMapId: 1, switches: [null], variables: [null] });
  for (const name of ['Actors', 'Classes', 'Skills', 'Items', 'Weapons', 'Armors', 'Enemies', 'Troops', 'States', 'Animations', 'Tilesets', 'CommonEvents']) await json(join(project, 'data', `${name}.json`), [null]);
  await json(join(project, 'data', 'MapInfos.json'), [null, { id: 1, name: 'Start', parentId: 0, order: 1 }]);
  await json(join(project, 'data', 'Map001.json'), { displayName: 'Start', width: 17, height: 13, data: new Array(17 * 13 * 6).fill(0), events: [null] });
  await writeFile(join(project, 'js', 'plugins.js'), 'var $plugins = [];\n');
  await writeFile(join(project, 'js', 'main.js'), 'console.log("Windows manual gate");\n');
  return project;
}

if (process.platform !== 'win32') throw new Error('This is an explicit Windows hardware gate and cannot run on this host.');
const installation = requiredOption(process.argv.slice(2), 'rpgmaker-installation');
const root = await mkdtemp(join(tmpdir(), 'dsh-rpgmaker-phase6-windows-manual-'));
const safeEnv: Record<string, string> = {};
for (const key of ['PATH', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'SystemRoot', 'ComSpec', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL', 'TERM', 'BUN_INSTALL', 'NODE_PATH', 'NODE_OPTIONS']) {
  const value = process.env[key];
  if (value !== undefined) safeEnv[key] = value;
}
safeEnv.DSH_HOME = join(root, 'dsh-home');

try {
  const project = await makeProject(root);
  const runtimeDir = join(root, 'dsh-runtime');
  const boot = await bootstrapRuntime({ dshHome: safeEnv.DSH_HOME, runtimeDir, env: safeEnv, platform: 'win32' });
  assert.equal(boot.verification.dshPackageVersion, DSH_VERSION);
  const dshExecutable = await findDshExecutable(runtimeDir, 'win32');
  if (!dshExecutable) throw new Error('Pinned DSH executable was not found after bootstrap.');
  const result = await buildRelease({
    platform: 'win32',
    env: safeEnv,
    dshHome: safeEnv.DSH_HOME,
    runtimeDir,
    mcpRuntimeDir: join(root, 'mcp-runtime'),
    dshExecutable,
    projectPath: project,
    outputRoot: join(root, 'release output'),
    rpgmakerInstallationPath: installation,
    sourceRoot: join(process.cwd(), 'presets', 'rpgmaker')
  });
  assert.equal(result.packer.version, '2.0.5');
  assert.equal(result.artifacts.find((artifact) => artifact.target === 'Windows')?.smoke.status, 'passed');
  assert.equal(result.artifacts.find((artifact) => artifact.target === 'Browser')?.smoke.status, 'passed');
  console.log(JSON.stringify({ ok: true, gate: 'phase6-windows-manual', installation, outputRoot: result.outputRoot, artifacts: result.artifacts.map((artifact) => ({ target: artifact.target, smoke: artifact.smoke })) }));
} finally {
  await rm(root, { recursive: true, force: true });
}
