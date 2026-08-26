import { createHash } from 'node:crypto';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { lstat, readFile, stat } from 'node:fs/promises';

import { resolveHarnessPaths, type PathOptions } from './config';
import { verifyForgejoMcpRuntime } from './forgejo-mcp';
import { ownedCoreutilsCommands } from './prerequisites';
import { findDshExecutable, verifyRuntime, type RuntimeVerification } from './bootstrap';
import { redactSensitive, runCommand, withoutCredentials, type CommandRunner } from './process';
import { resolveExecutable, resolveWindowsPwsh, resolveWindowsSevenZip, parseSevenZipVersion, parseSevenZipVersionText } from './executable';
import { withHarnessLock } from './lock';
import { inspectCredentialMetadata, type CredentialMetadata } from './credentials';
import {
  FREE_TEX_PACKER_VERSION,
  IMAGE_MAGICK_VERSION,
  OXIPNG_VERSION,
  resolveImageToolchain
} from './image-workshop';
import {
  DSH_TOOL_TIMEOUT_POLICY_PACKAGE,
  RPGMAKER_DSH_PROFILE,
  validateEffectiveTimeoutPolicyComposition,
  verifyMcpRuntime,
  verifyTimeoutPolicyComposition
} from './rpgmaker';
import { verifyImageWorkshopPlugin, imageWorkshopPluginSummary, type ImageWorkshopPluginVerification } from './image-plugin';

