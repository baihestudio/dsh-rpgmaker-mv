import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';

import { DSH_VERSION, PRODUCT_VERSION, WINDOWS_DSH_HOST, WINDOWS_DSH_PORT, withEnvironmentPath } from '../src/config';
import { verifyRuntime } from '../src/bootstrap';
import { prepareProcessInvocation, redactSensitive, runCommand, terminateProcessTree, type CommandRunner, withoutCredentials } from '../src/process';
import { verifyRpgMakerMcpRuntime } from '../src/rpgmaker';
import { validateRpgMakerWorkspace } from '../src/project';
import { verifyManagedWebProfile } from '../src/managed-web-profile';
import { verifyMcporterRuntime } from '../src/mcport';
import { PNPM_VERSION, verifyPnpmRuntimeForDoctor } from '../src/profile';
import { resolveExecutable, resolveWindowsPwsh } from '../src/executable';
import { atLeast, verifyWindowsPrerequisites } from '../src/prerequisites';
import { buildReleaseZip, inspectReleaseZip, INSTALLER_EXECUTABLE_NAME, WINDOWS_GATE_CLEANUP_HELPER_RELATIVE } from '../src/release-gate';
import { INSTALLATION_CAPACITY_FORMULA, INSTALLATION_STAGING_HEADROOM_BYTES, readInstallationReceipt } from '../src/installation-root';
import { verifyDesktopHostPayload, DESKTOP_HOST_PAYLOAD_RELATIVE } from '../src/desktop-host';
import {
  JS_RUNNER_ENV,
  MCPORTER_RUNTIME_ENV,
  RPGMAKER_MCP_RUNTIME_ENV,
  WORKSPACE_MCP_PACKAGE
} from '../src/workspace-mcp';
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
  stopping?: Promise<boolean>;
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

function diagnostic(value: string, env: Record<string, string | undefined> = process.env): string {
  return redactSensitive(value, env);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const WINDOWS_GATE_CLEANUP_RETRY_DELAYS_MS = [100, 200, 400, 800] as const;
// A fresh gate contains several hundred thousand npm/pnpm files.  Native
// PowerShell can need a few minutes to remove that disposable tree even after
// all child processes have exited; keep the timeout bounded but realistic.
const WINDOWS_GATE_CLEANUP_TIMEOUT_MS = 5 * 60_000;
const WINDOWS_TRANSIENT_NATIVE_CLEANUP_PATTERNS = [
  /ERROR_(?:SHARING|LOCK)_VIOLATION/i,
  /sharing violation/i,
  /(?:being|in use by|used by) another process/i,
  /0x800700(?:20|21)/i
];
const WINDOWS_GATE_CLEANUP_HELPER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  basename(WINDOWS_GATE_CLEANUP_HELPER_RELATIVE)
);
const WINDOWS_GATE_WORKSPACE_PREFIX = 'dsh-rpgmaker-phase7-installed-';

type GateWorkspaceExists = (path: string) => Promise<boolean>;

export interface GateWorkspaceCleanupOptions {
  platform?: string;
  env?: Record<string, string | undefined>;
  pwshExecutable?: string;
  /** Test-only override for the approved temporary parent. */
  tempRoot?: string;
  commandRunner?: CommandRunner;
  existsPath?: GateWorkspaceExists;
  delay?: (milliseconds: number) => Promise<void>;
}

function isTransientNativeCleanupError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  const text = `${errorMessage(error)} ${typeof code === 'string' ? code : ''}`;
  return WINDOWS_TRANSIENT_NATIVE_CLEANUP_PATTERNS.some((pattern) => pattern.test(text));
}

function cleanupEnvironment(root: string, source: Record<string, string | undefined>): Record<string, string | undefined> {
  const parent = dirname(root);
  const safe = withoutCredentials(source);
  for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP']) safe[key] = parent;
  return safe;
}

function windowsBasename(value: string): string {
  return basename(value.replaceAll('\\', '/')).toLowerCase();
}

