import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { strict as assert } from 'node:assert';

import { DSH_VERSION, WINDOWS_DSH_HOST, WINDOWS_DSH_PORT, withEnvironmentPath } from '../src/config';
import { verifyRuntime } from '../src/bootstrap';
import { prepareProcessInvocation, redactSensitive, runCommand, terminateProcessTree } from '../src/process';
import { verifyMcpRuntime } from '../src/rpgmaker';
import { verifyMcporterRuntime } from '../src/mcport';
import { PNPM_VERSION } from '../src/vision-toolkit';
import { resolveExecutable } from '../src/executable';
import { verifyWorkspaceMcpBundle } from '../src/workspace-mcp';
import { probeLoopbackPort } from '../src/windows';
import { observeLauncherProcesses } from './process-observation.mjs';

const DATABASE_TYPES = ['Actors', 'Classes', 'Skills', 'Items', 'Weapons', 'Armors', 'Enemies', 'Troops', 'States', 'Animations', 'Tilesets', 'CommonEvents'];
const ENVIRONMENT_KEYS = ['PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'TEMP', 'TMP', 'SystemRoot', 'ComSpec', 'COMSPEC', 'PATHEXT', 'LANG', 'LC_ALL', 'TERM', 'BUN_INSTALL', 'NODE_PATH', 'NODE_OPTIONS'] as const;

type ProcessEvidence = Awaited<ReturnType<typeof observeLauncherProcesses>>;

type StartedProcess = {
  child: ChildProcess;
  stdout: string;
  stderr: string;
  closed: Promise<number>;
  stopped: boolean;
};

function requiredOption(argv: string[], name: string): string {
  const prefix = `--${name}=`;
  const inline = argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(`--${name}`);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`Usage: bun run phase7:windows-installed -- --${name} <path>`);
  return value;
}

function diagnostic(value: string): string {
  return redactSensitive(value, process.env);
}

function optionalOption(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(`--${name}`);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function json(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

async function verifyInstalledRuntimes(installedRoot: string, bunExecutable: string): Promise<void> {
  const dshRuntime = await verifyRuntime(join(installedRoot, 'runtime', 'dsh'), { platform: 'win32', bunExecutable, env: { BUN_EXECUTABLE: bunExecutable } });
  const mcporterRuntime = await verifyMcporterRuntime(join(installedRoot, 'runtime', 'mcporter'), 'win32');
  const mcpRuntime = await verifyMcpRuntime(join(installedRoot, 'runtime', 'mcp'), 'win32');
  let pnpmVersion: string | undefined;
  try {
    pnpmVersion = (JSON.parse(await readFile(join(installedRoot, 'runtime', 'pnpm', 'node_modules', 'pnpm', 'package.json'), 'utf8')) as { version?: string }).version;
  } catch {
    pnpmVersion = undefined;
  }
  const pnpmShim = await exists(join(installedRoot, 'runtime', 'pnpm', 'node_modules', '.bin', 'pnpm.cmd'));
  const errors = [
    ...(dshRuntime.valid ? [] : dshRuntime.errors),
    ...(mcporterRuntime.valid ? [] : mcporterRuntime.errors),
    ...(mcpRuntime.valid ? [] : mcpRuntime.errors),
    ...(pnpmVersion === PNPM_VERSION && pnpmShim ? [] : [`installed pnpm ${PNPM_VERSION} runtime is incomplete`])
  ];
  if (errors.length > 0) throw new Error(`installed app-owned runtimes are not ready for the offline installed-release gate: ${errors.join('; ')}`);
}

async function makeWorkspace(root: string): Promise<string> {
  const workspace = join(root, '游戏 workspace with spaces');
  await mkdir(join(workspace, 'data'), { recursive: true });
  await mkdir(join(workspace, 'js', 'plugins'), { recursive: true });
  await writeFile(join(workspace, 'Game.rpgproject'), '{}\n');
  await writeFile(join(workspace, 'index.html'), '<!doctype html><html><body>Installed release gate</body></html>\n');
  await writeFile(join(workspace, 'data', 'System.json'), json({ gameTitle: 'Installed release gate', startMapId: 1, switches: [null], variables: [null] }));
  for (const type of DATABASE_TYPES) await writeFile(join(workspace, 'data', `${type}.json`), '[null]\n');
  await writeFile(join(workspace, 'data', 'MapInfos.json'), json([null, { id: 1, name: 'Start', parentId: 0, order: 1 }]));
  await writeFile(join(workspace, 'data', 'Map001.json'), json({ displayName: 'Start', width: 17, height: 13, data: new Array(17 * 13 * 6).fill(0), events: [null] }));
  await writeFile(join(workspace, 'js', 'plugins.js'), 'var $plugins = [];\n');
  await writeFile(join(workspace, 'js', 'main.js'), 'console.log("installed release gate");\n');
  return workspace;
}

function cleanEnvironment(root: string, bunExecutable: string): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const key of ENVIRONMENT_KEYS) {
    const value = process.env[key];
    if (value !== undefined) safe[key] = value;
  }
  safe.LOCALAPPDATA = join(root, 'Local AppData 选择 with spaces');
  safe.APPDATA = join(root, 'Roaming AppData 选择 with spaces');
  safe.USERPROFILE = join(root, 'User Profile 选择 with spaces');
  safe.TEMP = join(root, 'Temp 选择 with spaces');
  safe.TMP = safe.TEMP;
  safe.BUN_EXECUTABLE = bunExecutable;
  return withEnvironmentPath(safe, [dirname(bunExecutable), safe.PATH ?? ''].filter(Boolean).join(';'), 'win32') as Record<string, string>;
}

