import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bootstrapRuntime, type BootstrapResult } from './bootstrap';
import { resolveHarnessPaths, type HarnessPaths, type PathOptions } from './config';
import { resolveExecutable } from './executable';
import { withoutCredentials, runCommand, type CommandRunner } from './process';
import { installWindowsPrerequisites, type PrerequisiteConsent, type WindowsPrerequisiteOptions, type WindowsPrerequisiteReport } from './prerequisites';
import { createStartMenuShortcut, ensureHarnessLayout, uninstallHarness, type ShortcutCreationOptions, type UninstallOptions, type UninstallResult } from './windows';

export const RELEASE_ARCHIVE_NAME = 'DSH-RPGMaker-MV-Windows.zip';
export const RELEASE_ENTRIES = [
  'Install.cmd',
  'install.ps1',
  'Launch.cmd',
  'launch.ps1',
  'Uninstall.cmd',
  'uninstall.ps1',
  'bootstrap.ps1',
  'doctor.ps1',
  'LICENSE',
  'README.md',
  'docs',
  'package.json',
  'bun.lock',
  'src',
  'presets',
  'scripts'
] as const;

export interface InstallReleaseOptions extends PathOptions, WindowsPrerequisiteOptions {
  platform?: string;
  env?: Record<string, string | undefined>;
  releaseRoot: string;
  consent?: PrerequisiteConsent;
  commandRunner?: CommandRunner;
  createShortcut?: (options: ShortcutCreationOptions) => Promise<string>;
  now?: () => Date;
}

export interface InstallReleaseResult {
  releaseRoot: string;
  paths: HarnessPaths;
  prerequisites: WindowsPrerequisiteReport;
  bootstrap: BootstrapResult;
  shortcutPath: string;
  rollbackRoot?: string;
}

export interface ReleaseZipOptions {
  sourceRoot: string;
  outputZip: string;
  platform?: string;
  env?: Record<string, string | undefined>;
  commandRunner?: CommandRunner;
  zipExecutable?: string;
  pwshExecutable?: string;
}

export interface ReleaseZipInspection {
  path: string;
  entries: string[];
  requiredEntries: string[];
  valid: boolean;
  missing: string[];
}

export class ReleaseGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReleaseGateError';
  }
}