function isNativePowerShellExecutable(value: string): boolean {
  return windowsBasename(value) === 'pwsh.exe' && !/[\\/]WindowsApps[\\/]pwsh\.exe$/i.test(value);
}

function parsePowerShellVersion(output: string): [number, number, number] | undefined {
  const match = output.match(/(?:^|\r?\n)\s*PowerShell\s+(\d+)\.(\d+)\.(\d+)(?:[^\d]|$)/i);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

async function verifyNativePowerShell(
  pwsh: string,
  runner: CommandRunner,
  parent: string,
  cleanupEnv: Record<string, string | undefined>,
  sourceEnv: Record<string, string | undefined>
): Promise<void> {
  if (!isNativePowerShellExecutable(pwsh)) {
    throw new Error(`installed gate cleanup requires the native pwsh.exe runner, got ${diagnostic(pwsh, sourceEnv)}`);
  }

  let result;
  try {
    result = await runner(pwsh, ['--version'], { cwd: parent, env: cleanupEnv, platform: 'win32', timeoutMs: 30_000 });
  } catch (error) {
    const detail = diagnostic(errorMessage(error), sourceEnv);
    throw new Error(`installed gate cleanup PowerShell identity probe failed${detail ? `: ${detail}` : ''}`, { cause: error });
  }

  const output = `${result.stdout}\n${result.stderr}`;
  const version = parsePowerShellVersion(output);
  if (result.exitCode !== 0 || !version || !atLeast(version, [7, 4, 0])) {
    const detail = diagnostic(output.trim(), sourceEnv).trim();
    throw new Error(`installed gate cleanup requires verified PowerShell 7.4+ identity${detail ? `: ${detail}` : ''}`);
  }
}

function nativeCleanupFailure(root: string, result: { exitCode: number; stdout: string; stderr: string }, env: Record<string, string | undefined>): Error {
  const detail = diagnostic(`${result.stderr}\n${result.stdout}`.trim(), env).trim();
  return new Error(`native PowerShell gate workspace cleanup failed for ${diagnostic(root, env)} (exit code ${result.exitCode})${detail ? `: ${detail}` : ''}`);
}

export async function cleanupInstalledGateWorkspace(root: string, options: GateWorkspaceCleanupOptions = {}): Promise<void> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') throw new Error('installed gate workspace cleanup is Windows-only');

  const sourceEnv = options.env ?? process.env;
  const resolvedRoot = resolve(root);
  const expectedTempRoot = resolve(options.tempRoot ?? tmpdir());
  if (!isAbsolute(root) || root !== resolvedRoot) {
    throw new Error(`installed gate workspace root must be an absolute canonical path: ${diagnostic(resolvedRoot, sourceEnv)}`);
  }
  const parent = dirname(resolvedRoot);
  if (parent !== expectedTempRoot || !basename(resolvedRoot).startsWith(WINDOWS_GATE_WORKSPACE_PREFIX)) {
    throw new Error(`installed gate workspace root is not an owned temporary workspace: ${diagnostic(resolvedRoot, sourceEnv)}`);
  }

  const cleanupEnv = cleanupEnvironment(resolvedRoot, sourceEnv);
  const pwsh = options.pwshExecutable ?? await resolveWindowsPwsh({ platform: 'win32', env: sourceEnv });
  if (!pwsh) throw new Error('native PowerShell 7 executable was not found for installed gate workspace cleanup');

  const runner = options.commandRunner ?? runCommand;
  await verifyNativePowerShell(pwsh, runner, parent, cleanupEnv, sourceEnv);
  if (!(await exists(WINDOWS_GATE_CLEANUP_HELPER))) throw new Error(`installed gate cleanup helper is missing: ${WINDOWS_GATE_CLEANUP_HELPER}`);

  const existsPath = options.existsPath ?? gateRootExists;
  const wait = options.delay ?? delay;
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', WINDOWS_GATE_CLEANUP_HELPER, '-LiteralPath', resolvedRoot];
  let lastError: unknown;

  for (let attempt = 0; attempt <= WINDOWS_GATE_CLEANUP_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const result = await runner(pwsh, args, { cwd: parent, env: cleanupEnv, platform: 'win32', timeoutMs: WINDOWS_GATE_CLEANUP_TIMEOUT_MS });
      if (result.exitCode !== 0) throw nativeCleanupFailure(resolvedRoot, result, sourceEnv);
      if (await existsPath(resolvedRoot)) throw new Error(`native PowerShell cleanup resolved but gate root ${diagnostic(resolvedRoot, sourceEnv)} still exists`);
      return;
    } catch (error) {
      lastError = error;
      const retryDelay = isTransientNativeCleanupError(error)
        ? WINDOWS_GATE_CLEANUP_RETRY_DELAYS_MS[attempt]
        : undefined;
      if (retryDelay === undefined) break;
      await wait(retryDelay);
    }
  }

  const detail = diagnostic(errorMessage(lastError), sourceEnv);
  throw new Error(`temporary gate workspace cleanup failed for ${diagnostic(resolvedRoot, sourceEnv)}: ${detail}`, { cause: lastError });
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

