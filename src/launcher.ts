import { resolve } from 'node:path';

import { findDshExecutable } from './bootstrap';
import { resolveHarnessPaths, type PathOptions } from './config';
import { resolveExecutable } from './executable';
import { inspectCredentialMetadata } from './credentials';
import { childExitCode, runCommand, spawnInteractive, withoutCredentials, type CommandRunner, type InteractiveSpawner } from './process';
import { assertValidMvProject, pathExists, type ProjectValidation } from './project';
import { acquireHarnessSessionLeases } from './lock';

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
  lockTimeoutMs?: number;
  lockRetryMs?: number;
}

export interface LaunchResult {
  projectPath: string;
  validation: ProjectValidation;
  dshExecutable: string;
  args: string[];
  cwd: string;
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

export async function launchProject(options: LaunchOptions = {}): Promise<LaunchResult> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const paths = resolveHarnessPaths({ ...options, platform, env });
  const projectPath = options.projectPath ? resolve(options.projectPath) : await pickProjectDirectory({
    platform,
    env,
    commandRunner: options.commandRunner
  });
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

  const configured = (await inspectCredentialMetadata(paths.dshHome, env)).configured;
  const onboardingMessage = onboardingMessageFor(configured);
  if (onboardingMessage && options.notify) options.notify(`${onboardingMessage}\n`);

  const childEnv: Record<string, string | undefined> = {
    ...env,
    DSH_HOME: paths.dshHome,
    ...(options.extraEnv ?? {})
  };
  const args = [...(options.dshArgs ?? [])];
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
    onboardingMessage,
    child
  };
}

export { childExitCode };