function within(parent: string, child: string): boolean {
  const rest = relative(resolve(parent), resolve(child));
  return rest === '' || (!rest.startsWith(`..${sep}`) && rest !== '..');
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyReleaseTree(sourceRootInput: string, destination: string): Promise<void> {
  const sourceRoot = resolve(sourceRootInput);
  await mkdir(destination, { recursive: true });
  for (const entry of RELEASE_ENTRIES) {
    const source = join(sourceRoot, entry);
    if (!(await exists(source))) throw new ReleaseGateError(`Release source is incomplete: missing ${entry}.`);
    await cp(source, join(destination, entry), { recursive: true, force: false, errorOnExist: true });
  }
}

function generatedEnvironment(env: Record<string, string | undefined>, paths: HarnessPaths): Record<string, string | undefined> {
  return {
    ...env,
    DSH_HOME: paths.dshHome,
    DSH_RPGMAKER_PROGRAM_ROOT: paths.programRoot,
    DSH_RPGMAKER_DATA_ROOT: paths.mutableRoot,
    DSH_RPGMAKER_RUNTIME: paths.runtimeDir
  };
}

export async function installWindowsRelease(options: InstallReleaseOptions): Promise<InstallReleaseResult> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') throw new ReleaseGateError('The Release ZIP installer is Windows-only.');
  const env = options.env ?? process.env;
  const paths = resolveHarnessPaths(options);
  const releaseRoot = resolve(options.releaseRoot);
  if (within(releaseRoot, paths.programRoot) || within(paths.programRoot, releaseRoot)) {
    throw new ReleaseGateError('The extracted Release ZIP must be separate from the installed program root.');
  }
  const prerequisites = await installWindowsPrerequisites({
    ...options,
    platform,
    env,
    commandRunner: options.commandRunner,
    nodeExecutable: options.nodeExecutable,
    npmExecutable: options.npmExecutable,
    bunExecutable: options.bunExecutable,
    pwshExecutable: options.pwshExecutable,
    gitExecutable: options.gitExecutable,
    coreutilsExecutable: options.coreutilsExecutable,
    wingetExecutable: options.wingetExecutable,
    consent: options.consent
  });
  await ensureHarnessLayout({ ...options, platform, env, dshHome: paths.dshHome, mutableRoot: paths.mutableRoot, programRoot: paths.programRoot });

  const parent = dirname(paths.programRoot);
  await mkdir(parent, { recursive: true });
  const staging = join(parent, `.${basename(paths.programRoot)}.install-${randomUUID()}`);
  const rollbackRoot = `${paths.programRoot}.rollback-${Date.now()}-${randomUUID()}`;
  let oldMoved = false;
  try {
    await copyReleaseTree(releaseRoot, staging);
    if (await exists(paths.programRoot)) {
      await rename(paths.programRoot, rollbackRoot);
      oldMoved = true;
    }
    await rename(staging, paths.programRoot);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (oldMoved && !(await exists(paths.programRoot)) && await exists(rollbackRoot)) {
      await rename(rollbackRoot, paths.programRoot).catch(() => undefined);
    }
    throw new ReleaseGateError(`Release files could not be installed atomically: ${error instanceof Error ? error.message : String(error)}`);
  }

  const installedEnv = generatedEnvironment(env, paths);
  let bootstrap: BootstrapResult;
  try {
    bootstrap = await bootstrapRuntime({
      ...options,
      platform,
      env: installedEnv,
      dshHome: paths.dshHome,
      runtimeDir: paths.runtimeDir,
      programRoot: paths.programRoot,
      mutableRoot: paths.mutableRoot,
      bunExecutable: options.bunExecutable ?? prerequisites.checks.find((check) => check.id === 'bun')?.executable ?? env.BUN_EXECUTABLE,
      commandRunner: options.commandRunner
    });
  } catch (error) {
    throw new ReleaseGateError(`Release files are installed at ${paths.programRoot}, but the pinned DSH runtime could not be bootstrapped: ${error instanceof Error ? error.message : String(error)}`);
  }

  const createShortcut = options.createShortcut ?? createStartMenuShortcut;
  const shortcutPath = await createShortcut({
    platform,
    env: installedEnv,
    programRoot: paths.programRoot,
    mutableRoot: paths.mutableRoot,
    dshHome: paths.dshHome,
    targetPath: join(paths.programRoot, 'Launch.cmd'),
    workingDirectory: paths.programRoot,
    helperScript: join(paths.programRoot, 'scripts', 'create-shortcut.ps1'),
    pwshExecutable: options.pwshExecutable ?? prerequisites.checks.find((check) => check.id === 'powershell')?.executable,
    commandRunner: options.commandRunner
  });
  await writeFile(join(paths.programRoot, 'install.json'), `${JSON.stringify({
    product: 'DSH-RPGMaker-MV',
    format: 1,
    installedAt: (options.now ?? (() => new Date()))().toISOString(),
    programRoot: paths.programRoot,
    mutableRoot: paths.mutableRoot,
    dshHome: paths.dshHome,
    runtimeDir: paths.runtimeDir,
    prerequisites: prerequisites.checks.map((check) => ({ id: check.id, label: check.label, version: check.version, versions: check.versions, executable: check.executable }))
  }, null, 2)}\n`, 'utf8');
  return { releaseRoot, paths, prerequisites, bootstrap, shortcutPath, ...(oldMoved ? { rollbackRoot } : {}) };
}

async function archiveWithZip(options: ReleaseZipOptions, staging: string, outputZip: string): Promise<void> {
  const env = options.env ?? process.env;
  const runner = options.commandRunner ?? runCommand;
  const zip = options.zipExecutable ?? env.ZIP_EXECUTABLE ?? await resolveExecutable('zip', { platform: options.platform, env });
  if (!zip) throw new ReleaseGateError('A ZIP writer was not found. Use the repository release tooling on Windows or install a ZIP utility for contributor packaging.');
  const result = await runner(zip, ['-q', '-r', outputZip, '.'], { cwd: staging, env: withoutCredentials(env), platform: options.platform, timeoutMs: 15 * 60_000 });
  if (result.exitCode !== 0) throw new ReleaseGateError(`ZIP creation failed: ${result.stderr || result.stdout}`.trim());
}