async function gateRootExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw error;
  }
}

function json(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

async function verifyInstalledRuntimes(programRoot: string, nodeExecutable: string, npmExecutable?: string): Promise<void> {
  const dshRuntime = await verifyRuntime(join(programRoot, 'runtime', 'dsh'), { platform: 'win32', nodeExecutable, npmExecutable, env: { NODE_EXECUTABLE: nodeExecutable, ...(npmExecutable ? { NPM_EXECUTABLE: npmExecutable } : {}) } });
  const mcporterRuntime = await verifyMcporterRuntime(join(programRoot, 'runtime', 'mcporter'), 'win32');
  const mcpRuntime = await verifyRpgMakerMcpRuntime(join(programRoot, 'runtime', 'mcp'), 'win32');
  const pnpm = await verifyPnpmRuntimeForDoctor(programRoot, 'win32');
  const errors = [
    ...(dshRuntime.valid ? [] : dshRuntime.errors),
    ...(mcporterRuntime.valid ? [] : mcporterRuntime.errors),
    ...(mcpRuntime.valid ? [] : mcpRuntime.errors),
    ...(pnpm.valid ? [] : [pnpm.error ?? `installed pnpm ${PNPM_VERSION} runtime is incomplete`])
  ];
  if (errors.length > 0) throw new Error(`installed app-owned runtimes are not ready for the disposable installed-release gate: ${errors.join('; ')}`);
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

function cleanEnvironment(root: string, nodeExecutable?: string): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const key of ENVIRONMENT_KEYS) {
    const value = process.env[key];
    if (value !== undefined) safe[key] = value;
  }
  // Mutable layout paths must stay free of CJK and spaces: DSH's profile
  // composition includes resolve by path, and a CJK/space dshHome breaks the
  // loader. The CJK/space coverage is carried by the workspace fixture instead.
  safe.LOCALAPPDATA = join(root, 'LocalAppData');
  safe.APPDATA = join(root, 'RoamingAppData');
  safe.USERPROFILE = join(root, 'UserProfile');
  safe.TEMP = join(root, 'Temp');
  safe.TMP = safe.TEMP;
  delete safe.BUN_INSTALL;
  const nodeDir = nodeExecutable ? dirname(nodeExecutable).replaceAll('/', '\\').toLowerCase() : undefined;
  const path = (safe.PATH ?? '').split(';').filter((entry) => {
    const normalized = entry.replaceAll('/', '\\').replace(/[\\]+$/, '').toLowerCase();
    return !/\\bbun(?:\\.exe)?\\b/i.test(normalized) && (!nodeDir || normalized !== nodeDir);
  }).join(';');
  safe.NPM_CONFIG_CACHE = join(root, 'NpmCache');
  safe.npm_config_cache = safe.NPM_CONFIG_CACHE;
  return withEnvironmentPath(safe, path, 'win32') as Record<string, string>;
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
  if (started.stopped) return true;
  if (started.stopping) return started.stopping;
  const stopPromise = (async (): Promise<boolean> => {
    if (started.stopped) return true;
    if (started.child.exitCode === null && started.child.signalCode === null) {
      await terminateProcessTree(started.child, { platform: 'win32', env });
    }
    await started.closed;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (!(await probeLoopbackPort(WINDOWS_DSH_HOST, WINDOWS_DSH_PORT, 500))) {
        started.stopped = true;
        return true;
      }
      await delay(100);
    }
    return false;
  })();
  const trackedStop = stopPromise.finally(() => {
    started.stopping = undefined;
  });
  started.stopping = trackedStop;
  return trackedStop;
}

