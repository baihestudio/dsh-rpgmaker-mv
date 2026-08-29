import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { strict as assert } from 'node:assert';

import { bootstrapRuntime, findDshExecutable } from '../src/bootstrap';
import { DSH_VERSION } from '../src/config';
import { launchRpgmakerProject, prepareRpgMakerLaunch } from '../src/rpgmaker';
import { redactSensitive, runCommand } from '../src/process';
import { JS_RUNNER_ENV, MCPORTER_RUNTIME_ENV, XEROLO_RUNTIME_ENV } from '../src/workspace-mcp';

const DATABASE_TYPES = ['Actors', 'Classes', 'Skills', 'Items', 'Weapons', 'Armors', 'Enemies', 'Troops', 'States', 'Animations', 'Tilesets', 'CommonEvents'];

if (process.platform !== 'win32') throw new Error('Phase 2 real acceptance is supported on Windows only.');

function json(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function diagnosticText(value: string): string {
  return redactSensitive(value, process.env);
}

async function makeFixture(root: string): Promise<string> {
  const project = join(root, '选择 project with spaces');
  await mkdir(join(project, 'data'), { recursive: true });
  await mkdir(join(project, 'js', 'plugins'), { recursive: true });
  await writeFile(join(project, 'Game.rpgproject'), '{}\n');
  await writeFile(join(project, 'index.html'), '<!doctype html><html><body>Workspace MCP real acceptance</body></html>\n');
  await writeFile(join(project, 'data', 'System.json'), json({ gameTitle: 'Workspace MCP real acceptance', startMapId: 1, switches: [null], variables: [null] }));
  for (const type of DATABASE_TYPES) await writeFile(join(project, 'data', `${type}.json`), type === 'Actors' ? json([null, { id: 1, name: 'Hero' }]) : '[null]\n');
  await writeFile(join(project, 'data', 'MapInfos.json'), json([null, { id: 1, name: 'Start', parentId: 0, order: 1, expanded: false }]));
  await writeFile(join(project, 'data', 'Map001.json'), json({ displayName: 'Start', width: 17, height: 13, data: new Array(17 * 13 * 6).fill(0), events: [null] }));
  await writeFile(join(project, 'js', 'plugins.js'), 'var $plugins = [];\n');
  await writeFile(join(project, 'js', 'plugins', 'TestPlugin.js'), '// workspace MCP real acceptance\n');
  await writeFile(join(project, 'js', 'main.js'), 'console.log("workspace MCP real acceptance");\n');
  return project;
}

const root = await mkdtemp(join(tmpdir(), 'dsh-rpgmaker-phase2-real-'));
const dshHome = join(root, 'state');
const programRoot = join(root, 'program');
const runtimeDir = join(programRoot, 'runtime', 'dsh');
const mcporterRuntimeDir = join(programRoot, 'runtime', 'mcporter');
const xeroloRuntimeDir = join(programRoot, 'runtime', 'mcp');
const neutralLandingDir = join(programRoot, 'neutral');
const safeEnv: Record<string, string> = {};
for (const key of ['PATH', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'SystemRoot', 'ComSpec', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL', 'TERM', 'BUN_INSTALL', 'NODE_PATH', 'NODE_OPTIONS']) {
  const value = process.env[key];
  if (value !== undefined) safeEnv[key] = value;
}
safeEnv.DSH_HOME = dshHome;

try {
  const project = await makeFixture(root);
  const boot = await bootstrapRuntime({ platform: 'win32', env: safeEnv, dshHome, programRoot, mutableRoot: root, runtimeDir });
  assert.equal(boot.verification.dshPackageVersion, DSH_VERSION);
  const dshExecutable = await findDshExecutable(runtimeDir, 'win32');
  if (!dshExecutable) throw new Error('Pinned DSH executable was not found after bootstrap.');

  // This is the project-neutral launch preparation path: it receives no project
  // argument, prepares the local bundle, and validates the composition from the
  // app-owned neutral landing directory before a Host is started.
  const preparation = await prepareRpgMakerLaunch({
    platform: 'win32',
    env: safeEnv,
    dshHome,
    programRoot,
    mutableRoot: root,
    runtimeDir,
    mcporterRuntimeDir,
    mcpRuntimeDir: xeroloRuntimeDir,
    dshExecutable,
    commandRunner: runCommand
  });
  await mkdir(neutralLandingDir, { recursive: true });
  const composition = await Bun.file(preparation.compositionPath).text();
  assert.equal(composition.includes('--project'), false, 'project-neutral composition must not carry a project argument');
  assert.equal(preparation.agentPreset, 'rpgmaker');
  assert.equal(preparation.mcporterRuntimeDir, mcporterRuntimeDir);
  assert.equal(preparation.xeroloRuntimeDir, xeroloRuntimeDir);

  // Exercise the real launcher seam after preparation with a tracked child
  // double. This keeps the acceptance disposable while proving the launcher
  // sends no project picker or project argument to DSH.
  const launchedChild = new EventEmitter() as EventEmitter & { exitCode: number | null; signalCode: string | null };
  launchedChild.exitCode = null;
  launchedChild.signalCode = null;
  const launched = await launchRpgmakerProject({
    platform: 'win32',
    env: safeEnv,
    dshHome,
    programRoot,
    mutableRoot: root,
    runtimeDir,
    mcporterRuntimeDir,
    mcpRuntimeDir: xeroloRuntimeDir,
    dshExecutable,
    portAlreadyChecked: true,
    portProbe: async () => true,
    openExistingSession: async () => undefined,
    spawnInteractive: () => launchedChild
  });
  assert.equal(launched.cwd, neutralLandingDir);
  assert.equal(launched.args.some((argument) => argument === '--project' || argument.startsWith('--project=')), false);
  launchedChild.exitCode = 0;
  launchedChild.emit('exit', 0);
  await launched.releaseSession();

  const dshLib = join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib');
  const profileFile = (await readdir(dshLib)).find((file) => file.startsWith('profile-boot-') && file.endsWith('.js'));
  if (!profileFile) throw new Error('Compiled DSH profile boot module was not found.');
  const profileEnvironmentModule = join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh-launch-environment', 'lib', 'index.js');
  const mountProbe = await runCommand(process.env.NODE_EXECUTABLE ?? 'node', [join(process.cwd(), 'scripts', 'phase2-real-mount.mjs')], {
    cwd: neutralLandingDir,
    env: {
      ...safeEnv,
      PROJECT_PATH: project,
      NEUTRAL_LANDING_DIR: neutralLandingDir,
      PROFILE_FILE: join(dshLib, profileFile),
      ENVIRONMENT_MODULE: profileEnvironmentModule,
      COMPOSITION_FILE: preparation.compositionPath,
      [MCPORTER_RUNTIME_ENV]: preparation.mcporterRuntimeDir,
      [XEROLO_RUNTIME_ENV]: preparation.xeroloRuntimeDir,
      [JS_RUNNER_ENV]: preparation.jsRunner,
      XEROLO_ENTRY: preparation.xeroloScript,
      WORKSPACE_HOST_BUNDLE_ENTRY: join(dshHome, 'profiles', 'web', 'node_modules', '@baihestudio', 'dsh-workspace-mcp', 'lib', 'index.js'),
      WORKSPACE_AGENT_BUNDLE_ENTRY: join(dshHome, 'profiles', 'web', 'node_modules', '@baihestudio', 'dsh-workspace-mcp', 'lib', 'agent.js')
    },
    platform: 'win32',
    timeoutMs: 120_000
  });
  if (mountProbe.exitCode !== 0) throw new Error(`project-neutral DSH/Xerolo workspace acceptance failed: ${diagnosticText(mountProbe.stderr || mountProbe.stdout)}`);
  const line = mountProbe.stdout.split(/\r?\n/).map((value) => value.trim()).find((value) => value.startsWith('{"ok"'));
  if (!line) throw new Error(`workspace acceptance returned no structured result: ${diagnosticText(mountProbe.stdout)}`);
  const result = JSON.parse(line) as {
    ok?: boolean;
    stableTools?: number;
    workspaceServers?: number;
    pooledXeroloChildren?: number;
    directAgentToolCalls?: Array<{ name?: string; isError?: boolean; valueObserved?: boolean }>;
    xeroloProcessEvidence?: { children?: Array<unknown>; shellProcesses?: Array<unknown> };
  };
  assert.equal(result.ok, true);
  assert.equal(result.workspaceServers, 1);
  assert.equal(result.pooledXeroloChildren, 1);
  assert.equal(result.stableTools, 41);
  assert.equal(result.directAgentToolCalls?.length, 2);
  assert.equal(result.directAgentToolCalls?.some((call) => call.isError !== false || call.valueObserved !== true), false);
  assert.equal(result.xeroloProcessEvidence?.children?.length, 1);
  assert.equal(result.xeroloProcessEvidence?.shellProcesses?.length, 0);
  console.log(diagnosticText(JSON.stringify({
    ok: true,
    gate: 'phase2-real-workspace-mcp',
    dsh: DSH_VERSION,
    neutralLandingDir,
    project,
    mcporterRuntime: mcporterRuntimeDir,
    xeroloRuntime: xeroloRuntimeDir,
    launchEvidence: {
      neutralLandingDir,
      observedCwd: launched.cwd,
      projectArgumentCount: launched.args.filter((argument) => argument === '--project' || argument.startsWith('--project=')).length
    },
    ...result
  })));
} finally {
  await rm(root, { recursive: true, force: true });
}
