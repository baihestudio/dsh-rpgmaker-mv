import { randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bootstrapRuntime, DSH_RUNTIME_MANIFEST_RELATIVE, resolveDshEntrypoint, type BootstrapResult } from './bootstrap';
import { DSH_VERSION, environmentPath, legacyStartMenuShortcutPath, pathDelimiter, withEnvironmentPath, PROGRAM_OWNER, PROGRAM_OWNERSHIP_FILE, PRODUCT_NAME, PRODUCT_VERSION, resolveHarnessPaths, type HarnessPaths, type PathOptions } from './config';
import { resolveExecutable, resolveWindowsPwsh } from './executable';
import { FORGEJO_MCP_EXECUTABLE_NAME, FORGEJO_MCP_LICENSE_NAME, FORGEJO_MCP_MANIFEST_NAME, FORGEJO_MCP_RUNTIME_RELATIVE, forgejoMcpExecutablePath, verifyForgejoMcpRuntime } from './forgejo-mcp';
import { redactSensitive, withoutCredentials, runCommand, type CommandRunner } from './process';
import { installWindowsPrerequisites, type WindowsPrerequisiteOptions, type WindowsPrerequisiteReport } from './prerequisites';
import { deployRpgMakerPresets, prepareRpgMakerMcpRuntime, validateRpgMakerMcpContracts, type McpSchemaProbe, type RpgMakerMcpContractValidation, RPGMAKER_MCP_MANIFEST_RELATIVE } from './rpgmaker';
import { MCPORTER_MANIFEST_RELATIVE, prepareMcporterRuntime } from './mcport';
import { PNPM_MANIFEST_RELATIVE } from './profile';
import { DSH_BRAND_BUNDLE_RELATIVE, ensureManagedWebProfile } from './managed-web-profile';
import { WORKSPACE_MCP_AGENT_ENTRYPOINT, WORKSPACE_MCP_BUNDLE_ARCHIVE_RELATIVE, WORKSPACE_MCP_BUNDLE_RELATIVE } from './workspace-mcp';
import {
  DESKTOP_HOST_MANIFEST_RELATIVE,
  DESKTOP_HOST_PAYLOAD_RELATIVE,
  ELECTROBUN_PRODUCT_VERSION,
  copyDesktopHostPayload,
  resolveDesktopHostPayload,
  verifyDesktopHostPayload,
  type DesktopHostCopyResult
} from './desktop-host';
import {
  confirmAndStopOwnedAgent,
  RunningAgentCloseDeclinedError,
  type OwnedAgentConsent,
  type OwnedProcessRecord,
  type OwnedProcessTreeStopper,
  type OwnedProcessLister
} from './install-lifecycle';
import { createStartMenuShortcut, ensureHarnessLayout, uninstallHarness, type ShortcutCreationOptions, type UninstallOptions, type UninstallResult } from './windows';
import { withHarnessLock } from './lock';
import { commitInstallationReceipt, defaultInstallationRoot, defaultLocalStateRoot, INSTALLATION_CAPACITY_BASIS, INSTALLATION_CAPACITY_FORMULA, INSTALLATION_STAGING_HEADROOM_BYTES, inspectInstallationReceipt, measureReleasePayloadBytes, readInstallationReceipt, resolveRecordedInstallationRoot, validateInstallationRoot, type InstallationCapacity } from './installation-root';
import { createInstallationSession, rendererMode, type InstallationEventListener, type InstallationOperation, type InstallationRendererMode } from './install-events';
import { createInstallRunEvidence, type InstallRunEvidence } from './install-evidence';

export const RELEASE_ARCHIVE_NAME = 'DSH-RPGMaker-MV-Windows.zip';
export const INSTALLER_EXECUTABLE_NAME = 'installer.exe';
export const INSTALLER_BUILD_EVIDENCE_NAME = 'installer-build.json';
export const WINDOWS_GATE_CLEANUP_HELPER_RELATIVE = 'scripts/remove-phase7-gate-root.ps1';
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
  'THIRD-PARTY-NOTICES.md',
  'README.md',
  'docs',
  'package.json',
  'runtime-manifests',
  'src',
  'presets',
  'scripts',
  FORGEJO_MCP_RUNTIME_RELATIVE,
  WORKSPACE_MCP_BUNDLE_RELATIVE,
  DSH_BRAND_BUNDLE_RELATIVE
] as const;
/** Generated only while packaging; these are not part of the source tree contract. */
export const GENERATED_RELEASE_ENTRIES = [
  INSTALLER_EXECUTABLE_NAME,
  INSTALLER_BUILD_EVIDENCE_NAME
] as const;
/** Files required in a replaceable installed program tree. */
export const INSTALLED_PROGRAM_ENTRIES = [
  ...RELEASE_ENTRIES,
  ...GENERATED_RELEASE_ENTRIES
] as const;

export interface InstallReleaseOptions extends PathOptions, WindowsPrerequisiteOptions {
  platform?: string;
  env?: Record<string, string | undefined>;
  releaseRoot: string;
  /** Inject live MCP tools/list for disposable install tests. */
  mcpSchemaProbe?: McpSchemaProbe;
  /** Alias retained for the product's existing schema-probe seam. */
  schemaProbe?: McpSchemaProbe;
  installationRoot?: string;
  localStateRoot?: string;
  renderer?: InstallationRendererMode;
  operation?: InstallationOperation;
  onEvent?: InstallationEventListener;
  nonInteractive?: boolean;
  installationRootPicker?: (defaultPath: string) => Promise<string | undefined>;
  requiredInstallationBytes?: number;
  availableInstallationBytes?: number;
  installationHeadroomBytes?: number;
  commandRunner?: CommandRunner;
  createShortcut?: (options: ShortcutCreationOptions) => Promise<string>;
  writeInstallMetadata?: (path: string, content: string) => Promise<void>;
  prepareAgentDependencies?: (context: PrepareAgentDependenciesContext) => Promise<void>;
  /** Prebuilt host payload to merge into the Release tree. */
  desktopHostRoot?: string;
  /** Require a native host payload even when running a simulated test host. */
  requireDesktopHost?: boolean;
  /** Test seam for the owned upgrade process inventory/consent lifecycle. */
  ownedAgentConsent?: OwnedAgentConsent;
  ownedProcessRecords?: OwnedProcessRecord[];
  listOwnedProcesses?: OwnedProcessLister;
  stopOwnedProcessTree?: OwnedProcessTreeStopper;
  now?: () => Date;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
}

