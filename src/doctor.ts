import { join } from 'node:path';
import { stat } from 'node:fs/promises';

import { resolveHarnessPaths, type PathOptions } from './config';
import { verifyForgejoMcpRuntime } from './forgejo-mcp';
import { verifyWindowsPrerequisites } from './prerequisites';
import { findDshExecutable, verifyRuntime, type RuntimeVerification } from './bootstrap';
import { redactSensitive, runCommand, withoutCredentials, type CommandRunner } from './process';
import { withHarnessLock } from './lock';
import { inspectCredentialMetadata, type CredentialMetadata } from './credentials';
import {
  DSH_TOOL_TIMEOUT_POLICY_PACKAGE,
  RPGMAKER_DSH_PROFILE,
  validateEffectiveTimeoutPolicyComposition,
  verifyRpgMakerMcpRuntime,
  verifyTimeoutPolicyComposition
} from './rpgmaker';
import { verifyManagedWebProfile, type ManagedWebProfileOptions, type ManagedWebProfileVerification } from './managed-web-profile';
import { inspectWorkspaceSandbox } from './workspace-sandbox';

export interface DoctorOptions extends PathOptions {
  workspace?: string;
  sandboxProbe?: boolean;
  commandRunner?: CommandRunner;
  bunExecutable?: string;
  pwshExecutable?: string;
  coreutilsExecutable?: string;
  gitExecutable?: string;
  nodeExecutable?: string;
  npmExecutable?: string;
  pythonExecutable?: string;
  imageMagickExecutable?: string;
  verifyAgentDependencies?: (context: { platform: string; env: Record<string, string | undefined>; paths: ReturnType<typeof resolveHarnessPaths>; commandRunner: CommandRunner }) => Promise<{ mcp: DoctorCheck; checks?: DoctorCheck[] }>;
  managedWebProfileVerifier?: (options: ManagedWebProfileOptions) => Promise<ManagedWebProfileVerification>;
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

function check(id: string, label: string, ok: boolean, detail: string, path?: string): DoctorCheck {
  return { id, label, ok, detail: redactSensitive(detail), ...(path ? { path } : {}) };
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') throw new Error('Doctor is supported on Windows only.');
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
  const checks: DoctorCheck[] = [];
  const prerequisites = await verifyWindowsPrerequisites({
    platform,
    env,
    commandRunner: runner,
    nodeExecutable: options.nodeExecutable,
    npmExecutable: options.npmExecutable,
    pythonExecutable: options.pythonExecutable,
    bunExecutable: options.bunExecutable,
    pwshExecutable: options.pwshExecutable,
    gitExecutable: options.gitExecutable,
    coreutilsExecutable: options.coreutilsExecutable,
    imageMagickExecutable: options.imageMagickExecutable
  });
  checks.push(...prerequisites.checks.map((item) => check(item.id, item.label, item.ok, item.detail, item.executable)));
  const executablePaths: Record<string, string | undefined> = { ...prerequisites.executablePaths };
  const pwsh = prerequisites.executablePaths.powershell;
  const bun = prerequisites.executablePaths.bun;
  const node = prerequisites.executablePaths.node;

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

  const verifyAgentDependencies = options.verifyAgentDependencies ?? (async (context) => {
    const mcpRuntime = join(context.paths.programRoot, 'runtime', 'mcp');
    const dual = await verifyRpgMakerMcpRuntime(mcpRuntime, context.platform);
    const mv = dual.engines?.mv;
    const mz = dual.engines?.mz;
    return {
      mcp: check('rpgmaker-mcp', 'RPG Maker MCP runtime', dual.valid, dual.valid ? 'Pinned RPG Maker MV and MZ MCP packages are verified' : dual.errors.join('; '), dual.executable ?? mcpRuntime),
      checks: [
        check('rpgmaker-mv-mcp', 'RPG Maker MV MCP runtime', Boolean(mv?.valid), mv?.valid ? `Pinned RPG Maker MV MCP ${mv.packageVersion} is verified` : (mv?.errors.join('; ') ?? 'MV runtime verification unavailable'), mv?.executable ?? mcpRuntime),
        check('rpgmaker-mz-mcp', 'RPG Maker MZ MCP runtime', Boolean(mz?.valid), mz?.valid ? `Pinned RPG Maker MZ MCP ${mz.packageVersion} is verified` : (mz?.errors.join('; ') ?? 'MZ runtime verification unavailable'), mz?.executable ?? mcpRuntime)
      ]
    };
  });
  const agentDependencies = await verifyAgentDependencies({ platform, env: commandEnv, paths, commandRunner: runner });
  checks.push(agentDependencies.mcp);
  if (agentDependencies.checks) checks.push(...agentDependencies.checks);

  const managedWebProfile = await (options.managedWebProfileVerifier ?? verifyManagedWebProfile)({
    platform,
    env: commandEnv,
    dshHome: paths.dshHome,
    programRoot: paths.programRoot,
    mutableRoot: paths.mutableRoot,
    runtimeDir: paths.runtimeDir,
    dshExecutable,
    npmExecutable: options.npmExecutable,
    pnpmExecutable: undefined,
    commandRunner: runner
  });
  checks.push(check(
    'managed-web-profile',
    'Managed Web profile',
    managedWebProfile.valid,
    managedWebProfile.valid
      ? `Managed ${managedWebProfile.profile} profile has the exact pinned Web, image-generation, RPG Maker Agent brand, and workspace MCP packages`
      : managedWebProfile.errors.join('; '),
    managedWebProfile.profileDir
  ));

  const forgejoMcp = await verifyForgejoMcpRuntime({ platform, env: commandEnv, programRoot: paths.programRoot, commandRunner: runner });
  executablePaths.forgejoMcp = forgejoMcp.executablePath;
  checks.push(check(
    'forgejo-mcp',
    'App-owned Forgejo MCP',
    forgejoMcp.valid,
    forgejoMcp.valid ? 'Pinned Forgejo MCP 2.34.1 is verified' : forgejoMcp.errors.join('; '),
    forgejoMcp.executablePath
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

  if (options.workspace) {
    checks.push(...await inspectWorkspaceSandbox({
      workspace: options.workspace,
      sandboxProbe: options.sandboxProbe,
      platform,
      env: commandEnv,
      runtimeDir: paths.runtimeDir,
      pwshExecutable: pwsh,
      nodeExecutable: node,
      commandRunner: runner
    }));
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