export async function resolveInstalledNode(env: Record<string, string | undefined> = process.env): Promise<string> {
  const requested = env.NODE_EXECUTABLE ?? 'node.exe';
  const nodeExecutable = await resolveExecutable(requested, { platform: 'win32', env });
  if (!nodeExecutable || basename(nodeExecutable).toLowerCase() !== 'node.exe') {
    throw new Error(`The installed-release gate requires a direct native node.exe runner; ${nodeExecutable ? `resolved ${nodeExecutable}` : `${requested} was not found`}.`);
  }
  return nodeExecutable;
}

export async function runInstalledMount(
  installedRoot: string,
  dshHome: string,
  neutralLanding: string,
  workspace: string,
  env: Record<string, string>,
  nodeExecutable: string,
  commandRunner: CommandRunner = runCommand
): Promise<Record<string, unknown>> {
  if (basename(nodeExecutable).toLowerCase() !== 'node.exe') {
    throw new Error(`The installed-release gate requires a direct native node.exe runner, got ${nodeExecutable}.`);
  }
  const runtimeDir = join(installedRoot, 'runtime', 'dsh');
  const dshLib = join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib');
  const profileFileName = (await readdir(dshLib)).find((file) => file.startsWith('profile-boot-') && file.endsWith('.js'));
  if (!profileFileName) throw new Error('installed DSH profile boot module was not found');
  const mcpRuntime = join(installedRoot, 'runtime', 'mcp');
  // The installed-release runner test exercises command/env construction with a
  // deliberately virtual workspace path. Real installed probes always mount an
  // existing project and therefore take the strict marker classification path.
  // Keep the virtual-path seam useful without weakening runtime Agent startup,
  // which validates the workspace before registering a child.
  const workspaceValidation = await exists(workspace) ? await validateRpgMakerWorkspace(workspace) : undefined;
  if (workspaceValidation && (!workspaceValidation.valid || !workspaceValidation.engine)) {
    throw new Error(`installed gate workspace is not a valid RPG Maker project: ${workspaceValidation.missing.join(', ')}`);
  }
  const engine = workspaceValidation?.engine ?? 'mv';
  const mcp = await verifyRpgMakerMcpRuntime(mcpRuntime, 'win32');
  const executable = mcp.engines[engine].executable;
  if (!mcp.valid || !executable) throw new Error(`installed ${engine.toUpperCase()} RPG Maker MCP runtime is not usable: ${mcp.errors.join('; ')}`);
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
    [MCPORTER_RUNTIME_ENV]: join(installedRoot, 'runtime', 'mcporter'),
    [RPGMAKER_MCP_RUNTIME_ENV]: mcpRuntime,
    MV_ENTRY: engine === 'mv' ? executable : undefined,
    MZ_ENTRY: engine === 'mz' ? executable : undefined,
    RPGMAKER_ENGINE: engine,
    [JS_RUNNER_ENV]: nodeExecutable,
    NODE_EXECUTABLE: nodeExecutable,
    WORKSPACE_HOST_BUNDLE_ENTRY: join(dshHome, 'profiles', 'web', 'node_modules', '@baihestudio', 'dsh-workspace-mcp', 'lib', 'index.js'),
    WORKSPACE_AGENT_BUNDLE_ENTRY: join(dshHome, 'profiles', 'web', 'node_modules', '@baihestudio', 'dsh-workspace-mcp', 'lib', 'agent.js')
  };
  const mountScript = join(installedRoot, 'scripts', 'phase2-real-mount.mjs');
  if (!(await exists(mountScript))) throw new Error('installed phase2 process-observation probe was not included in the Release tree');
  const probe = await commandRunner(nodeExecutable, [mountScript], {
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

async function extractRelease(zipPath: string, destination: string, env: Record<string, string | undefined>): Promise<void> {
  const tar = await resolveExecutable('tar.exe', { platform: 'win32', env });
  if (!tar) throw new Error('The native Windows tar.exe extractor was not found for the disposable release gate.');
  await mkdir(destination, { recursive: true });
  const result = await runCommand(tar, ['-xf', zipPath, '-C', destination], { env: withoutCredentials(env), platform: 'win32', timeoutMs: 120_000 });
  if (result.exitCode !== 0) throw new Error(`Release extraction failed: ${diagnostic(result.stderr || result.stdout, env)}`);
}

async function runInstaller(installer: string, args: string[], cwd: string, env: Record<string, string>): Promise<{ stdout: string; stderr: string }> {
  const result = await runCommand(installer, args, { cwd, env, platform: 'win32', timeoutMs: 45 * 60_000 });
  if (result.exitCode !== 0) throw new Error(`installer.exe exited with ${result.exitCode}: ${diagnostic(result.stderr || result.stdout, env)}`);
  return { stdout: result.stdout, stderr: result.stderr };
}

async function main(): Promise<void> {
  if (process.platform !== 'win32') throw new Error('The disposable fresh-install gate is a Windows-only native acceptance.');
  const argv = process.argv.slice(2);
  console.log('PREFLIGHT: expected duration 5-8 minutes on the disposable native Windows host.');
  console.log('PREFLIGHT: disposable artifacts/roots include a temporary Release ZIP, extracted Release tree, installation/program tree, local-state/logs, shortcut, and npm cache; all are removed during gate cleanup.');
  console.log('PREFLIGHT: external services are the npm registry for release-owned npm ci and local loopback DSH Web/MCP probes; no WinGet or system-prerequisite mutation is performed.');
  const sourceRoot = resolve(requiredOption(argv, 'source-root'));
  const desktopHostRoot = resolve(requiredOption(argv, 'desktop-host-root'));
  const requestedBun = optionalOption(argv, 'bun-executable');
  const bunExecutable = requestedBun ? resolve(requestedBun) : process.execPath;
  const sourceEnv = process.env;
  const prerequisites = await verifyWindowsPrerequisites({ platform: 'win32', env: sourceEnv });
  if (!prerequisites.ok) {
    throw new Error(`Disposable gate requires already-installed external prerequisites (${prerequisites.missing.join(', ')}); no WinGet installation is attempted.`);
  }
  const nodeExecutable = prerequisites.executablePaths.node ?? await resolveInstalledNode(sourceEnv);
  const npmExecutable = prerequisites.executablePaths.npm;
  const pwshExecutable = await resolveWindowsPwsh({ platform: 'win32', env: sourceEnv });
  if (!pwshExecutable || basename(pwshExecutable).toLowerCase() !== 'pwsh.exe' || /[\\/]WindowsApps[\\/]pwsh\.exe$/i.test(pwshExecutable)) {
    throw new Error(`The disposable gate requires the repository-resolved native PowerShell 7 executable; got ${pwshExecutable ?? 'not found'}.`);
  }
  const root = await mkdtemp(join(tmpdir(), 'dsh-rpgmaker-phase7-installed-'));
  const targetEnv = cleanEnvironment(root, nodeExecutable);
  const installationRoot = join(root, 'installation');
  const localStateRoot = join(root, 'local-state');
  const shortcutPath = join(root, 'shortcut', 'RPG Maker Agent.lnk');
  const releaseArchive = join(root, 'release.zip');
  const extractedRelease = join(root, 'release');
  const programRoot = join(installationRoot, 'program');
  const dshHome = join(localStateRoot, 'state');
  const startedAt = Date.now();
  let primaryFailure: unknown;
  let cleanupFailure: Error | undefined;

  try {
    const archive = await buildReleaseZip({
      sourceRoot,
      outputZip: releaseArchive,
      platform: 'win32',
      env: sourceEnv,
      desktopHostRoot,
      requireDesktopHost: true,
      bunExecutable
    });
    const inspection = await inspectReleaseZip({ zipPath: archive, platform: 'win32', env: sourceEnv, requireDesktopHost: true });
    assert.equal(inspection.valid, true, `fresh Release inspection failed: ${inspection.missing.join(', ')}`);
    await extractRelease(archive, extractedRelease, sourceEnv);
    const installerBuildEvidence = JSON.parse(await (await import('node:fs/promises')).readFile(join(extractedRelease, 'installer-build.json'), 'utf8')) as { capacity?: { formula?: string; reserveBytes?: number; measuredPayloadBytes?: number; nativeInstallerBytes?: number } };
    assert.equal(installerBuildEvidence.capacity?.formula, INSTALLATION_CAPACITY_FORMULA);
    assert.equal(installerBuildEvidence.capacity?.reserveBytes, INSTALLATION_STAGING_HEADROOM_BYTES);
    assert.ok((installerBuildEvidence.capacity?.measuredPayloadBytes ?? 0) > 0);
    assert.ok((installerBuildEvidence.capacity?.nativeInstallerBytes ?? 0) > 0);
    const installer = join(extractedRelease, INSTALLER_EXECUTABLE_NAME);
    assert.equal(await exists(installer), true, 'fresh Release did not contain installer.exe');
    const host = await verifyDesktopHostPayload(join(extractedRelease, DESKTOP_HOST_PAYLOAD_RELATIVE));
    assert.equal(host.valid, true, `fresh Release desktop host verification failed: ${host.errors.join('; ')}`);
    const help = await runCommand(installer, ['--help'], { cwd: extractedRelease, env: targetEnv, platform: 'win32', timeoutMs: 60_000 });
    assert.equal(help.exitCode, 0, `standalone installer help failed: ${diagnostic(help.stderr || help.stdout, targetEnv)}`);
    assert.equal(/Bun was not found|Node was not found/i.test(`${help.stdout}\n${help.stderr}`), false, 'standalone help reported a runtime prerequisite failure');

    // The batch wrapper must classify its launch context itself.  Exercise the
    // helper's deterministic seam for both Explorer and terminal parents, then
    // invoke Install.cmd through a redirected terminal-style child.  A
    // successful terminal invocation must return without an unconditional
    // pause; an Explorer launch is the only context that preserves the screen.
    const windowsPowerShell51 = join(sourceEnv.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const contextHelper = join(extractedRelease, 'scripts', 'detect-explorer-launch.ps1');
    const explorerContext = await runCommand(windowsPowerShell51, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', contextHelper, '-ParentProcessName', 'explorer.exe'], { cwd: extractedRelease, env: targetEnv, platform: 'win32', timeoutMs: 30_000 });
    const terminalContext = await runCommand(windowsPowerShell51, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', contextHelper, '-ParentProcessName', 'cmd.exe'], { cwd: extractedRelease, env: targetEnv, platform: 'win32', timeoutMs: 30_000 });
    assert.equal(explorerContext.exitCode, 0, 'Explorer launch context was not recognized');
    assert.equal(terminalContext.exitCode, 1, 'terminal launch context was incorrectly classified as Explorer');
    const wrapperHelp = await runCommand(join(extractedRelease, 'Install.cmd'), ['--help'], { cwd: extractedRelease, env: targetEnv, platform: 'win32', timeoutMs: 60_000 });
    assert.equal(wrapperHelp.exitCode, 0, `terminal Install.cmd help failed or paused: ${diagnostic(wrapperHelp.stderr || wrapperHelp.stdout, targetEnv)}`);

    const install = await runInstaller(installer, [
      'install', '--release-root', extractedRelease,
      '--installation-root', installationRoot,
      '--local-state-root', localStateRoot,
      '--start-menu-shortcut', shortcutPath,
      '--node-executable', nodeExecutable,
      ...(npmExecutable ? ['--npm-executable', npmExecutable] : []),
      ...(pwshExecutable ? ['--pwsh-executable', pwshExecutable] : []),
      '--plain', '--non-interactive'
    ], extractedRelease, targetEnv);
    assert.match(install.stdout, /INSTALL .*succeeded/);
    const firstReceipt = await readInstallationReceipt(localStateRoot);
    assert.ok(firstReceipt, 'fresh install did not commit an installation receipt');
    assert.equal(firstReceipt.installationRoot.toLowerCase(), installationRoot.toLowerCase());
    await verifyInstalledRuntimes(programRoot, nodeExecutable, npmExecutable);
    const firstProfile = await verifyManagedWebProfile({ platform: 'win32', env: targetEnv, dshHome, installationRoot, mutableRoot: localStateRoot, runtimeDir: join(programRoot, 'runtime', 'dsh') });
    assert.equal(firstProfile.valid, true, `fresh installed Web profile failed: ${firstProfile.errors.join('; ')}`);
    const firstHost = await verifyDesktopHostPayload(join(programRoot, DESKTOP_HOST_PAYLOAD_RELATIVE));
    assert.equal(firstHost.valid, true, `installed desktop host failed: ${firstHost.errors.join('; ')}`);
    assert.equal(await exists(shortcutPath), true, 'fresh install did not create the owned shortcut');

    // Delete only the gate-owned replaceable tree.  The receipt remains in
    // local state, so the next invocation must classify itself as repair and
    // reuse the recorded root without relocation.
    await rm(programRoot, { recursive: true, force: true });
    const repair = await runInstaller(installer, [
      'install', '--release-root', extractedRelease,
      '--local-state-root', localStateRoot,
      '--start-menu-shortcut', shortcutPath,
      '--node-executable', nodeExecutable,
      ...(npmExecutable ? ['--npm-executable', npmExecutable] : []),
      ...(pwshExecutable ? ['--pwsh-executable', pwshExecutable] : []),
      '--plain', '--non-interactive'
    ], extractedRelease, targetEnv);
    assert.match(repair.stdout, /INSTALL .*succeeded/);
    const secondReceipt = await readInstallationReceipt(localStateRoot);
    assert.ok(secondReceipt, 'repair did not preserve the installation receipt');
    assert.equal(secondReceipt.installationRoot.toLowerCase(), firstReceipt.installationRoot.toLowerCase());
    await verifyInstalledRuntimes(programRoot, nodeExecutable, npmExecutable);
    const repairedProfile = await verifyManagedWebProfile({ platform: 'win32', env: targetEnv, dshHome, installationRoot, mutableRoot: localStateRoot, runtimeDir: join(programRoot, 'runtime', 'dsh') });
    assert.equal(repairedProfile.valid, true, `receipt-driven repair Web profile failed: ${repairedProfile.errors.join('; ')}`);

    const evidenceDir = join(localStateRoot, 'logs', 'install-runs');
    const evidenceEntries = await readdir(evidenceDir);
    const timingFiles = evidenceEntries.filter((entry) => entry.endsWith('.json'));
    const logFiles = evidenceEntries.filter((entry) => entry.endsWith('.log'));
    assert.equal(timingFiles.length, 2, 'fresh install and repair did not leave exactly two timing records');
    assert.equal(logFiles.length, 2, 'fresh install and repair did not leave exactly two diagnostic logs');
    const timings = await Promise.all(timingFiles.map(async (entry) => JSON.parse(await (await import('node:fs/promises')).readFile(join(evidenceDir, entry), 'utf8')) as { operation?: string; finalStatus?: string; installationRoot?: string; phases?: unknown[]; productVersion?: string; runtimeVersion?: string; capacity?: { formula?: string; reserveBytes?: number; requiredBytes?: number; availableBytes?: number } }));
    assert.equal(timings.every((item) => item.finalStatus === 'succeeded' && item.installationRoot?.toLowerCase() === installationRoot.toLowerCase() && (item.phases?.length ?? 0) >= 8), true, 'timing records did not capture all successful phases and the selected root');
    assert.equal(timings.every((item) => item.productVersion === PRODUCT_VERSION && item.runtimeVersion === DSH_VERSION), true, 'timing records did not keep product and runtime versions distinct');
    assert.equal(timings.every((item) => item.capacity?.formula === INSTALLATION_CAPACITY_FORMULA && item.capacity.reserveBytes === INSTALLATION_STAGING_HEADROOM_BYTES && (item.capacity.requiredBytes ?? 0) > 0), true, 'timing records did not capture installation capacity evidence');
    assert.equal(timings.some((item) => item.operation === 'repair'), true, 'second timing record was not classified as repair');
    assert.equal(await exists(join(programRoot, 'runtime', 'bun')), false, 'stale Bun runtime directory was installed');
    assert.equal(await exists(join(programRoot, 'runtime', 'bun.lock')), false, 'stale Bun lock was installed');
    const workspace = await makeWorkspace(root);
    await mkdir(join(programRoot, 'neutral'), { recursive: true });
    const agentEvidence = await runInstalledMount(programRoot, dshHome, join(programRoot, 'neutral'), workspace, targetEnv, nodeExecutable);
    assert.equal(agentEvidence.ok, true, 'installed Node-based Agent probe reported failure');

    console.log(diagnostic(JSON.stringify({
      ok: true,
      gate: 'phase7-windows-installed',
      dsh: DSH_VERSION,
      externalPrerequisites: prerequisites.checks.map((check) => ({ id: check.id, version: check.version, executable: check.executable })),
      provisioned: { sourceRoot, releaseArchive, extractedRelease, installationRoot, programRoot, localStateRoot, dshHome, shortcutPath, npmCache: targetEnv.NPM_CONFIG_CACHE },
      standalone: { installer, helpExitCode: help.exitCode, wrapperHelpExitCode: wrapperHelp.exitCode, explorerContextExitCode: explorerContext.exitCode, terminalContextExitCode: terminalContext.exitCode, nodeOnTargetPath: false, bunOnTargetPath: false },
      install: { terminalEvent: install.stdout.split(/\r?\n/).find((line) => line.startsWith('INSTALL ')), receipt: firstReceipt },
      repair: { terminalEvent: repair.stdout.split(/\r?\n/).find((line) => line.startsWith('INSTALL ')), receipt: secondReceipt },
      runtimes: { dsh: true, mcporter: true, rpgmakerMcp: true, pnpm: true, profile: repairedProfile.valid, host: firstHost.valid, shortcut: true },
      timing: { files: timingFiles, logs: logFiles },
      agentEvidence,
      durationMs: Date.now() - startedAt,
      cleanMachinePrerequisiteInstall: 'not run; requires a separate disposable Windows VM'
    })));
  } catch (error) {
    primaryFailure = error;
  } finally {
    try {
      await cleanupInstalledGateWorkspace(root, { pwshExecutable });
    } catch (error) {
      cleanupFailure = new Error(diagnostic(`disposable gate cleanup failed: ${errorMessage(error)}`));
    }
  }

  if (primaryFailure) throw primaryFailure;
  if (cleanupFailure) throw cleanupFailure;
}

if (import.meta.main) await main();
