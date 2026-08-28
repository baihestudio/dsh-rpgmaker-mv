import { join } from 'node:path';

import { withEnvironmentPath } from './config';
import { resolveExecutable, resolveWindowsPwsh } from './executable';
import { commandFailure, redactSensitive, runCommand, withoutCredentials, type CommandRunner } from './process';

export const WINDOWS_PREREQUISITE_IDS = ['node', 'python', 'bun', 'powershell', 'git', 'coreutils', 'imagemagick'] as const;
export type WindowsPrerequisiteId = (typeof WINDOWS_PREREQUISITE_IDS)[number];

export interface WindowsPrerequisiteCheck {
  id: WindowsPrerequisiteId;
  label: string;
  ok: boolean;
  detail: string;
  executable?: string;
  version?: string;
  versions?: Record<string, string>;
  wingetId: string;
}

export interface WindowsPrerequisiteReport {
  ok: boolean;
  checks: WindowsPrerequisiteCheck[];
  missing: WindowsPrerequisiteId[];
}

export type PrerequisiteConsent = boolean | ((missing: WindowsPrerequisiteCheck[]) => Promise<boolean> | boolean);

export interface WindowsPrerequisiteOptions {
  platform?: string;
  env?: Record<string, string | undefined>;
  commandRunner?: CommandRunner;
  nodeExecutable?: string;
  npmExecutable?: string;
  pythonExecutable?: string;
  bunExecutable?: string;
  pwshExecutable?: string;
  gitExecutable?: string;
  coreutilsExecutable?: string;
  imageMagickExecutable?: string;
  wingetExecutable?: string;
}

export interface InstallWindowsPrerequisitesOptions extends WindowsPrerequisiteOptions {
  consent?: PrerequisiteConsent;
}

export class PrerequisiteConsentError extends Error {
  readonly report: WindowsPrerequisiteReport;

  constructor(report: WindowsPrerequisiteReport) {
    super(`The following Windows prerequisites are missing: ${report.missing.join(', ')}. Re-run Install.cmd and consent to the listed WinGet installations.`);
    this.name = 'PrerequisiteConsentError';
    this.report = report;
  }
}

