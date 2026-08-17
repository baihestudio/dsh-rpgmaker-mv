import { resolveHarnessPaths, type PathOptions } from './config';
import { findDshExecutable, verifyRuntime, type RuntimeVerification } from './bootstrap';
import { redactSensitive, runCommand, withoutCredentials, type CommandRunner } from './process';
import { resolveExecutable } from './executable';
import { withHarnessLock } from './lock';
import { inspectCredentialMetadata, type CredentialMetadata } from './credentials';

export interface DoctorOptions extends PathOptions {
  commandRunner?: CommandRunner;
  bunExecutable?: string;
  pwshExecutable?: string;
  coreutilsExecutable?: string;
  gitExecutable?: string;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
}

export interface DoctorCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  path?: string;
}

export interface DoctorReport {
  ok: boolean;
  platform: string;
  runtimeDir: string;
  dshHome: string;
  executablePaths: Record<string, string | undefined>;
  credentials: CredentialMetadata;
  checks: DoctorCheck[];
  runtime: RuntimeVerification;
}

function versionNumbers(text: string): [number, number, number] | undefined {
  const match = text.match(/(?:^|\D)(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function atLeast(version: [number, number, number] | undefined, minimum: [number, number, number]): boolean {
  if (!version) return false;
  for (let index = 0; index < 3; index += 1) {
    if (version[index] !== minimum[index]) return version[index] > minimum[index];
  }
  return true;
}

async function commandVersion(
  runner: CommandRunner,
  command: string | undefined,
  env: Record<string, string | undefined>,
  args: string[] = ['--version']
): Promise<{ ok: boolean; output: string }> {
  if (!command) return { ok: false, output: '' };
  try {
    const result = await runner(command, args, { env, timeoutMs: 30_000 });
    return { ok: result.exitCode === 0, output: `${result.stdout}\n${result.stderr}` };
  } catch {
    return { ok: false, output: '' };
  }
}

function identifiesMicrosoftCoreutils(output: string, executablePath?: string): boolean {
  return /Microsoft Coreutils/i.test(output) || /Microsoft[.]Coreutils/i.test(executablePath ?? '');
}

function check(id: string, label: string, ok: boolean, detail: string, path?: string): DoctorCheck {
  return { id, label, ok, detail: redactSensitive(detail), ...(path ? { path } : {}) };
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const paths = resolveHarnessPaths({ ...options, platform, env });
  return withHarnessLock(paths.lockDir, () => runDoctorUnlocked(options, platform, env, paths), {
    timeoutMs: options.lockTimeoutMs,
    retryMs: options.lockRetryMs
  });
}

async function runDoctorUnlocked(options: DoctorOptions, platform: string, env: Record<string, string | undefined>, paths: ReturnType<typeof resolveHarnessPaths>): Promise<DoctorReport> {
  const runner = options.commandRunner ?? runCommand;
  const commandEnv = withoutCredentials(env);

  const pwsh = options.pwshExecutable ?? env.PWSH_EXECUTABLE ?? await resolveExecutable('pwsh', { platform, env });
  const coreutils = options.coreutilsExecutable ?? env.COREUTILS_MANAGER ?? await resolveExecutable('coreutils-manager', { platform, env }) ?? await resolveExecutable('coreutils', { platform, env });
  const coreutilsFind = await resolveExecutable('find', { platform, env });
  const coreutilsGrep = await resolveExecutable('grep', { platform, env });
  const git = options.gitExecutable ?? env.GIT_EXECUTABLE ?? await resolveExecutable('git', { platform, env });
  const bun = options.bunExecutable ?? env.BUN_EXECUTABLE ?? await resolveExecutable('bun', { platform, env });

  const checks: DoctorCheck[] = [];
  const executablePaths: Record<string, string | undefined> = {
    powershell: pwsh,
    coreutilsManager: coreutils,
    coreutilsFind,
    coreutilsGrep,
    git,
    bun
  };

  const pwshVersion = await commandVersion(runner, pwsh, commandEnv);
  const pwshParsed = versionNumbers(pwshVersion.output);
  checks.push(check(
    'powershell',
    'PowerShell 7.4+',
    pwshVersion.ok && atLeast(pwshParsed, [7, 4, 0]),
    pwsh ? (pwshVersion.ok && pwshParsed ? `PowerShell ${pwshParsed.join('.')} at ${pwsh}` : `PowerShell at ${pwsh} is missing or older than 7.4`) : 'PowerShell 7.4+ was not found; install Microsoft.PowerShell',
    pwsh
  ));

  const coreutilsVersion = await commandVersion(runner, coreutils, commandEnv);
  const coreutilsFindVersion = await commandVersion(runner, coreutilsFind, commandEnv);
  const coreutilsGrepVersion = await commandVersion(runner, coreutilsGrep, commandEnv);
  const coreutilsOk = coreutilsVersion.ok && coreutilsFindVersion.ok && coreutilsGrepVersion.ok
    && identifiesMicrosoftCoreutils(coreutilsVersion.output, coreutils)
    && identifiesMicrosoftCoreutils(coreutilsFindVersion.output, coreutilsFind)
    && identifiesMicrosoftCoreutils(coreutilsGrepVersion.output, coreutilsGrep);
  checks.push(check(
    'coreutils',
    'Microsoft Coreutils',
    coreutilsOk,
    coreutilsOk
      ? `Microsoft Coreutils manager and find/grep are available at ${coreutils}`
      : 'Microsoft Coreutils manager plus Microsoft Coreutils find and grep were not verified; install Microsoft.Coreutils with WinGet',
    coreutils
  ));

  const gitVersion = await commandVersion(runner, git, commandEnv);
  checks.push(check(
    'git',
    'Git',
    gitVersion.ok,
    gitVersion.ok ? `Git is available at ${git}` : 'Git was not found; install Git for Windows',
    git
  ));

  const bunVersion = await commandVersion(runner, bun, commandEnv);
  checks.push(check(
    'bun',
    'Bun',
    bunVersion.ok && Boolean(versionNumbers(bunVersion.output)),
    bunVersion.ok ? `Bun is available at ${bun}` : 'Bun was not found; install Bun and reopen the launcher',
    bun
  ));

  const runtime = await verifyRuntime(paths.runtimeDir, { bunExecutable: bun ?? 'bun', commandRunner: runner, env: commandEnv, platform });
  checks.push(check(
    'dsh-runtime',
    `DSH ${runtime.dshPackageVersion ?? 'runtime'}`,
    runtime.valid,
    runtime.valid ? `Pinned DSH ${runtime.dshPackageVersion} and koffi are verified` : runtime.errors.join('; ')
  ));

  const dshExecutable = runtime.dshExecutable ?? await findDshExecutable(paths.runtimeDir, platform);
  executablePaths.dsh = dshExecutable;
  checks.push(check(
    'dsh-executable',
    'DSH executable path',
    Boolean(dshExecutable),
    dshExecutable ? `DSH executable is ${dshExecutable}` : 'DSH executable was not found; run bootstrap',
    dshExecutable
  ));

  const credentials = await inspectCredentialMetadata(paths.dshHome, env);
  checks.push(check(
    'credentials',
    'DSH credential metadata',
    credentials.configured,
    credentials.configured
      ? `Credential metadata is available through ${credentials.source}; the value is not read or printed`
      : 'DeepSeek credentials are not configured. Use DSH’s loopback-only local onboarding; the key is stored in DSH_HOME/.credentials.yaml',
    credentials.path
  ));

  return {
    ok: checks.every((item) => item.ok),
    platform,
    runtimeDir: paths.runtimeDir,
    dshHome: paths.dshHome,
    executablePaths,
    credentials,
    checks,
    runtime
  };
}

export function renderDoctorReport(report: DoctorReport): string {
  const lines = [`DSH RPG Maker doctor (${report.platform})`, `DSH_HOME: ${report.dshHome}`, `Runtime: ${report.runtimeDir}`, ''];
  for (const item of report.checks) {
    lines.push(`${item.ok ? 'PASS' : 'FAIL'} ${item.label}: ${item.detail}`);
  }
  lines.push('', report.ok ? 'Doctor passed.' : 'Doctor found issues. Fix the reported items and run doctor again.');
  return redactSensitive(lines.join('\n'));
}