function startInstalledLaunch(launchCmd: string, installedRoot: string, env: Record<string, string>): StartedProcess {
  const invocation = prepareProcessInvocation(launchCmd, [], 'win32', env);
  const child = spawn(invocation.command, invocation.args, {
    cwd: installedRoot,
    env,
    shell: false,
    windowsHide: true,
    windowsVerbatimArguments: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    if (stdout.length < 256_000) stdout += chunk;
  });
  child.stderr?.on('data', (chunk: string) => {
    if (stderr.length < 256_000) stderr += chunk;
  });
  const closed = new Promise<number>((resolveClose) => {
    child.once('close', (code) => resolveClose(code ?? 1));
    child.once('error', () => resolveClose(1));
  });
  return { child, get stdout() { return stdout; }, get stderr() { return stderr; }, closed, stopped: false };
}

function normalized(value: string): string {
  return value.replaceAll('\\', '/').toLowerCase();
}

async function probeWeb(): Promise<{ ready: boolean; status?: number }> {
  if (!(await probeLoopbackPort(WINDOWS_DSH_HOST, WINDOWS_DSH_PORT, 500))) return { ready: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  timer.unref?.();
  try {
    const response = await fetch(`http://${WINDOWS_DSH_HOST}:${WINDOWS_DSH_PORT}/`, { signal: controller.signal });
    return { ready: true, status: response.status };
  } catch {
    return { ready: false };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForLaunchReady(
  started: StartedProcess,
  installedRoot: string,
  neutralLanding: string,
  env: Record<string, string>
): Promise<{ durationMs: number; port: { host: string; port: number; httpStatus?: number }; launcher: ProcessEvidence & { neutralLandingMessageObserved: boolean } }> {
  const startedAt = Date.now();
  const deadline = startedAt + 120_000;
  while (Date.now() < deadline) {
    if (started.child.exitCode !== null || started.child.signalCode !== null) {
      throw new Error(`installed Launch.cmd exited before fixed-port readiness (stdout/stderr: ${diagnostic(`${started.stdout}\n${started.stderr}`)})`);
    }
    const web = await probeWeb();
    const processes = await observeLauncherProcesses({ installedRoot, platform: 'win32', env });
    const neutralLandingMessageObserved = normalized(started.stdout).includes(normalized(`Launching official DSH in neutral landing directory ${neutralLanding}`));
    if (web.ready && processes.launcherProcessObserved && processes.projectArgumentCount === 0 && neutralLandingMessageObserved) {
      return {
        durationMs: Date.now() - startedAt,
        port: { host: WINDOWS_DSH_HOST, port: WINDOWS_DSH_PORT, ...(web.status === undefined ? {} : { httpStatus: web.status }) },
        launcher: { ...processes, neutralLandingMessageObserved }
      };
    }
    await delay(250);
  }
  throw new Error(`installed Launch.cmd did not reach the fixed loopback Web readiness gate (stdout/stderr: ${diagnostic(`${started.stdout}\n${started.stderr}`)})`);
}

async function stopInstalledLaunch(started: StartedProcess, env: Record<string, string>): Promise<boolean> {
  if (started.stopped) return !(await probeLoopbackPort(WINDOWS_DSH_HOST, WINDOWS_DSH_PORT, 500));
  started.stopped = true;
  if (started.child.exitCode === null && started.child.signalCode === null) {
    await terminateProcessTree(started.child, { platform: 'win32', env });
  }
  await started.closed;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!(await probeLoopbackPort(WINDOWS_DSH_HOST, WINDOWS_DSH_PORT, 500))) return true;
    await delay(100);
  }
  return false;
}

async function runInstalledMount(
  installedRoot: string,
  dshHome: string,
  neutralLanding: string,
  workspace: string,
  env: Record<string, string>
): Promise<Record<string, unknown>> {
  const runtimeDir = join(installedRoot, 'runtime', 'dsh');
  const dshLib = join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib');
  const profileFileName = (await readdir(dshLib)).find((file) => file.startsWith('profile-boot-') && file.endsWith('.js'));
  if (!profileFileName) throw new Error('installed DSH profile boot module was not found');
  const mcpRuntime = join(installedRoot, 'runtime', 'mcp');
  const mcp = await verifyMcpRuntime(mcpRuntime, 'win32');
  if (!mcp.valid || !mcp.executable) throw new Error(`installed Xerolo runtime is not usable: ${mcp.errors.join('; ')}`);
  const mountEnv = {
    ...env,
    DSH_HOME: dshHome,
    DSH_RPGMAKER_PROGRAM_ROOT: installedRoot,
    DSH_RPGMAKER_DATA_ROOT: dirname(dshHome),
    DSH_RPGMAKER_RUNTIME: runtimeDir,
    PROFILE_FILE: join(dshLib, profileFileName),
    ENVIRONMENT_MODULE: join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh-launch-environment', 'lib', 'index.js'),
    PROJECT_PATH: workspace,
    NEUTRAL_LANDING_DIR: neutralLanding,
    COMPOSITION_FILE: join(dshHome, 'rpgmaker-mv', 'cordis.patch.yml'),
    MCPORTER_RUNTIME: join(installedRoot, 'runtime', 'mcporter'),
    XEROLO_RUNTIME: mcpRuntime,
    XEROLO_ENTRY: mcp.executable,
    JS_RUNNER: env.BUN_EXECUTABLE,
    WORKSPACE_BUNDLE_ENTRY: join(dshHome, 'profiles', 'web', 'node_modules', '@baihestudio', 'dsh-workspace-mcp', 'lib', 'index.js')
  };
  const mountScript = join(installedRoot, 'scripts', 'phase2-real-mount.mjs');
  if (!(await exists(mountScript))) throw new Error('installed phase2 process-observation probe was not included in the Release tree');
  const probe = await runCommand(env.BUN_EXECUTABLE, [mountScript], {
    cwd: neutralLanding,
    env: mountEnv,
    platform: 'win32',
    timeoutMs: 120_000
  });
  if (probe.exitCode !== 0) throw new Error(`installed-tree Agent probe failed: ${diagnostic(probe.stderr || probe.stdout)}`);
  const line = probe.stdout.split(/\r?\n/).map((value) => value.trim()).find((value) => value.startsWith('{"ok"'));
  if (!line) throw new Error(`installed-tree Agent probe returned no structured result: ${diagnostic(probe.stdout)}`);
  return JSON.parse(line) as Record<string, unknown>;
}

if (process.platform !== 'win32') throw new Error('The installed-release gate is a Windows-only native acceptance.');

const installedRoot = resolve(requiredOption(process.argv.slice(2), 'installed-root'));
if (!(await exists(join(installedRoot, 'Launch.cmd')))) throw new Error(`Supported installed Launch.cmd was not found under ${installedRoot}.`);
const requestedBun = optionalOption(process.argv.slice(2), 'bun-executable');
const bunExecutable = requestedBun
  ? resolve(requestedBun)
  : await resolveExecutable('bun.exe', { platform: 'win32', env: process.env });
if (!bunExecutable || basename(bunExecutable).toLowerCase() !== 'bun.exe') throw new Error(`The installed-release gate requires a direct bun.exe runner, got ${bunExecutable ?? 'not found'}.`);
await verifyInstalledRuntimes(installedRoot, bunExecutable);
const root = await mkdtemp(join(tmpdir(), 'dsh-rpgmaker-phase7-installed-'));
const env = cleanEnvironment(root, bunExecutable);
const mutableRoot = join(env.LOCALAPPDATA, 'BaiheStudio', 'DSH-RPGMaker-MV');
const dshHome = join(mutableRoot, 'state');
const neutralLanding = join(installedRoot, 'neutral');
const workspace = await makeWorkspace(root);
const launchCmd = join(installedRoot, 'Launch.cmd');
const active: StartedProcess[] = [];
const startedAt = Date.now();

try {
  await mkdir(neutralLanding, { recursive: true });
  const firstStarted = startInstalledLaunch(launchCmd, installedRoot, env);
  active.push(firstStarted);
  const firstLaunch = await waitForLaunchReady(firstStarted, installedRoot, neutralLanding, env);
  const firstProfile = await verifyWorkspaceMcpBundle({ platform: 'win32', env, dshHome, programRoot: installedRoot, mutableRoot, runtimeDir: join(installedRoot, 'runtime', 'dsh') });
  assert.equal(firstProfile.valid, true);
  const firstPortClosed = await stopInstalledLaunch(firstStarted, env);
  assert.equal(firstPortClosed, true);
  active.splice(active.indexOf(firstStarted), 1);

  const profilePackage = join(dshHome, 'profiles', 'web', 'node_modules', '@baihestudio', 'dsh-workspace-mcp');
  await rm(profilePackage, { recursive: true, force: true });
  const brokenProfile = await verifyWorkspaceMcpBundle({ platform: 'win32', env, dshHome, programRoot: installedRoot, mutableRoot, runtimeDir: join(installedRoot, 'runtime', 'dsh') });
  assert.equal(brokenProfile.valid, false);

  const repairStarted = startInstalledLaunch(launchCmd, installedRoot, env);
  active.push(repairStarted);
  const repairLaunch = await waitForLaunchReady(repairStarted, installedRoot, neutralLanding, env);
  const repairedProfile = await verifyWorkspaceMcpBundle({ platform: 'win32', env, dshHome, programRoot: installedRoot, mutableRoot, runtimeDir: join(installedRoot, 'runtime', 'dsh') });
  assert.equal(repairedProfile.valid, true);
  const repairPortClosed = await stopInstalledLaunch(repairStarted, env);
  assert.equal(repairPortClosed, true);
  active.splice(active.indexOf(repairStarted), 1);

  const agentEvidence = await runInstalledMount(installedRoot, dshHome, neutralLanding, workspace, env);
  const directCalls = agentEvidence.directAgentToolCalls as Array<{ isError?: boolean; valueObserved?: boolean }> | undefined;
  const processEvidence = agentEvidence.xeroloProcessEvidence as { children?: unknown[]; shellProcesses?: unknown[] } | undefined;
  assert.equal(agentEvidence.ok, true);
  assert.equal(agentEvidence.stableTools, 41);
  assert.equal(directCalls?.length, 2);
  assert.equal(directCalls?.some((call) => call.isError !== false || call.valueObserved !== true), false);
  assert.equal(processEvidence?.children?.length, 1);
  assert.equal(processEvidence?.shellProcesses?.length, 0);

  console.log(diagnostic(JSON.stringify({
    ok: true,
    gate: 'phase7-windows-installed',
    dsh: DSH_VERSION,
    provisioned: {
      installedRoot,
      dshHome,
      workspace,
      neutralLanding,
      fixedWeb: `${WINDOWS_DSH_HOST}:${WINDOWS_DSH_PORT}`
    },
    firstLaunch: {
      command: 'Launch.cmd',
      durationMs: firstLaunch.durationMs,
      port: firstLaunch.port,
      launcher: firstLaunch.launcher,
      profile: { valid: firstProfile.valid, bundleOccurrences: firstProfile.bundleOccurrences }
    },
    repair: {
      linkBroken: !brokenProfile.valid,
      brokenProfileErrors: brokenProfile.errors.length,
      command: 'Launch.cmd',
      durationMs: repairLaunch.durationMs,
      port: repairLaunch.port,
      launcher: repairLaunch.launcher,
      profile: { valid: repairedProfile.valid, bundleOccurrences: repairedProfile.bundleOccurrences }
    },
    agentEvidence,
    shutdown: { firstPortClosed, repairPortClosed },
    durationMs: Date.now() - startedAt
  })));
} finally {
  for (const process of [...active].reverse()) {
    await stopInstalledLaunch(process, env).catch(() => undefined);
  }
  await rm(root, { recursive: true, force: true });
}
