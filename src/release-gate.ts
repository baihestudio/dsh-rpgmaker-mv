import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bootstrapRuntime, type BootstrapResult } from './bootstrap';
import { PROGRAM_OWNER, PROGRAM_OWNERSHIP_FILE, PRODUCT_NAME, resolveHarnessPaths, type HarnessPaths, type PathOptions } from './config';
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
  writeInstallMetadata?: (path: string, content: string) => Promise<void>;
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

function ownershipMarker(): string {
  return `${JSON.stringify({ owner: PROGRAM_OWNER, product: PRODUCT_NAME, format: 1 })}\n`;
}

function installMetadata(paths: HarnessPaths, prerequisites: WindowsPrerequisiteReport, now: () => Date): string {
  return `${JSON.stringify({
    owner: PROGRAM_OWNER,
    product: PRODUCT_NAME,
    format: 1,
    installedAt: now().toISOString(),
    programRoot: paths.programRoot,
    mutableRoot: paths.mutableRoot,
    dshHome: paths.dshHome,
    runtimeDir: paths.runtimeDir,
    prerequisites: prerequisites.checks.map((check) => ({ id: check.id, label: check.label, version: check.version, versions: check.versions, executable: check.executable }))
  }, null, 2)}\n`;
}

async function restoreInstallTransaction(
  paths: HarnessPaths,
  rollbackRoot: string,
  oldMoved: boolean,
  shortcutPath: string,
  shortcutBackup: string | undefined,
  hadShortcut: boolean,
  now: () => Date
): Promise<string | undefined> {
  let failedRoot: string | undefined;
  if (await exists(paths.programRoot)) {
    failedRoot = `${paths.programRoot}.failed-${now().toISOString().replace(/[-:.TZ]/g, '')}-${randomUUID()}`;
    await rename(paths.programRoot, failedRoot);
  }
  if (oldMoved) await rename(rollbackRoot, paths.programRoot);
  if (hadShortcut && shortcutBackup) {
    await mkdir(dirname(shortcutPath), { recursive: true });
    await cp(shortcutBackup, shortcutPath, { force: true });
  } else {
    await rm(shortcutPath, { force: true });
  }
  return failedRoot;
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
  const shortcutBackup = `${paths.startMenuShortcutPath}.backup-${randomUUID()}`;
  const hadShortcut = await exists(paths.startMenuShortcutPath);
  let oldMoved = false;
  let stagingActive = true;
  try {
    await copyReleaseTree(releaseRoot, staging);
    await writeFile(join(staging, PROGRAM_OWNERSHIP_FILE), ownershipMarker(), 'utf8');
    if (hadShortcut) await cp(paths.startMenuShortcutPath, shortcutBackup, { force: false, errorOnExist: true });
    if (await exists(paths.programRoot)) {
      await rename(paths.programRoot, rollbackRoot);
      oldMoved = true;
    }
    await rename(staging, paths.programRoot);
    stagingActive = false;

    const installedEnv = generatedEnvironment(env, paths);
    let bootstrap: BootstrapResult;
    let shortcutPath: string;
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
      const metadataPath = join(paths.programRoot, 'install.json');
      const metadataWriter = options.writeInstallMetadata ?? ((path: string, content: string) => writeFile(path, content, 'utf8'));
      await metadataWriter(metadataPath, installMetadata(paths, prerequisites, options.now ?? (() => new Date())));
      if (!(await exists(metadataPath))) throw new Error('Install metadata was not written.');
      const createShortcut = options.createShortcut ?? createStartMenuShortcut;
      shortcutPath = await createShortcut({
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
    } catch (error) {
      let failedRoot: string | undefined;
      let recoveryError: string | undefined;
      try {
        failedRoot = await restoreInstallTransaction(paths, rollbackRoot, oldMoved, paths.startMenuShortcutPath, hadShortcut ? shortcutBackup : undefined, hadShortcut, options.now ?? (() => new Date()));
      } catch (restoreError) {
        recoveryError = restoreError instanceof Error ? restoreError.message : String(restoreError);
      }
      if (!recoveryError) await rm(shortcutBackup, { force: true });
      const detail = error instanceof Error ? error.message : String(error);
      if (recoveryError) {
        throw new ReleaseGateError(`Release install failed after the program swap and recovery is degraded: ${detail}. Failed new tree: ${failedRoot ?? paths.programRoot}; prior tree: ${oldMoved ? rollbackRoot : 'none'}; recovery error: ${recoveryError}. Do not delete these paths until recovery is resolved.`);
      }
      const recovery = oldMoved
        ? `the prior program tree was restored at ${paths.programRoot}`
        : `no prior program tree existed; the install path is inactive`;
      throw new ReleaseGateError(`Release install failed after the program swap; ${recovery}. Failed new tree preserved at ${failedRoot ?? 'none'} for diagnostic or explicit recovery: ${detail}`);
    }
    await rm(shortcutBackup, { force: true });
    return { releaseRoot, paths, prerequisites, bootstrap, shortcutPath, ...(oldMoved ? { rollbackRoot } : {}) };
  } catch (error) {
    if (stagingActive) await rm(staging, { recursive: true, force: true });
    if (error instanceof ReleaseGateError) throw error;
    if (oldMoved && !(await exists(paths.programRoot)) && await exists(rollbackRoot)) {
      await rename(rollbackRoot, paths.programRoot).catch(() => undefined);
    }
    throw new ReleaseGateError(`Release files could not be installed atomically: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (stagingActive) await rm(staging, { recursive: true, force: true });
  }
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
