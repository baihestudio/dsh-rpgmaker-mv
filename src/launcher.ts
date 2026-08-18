import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as processStdin, stdout as processStdout } from 'node:process';

import { findDshExecutable } from './bootstrap';
import { resolveHarnessPaths, WINDOWS_DSH_HOST, WINDOWS_DSH_PORT, type PathOptions } from './config';
import { resolveExecutable } from './executable';
import { inspectCredentialMetadata } from './credentials';
import { childExitCode, runCommand, spawnInteractive, withoutCredentials, type CommandRunner, type InteractiveSpawner } from './process';
import { assertValidMvProject, pathExists, type ProjectValidation } from './project';
import { acquireHarnessSessionLeases } from './lock';
import {
  ensureFixedPortAvailable,
  ensureHarnessLayout,
  openExistingDshSession,
  recordRecentProject,
  selectProject,
  type ExistingSessionOpener,
  type PortConflictAction,
  type PortProbe,
  type RecentProject,
  type RecentProjectChoice,
  writeLaunchLog
} from './windows';

export const SINGLE_WRITER_NOTICE = [
  'Agent single-writer contract',
  'The agent and RPG Maker MCP are the sole writers of this project while the session is running.',
  'If the RPG Maker MV editor is open, it is read-only: do not save from the editor.',
  'Reopen the project in the editor before inspecting changes made by the agent.'
].join('\n');

export const ONBOARDING_MESSAGE = [
  'DeepSeek credentials are not configured.',
  'Complete DSH’s loopback-only local onboarding when DSH opens; it writes only to DSH_HOME/.credentials.yaml.',
  'The credential value is never written to generated settings, the selected project, or launcher logs.'
].join('\n');

export interface FolderPickerOptions {
  platform?: string;
  env?: Record<string, string | undefined>;
  pwshExecutable?: string;
  commandRunner?: CommandRunner;
}

export interface LaunchOptions extends PathOptions {
  projectPath?: string;
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
  chooseRecentProject?: (last: RecentProject, recent: RecentProject[]) => Promise<RecentProjectChoice> | RecentProjectChoice;
  pickProject?: () => Promise<string>;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
}

export interface LaunchResult {
  projectPath: string;
  validation: ProjectValidation;
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

const WINDOWS_PICKER_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
  '$dialog.Description = \'Select an RPG Maker MV project folder\'',
  '$dialog.UseDescriptionForTitle = $true',
  'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.WriteLine($dialog.SelectedPath) }'
].join('; ');

function selectedPath(output: string): string | undefined {
  const values = output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  return values.at(-1);
}

export async function pickProjectDirectory(options: FolderPickerOptions = {}): Promise<string> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const runner = options.commandRunner ?? runCommand;
  const commandEnv = withoutCredentials(env);
  if (platform === 'win32') {
    const pwsh = options.pwshExecutable ?? env.PWSH_EXECUTABLE ?? await resolveExecutable('pwsh', { platform, env }) ?? 'pwsh';
    let result;
    try {
      result = await runner(pwsh, ['-NoLogo', '-NoProfile', '-STA', '-Command', WINDOWS_PICKER_SCRIPT], { env: commandEnv, timeoutMs: 10 * 60_000 });
    } catch {
      throw new LauncherError('The native Windows folder picker could not start. Verify PowerShell 7.4+ and retry.');
    }
    if (result.exitCode !== 0) throw new LauncherError('The native Windows folder picker failed or was cancelled.');
    const path = selectedPath(result.stdout);
    if (!path) throw new LauncherError('No project folder was selected.');
    return resolve(path);
  }
  throw new LauncherError('A native folder picker is supported on Windows. Pass --project with an RPG Maker MV project path.');
}

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

async function defaultRecentProjectChoice(last: RecentProject): Promise<RecentProjectChoice> {
  const answer = await ask(`Continue last project (${last.path})? [Y]es / [N]o, choose another: `);
  return /^(?:y|yes)$/i.test(answer) ? 'continue-last' : 'choose-other';
}

async function defaultPortConflict(url: string): Promise<PortConflictAction> {
  const answer = await ask(`DSH is already using ${url}. [O]pen existing session, [R]etry after closing it, or [C]ancel: `);
  if (/^(?:o|open)$/i.test(answer)) return 'open-existing';
  if (/^(?:r|retry)$/i.test(answer)) return 'retry';
  return 'cancel';
}