async function archiveWithPowerShell(options: ReleaseZipOptions, staging: string, outputZip: string): Promise<void> {
  const env = options.env ?? process.env;
  const runner = options.commandRunner ?? runCommand;
  const pwsh = options.pwshExecutable ?? env.PWSH_EXECUTABLE ?? await resolveExecutable('pwsh', { platform: 'win32', env });
  if (!pwsh) throw new ReleaseGateError('PowerShell 7 was not found to create the Release ZIP.');
  const helper = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'scripts', 'compress-release.ps1');
  const result = await runner(pwsh, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', helper, '-SourceRoot', staging, '-Destination', outputZip], { env: withoutCredentials(env), platform: 'win32', timeoutMs: 15 * 60_000 });
  if (result.exitCode !== 0) throw new ReleaseGateError(`PowerShell ZIP creation failed: ${result.stderr || result.stdout}`.trim());
}

export async function buildReleaseZip(options: ReleaseZipOptions): Promise<string> {
  const platform = options.platform ?? process.platform;
  const sourceRoot = resolve(options.sourceRoot);
  const outputZip = resolve(options.outputZip);
  if (await exists(outputZip)) throw new ReleaseGateError(`Release ZIP already exists; refusing to overwrite ${outputZip}.`);
  if (within(sourceRoot, outputZip) || within(outputZip, sourceRoot)) throw new ReleaseGateError('Release ZIP output must be outside the source tree.');
  await mkdir(dirname(outputZip), { recursive: true });
  const staging = await mkdtemp(join(dirname(outputZip), `.dsh-release-${randomUUID()}-`));
  try {
    await copyReleaseTree(sourceRoot, staging);
    if (platform === 'win32') await archiveWithPowerShell(options, staging, outputZip);
    else await archiveWithZip(options, staging, outputZip);
    if (!(await exists(outputZip))) throw new ReleaseGateError(`ZIP creation completed without producing ${outputZip}.`);
    return outputZip;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function inspectReleaseZip(options: { zipPath: string; platform?: string; env?: Record<string, string | undefined>; commandRunner?: CommandRunner; unzipExecutable?: string }): Promise<ReleaseZipInspection> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const zipPath = resolve(options.zipPath);
  if (!(await exists(zipPath))) throw new ReleaseGateError(`Release ZIP does not exist: ${zipPath}.`);
  const runner = options.commandRunner ?? runCommand;
  let command: string | undefined = options.unzipExecutable;
  let args: string[];
  if (command) args = ['-Z1', zipPath];
  else if (platform === 'win32') {
    command = env.TAR_EXECUTABLE ?? await resolveExecutable('tar', { platform, env });
    args = ['-tf', zipPath];
  } else {
    command = await resolveExecutable('unzip', { platform, env });
    args = ['-Z1', zipPath];
  }
  if (!command) throw new ReleaseGateError('No ZIP listing utility was found to inspect the Release ZIP.');
  const result = await runner(command, args, { env: withoutCredentials(env), platform, timeoutMs: 30_000 });
  if (result.exitCode !== 0) throw new ReleaseGateError(`Release ZIP inspection failed: ${result.stderr || result.stdout}`.trim());
  const entries = result.stdout.split(/\r?\n/).map((entry) => entry.trim().replaceAll('\\', '/').replace(/^\.\//, '')).filter(Boolean);
  const requiredEntries = ['Install.cmd', 'install.ps1', 'Launch.cmd', 'launch.ps1', 'Uninstall.cmd', 'uninstall.ps1', 'docs/windows-release.md', 'src/cli.ts', 'presets/rpgmaker/preset.yml'];
  const missing = requiredEntries.filter((entry) => !entries.includes(entry) && !entries.some((candidate) => candidate.startsWith(`${entry}/`)));
  return { path: zipPath, entries, requiredEntries, valid: missing.length === 0, missing };
}

export async function uninstallWindowsRelease(options: UninstallOptions = {}): Promise<UninstallResult> {
  return uninstallHarness(options);
}

export { ensureHarnessLayout, installWindowsPrerequisites };