export interface PrepareAgentDependenciesContext {
  paths: HarnessPaths;
  env: Record<string, string | undefined>;
  nodeExecutable?: string;
  npmExecutable?: string;
  commandRunner?: CommandRunner;
}

export interface InstallReleaseResult {
  releaseRoot: string;
  paths: HarnessPaths;
  prerequisites: WindowsPrerequisiteReport;
  bootstrap: BootstrapResult;
  shortcutPath: string;
  desktopHost?: DesktopHostCopyResult;
  launchTarget: string;
  rollbackRoot?: string;
  timingPath?: string;
  logPath?: string;
  timing?: import('./install-evidence').InstallTimingRecord;
  mcpContracts?: RpgMakerMcpContractValidation;
}

export interface ReleaseZipOptions {
  sourceRoot: string;
  outputZip: string;
  platform?: string;
  env?: Record<string, string | undefined>;
  commandRunner?: CommandRunner;
  zipExecutable?: string;
  pwshExecutable?: string;
  desktopHostRoot?: string;
  requireDesktopHost?: boolean;
  bunExecutable?: string;
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

export class InstallationCancelledError extends ReleaseGateError {
  constructor(message = 'Installation cancelled. No files were downloaded or changed.') {
    super(message);
    this.name = 'InstallationCancelledError';
  }
}

export interface PathApi {
  resolve(path: string): string;
  relative(from: string, to: string): string;
  parse(path: string): { root: string };
  sep: string;
}

const NATIVE_PATH: PathApi = { resolve, relative, parse, sep };

function within(parent: string, child: string, paths: PathApi = NATIVE_PATH): boolean {
  const parentResolved = paths.resolve(parent);
  const childResolved = paths.resolve(child);
  // On Windows, relative() returns an absolute path when the roots differ
  // (e.g. different drive letters); that must not read as "inside".
  if (paths.parse(parentResolved).root.toLowerCase() !== paths.parse(childResolved).root.toLowerCase()) return false;
  const rest = paths.relative(parentResolved, childResolved);
  return rest === '' || (!rest.startsWith(`..${paths.sep}`) && rest !== '..');
}

export function pathsNest(first: string, second: string, paths: PathApi = NATIVE_PATH): boolean {
  return within(first, second, paths) || within(second, first, paths);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyReleaseTree(
  sourceRootInput: string,
  destination: string,
  entries: readonly string[] = RELEASE_ENTRIES,
): Promise<void> {
  const sourceRoot = resolve(sourceRootInput);
  await mkdir(destination, { recursive: true });
  for (const entry of entries) {
    const source = join(sourceRoot, entry);
    if (GENERATED_RELEASE_ENTRIES.includes(entry as typeof GENERATED_RELEASE_ENTRIES[number])) {
      if (!(await nonEmptyRegularFile(source))) throw new ReleaseGateError(`Release source is incomplete: required maintenance artifact ${entry} is missing or not a non-empty regular file.`);
    } else if (!(await exists(source))) {
      throw new ReleaseGateError(`Release source is incomplete: missing ${entry}.`);
    }
    await cp(source, join(destination, entry), { recursive: true, force: false, errorOnExist: true });
  }
}

async function nonEmptyRegularFile(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    return metadata.isFile() && !metadata.isSymbolicLink() && metadata.size > 0;
  } catch {
    return false;
  }
}

async function verifyInstalledMaintenanceContract(programRoot: string): Promise<void> {
  for (const entry of GENERATED_RELEASE_ENTRIES) {
    const path = join(programRoot, entry);
    if (!(await nonEmptyRegularFile(path))) {
      throw new ReleaseGateError(`Installed program is incomplete: required maintenance artifact ${entry} is missing or not a non-empty regular file.`);
    }
  }
}

function generatedEnvironment(env: Record<string, string | undefined>, paths: HarnessPaths, prerequisites: WindowsPrerequisiteReport): Record<string, string | undefined> {
  const executableDirs = prerequisites.checks.flatMap((item) => item.executable ? [dirname(item.executable)] : []);
  const inheritedPath = environmentPath(env, 'win32')
    .split(pathDelimiter('win32'))
    .filter(Boolean);
  const path = [...new Set([...executableDirs, ...inheritedPath])].join(pathDelimiter('win32'));
  const next = withEnvironmentPath(env, path, 'win32');
  return {
    ...next,
    DSH_HOME: paths.dshHome,
    DSH_RPGMAKER_PROGRAM_ROOT: paths.programRoot,
    DSH_RPGMAKER_INSTALLATION_ROOT: paths.installationRoot,
    DSH_RPGMAKER_DATA_ROOT: paths.mutableRoot,
    DSH_RPGMAKER_RUNTIME: paths.runtimeDir,
    DSH_FORGEJO_MCP_COMMAND: forgejoMcpExecutablePath(paths.programRoot),
    DSH_RPGMAKER_INSTALLATION_CACHE: paths.installationCacheDir,
    DSH_RPGMAKER_CACHE_DIR: paths.installationCacheDir,
    NODE_EXECUTABLE: prerequisites.executablePaths.node,
    NPM_EXECUTABLE: prerequisites.executablePaths.npm,
    BUN_EXECUTABLE: prerequisites.executablePaths.bun,
    NPM_CONFIG_CACHE: join(paths.installationCacheDir, 'npm-cache'),
    npm_config_cache: join(paths.installationCacheDir, 'npm-cache')
  };
}

function ownershipMarker(): string {
  return `${JSON.stringify({ owner: PROGRAM_OWNER, product: PRODUCT_NAME, format: 1 })}\n`;
}

function boundedDiagnostic(message: string, env: Record<string, string | undefined>, limit = 2_000): string {
  const redacted = redactSensitive(message, env).trim();
  if (redacted.length <= limit) return redacted;
  return `[diagnostic truncated]\n${redacted.slice(-limit)}`;
}

function installMetadata(
  paths: HarnessPaths,
  prerequisites: WindowsPrerequisiteReport,
  now: () => Date,
  launchTarget: string,
  desktopHost: DesktopHostCopyResult | undefined,
  mcpContracts?: RpgMakerMcpContractValidation
): string {
  return `${JSON.stringify({
    owner: PROGRAM_OWNER,
    product: PRODUCT_NAME,
    format: 1,
    installedAt: now().toISOString(),
    installationRoot: paths.installationRoot,
    programRoot: paths.programRoot,
    localStateRoot: paths.localStateRoot,
    mutableRoot: paths.mutableRoot,
    dshHome: paths.dshHome,
    runtimeDir: paths.runtimeDir,
    installationCacheDir: paths.installationCacheDir,
    launchTarget,
    ...(desktopHost ? {
      desktopHost: {
        payload: DESKTOP_HOST_PAYLOAD_RELATIVE,
        manifest: desktopHost.manifestPath ? relative(desktopHost.payloadRoot, desktopHost.manifestPath).replaceAll('\\', '/') : undefined,
        launchTarget: desktopHost.installedLaunchTarget ?? desktopHost.launchTarget,
        payloadLaunchTarget: desktopHost.launchTarget,
        hostCommit: desktopHost.hostCommit,
        bunVersion: desktopHost.bunVersion,
        productVersion: desktopHost.productVersion,
        ...(desktopHost.adapterSourceSha256 ? { adapterSourceSha256: desktopHost.adapterSourceSha256 } : {}),
        ...(desktopHost.sidecarSha256 ? { sidecarSha256: desktopHost.sidecarSha256 } : {}),
        ...(desktopHost.sidecarProvenance ? { sidecarProvenance: desktopHost.sidecarProvenance } : {})
      }
    } : {}),
    prerequisites: prerequisites.checks.map((check) => ({ id: check.id, label: check.label, version: check.version, versions: check.versions, executable: check.executable })),
    ...(mcpContracts ? {
      mcpContracts: {
        valid: mcpContracts.valid,
        engines: Object.fromEntries(Object.entries(mcpContracts.engines).map(([engine, result]) => [engine, {
          toolCount: result.toolCount,
          manifestDigest: result.manifestDigest,
          valid: result.valid
        }]))
      }
    } : {})
  }, null, 2)}\n`;
}

async function carryForwardVerifiedDependencies(previousProgramRoot: string, nextProgramRoot: string): Promise<void> {
  for (const relativePath of [join('runtime', 'mcp'), join('runtime', 'pnpm')]) {
    const source = join(previousProgramRoot, relativePath);
    const destination = join(nextProgramRoot, relativePath);
    if (await exists(source) && !(await exists(destination))) {
      await mkdir(dirname(destination), { recursive: true });
      await cp(source, destination, { recursive: true, force: false, errorOnExist: true });
    }
  }
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

async function installWindowsReleaseCore(options: InstallReleaseOptions, session?: ReturnType<typeof createInstallationSession>, evidence?: InstallRunEvidence): Promise<InstallReleaseResult> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') throw new ReleaseGateError('The Release ZIP installer is Windows-only.');
  const env = options.env ?? process.env;
  const baseCommandRunner = options.commandRunner ?? runCommand;
  const commandRunner: CommandRunner = async (command, args, commandOptions) => {
    try {
      const result = await baseCommandRunner(command, args, commandOptions);
      evidence?.command('child process', command, result);
      return result;
    } catch (error) {
      evidence?.appendLog(`child process ${basename(command)} could not start: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  };
  const now = options.now ?? (() => new Date());
  const releaseRoot = resolve(options.releaseRoot);
  const localStateRoot = resolve(options.localStateRoot ?? options.mutableRoot ?? env.DSH_RPGMAKER_LOCAL_STATE_ROOT ?? env.DSH_RPGMAKER_DATA_ROOT ?? defaultLocalStateRoot(env));
  const existingReceipt = await readInstallationReceipt(localStateRoot);
  if (options.operation === 'repair' && !existingReceipt) {
    throw new ReleaseGateError('Repair requires an existing installation-location receipt. Run install first.');
  }
  const startPhase = (phase: Parameters<NonNullable<typeof session>['startPhase']>[0], label?: string): void => {
    session?.startPhase(phase, label);
    evidence?.phaseStarted(phase);
  };
  const finishPhase = (status: 'succeeded' | 'failed' | 'cancelled' = 'succeeded', error?: string): void => {
    session?.finishPhase(status, error ? { message: error } : undefined);
    if (session) evidence?.phaseFinished(status, now(), 0, error);
  };
  startPhase('destination', existingReceipt ? 'reuse recorded installation root' : 'choose and validate installation root');
  let selectedInstallationRoot = options.installationRoot;
  let pickerAttempted = false;
  if (!existingReceipt && !selectedInstallationRoot && options.installationRootPicker) {
    pickerAttempted = true;
    selectedInstallationRoot = await options.installationRootPicker(defaultInstallationRoot(env));
  }
  if (existingReceipt) {
    const recorded = await resolveRecordedInstallationRoot(localStateRoot, selectedInstallationRoot, platform);
    selectedInstallationRoot = recorded.installationRoot;
  }
  const paths = resolveHarnessPaths({ ...options, installationRoot: selectedInstallationRoot, localStateRoot, mutableRoot: localStateRoot });
  evidence?.setInstallationRoot(paths.installationRoot);
  if (!existingReceipt && !selectedInstallationRoot) {
    if (pickerAttempted && !options.nonInteractive) {
      throw new InstallationCancelledError();
    }
    throw new ReleaseGateError('No installation root was selected. Choose a destination before downloading prerequisites.');
  }
  if (!within(paths.installationRoot, paths.programRoot) || resolve(paths.installationRoot) === resolve(paths.programRoot)) {
    throw new ReleaseGateError(`The program root ${paths.programRoot} must be a child of the selected installation root ${paths.installationRoot}.`);
  }
  if (pathsNest(releaseRoot, paths.programRoot)) {
    throw new ReleaseGateError('The extracted Release ZIP must be separate from the installed program root.');
  }

  const sourceAdapterPath = join(releaseRoot, 'src', 'electrobun-sidecar.ts');
  const desktopHostSource = await resolveDesktopHostPayload(releaseRoot, { desktopHostRoot: options.desktopHostRoot });
  const requireDesktopHost = options.requireDesktopHost ?? (platform === 'win32' && process.platform === 'win32');
  let desktopHost: DesktopHostCopyResult | undefined;
  if (desktopHostSource) {
    if (pathsNest(desktopHostSource, paths.programRoot)) {
      throw new ReleaseGateError('The desktop host payload must be separate from the installed program root.');
    }
    const verifiedHost = await verifyDesktopHostPayload(desktopHostSource, {
      productVersion: ELECTROBUN_PRODUCT_VERSION,
      adapterSourcePath: sourceAdapterPath
    });
    if (!verifiedHost.valid || !verifiedHost.launchTarget) {
      throw new ReleaseGateError(`Desktop host payload is not usable: ${verifiedHost.errors.join('; ')}`);
    }
    desktopHost = {
      ...verifiedHost,
      installedLaunchTarget: `${DESKTOP_HOST_PAYLOAD_RELATIVE}/${verifiedHost.launchTarget}`.replaceAll('\\', '/')
    };
  } else if (requireDesktopHost) {
    throw new ReleaseGateError(`Release is missing the required ${DESKTOP_HOST_PAYLOAD_RELATIVE} payload.`);
  }

  const rootValidation = await validateInstallationRoot(paths.installationRoot, {
    platform,
    localStateRoot: paths.mutableRoot,
    releaseRoot,
    requiredBytes: options.requiredInstallationBytes,
    availableBytes: options.availableInstallationBytes,
    headroomBytes: options.installationHeadroomBytes
  });
  if (!rootValidation.valid) {
    const space = `${rootValidation.requiredBytes} bytes required${rootValidation.availableBytes === undefined ? '' : `, ${rootValidation.availableBytes} bytes available`}`;
    const message = `Installation root ${paths.installationRoot} is not usable (${space}): ${rootValidation.errors.join('; ')}`;
    finishPhase('failed', message);
    throw new ReleaseGateError(message);
  }
  const capacity: InstallationCapacity = {
    payloadBytes: rootValidation.payloadBytes,
    headroomBytes: rootValidation.headroomBytes,
    requiredBytes: rootValidation.requiredBytes,
    ...(rootValidation.availableBytes === undefined ? {} : { availableBytes: rootValidation.availableBytes }),
    formula: INSTALLATION_CAPACITY_FORMULA,
    basis: INSTALLATION_CAPACITY_BASIS
  };
  session?.reportCapacity(capacity);
  evidence?.setCapacity(capacity);
  finishPhase();

  // This read-only lifecycle check is deliberately before prerequisite
  // verification, mutable-layout creation, or the program-tree swap. A user
  // who declines to close an active owned Agent therefore gets a true no-op.
  startPhase('prerequisites', 'verify Node.js/npm and Windows prerequisites');
  try {
    await confirmAndStopOwnedAgent({
      platform,
      env,
      programRoot: paths.programRoot,
      commandRunner,
      pwshExecutable: options.pwshExecutable,
      processRecords: options.ownedProcessRecords,
      listProcesses: options.listOwnedProcesses,
      stopProcessTree: options.stopOwnedProcessTree,
      consent: options.ownedAgentConsent
    });
  } catch (error) {
    if (error instanceof RunningAgentCloseDeclinedError) {
      throw new ReleaseGateError(error.message);
    }
    throw new ReleaseGateError(`The installed RPG Maker Agent could not be safely closed before upgrade: ${error instanceof Error ? error.message : String(error)}`);
  }

  const prerequisites = await installWindowsPrerequisites({
    ...options,
    platform,
    env,
    commandRunner,
    nodeExecutable: options.nodeExecutable,
    npmExecutable: options.npmExecutable,
    pwshExecutable: options.pwshExecutable,
    gitExecutable: options.gitExecutable,
    coreutilsExecutable: options.coreutilsExecutable,
    wingetExecutable: options.wingetExecutable,
  });
  for (const item of prerequisites.checks) evidence?.prerequisite(item.id, item.ok ? 'verified' : 'failed');
  finishPhase();
  await ensureHarnessLayout({
    ...options,
    platform,
    env,
    dshHome: paths.dshHome,
    mutableRoot: paths.mutableRoot,
    installationRoot: paths.installationRoot,
  });

  const parent = dirname(paths.programRoot);
  await mkdir(parent, { recursive: true });
  const staging = join(parent, `.${basename(paths.programRoot)}.install-${randomUUID()}`);
  const rollbackRoot = `${paths.programRoot}.rollback-${Date.now()}-${randomUUID()}`;
  const shortcutBackup = `${paths.startMenuShortcutPath}.backup-${randomUUID()}`;
  const hadShortcut = await exists(paths.startMenuShortcutPath);
  let oldMoved = false;
  let stagingActive = true;
  try {
    await copyReleaseTree(releaseRoot, staging, INSTALLED_PROGRAM_ENTRIES);
    if (desktopHostSource) {
      const copiedHost = await copyDesktopHostPayload(releaseRoot, staging, {
        desktopHostRoot: desktopHostSource,
        productVersion: ELECTROBUN_PRODUCT_VERSION,
        adapterSourcePath: sourceAdapterPath
      });
      if (!copiedHost) throw new ReleaseGateError(`Release is missing the required ${DESKTOP_HOST_PAYLOAD_RELATIVE} payload.`);
      desktopHost = copiedHost;
    }
    await writeFile(join(staging, PROGRAM_OWNERSHIP_FILE), ownershipMarker(), 'utf8');
    if (hadShortcut) await cp(paths.startMenuShortcutPath, shortcutBackup, { force: false, errorOnExist: true });
    if (await exists(paths.programRoot)) {
      await rename(paths.programRoot, rollbackRoot);
      oldMoved = true;
    }
    await rename(staging, paths.programRoot);
    stagingActive = false;

    const installedEnv = generatedEnvironment(env, paths, prerequisites);
    startPhase('runtime', 'install and verify the pinned DSH runtime');
    let bootstrap: BootstrapResult;
    let shortcutPath: string;
    let mcpContracts: RpgMakerMcpContractValidation | undefined;
    try {
      const forgejoMcp = await verifyForgejoMcpRuntime({ platform, env, programRoot: paths.programRoot, commandRunner });
      if (!forgejoMcp.valid) throw new Error(`App-owned Forgejo MCP is not usable: ${forgejoMcp.errors.join('; ')}`);
      if (oldMoved) await carryForwardVerifiedDependencies(rollbackRoot, paths.programRoot);
      bootstrap = await bootstrapRuntime({
        ...options,
        platform,
        env: installedEnv,
        dshHome: paths.dshHome,
        runtimeDir: paths.runtimeDir,
        mutableRoot: paths.mutableRoot,
        nodeExecutable: options.nodeExecutable ?? prerequisites.executablePaths.node,
        npmExecutable: options.npmExecutable ?? prerequisites.executablePaths.npm,
        manifestRoot: join(paths.programRoot, DSH_RUNTIME_MANIFEST_RELATIVE),
        commandRunner
      });
      finishPhase();
      startPhase('tools', 'install and verify app-owned tools');
      const prepareAgentDependencies = options.prepareAgentDependencies ?? (async (context) => {
        const mcporter = await prepareMcporterRuntime({
          platform,
          env: context.env,
          dshHome: context.paths.dshHome,
          mutableRoot: context.paths.mutableRoot,
          runtimeDir: context.paths.runtimeDir,
          nodeExecutable: context.nodeExecutable,
          npmExecutable: context.npmExecutable,
          manifestRoot: join(context.paths.programRoot, MCPORTER_MANIFEST_RELATIVE),
          commandRunner: context.commandRunner
        }, join(context.paths.programRoot, 'runtime', 'mcporter'));
        if (!mcporter.valid) throw new Error(`MCPorter runtime is not usable: ${mcporter.errors.join('; ')}`);
        const mcp = await prepareRpgMakerMcpRuntime({ platform, env: context.env, nodeExecutable: context.nodeExecutable, npmExecutable: context.npmExecutable, manifestRoot: join(context.paths.programRoot, RPGMAKER_MCP_MANIFEST_RELATIVE), commandRunner: context.commandRunner }, join(context.paths.programRoot, 'runtime', 'mcp'));
        if (!mcp.valid) throw new Error(`RPG Maker MCP is not usable: ${mcp.errors.join('; ')}`);
        const dshExecutable = bootstrap.verification.dshExecutable ?? await resolveDshEntrypoint(context.paths.runtimeDir, platform);
        if (!dshExecutable) throw new Error('Pinned DSH executable was not found before managed Web profile materialization.');
        const managed = await ensureManagedWebProfile({
          platform,
          env: context.env,
          dshHome: context.paths.dshHome,
          mutableRoot: context.paths.mutableRoot,
          runtimeDir: context.paths.runtimeDir,
          dshExecutable,
          npmExecutable: context.npmExecutable,
          nodeExecutable: context.nodeExecutable,
          manifestRoot: join(context.paths.programRoot, PNPM_MANIFEST_RELATIVE),
          commandRunner: context.commandRunner
        });
        if (!managed.valid) throw new Error(`Managed Web profile is not usable: ${managed.errors.join('; ')}`);
      });
      await prepareAgentDependencies({
        paths,
        env: installedEnv,
        nodeExecutable: options.nodeExecutable ?? prerequisites.executablePaths.node,
        npmExecutable: options.npmExecutable ?? prerequisites.executablePaths.npm ?? await resolveExecutable('npm', { platform, env: installedEnv }),
        commandRunner
      });
      // Live MCP contract checks are part of the committed-install gate.  The
      // injected command-runner path is intentionally kept filesystem-only for
      // ordinary disposable tests; those tests opt in with a schema probe seam.
      const schemaProbe = options.mcpSchemaProbe ?? options.schemaProbe;
      if (schemaProbe || !options.commandRunner) {
        const nodeExecutable = options.nodeExecutable ?? prerequisites.executablePaths.node;
        if (!nodeExecutable) throw new Error('A verified direct node.exe is required for live RPG Maker MCP contract validation.');
        mcpContracts = await validateRpgMakerMcpContracts({
          runtimeDir: join(paths.programRoot, 'runtime', 'mcp'),
          nodeExecutable,
          installationCacheDir: paths.installationCacheDir,
          platform,
          env: installedEnv,
          schemaProbe
        });
        if (!mcpContracts.valid) throw new Error(`RPG Maker MCP live contract validation failed: ${mcpContracts.errors.join('; ')}`);
      }
      finishPhase();
      startPhase('profile', 'materialize managed Web profile and presets');
      const dshExecutable = bootstrap.verification.dshExecutable ?? await resolveDshEntrypoint(paths.runtimeDir, platform);
      if (!dshExecutable) throw new Error('Pinned DSH executable was not found after bootstrap.');
      await deployRpgMakerPresets({
        platform,
        env: installedEnv,
        dshHome: paths.dshHome,
        mutableRoot: paths.mutableRoot,
        runtimeDir: paths.runtimeDir,
        dshExecutable,
        sourceRoot: join(paths.programRoot, 'presets', 'rpgmaker'),
        commandRunner
      });
      finishPhase();
      startPhase('metadata', 'write installation metadata');
      const metadataPath = join(paths.programRoot, 'install.json');
      const metadataWriter = options.writeInstallMetadata ?? ((path: string, content: string) => writeFile(path, content, 'utf8'));
      const launchTarget = desktopHost?.installedLaunchTarget ?? 'Launch.cmd';
      await metadataWriter(metadataPath, installMetadata(paths, prerequisites, now, launchTarget, desktopHost, mcpContracts));
      if (!(await exists(metadataPath))) throw new Error('Install metadata was not written.');
      finishPhase();
      startPhase('shortcut', 'create Start Menu shortcut');
      const createShortcut = options.createShortcut ?? createStartMenuShortcut;
      shortcutPath = await createShortcut({
        platform,
        env: installedEnv,
        mutableRoot: paths.mutableRoot,
        dshHome: paths.dshHome,
        startMenuShortcutPath: paths.startMenuShortcutPath,
        targetPath: join(paths.programRoot, ...launchTarget.replaceAll('\\', '/').split('/')),
        workingDirectory: paths.programRoot,
        helperScript: join(paths.programRoot, 'scripts', 'create-shortcut.ps1'),
        pwshExecutable: options.pwshExecutable ?? prerequisites.checks.find((check) => check.id === 'powershell')?.executable,
        commandRunner
      });
      if (!options.startMenuShortcutPath) {
        const legacyShortcut = legacyStartMenuShortcutPath({ env });
        if (legacyShortcut !== paths.startMenuShortcutPath) await rm(legacyShortcut, { force: true });
      }
      finishPhase();
      startPhase('verification', 'commit receipt after final verification');
      // The receipt is the source of truth for maintenance.  Commit it only
      // after the new program tree, runtime/profile verification, metadata,
      // and shortcut work have all completed successfully.
      await verifyInstalledMaintenanceContract(paths.programRoot);
      await commitInstallationReceipt({
        product: PRODUCT_NAME,
        owner: PROGRAM_OWNER,
        installationRoot: paths.installationRoot,
        programRoot: paths.programRoot,
        localStateRoot: paths.mutableRoot,
        committedAt: now().toISOString()
      });
      finishPhase();
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
    const launchTarget = desktopHost?.installedLaunchTarget ?? 'Launch.cmd';
    return { releaseRoot, paths, prerequisites, bootstrap, shortcutPath, desktopHost, launchTarget, ...(mcpContracts ? { mcpContracts } : {}), ...(oldMoved ? { rollbackRoot } : {}) };
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

/** Run one complete install/upgrade/repair session with a single terminal
 * outcome and paired timing/diagnostic evidence. */
export async function installWindowsRelease(options: InstallReleaseOptions): Promise<InstallReleaseResult> {
  const env = options.env ?? process.env;
  const localStateRoot = resolve(options.localStateRoot ?? options.mutableRoot ?? env.DSH_RPGMAKER_LOCAL_STATE_ROOT ?? env.DSH_RPGMAKER_DATA_ROOT ?? defaultLocalStateRoot(env));
  const receiptInspection = await inspectInstallationReceipt(localStateRoot);
  const receipt = receiptInspection.receipt;
  const operation: InstallationOperation = options.operation ?? (receipt ? (await exists(receipt.programRoot) ? 'upgrade' : 'repair') : 'install');
  const mode = rendererMode({ mode: options.renderer });
  const session = createInstallationSession({ operation, now: options.now, onEvent: options.onEvent });
  const evidence = createInstallRunEvidence({
    localStateRoot,
    installationRoot: options.installationRoot ?? receipt?.installationRoot ?? '',
    operation,
    renderer: mode,
    productVersion: PRODUCT_VERSION,
    runtimeVersion: DSH_VERSION,
    now: options.now,
    env
  });
  await evidence.start();
  try {
    session.start();
    if (receiptInspection.error) throw receiptInspection.error;
    const result = await withHarnessLock(join(localStateRoot, 'install.lock'), () => installWindowsReleaseCore(options, session, evidence), {
      timeoutMs: options.lockTimeoutMs ?? 45 * 60_000,
      retryMs: options.lockRetryMs
    });
    session.succeed();
    const timing = await evidence.finish('succeeded');
    return { ...result, timingPath: evidence.timingPath, logPath: evidence.logPath, timing };
  } catch (error) {
    const message = boundedDiagnostic(error instanceof Error ? error.message : String(error), env);
    const cancelled = error instanceof InstallationCancelledError || (session.isTerminal && message.toLowerCase().includes('cancel'));
    if (!session.isTerminal) {
      if (cancelled) session.cancel(message);
      else session.fail({ message });
    }
    evidence.appendLog(`installation ${cancelled ? 'cancelled' : 'failed'}: ${message}`);
    const timing = await evidence.finish(cancelled ? 'cancelled' : 'failed', { error: message });
    if (error instanceof InstallationCancelledError) throw new InstallationCancelledError(message);
    if (error instanceof ReleaseGateError) throw new ReleaseGateError(message);
    throw new ReleaseGateError(message);
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
  const pwsh = options.pwshExecutable ?? env.PWSH_EXECUTABLE ?? await resolveWindowsPwsh({ platform: 'win32', env });
  if (!pwsh) throw new ReleaseGateError('PowerShell 7 was not found to create the Release ZIP.');
  const helper = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'scripts', 'compress-release.ps1');
  const result = await runner(pwsh, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-SourceRoot', staging, '-Destination', outputZip], { env: withoutCredentials(env), platform: 'win32', timeoutMs: 15 * 60_000 });
  if (result.exitCode !== 0) throw new ReleaseGateError(`PowerShell ZIP creation failed: ${result.stderr || result.stdout}`.trim());
}

interface InstallerBuildMetadata {
  schemaVersion: number;
  artifact: string;
  target: string;
  compiler: string;
  compilerVersion: string;
  source: string;
  builtAt: string;
}

async function buildInstallerExecutable(options: ReleaseZipOptions, sourceRoot: string, staging: string): Promise<InstallerBuildMetadata> {
  const env = options.env ?? process.env;
  const runner = options.commandRunner ?? runCommand;
  const bun = options.bunExecutable ?? env.BUN_EXECUTABLE ?? await resolveExecutable('bun', { platform: options.platform, env });
  if (!bun) throw new ReleaseGateError('A build-time Bun executable is required to compile installer.exe. Target machines do not need Bun.');
  const output = join(staging, INSTALLER_EXECUTABLE_NAME);
  const entry = join(sourceRoot, 'src', 'installer.ts');
  const args = ['build', entry, '--compile', '--target=bun-windows-x64', '--outfile', output];
  let result;
  try {
    result = await runner(bun, args, { cwd: sourceRoot, env: withoutCredentials(env), platform: options.platform, timeoutMs: 15 * 60_000 });
  } catch (error) {
    const detail = boundedDiagnostic(error instanceof Error ? error.message : String(error), env);
    throw new ReleaseGateError(`installer.exe compilation could not start${detail ? `: ${detail}` : ''}`);
  }
  if (result.exitCode !== 0) {
    const detail = boundedDiagnostic(`${result.stderr}\n${result.stdout}`, env);
    throw new ReleaseGateError(`installer.exe compilation failed${detail ? `: ${detail}` : ''}`);
  }
  if (!(await nonEmptyRegularFile(output))) {
    throw new ReleaseGateError('installer.exe compilation completed without producing a fresh executable.');
  }
  let version = 'unknown';
  try {
    const versionResult = await runner(bun, ['--version'], { cwd: sourceRoot, env: withoutCredentials(env), platform: options.platform, timeoutMs: 30_000 });
    version = redactSensitive(`${versionResult.stdout}\n${versionResult.stderr}`, env).trim() || version;
  } catch {
    // The executable itself is still valid evidence; retain an explicit
    // unknown compiler version rather than inventing one.
  }
  return { schemaVersion: 1, artifact: INSTALLER_EXECUTABLE_NAME, target: 'bun-windows-x64', compiler: 'bun', compilerVersion: version, source: 'src/installer.ts', builtAt: new Date().toISOString() };
}

async function writeInstallerBuildEvidence(staging: string, metadata: InstallerBuildMetadata): Promise<void> {
  const measuredPayloadBytes = await measureReleasePayloadBytes(staging);
  const nativeInstallerBytes = (await stat(join(staging, INSTALLER_EXECUTABLE_NAME))).size;
  await writeFile(join(staging, INSTALLER_BUILD_EVIDENCE_NAME), `${JSON.stringify({
    ...metadata,
    capacity: {
      formula: INSTALLATION_CAPACITY_FORMULA,
      basis: INSTALLATION_CAPACITY_BASIS,
      reserveBytes: INSTALLATION_STAGING_HEADROOM_BYTES,
      measuredPayloadBytes,
      nativeInstallerBytes
    }
  }, null, 2)}\n`, 'utf8');
}

export async function buildReleaseZip(options: ReleaseZipOptions): Promise<string> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const sourceRoot = resolve(options.sourceRoot);
  const outputZip = resolve(options.outputZip);
  if (await exists(outputZip)) throw new ReleaseGateError(`Release ZIP already exists; refusing to overwrite ${outputZip}.`);
  if (pathsNest(sourceRoot, outputZip)) throw new ReleaseGateError('Release ZIP output must be outside the source tree.');
  const desktopHostSource = await resolveDesktopHostPayload(sourceRoot, { desktopHostRoot: options.desktopHostRoot });
  // A Windows-targeted archive is strict by default. Contributor builds for
  // another platform may omit the native payload; a caller can still request
  // the gate explicitly with requireDesktopHost. Provenance remains strict for
  // every supplied host payload as part of the release contract.
  const requireDesktopHost = options.requireDesktopHost ?? (platform === 'win32');
  if (!desktopHostSource && requireDesktopHost) {
    throw new ReleaseGateError(`Release is missing the required ${DESKTOP_HOST_PAYLOAD_RELATIVE} payload.`);
  }
  if (desktopHostSource) {
    if (pathsNest(desktopHostSource, outputZip)) {
      throw new ReleaseGateError('Release ZIP output must be outside the desktop host payload.');
    }
    if (pathsNest(desktopHostSource, sourceRoot) && resolve(desktopHostSource) !== resolve(join(sourceRoot, DESKTOP_HOST_PAYLOAD_RELATIVE))) {
      throw new ReleaseGateError('The desktop host payload must not be nested in an unrelated source tree.');
    }
    const host = await verifyDesktopHostPayload(desktopHostSource, {
      productVersion: ELECTROBUN_PRODUCT_VERSION,
      adapterSourcePath: join(sourceRoot, 'src', 'electrobun-sidecar.ts')
    });
    if (!host.valid || !host.launchTarget) throw new ReleaseGateError(`Desktop host payload is not usable: ${host.errors.join('; ')}`);
  }
  const forgejoMcp = await verifyForgejoMcpRuntime({ platform, env, programRoot: sourceRoot, probeVersion: false });
  if (!forgejoMcp.valid) throw new ReleaseGateError(`Release source Forgejo MCP is not usable: ${forgejoMcp.errors.join('; ')}`);
  await mkdir(dirname(outputZip), { recursive: true });
  const staging = await mkdtemp(join(dirname(outputZip), `.dsh-release-${randomUUID()}-`));
  try {
    await copyReleaseTree(sourceRoot, staging);
    // Every Release ZIP carries a freshly compiled installer. This contract is
    // independent of the host platform, desktop payload, and test seams.
    const installerBuild = await buildInstallerExecutable(options, sourceRoot, staging);
    if (desktopHostSource) {
      await copyDesktopHostPayload(sourceRoot, staging, {
        desktopHostRoot: desktopHostSource,
        productVersion: ELECTROBUN_PRODUCT_VERSION,
        adapterSourcePath: join(sourceRoot, 'src', 'electrobun-sidecar.ts')
      });
    }
    await writeInstallerBuildEvidence(staging, installerBuild);
    if (platform === 'win32') await archiveWithPowerShell(options, staging, outputZip);
    else await archiveWithZip(options, staging, outputZip);
    if (!(await exists(outputZip))) throw new ReleaseGateError(`ZIP creation completed without producing ${outputZip}.`);
    // A successful archive is not enough: inspect the archive that was just
    // written and require the freshly compiled installer/evidence entries (as
    // well as the rest of the Release contract) before returning it. This is
    // intentionally unconditional so test seams cannot bypass the artifact
    // contract.
    const inspection = await inspectReleaseZip({
      zipPath: outputZip,
      platform,
      env,
      commandRunner: options.commandRunner,
      requireDesktopHost
    });
    if (!inspection.valid) throw new ReleaseGateError(`Release ZIP is missing required entries: ${inspection.missing.join(', ')}`);
    return outputZip;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function inspectReleaseZip(options: { zipPath: string; platform?: string; env?: Record<string, string | undefined>; commandRunner?: CommandRunner; unzipExecutable?: string; requireDesktopHost?: boolean }): Promise<ReleaseZipInspection> {
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
  const requiredEntries = [
    'Install.cmd',
    'install.ps1',
    'Launch.cmd',
    'launch.ps1',
    'Uninstall.cmd',
    'uninstall.ps1',
    'THIRD-PARTY-NOTICES.md',
    'docs/user-guide.md',
    'docs/windows-release.md',
    WINDOWS_GATE_CLEANUP_HELPER_RELATIVE,
    'src/cli.ts',
    'src/installer.ts',
    'src/mcport.ts',
    'src/workspace-mcp.ts',
    'src/profile.ts',
    'src/managed-web-profile.ts',
    'runtime-manifests/dsh/package.json',
    'runtime-manifests/dsh/package-lock.json',
    'runtime-manifests/mcporter/package.json',
    'runtime-manifests/mcporter/package-lock.json',
    'runtime-manifests/rpgmaker-mcp/package.json',
    'runtime-manifests/rpgmaker-mcp/package-lock.json',
    'runtime-manifests/pnpm/package.json',
    'runtime-manifests/pnpm/package-lock.json',
    'presets/rpgmaker/preset.yml',
    `${FORGEJO_MCP_RUNTIME_RELATIVE}/${FORGEJO_MCP_EXECUTABLE_NAME}`,
    `${FORGEJO_MCP_RUNTIME_RELATIVE}/${FORGEJO_MCP_MANIFEST_NAME}`,
    `${FORGEJO_MCP_RUNTIME_RELATIVE}/${FORGEJO_MCP_LICENSE_NAME}`,
    `${WORKSPACE_MCP_BUNDLE_ARCHIVE_RELATIVE}/package.json`,
    `${WORKSPACE_MCP_BUNDLE_ARCHIVE_RELATIVE}/cordis.patch.yml`,
    `${WORKSPACE_MCP_BUNDLE_ARCHIVE_RELATIVE}/LICENSE`,
    `${WORKSPACE_MCP_BUNDLE_ARCHIVE_RELATIVE}/README.md`,
    `${WORKSPACE_MCP_BUNDLE_ARCHIVE_RELATIVE}/lib/contract.js`,
    `${WORKSPACE_MCP_BUNDLE_ARCHIVE_RELATIVE}/lib/env.js`,
    `${WORKSPACE_MCP_BUNDLE_ARCHIVE_RELATIVE}/${WORKSPACE_MCP_AGENT_ENTRYPOINT}`,
    `${WORKSPACE_MCP_BUNDLE_ARCHIVE_RELATIVE}/lib/index.js`,
    `${WORKSPACE_MCP_BUNDLE_ARCHIVE_RELATIVE}/lib/mcport-host.js`,
    `${WORKSPACE_MCP_BUNDLE_ARCHIVE_RELATIVE}/lib/tools.js`,
    `${WORKSPACE_MCP_BUNDLE_ARCHIVE_RELATIVE}/lib/workspace.js`,
    `${WORKSPACE_MCP_BUNDLE_ARCHIVE_RELATIVE}/lib/xerolo-manifest.js`,
    `${WORKSPACE_MCP_BUNDLE_ARCHIVE_RELATIVE}/lib/mz-manifest.js`,
    'presets/rpgmaker/skills/rpgmaker-mz/SKILL.md',
    'docs/research/rpgmaker-mz-mcp-selection.md',
    'docs/research/rpgmaker-mz-enhancement-roadmap.md'
  ];
  requiredEntries.unshift(INSTALLER_EXECUTABLE_NAME, INSTALLER_BUILD_EVIDENCE_NAME);
  const missing = requiredEntries.filter((entry) => !entries.includes(entry) && !entries.some((candidate) => candidate.startsWith(`${entry}/`)));
  const requireDesktopHost = options.requireDesktopHost ?? (platform === 'win32' && process.platform === 'win32');
  if (requireDesktopHost) {
    requiredEntries.push(DESKTOP_HOST_PAYLOAD_RELATIVE, DESKTOP_HOST_MANIFEST_RELATIVE);
    const hostEntries = entries.filter((entry) => entry === DESKTOP_HOST_PAYLOAD_RELATIVE || entry.startsWith(`${DESKTOP_HOST_PAYLOAD_RELATIVE}/`));
    const hasDescriptor = hostEntries.includes(DESKTOP_HOST_MANIFEST_RELATIVE);
    const hasExecutable = hostEntries.some((entry) => entry.toLowerCase().endsWith('.exe'));
    if (hostEntries.length === 0) missing.push(DESKTOP_HOST_PAYLOAD_RELATIVE);
    if (!hasDescriptor) missing.push(DESKTOP_HOST_MANIFEST_RELATIVE);
    if (!hasExecutable) missing.push(`${DESKTOP_HOST_PAYLOAD_RELATIVE}/*.exe`);
  }
  return { path: zipPath, entries, requiredEntries, valid: missing.length === 0, missing };
}

export async function uninstallWindowsRelease(options: UninstallOptions = {}): Promise<UninstallResult> {
  return uninstallHarness(options);
}

export { ensureHarnessLayout, installWindowsPrerequisites };