export async function resolveLaunchProjectPath(options: LaunchOptions = {}): Promise<string> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  return selectProject({
    ...options,
    platform,
    env,
    projectPath: options.projectPath,
    pickProject: options.pickProject ?? (() => pickProjectDirectory({ platform, env, commandRunner: options.commandRunner })),
    chooseRecentProject: options.chooseRecentProject ?? defaultRecentProjectChoice,
    notify: options.notify
  });
}

export async function ensureLaunchPort(options: LaunchOptions): Promise<void> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (!options.bindWeb || options.portAlreadyChecked) return;
  await ensureFixedPortAvailable({
    platform,
    host: options.webHost ?? WINDOWS_DSH_HOST,
    port: options.webPort ?? WINDOWS_DSH_PORT,
    portProbe: options.portProbe,
    onConflict: options.onPortConflict ?? defaultPortConflict,
    openExisting: options.openExistingSession ?? ((url) => openExistingDshSession(url, { platform, env, commandRunner: options.commandRunner })),
    notify: options.notify
  });
}

export async function launchProject(options: LaunchOptions = {}): Promise<LaunchResult> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const paths = resolveHarnessPaths({ ...options, platform, env });
  const projectPath = await resolveLaunchProjectPath(options);
  await ensureLaunchPort(options);
  const leases = await acquireHarnessSessionLeases(paths.lockDir, paths.sessionLeaseDir, {
    timeoutMs: options.lockTimeoutMs,
    retryMs: options.lockRetryMs
  });
  try {
    const result = await launchProjectUnlocked(options, platform, env, paths, projectPath);
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

function addWebBinding(args: string[], host: string, port: number): string[] {
  if (args.includes('--host') || args.includes('--port')) return args;
  return [...args, '--host', host, '--port', String(port)];
}

async function launchProjectUnlocked(
  options: LaunchOptions,
  platform: string,
  env: Record<string, string | undefined>,
  paths: ReturnType<typeof resolveHarnessPaths>,
  projectPath: string
): Promise<Omit<LaunchResult, 'releaseSession'>> {
  let validation: ProjectValidation;
  try {
    validation = await assertValidMvProject(projectPath);
  } catch (error) {
    throw new LauncherError(error instanceof Error ? error.message : String(error));
  }

  const executable = options.dshExecutable ?? await findDshExecutable(paths.runtimeDir, platform);
  if (!executable) {
    throw new LauncherError(`Official DSH was not found in ${paths.runtimeDir}. Run bootstrap, then doctor, before launching.`);
  }
  if (!(await pathExists(executable))) {
    throw new LauncherError(`DSH executable does not exist: ${executable}. Run bootstrap, then doctor, before launching.`);
  }

  await ensureHarnessLayout({ ...options, platform, env, dshHome: paths.dshHome, mutableRoot: paths.mutableRoot, programRoot: paths.programRoot });
  await recordRecentProject(validation.projectPath, { ...options, platform, env, dshHome: paths.dshHome, mutableRoot: paths.mutableRoot, programRoot: paths.programRoot });

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
    ...(options.extraEnv ?? {})
  };
  const rawArgs = [...(options.dshArgs ?? [])];
  const args = options.bindWeb
    ? addWebBinding(rawArgs, options.webHost ?? WINDOWS_DSH_HOST, options.webPort ?? WINDOWS_DSH_PORT)
    : rawArgs;
  await writeLaunchLog({ ...options, dshHome: paths.dshHome, mutableRoot: paths.mutableRoot, programRoot: paths.programRoot, event: 'launch', projectPath: validation.projectPath, host: options.bindWeb ? options.webHost ?? WINDOWS_DSH_HOST : undefined, port: options.bindWeb ? options.webPort ?? WINDOWS_DSH_PORT : undefined });
  const child = (options.spawnInteractive ?? spawnInteractive)(executable, args, {
    cwd: validation.projectPath,
    env: childEnv,
    platform
  });

  return {
    projectPath: validation.projectPath,
    validation,
    dshExecutable: executable,
    args,
    cwd: validation.projectPath,
    ...(options.bindWeb ? { webUrl: `http://${options.webHost ?? WINDOWS_DSH_HOST}:${options.webPort ?? WINDOWS_DSH_PORT}/` } : {}),
    onboardingMessage,
    child
  };
}

export { childExitCode };