function versionNumbers(text: string): [number, number, number] | undefined {
  const match = text.match(/(?:^|\D)(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function atLeast(version: [number, number, number] | undefined, minimum: [number, number, number]): boolean {
  if (!version) return false;
  for (let index = 0; index < minimum.length; index += 1) {
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
    const result = await runner(command, args, { env: withoutCredentials(env), platform: 'win32', timeoutMs: 30_000 });
    return { ok: result.exitCode === 0, output: `${result.stdout}\n${result.stderr}` };
  } catch {
    return { ok: false, output: '' };
  }
}

function managerContract(helpOutput: string, statusOutput: string): boolean {
  return /Manage coreutils utilities and PowerShell profiles/i.test(helpOutput)
    && /\benable\b/i.test(helpOutput)
    && /\bdisable\b/i.test(helpOutput)
    && /\bstatus\b/i.test(helpOutput)
    && /^\s*find\s+enabled\s*$/im.test(statusOutput)
    && /^\s*grep\s+enabled\s*$/im.test(statusOutput);
}

function normalized(value: string): string {
  return value.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
}

function isWithin(parent: string | undefined, child: string | undefined): boolean {
  if (!parent || !child) return false;
  const root = normalized(parent);
  const candidate = normalized(child);
  return candidate === root || candidate.startsWith(`${root}/`);
}

function coreutilsRoot(manager: string | undefined): string | undefined {
  if (!manager) return undefined;
  const normalizedName = manager.replaceAll('\\', '/');
  const lastSlash = normalizedName.lastIndexOf('/');
  const parent = lastSlash >= 0 ? normalizedName.slice(0, lastSlash) : '';
  const base = parent.split('/').at(-1)?.toLowerCase();
  return base === 'bin' || base === 'cmd' ? parent.slice(0, parent.lastIndexOf('/')) : parent;
}

/** Directories where a Microsoft Coreutils install keeps its manager and shim executables. */
function coreutilsCommandDirectories(manager: string | undefined): string[] {
  const root = coreutilsRoot(manager);
  if (!root) return [];
  return [root, join(root, 'bin'), join(root, 'cmd')];
}

/**
 * Resolve find/grep owned by the verified Coreutils installation root rather than
 * whatever shadows them earlier on PATH (Windows System32 ships a native find.exe).
 * A clean WinGet install appends the Coreutils directory after inherited PATH
 * entries, so PATH-only resolution can pick the unrelated System32 shim and fail
 * the ownership check even though the package is correctly installed.
 */
export async function ownedCoreutilsCommands(manager: string | undefined, env: Record<string, string | undefined>): Promise<{ find?: string; grep?: string }> {
  const result: { find?: string; grep?: string } = {};
  for (const directory of coreutilsCommandDirectories(manager)) {
    if (!result.find) result.find = await resolveExecutable(join(directory, 'find'), { platform: 'win32', env });
    if (!result.grep) result.grep = await resolveExecutable(join(directory, 'grep'), { platform: 'win32', env });
    if (result.find && result.grep) break;
  }
  return result;
}

function coreutilsFailureDetail(
  manager: string | undefined,
  contractOk: boolean,
  find: string | undefined,
  grep: string | undefined,
  managerRoot: string | undefined
): string {
  const parts: string[] = [];
  if (!manager) parts.push('coreutils-manager.exe was not resolved on PATH');
  else if (!contractOk) parts.push(`coreutils-manager --help/status contract failed at ${manager}`);
  const describe = (name: string, value: string | undefined): string => {
    if (!value) return `${name} was not resolved`;
    return isWithin(managerRoot, value) ? `${name} verified at ${value}` : `${name} resolved to ${value} outside the Coreutils root ${managerRoot ?? 'unknown'}`;
  };
  parts.push(describe('find', find), describe('grep', grep));
  return parts.join('; ');
}

function check(
  id: WindowsPrerequisiteId,
  label: string,
  wingetId: string,
  ok: boolean,
  detail: string,
  executable?: string,
  version?: string,
  versions?: Record<string, string>
): WindowsPrerequisiteCheck {
  return { id, label, wingetId, ok, detail: redactSensitive(detail), ...(executable ? { executable } : {}), ...(version ? { version } : {}), ...(versions ? { versions } : {}) };
}

async function resolved(name: string, explicit: string | undefined, env: Record<string, string | undefined>): Promise<string | undefined> {
  return explicit ?? await resolveExecutable(name, { platform: 'win32', env });
}

export async function verifyWindowsPrerequisites(options: WindowsPrerequisiteOptions = {}): Promise<WindowsPrerequisiteReport> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (platform !== 'win32') {
    return {
      ok: false,
      checks: WINDOWS_PREREQUISITE_IDS.map((id) => check(id, id, id, false, 'Windows prerequisites are release-gated and were not checked on this host.')),
      missing: [...WINDOWS_PREREQUISITE_IDS]
    };
  }

  const runner = options.commandRunner ?? runCommand;
  const node = await resolved('node', options.nodeExecutable ?? env.NODE_EXECUTABLE, env);
  const npm = await resolved('npm', options.npmExecutable ?? env.NPM_EXECUTABLE, env);
  const wingetPython = env.LOCALAPPDATA
    ? await resolveExecutable(join(env.LOCALAPPDATA, 'Programs', 'Python', 'Python313', 'python.exe'), { platform: 'win32', env })
    : undefined;
  const python = await resolved('python', options.pythonExecutable ?? env.PYTHON_EXECUTABLE ?? wingetPython, env);
  const bun = await resolved('bun', options.bunExecutable ?? env.BUN_EXECUTABLE, env);
  const pwsh = options.pwshExecutable ?? await resolveWindowsPwsh({ platform: 'win32', env });
  const git = await resolved('git', options.gitExecutable ?? env.GIT_EXECUTABLE, env);
  const manager = await resolved('coreutils-manager', options.coreutilsExecutable ?? env.COREUTILS_MANAGER, env)
    ?? await resolved('coreutils', undefined, env);
  const imageMagick = await resolved('magick', options.imageMagickExecutable, env);
  // Prefer find/grep owned by the verified Coreutils root so a clean install
  // succeeds even when System32/find.exe or another shim precedes Coreutils on PATH.
  const ownedCommands = await ownedCoreutilsCommands(manager, env);
  const find = ownedCommands.find ?? await resolved('find', undefined, env);
  const grep = ownedCommands.grep ?? await resolved('grep', undefined, env);

  const nodeVersion = await commandVersion(runner, node, env);
  const nodeLts = await commandVersion(runner, node, env, ['-p', 'process.release.lts']);
  const npmVersion = await commandVersion(runner, npm, env);
  const pythonVersion = await commandVersion(runner, python, env);
  const bunVersion = await commandVersion(runner, bun, env);
  const pwshVersion = await commandVersion(runner, pwsh, env);
  const gitVersion = await commandVersion(runner, git, env);
  const managerHelp = await commandVersion(runner, manager, env, ['--help']);
  const managerStatus = await commandVersion(runner, manager, env, ['status']);
  const findVersion = await commandVersion(runner, find, env);
  const grepVersion = await commandVersion(runner, grep, env);
  const imageMagickVersion = await commandVersion(runner, imageMagick, env);
  const managerRoot = coreutilsRoot(manager);
  const nodeParsed = versionNumbers(nodeVersion.output);
  const nodeLtsName = nodeLts.output.trim().split(/\r?\n/).find(Boolean);
  const pythonParsed = versionNumbers(pythonVersion.output);
  const pwshParsed = versionNumbers(pwshVersion.output);
  const nodeIdentity = /(?:^|\r?\n)\s*v\d+\.\d+\.\d+/i.test(nodeVersion.output);
  const npmIdentity = /(?:^|\r?\n)\s*v?\d+\.\d+\.\d+/i.test(npmVersion.output);
  const pythonIdentity = /(?:^|\r?\n)\s*Python\s+\d+\.\d+/i.test(pythonVersion.output);
  const bunIdentity = /(?:^|\r?\n)\s*\d+\.\d+\.\d+/i.test(bunVersion.output);
  const powershellIdentity = /PowerShell\s+\d+\.\d+/i.test(pwshVersion.output);
  const gitIdentity = /(?:^|\r?\n)\s*git version\s+\d+\.\d+\.\d+/i.test(gitVersion.output);
  const nodeOk = nodeVersion.ok && nodeIdentity && atLeast(nodeParsed, [18, 0, 0]) && nodeLts.ok && Boolean(nodeLtsName) && !/^false$/i.test(nodeLtsName ?? '') && npmVersion.ok && npmIdentity && Boolean(versionNumbers(npmVersion.output));
  const powershellOk = pwshVersion.ok && powershellIdentity && atLeast(pwshParsed, [7, 4, 0]);
  const coreutilsContractOk = managerHelp.ok && managerStatus.ok && managerContract(managerHelp.output, managerStatus.output);
  const coreutilsOk = coreutilsContractOk
    && findVersion.ok && grepVersion.ok
    && isWithin(managerRoot, find) && isWithin(managerRoot, grep);

  const checks = [
    check(
      'node',
      'Node.js LTS and npm',
      'OpenJS.NodeJS.LTS',
      nodeOk,
      nodeOk
        ? `Node.js LTS ${nodeParsed?.join('.')} (${nodeLtsName}) and npm ${versionNumbers(npmVersion.output)?.join('.')} are available at ${node}`
        : 'Node.js LTS (18+) and npm were not both verified; install OpenJS.NodeJS.LTS with WinGet',
      node,
      nodeParsed?.join('.'),
      nodeParsed && versionNumbers(npmVersion.output) && nodeLtsName ? { node: nodeParsed.join('.'), npm: versionNumbers(npmVersion.output)!.join('.'), lts: nodeLtsName } : undefined
    ),
    check(
      'python',
      'Python 3.11+',
      'Python.Python.3.13',
      pythonVersion.ok && pythonIdentity && atLeast(pythonParsed, [3, 11, 0]),
      pythonVersion.ok && pythonIdentity && pythonParsed
        ? `Python ${pythonParsed.join('.')} is available at ${python}`
        : 'Python 3.11+ was not verified; install Python.Python.3.13 with WinGet',
      python,
      pythonParsed?.join('.')
    ),
    check(
      'bun',
      'Bun',
      'Oven-sh.Bun',
      bunVersion.ok && bunIdentity && Boolean(versionNumbers(bunVersion.output)),
      bunVersion.ok && bunIdentity ? `Bun is available at ${bun}` : 'Bun was not verified; install Oven-sh.Bun with WinGet',
      bun,
      versionNumbers(bunVersion.output)?.join('.')
    ),
    check(
      'powershell',
      'PowerShell 7.4+',
      'Microsoft.PowerShell',
      powershellOk,
      powershellOk ? `PowerShell ${pwshParsed?.join('.')} is available at ${pwsh}` : 'PowerShell 7.4+ was not verified; install Microsoft.PowerShell with WinGet',
      pwsh,
      pwshParsed?.join('.')
    ),
    check(
      'git',
      'Git for Windows',
      'Git.Git',
      gitVersion.ok && gitIdentity,
      gitVersion.ok && gitIdentity ? `Git is available at ${git}` : 'Git for Windows was not verified; install Git.Git with WinGet',
      git,
      versionNumbers(gitVersion.output)?.join('.')
    ),
    check(
      'coreutils',
      'Microsoft Coreutils',
      'Microsoft.Coreutils',
      coreutilsOk,
      coreutilsOk
        ? `Microsoft Coreutils manager and enabled find/grep are available under ${managerRoot}`
        : `Microsoft Coreutils manager, enabled find, and enabled grep were not verified; install Microsoft.Coreutils with WinGet (${coreutilsFailureDetail(manager, coreutilsContractOk, find, grep, managerRoot)})`,
      manager
    ),
    check(
      'imagemagick',
      'ImageMagick 7',
      'ImageMagick.ImageMagick',
      imageMagickVersion.ok && /ImageMagick\s+\d+\.\d+/i.test(imageMagickVersion.output),
      imageMagickVersion.ok && /ImageMagick\s+\d+\.\d+/i.test(imageMagickVersion.output)
        ? `ImageMagick is available at ${imageMagick}`
        : imageMagick
          ? `ImageMagick was not verified at ${imageMagick}; install ImageMagick.ImageMagick with WinGet`
          : 'ImageMagick was not found; install ImageMagick.ImageMagick with WinGet',
      imageMagick,
      versionNumbers(imageMagickVersion.output)?.join('.')
    )
  ];
  const missing = checks.filter((item) => !item.ok).map((item) => item.id);
  return { ok: missing.length === 0, checks, missing };
}

async function refreshWindowsEnvironment(runner: CommandRunner, env: Record<string, string | undefined>): Promise<Record<string, string | undefined>> {
  const paths = [env.PATH ?? ''];
  const registry = [
    ['HKCU', 'Environment'],
    ['HKLM', 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment']
  ] as const;
  const reg = env.SystemRoot ? join(env.SystemRoot, 'System32', 'reg.exe') : 'reg.exe';
  for (const [hive, key] of registry) {
    try {
      const result = await runner(reg, ['query', `${hive}\\${key}`, '/v', 'Path'], { env: withoutCredentials(env), platform: 'win32', timeoutMs: 30_000 });
      if (result.exitCode !== 0) continue;
      const value = result.stdout.match(/^\s*Path\s+REG_[A-Z_]+\s+(.*)$/im)?.[1]?.trim();
      if (!value) continue;
      paths.push(value.replace(/%([^%]+)%/g, (_match, name: string) => env[name] ?? process.env[name] ?? `%${name}%`));
    } catch {
      // Verification still uses the original environment if registry refresh is unavailable.
    }
  }
  return withEnvironmentPath(env, [...new Set(paths.filter(Boolean).flatMap((value) => value.split(';')))].join(';'), 'win32');
}

/**
 * Run one WinGet install for a missing prerequisite and return a redacted
 * failure detail, or undefined when WinGet succeeded. WinGet exits nonzero for
 * benign outcomes such as "already installed, no newer version"; the
 * authoritative pass/fail is the post-install verification, so a nonzero exit
 * here only surfaces if that verification still fails.
 */
async function installOne(
  runner: CommandRunner,
  winget: string,
  prerequisite: WindowsPrerequisiteCheck,
  env: Record<string, string | undefined>
): Promise<string | undefined> {
  const args = ['install', '--id', prerequisite.wingetId, '--exact', '--accept-source-agreements', '--accept-package-agreements'];
  let result;
  try {
    result = await runner(winget, args, { env: withoutCredentials(env), platform: 'win32', timeoutMs: 15 * 60_000 });
  } catch (error) {
    return `WinGet could not install ${prerequisite.label}: ${redactSensitive(error instanceof Error ? error.message : String(error), env)}`;
  }
  if (result.exitCode !== 0) return commandFailure(winget, args, result, env).message;
  return undefined;
}

export async function installWindowsPrerequisites(options: InstallWindowsPrerequisitesOptions = {}): Promise<WindowsPrerequisiteReport> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') throw new Error('Windows prerequisite installation can only run on Windows.');
  const env = options.env ?? process.env;
  const runner = options.commandRunner ?? runCommand;
  let report = await verifyWindowsPrerequisites(options);
  if (report.ok) return report;
  const missing = report.checks.filter((item) => !item.ok);
  let consent = options.consent;
  if (typeof consent === 'function') consent = await consent(missing);
  if (consent !== true) throw new PrerequisiteConsentError(report);
  const winget = options.wingetExecutable ?? env.WINGET_EXECUTABLE ?? await resolveExecutable('winget', { platform: 'win32', env });
  if (!winget) throw new Error('WinGet was not found. Install App Installer from Microsoft, then run Install.cmd again.');
  const wingetFailures: string[] = [];
  for (const prerequisite of missing) {
    const failure = await installOne(runner, winget, prerequisite, env);
    if (failure) wingetFailures.push(failure);
  }
  const refreshedEnv = await refreshWindowsEnvironment(runner, env);
  report = await verifyWindowsPrerequisites({ ...options, env: refreshedEnv });
  if (!report.ok) {
    const detail = wingetFailures.length > 0 ? ` WinGet reported: ${wingetFailures.join('; ')}.` : '';
    throw new Error(`Prerequisite installation completed but verification still fails: ${report.missing.join(', ')}.${detail}`);
  }
  return report;
}

export { atLeast, versionNumbers };
