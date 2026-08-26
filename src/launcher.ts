import { mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as processStdin, stdout as processStdout } from 'node:process';

import { findDshExecutable } from './bootstrap';
import { resolveHarnessPaths, WINDOWS_DSH_HOST, WINDOWS_DSH_PORT, type PathOptions } from './config';
import { forgejoMcpExecutablePath } from './forgejo-mcp';
import { inspectCredentialMetadata } from './credentials';
import { childExitCode, runCommand, spawnInteractive, type CommandRunner, type InteractiveSpawner } from './process';
import { pathExists } from './project';
import { acquireHarnessSessionLeases } from './lock';
import {
  ensureFixedPortAvailable,
  ensureHarnessLayout,
  openExistingDshSession,
  probeLoopbackPort,
  type ExistingSessionOpener,
  type PortConflictAction,
  type PortProbe,
  writeLaunchLog
} from './windows';

export const SINGLE_WRITER_NOTICE = [
  'Agent single-writer contract',
  'Choose an RPG Maker MV workspace in DSH Web; the agent and its RPG Maker tools are the sole writers while that session is running.',
  'Do not have multiple Agents write to the same project at the same time.',
  'If the RPG Maker MV editor is open, it is read-only: do not save from the editor.',
  'Reopen the project in the editor before inspecting changes made by the agent.'
].join('\n');

export const ONBOARDING_MESSAGE = [
  'DeepSeek credentials are not configured.',
  'Complete DSH’s loopback-only local onboarding when DSH opens; it writes only to DSH_HOME/.credentials.yaml.',
  'The credential value is never written to generated settings, project workspaces, or launcher logs.'
].join('\n');

export function onboardingMessageFor(configured: boolean): string | undefined {
  return configured ? undefined : ONBOARDING_MESSAGE;
}

async function ask(question: string): Promise<string> {
  if (!processStdin.isTTY || !processStdout.isTTY) return '';
  const readline = createInterface({ input: processStdin, output: processStdout });
  try {
    return (await readline.question(question)).trim();
  } finally {
    readline.close();
  }
}

export interface LaunchOptions extends PathOptions {
  dshExecutable?: string;
  dshArgs?: string[];
  commandRunner?: CommandRunner;
  spawnInteractive?: InteractiveSpawner;
  notify?: (message: string) => void;
  extraEnv?: Record<string, string | undefined>;
  bindWeb?: boolean;
  webHost?: string;
  webPort?: number;
  portProbe?: PortProbe;
  portAlreadyChecked?: boolean;
  onPortConflict?: (url: string) => Promise<PortConflictAction> | PortConflictAction;
  openExistingSession?: ExistingSessionOpener;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
}

export interface LaunchResult {
  dshExecutable: string;
  args: string[];
  cwd: string;
  webUrl?: string;
  onboardingMessage?: string;
  child: unknown;
  releaseSession: () => Promise<void>;
}

export class LauncherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LauncherError';
  }
}

async function defaultPortConflict(url: string): Promise<PortConflictAction> {
  const answer = await ask(`DSH is already using ${url}. [O]pen existing session, [R]etry after closing it, or [C]ancel: `);
  if (/^(?:o|open)$/i.test(answer)) return 'open-existing';
  if (/^(?:r|retry)$/i.test(answer)) return 'retry';
  return 'cancel';
}

export async function ensureLaunchPort(options: LaunchOptions): Promise<void> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  validateRequestedBinding(options);
  if (!options.bindWeb || options.portAlreadyChecked) return;
  await ensureFixedPortAvailable({
    platform,
    host: WINDOWS_DSH_HOST,
    port: WINDOWS_DSH_PORT,
    portProbe: options.portProbe,
    onConflict: options.onPortConflict ?? defaultPortConflict,
    openExisting: options.openExistingSession ?? ((url) => openExistingDshSession(url, { platform, env, commandRunner: options.commandRunner })),
    notify: options.notify
  });
}

function rejectProjectArgument(args: string[]): void {
  for (const argument of args) {
    if (argument === '--project' || argument.startsWith('--project=')) {
      throw new LauncherError('The project-neutral launch does not accept --project; choose a workspace in DSH Web.');
    }
  }
}