export interface DoctorOptions extends PathOptions {
  commandRunner?: CommandRunner;
  bunExecutable?: string;
  pwshExecutable?: string;
  coreutilsExecutable?: string;
  gitExecutable?: string;
  nodeExecutable?: string;
  npmExecutable?: string;
  pythonExecutable?: string;
  sevenZipExecutable?: string;
  verifyAgentDependencies?: (context: { platform: string; env: Record<string, string | undefined>; paths: ReturnType<typeof resolveHarnessPaths>; commandRunner: CommandRunner }) => Promise<{ mcp: DoctorCheck; image: DoctorCheck }>;
  verifyImageWorkshopPlugin?: (context: { platform: string; env: Record<string, string | undefined>; paths: ReturnType<typeof resolveHarnessPaths>; commandRunner: CommandRunner }) => Promise<ImageWorkshopPluginVerification>;
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
  programRoot: string;
  mutableRoot: string;
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

// Mirrors Microsoft coreutils-manager's manager.rs clap help and status subcommands; find/grep banners are intentionally not used as identity.
function managerContract(helpOutput: string, statusOutput: string): boolean {
  return /Manage coreutils utilities and PowerShell profiles/i.test(helpOutput)
    && /\benable\b/i.test(helpOutput)
    && /\bdisable\b/i.test(helpOutput)
    && /\bstatus\b/i.test(helpOutput)
    && /^\s*find\s+enabled\s*$/im.test(statusOutput)
    && /^\s*grep\s+enabled\s*$/im.test(statusOutput);
}

function coreutilsInstallDir(managerPath: string | undefined): string | undefined {
  if (!managerPath) return undefined;
  const parent = dirname(managerPath);
  const name = basename(parent).toLowerCase();
  return name === 'bin' || name === 'cmd' ? dirname(parent) : parent;
}

function isWithinInstallDir(candidate: string | undefined, installDir: string | undefined): boolean {
  if (!candidate || !installDir) return false;
  const normalize = (value: string): string => value.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
  const child = normalize(candidate);
  const root = normalize(installDir);
  return child === root || child.startsWith(`${root}/`);
}

function check(id: string, label: string, ok: boolean, detail: string, path?: string): DoctorCheck {
  return { id, label, ok, detail: redactSensitive(detail), ...(path ? { path } : {}) };
}

function within(root: string, candidate: string): boolean {
  const rest = relative(resolve(root), resolve(candidate));
  return rest === '' || (!rest.startsWith(`..${sep}`) && rest !== '..');
}

async function matchesSha256(path: string | undefined, expected: unknown): Promise<boolean> {
  if (!path || typeof expected !== 'string' || !/^[a-f0-9]{64}$/i.test(expected)) return false;
  try {
    const hash = createHash('sha256');
    hash.update(await readFile(path) as unknown as string);
    return hash.digest('hex') === expected.toLowerCase();
  } catch {
    return false;
  }
}

async function verifyImageToolchainMetadata(toolchainRoot: string): Promise<{ valid: boolean; detail: string; path: string }> {
  const manifestPath = join(toolchainRoot, 'toolchain.json');
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      format?: unknown;
      imageMagick?: { path?: unknown; version?: unknown; sha256?: unknown };
      helper?: { root?: unknown; lockPath?: unknown; lockSha256?: unknown; packageVersion?: unknown };
      oxipng?: { path?: unknown; version?: unknown; sha256?: unknown };
    };
    const imagePath = typeof manifest.imageMagick?.path === 'string' ? resolve(manifest.imageMagick.path) : undefined;
    const helperRoot = typeof manifest.helper?.root === 'string' ? resolve(manifest.helper.root) : undefined;
    const helperLock = typeof manifest.helper?.lockPath === 'string' ? resolve(manifest.helper.lockPath) : undefined;
    const oxipngPath = typeof manifest.oxipng?.path === 'string' ? resolve(manifest.oxipng.path) : undefined;
    const paths = [imagePath, helperRoot, helperLock, oxipngPath];
    const filesReady = await Promise.all(paths.map(async (path, index) => {
      if (!path || !within(toolchainRoot, path)) return false;
      const info = await lstat(path).catch(() => undefined);
      return Boolean(info && !info.isSymbolicLink() && (index === 1 ? info.isDirectory() : info.isFile()));
    }));
    const helperPackagePath = helperRoot ? join(helperRoot, 'node_modules', 'free-tex-packer-core', 'package.json') : undefined;
    const helperPackage = helperPackagePath
      ? JSON.parse(await readFile(helperPackagePath, 'utf8').catch(() => '{}')) as { version?: unknown }
      : {};
    const rootPackage = helperRoot
      ? JSON.parse(await readFile(join(helperRoot, 'package.json'), 'utf8').catch(() => '{}')) as { dependencies?: Record<string, unknown> }
      : {};
    const valid = manifest.format === 2
      && manifest.imageMagick?.version === IMAGE_MAGICK_VERSION
      && manifest.helper?.packageVersion === FREE_TEX_PACKER_VERSION
      && manifest.oxipng?.version === OXIPNG_VERSION
      && helperPackage.version === FREE_TEX_PACKER_VERSION
      && rootPackage.dependencies?.['free-tex-packer-core'] === FREE_TEX_PACKER_VERSION
      && filesReady.every(Boolean)
      && await matchesSha256(imagePath, manifest.imageMagick?.sha256)
      && await matchesSha256(helperLock, manifest.helper?.lockSha256)
      && await matchesSha256(oxipngPath, manifest.oxipng?.sha256);
    return {
      valid,
      detail: valid
        ? `Pinned ImageMagick ${IMAGE_MAGICK_VERSION}, free-tex-packer-core ${FREE_TEX_PACKER_VERSION}, and oxipng ${OXIPNG_VERSION} metadata and app-owned paths are verified without executing image tools`
        : 'The app-owned image toolchain manifest, versions, or app-owned paths were not verified; run Install.cmd to repair it',
      path: manifestPath
    };
  } catch {
    return { valid: false, detail: 'The app-owned image toolchain manifest is missing or invalid; run Install.cmd to repair it', path: manifestPath };
  }
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

  const pwsh = options.pwshExecutable ?? env.PWSH_EXECUTABLE ?? await resolveWindowsPwsh({ platform, env });
  const coreutils = options.coreutilsExecutable ?? env.COREUTILS_MANAGER ?? await resolveExecutable('coreutils-manager', { platform, env }) ?? await resolveExecutable('coreutils', { platform, env });
  const ownedCoreutils = await ownedCoreutilsCommands(coreutils, env);
  const coreutilsFind = ownedCoreutils.find ?? await resolveExecutable('find', { platform, env });
  const coreutilsGrep = ownedCoreutils.grep ?? await resolveExecutable('grep', { platform, env });
  const git = options.gitExecutable ?? env.GIT_EXECUTABLE ?? await resolveExecutable('git', { platform, env });
  const bun = options.bunExecutable ?? env.BUN_EXECUTABLE ?? await resolveExecutable('bun', { platform, env });
  const node = options.nodeExecutable ?? env.NODE_EXECUTABLE ?? await resolveExecutable('node', { platform, env });
  const npm = options.npmExecutable ?? env.NPM_EXECUTABLE ?? await resolveExecutable('npm', { platform, env });
  const wingetPython = platform === 'win32' && env.LOCALAPPDATA
    ? await resolveExecutable(join(env.LOCALAPPDATA, 'Programs', 'Python', 'Python313', 'python.exe'), { platform, env })
    : undefined;
  const python = options.pythonExecutable ?? env.PYTHON_EXECUTABLE ?? wingetPython ?? await resolveExecutable('python', { platform, env });
  const sevenZip = platform === 'win32'
    ? options.sevenZipExecutable ?? env.SEVEN_ZIP_EXECUTABLE ?? await resolveWindowsSevenZip({ platform, env, commandRunner: runner })
    : undefined;

  const checks: DoctorCheck[] = [];
  const executablePaths: Record<string, string | undefined> = {
    powershell: pwsh,
    coreutilsManager: coreutils,
    coreutilsFind,
    coreutilsGrep,
    git,
    bun,
    node,
    npm,
    python,
    ...(sevenZip ? { sevenZip } : {})
  };

  const pwshVersion = await commandVersion(runner, pwsh, commandEnv);
  const pwshParsed = versionNumbers(pwshVersion.output);
  checks.push(check(
    'powershell',
    'PowerShell 7.4+',
    pwshVersion.ok && /PowerShell\s+\d+\.\d+/i.test(pwshVersion.output) && atLeast(pwshParsed, [7, 4, 0]),
    pwsh ? (pwshVersion.ok && pwshParsed ? `PowerShell ${pwshParsed.join('.')} at ${pwsh}` : `PowerShell at ${pwsh} is missing or older than 7.4`) : 'PowerShell 7.4+ was not found; install Microsoft.PowerShell',
    pwsh
  ));

  const coreutilsHelp = await commandVersion(runner, coreutils, commandEnv, ['--help']);
  const coreutilsStatus = await commandVersion(runner, coreutils, commandEnv, ['status']);
  const coreutilsFindVersion = await commandVersion(runner, coreutilsFind, commandEnv);
  const coreutilsGrepVersion = await commandVersion(runner, coreutilsGrep, commandEnv);
  const coreutilsRoot = coreutilsInstallDir(coreutils);
  const coreutilsOk = coreutilsHelp.ok && coreutilsStatus.ok
    && managerContract(coreutilsHelp.output, coreutilsStatus.output)
    && coreutilsFindVersion.ok && coreutilsGrepVersion.ok
    && isWithinInstallDir(coreutilsFind, coreutilsRoot)
    && isWithinInstallDir(coreutilsGrep, coreutilsRoot);
  checks.push(check(
    'coreutils',
    'Microsoft Coreutils',
    coreutilsOk,
    coreutilsOk
      ? `Microsoft Coreutils manager contract and enabled find/grep are available under ${coreutilsRoot}`
      : 'Microsoft Coreutils manager contract and installation-relative enabled find/grep were not verified; install Microsoft.Coreutils with WinGet',
    coreutils
  ));

  const gitVersion = await commandVersion(runner, git, commandEnv);
  checks.push(check(
    'git',
    'Git',
    gitVersion.ok && /(?:^|\r?\n)\s*git version\s+\d+\.\d+\.\d+/i.test(gitVersion.output),
    gitVersion.ok ? `Git is available at ${git}` : 'Git was not found; install Git for Windows',
    git
  ));

  const bunVersion = await commandVersion(runner, bun, commandEnv);
  checks.push(check(
    'bun',
    'Bun',
    bunVersion.ok && /(?:^|\r?\n)\s*\d+\.\d+\.\d+/i.test(bunVersion.output) && Boolean(versionNumbers(bunVersion.output)),
    bunVersion.ok ? `Bun is available at ${bun}` : 'Bun was not found; install Bun and reopen the launcher',
    bun
  ));

  if (platform === 'win32') {
    const sevenZipVersion = await commandVersion(runner, sevenZip, commandEnv, ['i']);
    const sevenZipParsed = parseSevenZipVersion(sevenZipVersion.output);
    const sevenZipVersionText = parseSevenZipVersionText(sevenZipVersion.output);
    checks.push(check(
      '7zip',
      '7-Zip',
      sevenZipVersion.ok && Boolean(sevenZipParsed),
      sevenZipVersion.ok && sevenZipParsed ? `7-Zip ${sevenZipVersionText ?? sevenZipParsed.join('.')} is available at ${sevenZip}` : '7-Zip was not verified; run Install.cmd to install 7zip.7zip with WinGet',
      sevenZip
    ));

    const pythonVersion = await commandVersion(runner, python, commandEnv);
    const pythonParsed = versionNumbers(pythonVersion.output);
    checks.push(check(
      'python',
      'Python 3.11+',
      pythonVersion.ok && /(?:^|\r?\n)\s*Python\s+\d+\.\d+/i.test(pythonVersion.output) && atLeast(pythonParsed, [3, 11, 0]),
      pythonVersion.ok && pythonParsed ? `Python ${pythonParsed.join('.')} is available at ${python}` : 'Python 3.11+ was not verified; run Install.cmd to install Python.Python.3.13 with WinGet',
      python
    ));

    const nodeVersion = await commandVersion(runner, node, commandEnv);
    const nodeLts = await commandVersion(runner, node, commandEnv, ['-p', 'process.release.lts']);
    const npmVersion = await commandVersion(runner, npm, commandEnv);
    const nodeParsed = versionNumbers(nodeVersion.output);
    const nodeLtsName = nodeLts.output.trim().split(/\r?\n/).find(Boolean);
    checks.push(check(
      'node',
      'Node.js LTS 18+ and npm',
      nodeVersion.ok && /(?:^|\r?\n)\s*v\d+\.\d+\.\d+/i.test(nodeVersion.output) && Boolean(nodeParsed) && atLeast(nodeParsed, [18, 0, 0]) && nodeLts.ok && Boolean(nodeLtsName) && !/^false$/i.test(nodeLtsName ?? '') && npmVersion.ok && /(?:^|\r?\n)\s*v?\d+\.\d+\.\d+/i.test(npmVersion.output) && Boolean(versionNumbers(npmVersion.output)),
      nodeVersion.ok && npmVersion.ok ? `Node.js LTS ${nodeParsed?.join('.')} (${nodeLtsName}) and npm ${versionNumbers(npmVersion.output)?.join('.')}` : 'Node.js LTS and npm were not both verified; install OpenJS.NodeJS.LTS',
      node
    ));
  }

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

  if (platform === 'win32') {
    const verifyAgentDependencies = options.verifyAgentDependencies ?? (async (context) => {
      const mcpRuntime = join(context.paths.programRoot, 'runtime', 'mcp');
      const mcp = await verifyMcpRuntime(mcpRuntime, context.platform);
      const imageMetadata = await verifyImageToolchainMetadata(join(context.paths.programRoot, 'tools', 'image-workshop'));
      const image = check('image-toolchain', 'Image asset toolchain', imageMetadata.valid, imageMetadata.detail, imageMetadata.path);
      return {
        mcp: check('rpgmaker-mcp', 'RPG Maker MV MCP runtime', mcp.valid, mcp.valid ? `Pinned RPG Maker MV MCP ${mcp.packageVersion} is verified` : mcp.errors.join('; '), mcp.executable ?? mcpRuntime),
        image
      };
    });
    const agentDependencies = await verifyAgentDependencies({ platform, env: commandEnv, paths, commandRunner: runner });
    checks.push(agentDependencies.mcp, agentDependencies.image);

    const forgejoMcp = await verifyForgejoMcpRuntime({ platform, env: commandEnv, programRoot: paths.programRoot, commandRunner: runner });
    executablePaths.forgejoMcp = forgejoMcp.executablePath;
    checks.push(check(
      'forgejo-mcp',
      'App-owned Forgejo MCP',
      forgejoMcp.valid,
      forgejoMcp.valid ? 'Pinned Forgejo MCP 2.34.1 is verified' : forgejoMcp.errors.join('; '),
      forgejoMcp.executablePath
    ));

    const imagePlugin = await (options.verifyImageWorkshopPlugin ?? (context => verifyImageWorkshopPlugin({
      platform: context.platform,
      env: context.env,
      dshHome: context.paths.dshHome,
      programRoot: context.paths.programRoot,
      runtimeDir: context.paths.runtimeDir,
      commandRunner: context.commandRunner
    })))({ platform, env: commandEnv, paths, commandRunner: runner });
    if (imagePlugin.packageDir) executablePaths['image-workshop-plugin'] = imagePlugin.packageDir;
    checks.push(check(
      'image-tool-plugin',
      'App-owned image tool plugin',
      imagePlugin.valid,
      imageWorkshopPluginSummary(imagePlugin),
      imagePlugin.packageDir
    ));

    const timeoutPolicy = await verifyTimeoutPolicyComposition(paths.dshHome);
    const effectivePolicyErrors: string[] = [];
    if (dshExecutable) {
      try {
        await validateEffectiveTimeoutPolicyComposition(
          dshExecutable,
          timeoutPolicy.hostCompositionPath,
          paths.mutableRoot,
          platform,
          { ...commandEnv, DSH_HOME: paths.dshHome },
          runner
        );
      } catch (error) {
        effectivePolicyErrors.push(error instanceof Error ? error.message : String(error));
      }
    } else {
      effectivePolicyErrors.push('Pinned DSH executable was not found; the effective timeout policy was not validated.');
    }
    const timeoutPolicyErrors = [...timeoutPolicy.errors, ...effectivePolicyErrors];
    const timeoutPolicyValid = timeoutPolicyErrors.length === 0;
    checks.push(check(
      'tool-call-timeout-policy',
      'Shared DSH tool-call timeout policy',
      timeoutPolicyValid,
      timeoutPolicyValid
        ? `Pinned DSH ${RPGMAKER_DSH_PROFILE} profile supplies exactly one official ${DSH_TOOL_TIMEOUT_POLICY_PACKAGE} Host row across ${timeoutPolicy.coveredPresets.length} custom Agent presets`
        : timeoutPolicyErrors.join('; '),
      timeoutPolicy.hostCompositionPath
    ));

    const layoutPaths = [paths.mutableRoot, paths.dshHome, paths.logsDir, paths.cacheDir];
    const layoutValues = await Promise.all(layoutPaths.map(async (path) => (await stat(path).catch(() => undefined))?.isDirectory() ?? false));
    const layoutOk = layoutValues.every(Boolean);
    checks.push(check(
      'app-layout',
      'Per-user DSH state layout',
      layoutOk,
      layoutOk ? `Program files use ${paths.programRoot}; mutable state uses ${paths.mutableRoot} with DSH_HOME at ${paths.dshHome}` : `Mutable state layout is incomplete under ${paths.mutableRoot}; run Install.cmd or repair the installation`,
      paths.mutableRoot
    ));
  }

  return {
    ok: checks.every((item) => item.ok),
    platform,
    runtimeDir: paths.runtimeDir,
    dshHome: paths.dshHome,
    programRoot: paths.programRoot,
    mutableRoot: paths.mutableRoot,
    executablePaths,
    credentials,
    checks,
    runtime
  };
}

export function renderDoctorReport(report: DoctorReport): string {
  const lines = [`DSH RPG Maker doctor (${report.platform})`, `Program root: ${report.programRoot}`, `Mutable root: ${report.mutableRoot}`, `DSH_HOME: ${report.dshHome}`, `Runtime: ${report.runtimeDir}`, ''];
  for (const item of report.checks) {
    lines.push(`${item.ok ? 'PASS' : 'FAIL'} ${item.label}: ${item.detail}`);
  }
  lines.push('', report.ok ? 'Doctor passed.' : 'Doctor found issues. Fix the reported items and run doctor again.');
  return redactSensitive(lines.join('\n'));
}
