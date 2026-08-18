import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { strict as assert } from 'node:assert';

import { bootstrapRuntime, findDshExecutable } from '../src/bootstrap';
import { buildRelease } from '../src/release';
import { DSH_VERSION } from '../src/config';

const root = await mkdtemp(join(tmpdir(), 'dsh-rpgmaker-phase6-real-'));
const dshHome = join(root, 'dsh-home');
const safeEnv: Record<string, string> = {};
for (const key of ['PATH', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'SystemRoot', 'ComSpec', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL', 'TERM', 'BUN_INSTALL', 'NODE_PATH', 'NODE_OPTIONS']) {
  const value = process.env[key];
  if (value !== undefined) safeEnv[key] = value;
}
safeEnv.DSH_HOME = dshHome;

async function json(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value)}\n`);
}

async function makeProject(): Promise<string> {
  const project = join(root, '选择 project with spaces');
  await mkdir(join(project, 'data'), { recursive: true });
  await mkdir(join(project, 'js', 'plugins'), { recursive: true });
  await writeFile(join(project, 'Game.rpgproject'), '{}\n');
  await writeFile(join(project, 'index.html'), '<!doctype html><html><body>Phase 6</body></html>\n');
  await json(join(project, 'data', 'System.json'), { gameTitle: 'Phase 6', startMapId: 1, switches: [null], variables: [null] });
  const database = ['Classes', 'Skills', 'Items', 'Weapons', 'Armors', 'Enemies', 'Troops', 'States', 'Animations', 'Tilesets', 'CommonEvents'];
  await json(join(project, 'data', 'Actors.json'), [null, { id: 1, name: 'Hero' }]);
  for (const name of database) await json(join(project, 'data', `${name}.json`), [null]);
  await json(join(project, 'data', 'MapInfos.json'), [null, { id: 1, name: 'Start', parentId: 0, order: 1 }]);
  await json(join(project, 'data', 'Map001.json'), { displayName: 'Start', width: 17, height: 13, data: new Array(17 * 13 * 6).fill(0), events: [null] });
  await writeFile(join(project, 'js', 'plugins.js'), 'var $plugins = [];\n');
  await writeFile(join(project, 'js', 'main.js'), 'console.log("Phase 6");\n');
  return project;
}

async function makeDisposableInstallation(): Promise<string> {
  const installation = join(root, 'RPG Maker MV fixture');
  await mkdir(join(installation, 'nwjs-win'), { recursive: true });
  await writeFile(join(installation, 'nwjs-win', 'Game.exe'), 'Windows smoke is intentionally unsupported on this host.\n');
  return installation;
}

try {
  const project = await makeProject();
  const installation = process.platform === 'win32'
    ? process.env.RPGMAKER_MV_INSTALLATION ?? process.env.RPGMAKER_MV_HOME
    : await makeDisposableInstallation();
  if (!installation) throw new Error('Windows acceptance requires RPGMAKER_MV_INSTALLATION or RPGMAKER_MV_HOME on Windows.');

  const runtimeDir = join(root, 'dsh-runtime');
  const mcpRuntimeDir = join(root, 'mcp-runtime');
  const boot = await bootstrapRuntime({ dshHome, runtimeDir, env: safeEnv, platform: process.platform });
  assert.equal(boot.verification.dshPackageVersion, DSH_VERSION);
  const dshExecutable = await findDshExecutable(runtimeDir, process.platform);
  if (!dshExecutable) throw new Error('pinned DSH executable was not found after bootstrap');

  const result = await buildRelease({
    platform: process.platform,
    env: safeEnv,
    dshHome,
    runtimeDir,
    mcpRuntimeDir,
    dshExecutable,
    projectPath: project,
    outputRoot: join(root, 'release output'),
    rpgmakerInstallationPath: installation,
    sourceRoot: join(process.cwd(), 'presets', 'rpgmaker')
  });
  assert.equal(result.packer.version, '2.0.5');
  assert.equal(result.validation, 'existing-rpgmaker-mcp');
  assert.equal(result.artifacts.find((artifact) => artifact.target === 'Browser')?.smoke.status, 'passed');
  if (process.platform !== 'win32') assert.equal(result.artifacts.find((artifact) => artifact.target === 'Windows')?.smoke.status, 'unsupported');
  console.log(JSON.stringify({
    ok: true,
    dsh: DSH_VERSION,
    packer: result.packer,
    outputRoot: result.outputRoot,
    artifacts: result.artifacts.map((artifact) => ({ target: artifact.target, smoke: artifact.smoke }))
  }));
} finally {
  await rm(root, { recursive: true, force: true });
}