export async function launchProject(options: LaunchOptions = {}): Promise<LaunchResult> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  rejectProjectArgument(options.dshArgs ?? []);
  validateRequestedBinding(options);
  if (options.bindWeb) addFixedWebBinding(options.dshArgs ?? []);
  else rejectCallerBinding(options.dshArgs ?? []);
  const paths = resolveHarnessPaths({ ...options, platform, env });
  await ensureLaunchPort(options);
  const leases = await acquireHarnessSessionLeases(paths.lockDir, paths.sessionLeaseDir, {
    timeoutMs: options.lockTimeoutMs,
    retryMs: options.lockRetryMs
  });
  try {
    const result = await launchProjectUnlocked(options, platform, env, paths);
    const releaseSession = attachSessionLease(result.child, leases.session.release);
    await leases.operation.release();
    return { ...result, releaseSession };
  } catch (error) {
    await leases.operation.release();
    await leases.session.release();
    throw error;
  }
}

function attachSessionLease(child: unknown, release: () => Promise<void>): () => Promise<void> {
  if (!child || typeof (child as { once?: unknown }).once !== 'function') {
    throw new LauncherError('DSH launch did not return a trackable child process; the session lease was not retained.');
  }
  let releasePromise: Promise<void> | undefined;
  const releaseOnce = (): Promise<void> => {
    releasePromise ??= release();
    return releasePromise;
  };
  const onEnd = (): void => { void releaseOnce(); };
  const lifecycle = child as { once: (event: string, listener: () => void) => unknown; exitCode?: number | null; signalCode?: string | null };
  lifecycle.once('exit', onEnd);
  lifecycle.once('error', onEnd);
  lifecycle.once('close', onEnd);
  if (lifecycle.exitCode !== undefined && lifecycle.exitCode !== null) void releaseOnce();
  if (lifecycle.signalCode !== undefined && lifecycle.signalCode !== null) void releaseOnce();
  return releaseOnce;
}

function fixedBindingError(option: string, value: string): LauncherError {
  return new LauncherError(`The DSH web binding is fixed at ${WINDOWS_DSH_HOST}:${WINDOWS_DSH_PORT}; caller-supplied ${option}=${value} is not allowed.`);
}

function validateFixedBindingValue(option: string, value: string | undefined, expected: string): void {
  if (value === undefined || value === expected) return;
  throw fixedBindingError(option, value);
}

/**
 * Removes caller-supplied fixed-binding options after validating them, then
 * appends one canonical binding. This is deliberately argv-based: shell text
 * is never parsed or interpolated here.
 */
export function addFixedWebBinding(args: string[]): string[] {
  const filtered: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const inline = argument.match(/^--(host|port)=(.*)$/s);
    if (inline) {
      const option = `--${inline[1]}`;
      const value = inline[2];
      validateFixedBindingValue(option, value, inline[1] === 'host' ? WINDOWS_DSH_HOST : String(WINDOWS_DSH_PORT));
      continue;
    }
    if (argument !== '--host' && argument !== '--port') {
      filtered.push(argument);
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new LauncherError(`The DSH web binding option ${argument} requires a value.`);
    index += 1;
    validateFixedBindingValue(argument, value, argument === '--host' ? WINDOWS_DSH_HOST : String(WINDOWS_DSH_PORT));
  }
  return [...filtered, '--host', WINDOWS_DSH_HOST, '--port', String(WINDOWS_DSH_PORT)];
}

function rejectCallerBinding(args: string[]): void {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const inline = argument.match(/^--(host|port)=(.*)$/s);
    if (inline) throw fixedBindingError(`--${inline[1]}`, inline[2]);
    if (argument !== '--host' && argument !== '--port') continue;
    const value = args[index + 1];
    throw fixedBindingError(argument, value ?? '(missing)');
  }
}

function validateRequestedBinding(options: LaunchOptions): void {
  if (!options.bindWeb) return;
  validateFixedBindingValue('--host', options.webHost, WINDOWS_DSH_HOST);
  if (options.webPort !== undefined && options.webPort !== WINDOWS_DSH_PORT) {
    throw fixedBindingError('--port', String(options.webPort));
  }
}

async function openStartedWebSession(
  options: LaunchOptions,
  platform: string,
  env: Record<string, string | undefined>,
  child: unknown
): Promise<void> {
  if (!options.bindWeb || platform !== 'win32') return;
  const probe = options.portProbe ?? probeLoopbackPort;
  const lifecycle = child as { exitCode?: number | null; signalCode?: string | null };
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (lifecycle.exitCode != null || lifecycle.signalCode != null) return;
    if (await probe(WINDOWS_DSH_HOST, WINDOWS_DSH_PORT)) {
      const url = `http://${WINDOWS_DSH_HOST}:${WINDOWS_DSH_PORT}/`;
      try {
        const open = options.openExistingSession ?? ((target: string) => openExistingDshSession(target, { platform, env, commandRunner: options.commandRunner }));
        await open(url);
      } catch {
        options.notify?.(`DSH started, but the browser could not be opened automatically. Open ${url} manually.`);
      }
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  options.notify?.(`DSH is still starting. Open http://${WINDOWS_DSH_HOST}:${WINDOWS_DSH_PORT}/ manually when it is ready.`);
}

async function launchProjectUnlocked(
  options: LaunchOptions,
  platform: string,
  env: Record<string, string | undefined>,
  paths: ReturnType<typeof resolveHarnessPaths>
): Promise<Omit<LaunchResult, 'releaseSession'>> {
  const executable = options.dshExecutable ?? await findDshExecutable(paths.runtimeDir, platform);
  if (!executable) {
    throw new LauncherError(`Official DSH was not found in ${paths.runtimeDir}. Run bootstrap, then doctor, before launching.`);
  }
  if (!(await pathExists(executable))) {
    throw new LauncherError(`DSH executable does not exist: ${executable}. Run bootstrap, then doctor, before launching.`);
  }

  await ensureHarnessLayout({ ...options, platform, env, dshHome: paths.dshHome, mutableRoot: paths.mutableRoot, programRoot: paths.programRoot });
  await mkdir(paths.neutralLandingDir, { recursive: true });

  const configured = (await inspectCredentialMetadata(paths.dshHome, env)).configured;
  const onboardingMessage = onboardingMessageFor(configured);
  if (onboardingMessage && options.notify) options.notify(`${onboardingMessage}\n`);

  const childEnv: Record<string, string | undefined> = {
    ...env,
    DSH_HOME: paths.dshHome,
    DSH_RPGMAKER_PROGRAM_ROOT: paths.programRoot,
    DSH_RPGMAKER_DATA_ROOT: paths.mutableRoot,
    DSH_RPGMAKER_RUNTIME: paths.runtimeDir,
    DSH_RPGMAKER_LOG_DIR: paths.logsDir,
    DSH_RPGMAKER_CACHE_DIR: paths.cacheDir,
    DSH_FORGEJO_MCP_COMMAND: env.DSH_FORGEJO_MCP_COMMAND ?? forgejoMcpExecutablePath(paths.programRoot),
    ...(options.extraEnv ?? {})
  };
  const rawArgs = [...(options.dshArgs ?? [])];
  const args = options.bindWeb ? addFixedWebBinding(rawArgs) : rawArgs;
  await writeLaunchLog({ ...options, dshHome: paths.dshHome, mutableRoot: paths.mutableRoot, programRoot: paths.programRoot, event: 'launch', host: options.bindWeb ? options.webHost ?? WINDOWS_DSH_HOST : undefined, port: options.bindWeb ? options.webPort ?? WINDOWS_DSH_PORT : undefined });
  const child = (options.spawnInteractive ?? spawnInteractive)(executable, args, {
    cwd: paths.neutralLandingDir,
    env: childEnv,
    platform
  });
  await openStartedWebSession(options, platform, env, child);

  return {
    dshExecutable: executable,
    args,
    cwd: paths.neutralLandingDir,
    ...(options.bindWeb ? { webUrl: `http://${WINDOWS_DSH_HOST}:${WINDOWS_DSH_PORT}/` } : {}),
    onboardingMessage,
    child
  };
}

export { childExitCode };
