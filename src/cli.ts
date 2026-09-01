import { bootstrapRuntime, BootstrapError } from './bootstrap';
import { runDoctor, renderDoctorReport } from './doctor';
import { launchProject, SINGLE_WRITER_NOTICE, LauncherError } from './launcher';
import { launchRpgmakerProject } from './rpgmaker';
import { childExitCode, redactSensitive, runCommand, type CommandRunner, type InteractiveSpawner } from './process';
import { WINDOWS_DSH_HOST, WINDOWS_DSH_PORT } from './config';
import { buildReleaseZip, inspectReleaseZip, installWindowsRelease, uninstallWindowsRelease } from './release-gate';
import type { PrerequisiteConsent, WindowsPrerequisiteCheck } from './prerequisites';
import { pickInstallationRoot, type PortConflictAction, type ExistingSessionOpener, type PortProbe } from './windows';
import { resolveExecutable } from './executable';
import { createInstallationRenderer } from './install-renderer';
import { rendererMode, type InstallationEventListener, type InstallationRendererMode } from './install-events';
import { defaultLocalStateRoot, readInstallationReceipt } from './installation-root';
import { createInterface } from 'node:readline/promises';
import { stdin as processStdin, stdout as processStdout } from 'node:process';

export interface CliIO {
  stdout: { write: (text: string) => unknown; isTTY?: boolean };
  stderr: { write: (text: string) => unknown; isTTY?: boolean };
}

export interface CliDependencies {
  env?: Record<string, string | undefined>;
  platform?: string;
  io?: CliIO;
  commandRunner?: CommandRunner;
  spawnInteractive?: InteractiveSpawner;
  prerequisiteConsent?: PrerequisiteConsent;
  portProbe?: PortProbe;
  onPortConflict?: (url: string) => Promise<PortConflictAction> | PortConflictAction;
  openExistingSession?: ExistingSessionOpener;
  rpgmaker?: boolean;
  installEventListener?: InstallationEventListener;
  installationPicker?: (defaultPath: string) => Promise<string | undefined>;
}

interface ParsedArgs {
  command: string;
  positionals: string[];
  values: Record<string, string>;
  flags: Set<string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [first, ...rest] = argv;
  const command = first && !first.startsWith('-') ? first : 'launch';
  const args = first && !first.startsWith('-') ? rest : argv;
  const positionals: string[] = [];
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith('--')) {
      throw new Error(`Unexpected argument: ${value}`);
    }
    const encoded = value.slice(2);
    const equals = encoded.indexOf('=');
    if (equals >= 0) {
      values[encoded.slice(0, equals)] = encoded.slice(equals + 1);
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      values[encoded] = next;
      index += 1;
    } else {
      flags.add(encoded);
    }
  }
  return { command, positionals, values, flags };
}

function helpText(): string {
  return [
    'RPG Maker Agent — workspace-selected MV/MZ harness',
    '',
    'Commands:',
    '  bootstrap   Install or repair the pinned DSH runtime using Node.js/npm',
    '  doctor      Check Windows prerequisites, DSH metadata, and an explicit workspace',
    '  install     Install a Release ZIP into the per-user Windows roots',
    '  repair      Rebuild the recorded installation root without relocation',
    '  uninstall   Remove program files/cache (use --purge for state/credentials)',
    '  release-zip Build and inspect a distributable Release ZIP',
    '  launch      Start project-neutral DSH Web; choose workspaces in its UI',
    '',
    'Options:',
    '  --release-root <path>     Extracted Release ZIP root (install)',
    '  --zip <path>              Release ZIP path (release-zip)',
    '  --installation-root <path> First-install root for program, runtimes, and cache',
    '  --local-state-root <path> Fixed per-user local state root override',
    '  --mutable-root <path>     Alias for the fixed local state root',
    '  --start-menu-shortcut <path> Override the owned Start Menu shortcut path',
    '  --dsh-home <path>         Override DSH_HOME for this invocation',
    '  --runtime-dir <path>      Override the app-owned runtime tree',
    '  --dsh-executable <path>   Use an explicit DSH executable',
    '  --workspace <path>        Inspect one explicit Windows workspace with Doctor',
    '  --sandbox-probe            Run the pinned DSH workspace-write runner after workspace checks pass',
    '  --js-executable <path>    Use an explicit Node executable for MCP',
    '  --mcp-runtime-dir <path>  Use the app-owned RPG Maker MCP runtime',
    '  --source-root <path>      Preset source root override',
    '  --desktop-host-root <path> Prebuilt desktop host payload to package/install',
    '  --require-desktop-host    Require a verified native desktop host payload',
    '  --pwsh-executable <path>  Use an explicit PowerShell executable',
    '  --node-executable <path>  Use an explicit Node.js executable',
    '  --plain                   Use append-only plain installation events',
    '  --ndjson                  Use machine-readable NDJSON installation events',
    '  --non-interactive         Disable dialogs and keypress waits',
    '  --npm-executable <path>   Use an explicit npm executable',
    '  --winget-executable <path> Use an explicit WinGet executable',
    '  --git-executable <path>   Use an explicit Git executable',
    '  --coreutils-executable <path> Use an explicit Coreutils manager',
    '  --yes                     Consent to prerequisite installation',
    '  --purge                   Explicitly delete mutable state/credentials (uninstall)',
    '  --json                    Render doctor output as JSON',
    '  --help                    Show this help'
  ].join('\n');
}

function option(values: Record<string, string>, name: string): string | undefined {
  return values[name];
}

function baseOptions(parsed: ParsedArgs, dependencies: CliDependencies): Record<string, unknown> {
  return {
    platform: dependencies.platform,
    env: dependencies.env,
    dshHome: option(parsed.values, 'dsh-home'),
    runtimeDir: option(parsed.values, 'runtime-dir'),
    installationRoot: option(parsed.values, 'installation-root'),
    localStateRoot: option(parsed.values, 'local-state-root'),
    mutableRoot: option(parsed.values, 'mutable-root'),
    startMenuShortcutPath: option(parsed.values, 'start-menu-shortcut'),
    nodeExecutable: option(parsed.values, 'node-executable'),
    jsExecutable: option(parsed.values, 'js-executable'),
    commandRunner: dependencies.commandRunner
  };
}

function requiredOption(parsed: ParsedArgs, name: string): string {
  const value = option(parsed.values, name);
  if (!value) throw new Error(`Missing required option --${name}.`);
  return value;
}

async function promptPrerequisiteConsent(missing: WindowsPrerequisiteCheck[], io: CliIO): Promise<boolean> {
  io.stdout.write('RPG Maker Agent may use WinGet to install or repair these prerequisites:\n');
  for (const item of missing) io.stdout.write(`  - ${item.label}\n`);
  if (!processStdin.isTTY || !processStdout.isTTY) return false;
  const readline = createInterface({ input: processStdin, output: processStdout });
  try {
    const answer = (await readline.question('Allow WinGet to install or repair the listed prerequisites? [Y/N] ')).trim();
    return /^(?:y|yes)$/i.test(answer);
  } finally {
    readline.close();
  }
}

function validateCliFixedBinding(argv: string[]): void {
  const [first, ...rest] = argv;
  const command = first && !first.startsWith('-') ? first : 'launch';
  if (command !== 'launch') return;
  const args = first && !first.startsWith('-') ? rest : argv;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const inline = argument.match(/^--(host|port)=(.*)$/s);
    if (inline) {
      const expected = inline[1] === 'host' ? WINDOWS_DSH_HOST : String(WINDOWS_DSH_PORT);
      if (inline[2] !== expected) throw new Error(`The DSH web binding is fixed at ${WINDOWS_DSH_HOST}:${WINDOWS_DSH_PORT}; caller-supplied --${inline[1]}=${inline[2]} is not allowed.`);
      continue;
    }
    if (argument !== '--host' && argument !== '--port') continue;
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`The DSH launch binding option ${argument} requires a value and is fixed at ${WINDOWS_DSH_HOST}:${WINDOWS_DSH_PORT}.`);
    index += 1;
    const expected = argument === '--host' ? WINDOWS_DSH_HOST : String(WINDOWS_DSH_PORT);
    if (value !== expected) throw new Error(`The DSH web binding is fixed at ${WINDOWS_DSH_HOST}:${WINDOWS_DSH_PORT}; caller-supplied ${argument}=${value} is not allowed.`);
  }
}

export async function runCli(argv: string[] = process.argv.slice(2), dependencies: CliDependencies = {}): Promise<number> {
  const env = dependencies.env ?? process.env;
  const io = dependencies.io ?? { stdout: process.stdout, stderr: process.stderr };
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    io.stderr.write(`${redactSensitive(error instanceof Error ? error.message : String(error), env)}\n`);
    return 2;
  }

  if (parsed.flags.has('help') || parsed.command === 'help') {
    io.stdout.write(`${helpText()}\n`);
    return 0;
  }

  try {
    if (parsed.values['program-root'] !== undefined || parsed.flags.has('program-root')) {
      throw new Error('--program-root was removed; use --installation-root and its owned program child.');
    }
    if ((dependencies.platform ?? process.platform) !== 'win32') {
      throw new Error('RPG Maker Agent is supported on Windows only.');
    }
    if (parsed.command === 'bootstrap') {
      const result = await bootstrapRuntime({
        ...baseOptions(parsed, dependencies),
        nodeExecutable: option(parsed.values, 'node-executable'),
        npmExecutable: option(parsed.values, 'npm-executable')
      });
      io.stdout.write(`Bootstrap ${result.status}: ${result.runtimeDir}\n`);
      if (result.rollbackDir) io.stdout.write(`Previous runtime retained for rollback: ${result.rollbackDir}\n`);
      return 0;
    }

    if (parsed.command === 'install' || parsed.command === 'repair') {
      const localStateRoot = option(parsed.values, 'local-state-root') ?? option(parsed.values, 'mutable-root') ?? defaultLocalStateRoot(dependencies.env ?? process.env);
      const receipt = await readInstallationReceipt(localStateRoot);
      if (parsed.command === 'repair' && !receipt) throw new Error('Repair requires an existing installation-location receipt. Run install first.');
      let installationRoot = option(parsed.values, 'installation-root');
      if (!installationRoot && !receipt) {
        if (parsed.flags.has('non-interactive') || parsed.flags.has('plain') || parsed.flags.has('ndjson') || !(dependencies.env ?? process.env).TERM && !processStdin.isTTY) {
          throw new Error('First installation requires an explicit --installation-root in noninteractive mode.');
        }
      }
      const mode: InstallationRendererMode = parsed.flags.has('ndjson') ? 'ndjson' : parsed.flags.has('plain') || parsed.flags.has('non-interactive') ? 'plain' : rendererMode({ stdoutIsTTY: io.stdout.isTTY === true });
      const eventListener = dependencies.installEventListener ?? createInstallationRenderer(mode, io);
      const installationRootPicker = !installationRoot && !receipt
        ? (dependencies.installationPicker ?? (async (defaultPath: string): Promise<string | undefined> => {
          let nativeDialogUnavailable = false;
          const selected = await pickInstallationRoot({
            defaultPath,
            platform: dependencies.platform,
            env: dependencies.env,
            commandRunner: dependencies.commandRunner,
            onUnavailable: () => { nativeDialogUnavailable = true; }
          });
          // A successful dialog with no selected path is a user cancellation,
          // not an invitation to ask a second time.  Only an unavailable
          // native adapter falls back to the validated terminal prompt.
          if (!nativeDialogUnavailable || !processStdin.isTTY || !processStdout.isTTY) return selected;
          const readline = createInterface({ input: processStdin, output: processStdout });
          try {
            return (await readline.question(`Installation root [${defaultPath}]: `)).trim() || defaultPath;
          } finally {
            readline.close();
          }
        }))
        : undefined;
      const prerequisiteConsent: PrerequisiteConsent = dependencies.prerequisiteConsent
        ?? (parsed.flags.has('yes') ? true : mode === 'interactive' ? (missing) => promptPrerequisiteConsent(missing, io) : false);
      const result = await installWindowsRelease({
        platform: dependencies.platform,
        env: dependencies.env,
        releaseRoot: option(parsed.values, 'release-root') ?? process.cwd(),
        installationRoot,
        installationRootPicker,
        operation: parsed.command === 'repair' ? 'repair' : undefined,
        localStateRoot,
        dshHome: option(parsed.values, 'dsh-home'),
        runtimeDir: option(parsed.values, 'runtime-dir'),
        mutableRoot: option(parsed.values, 'mutable-root'),
        startMenuShortcutPath: option(parsed.values, 'start-menu-shortcut'),
        pwshExecutable: option(parsed.values, 'pwsh-executable'),
        nodeExecutable: option(parsed.values, 'node-executable'),
        npmExecutable: option(parsed.values, 'npm-executable'),
        gitExecutable: option(parsed.values, 'git-executable'),
        coreutilsExecutable: option(parsed.values, 'coreutils-executable'),
        wingetExecutable: option(parsed.values, 'winget-executable'),
        desktopHostRoot: option(parsed.values, 'desktop-host-root'),
        requireDesktopHost: parsed.flags.has('require-desktop-host') ? true : undefined,
        consent: prerequisiteConsent,
        renderer: mode,
        onEvent: eventListener,
        nonInteractive: parsed.flags.has('non-interactive') || mode !== 'interactive',
        commandRunner: dependencies.commandRunner
      });
      if (mode === 'ndjson') return 0;
      io.stdout.write(`Installed RPG Maker Agent under ${result.paths.programRoot}\n`);
      io.stdout.write(`Mutable state: ${result.paths.mutableRoot}; DSH_HOME: ${result.paths.dshHome}\n`);
      io.stdout.write(`Start Menu shortcut: ${result.shortcutPath}\n`);
      return 0;
    }

    if (parsed.command === 'uninstall') {
      const result = await uninstallWindowsRelease({
        platform: dependencies.platform,
        env: dependencies.env,
        installationRoot: option(parsed.values, 'installation-root'),
        localStateRoot: option(parsed.values, 'local-state-root'),
        dshHome: option(parsed.values, 'dsh-home'),
        runtimeDir: option(parsed.values, 'runtime-dir'),
        mutableRoot: option(parsed.values, 'mutable-root'),
        startMenuShortcutPath: option(parsed.values, 'start-menu-shortcut'),
        purge: parsed.flags.has('purge')
      });
      io.stdout.write(`Removed program files and cache under ${result.programRoot}.\n`);
      io.stdout.write(result.purged ? `Purged mutable DSH state under ${result.mutableRoot}.\n` : `Preserved DSH state, credentials, logs, and recent projects under ${result.mutableRoot}.\n`);
      return 0;
    }

    if (parsed.command === 'release-zip') {
      const zipPath = requiredOption(parsed, 'zip');
      const sourceRoot = option(parsed.values, 'source-root') ?? process.cwd();
      const desktopHostRoot = option(parsed.values, 'desktop-host-root');
      if (!desktopHostRoot) throw new Error('release-zip requires an explicit --desktop-host-root <payload-directory>.');
      const requireDesktopHost = true;
      const archive = await buildReleaseZip({ sourceRoot, outputZip: zipPath, platform: dependencies.platform, env: dependencies.env, commandRunner: dependencies.commandRunner, desktopHostRoot, requireDesktopHost });
      const inspection = await inspectReleaseZip({ zipPath: archive, platform: dependencies.platform, env: dependencies.env, commandRunner: dependencies.commandRunner, requireDesktopHost });
      if (!inspection.valid) throw new Error(`Release ZIP is missing required entries: ${inspection.missing.join(', ')}`);
      io.stdout.write(`Release ZIP: ${archive}\n${inspection.entries.length} entries inspected.\n`);
      return 0;
    }

    if (parsed.command === 'doctor') {
      const workspace = option(parsed.values, 'workspace');
      if (parsed.flags.has('sandbox-probe') && !workspace) throw new Error('--sandbox-probe requires --workspace <path>.');
      const report = await runDoctor({
        ...baseOptions(parsed, dependencies),
        workspace,
        sandboxProbe: parsed.flags.has('sandbox-probe'),
        pwshExecutable: option(parsed.values, 'pwsh-executable'),
        nodeExecutable: option(parsed.values, 'node-executable'),
        npmExecutable: option(parsed.values, 'npm-executable'),
        gitExecutable: option(parsed.values, 'git-executable'),
        coreutilsExecutable: option(parsed.values, 'coreutils-executable')
      });
      io.stdout.write(parsed.flags.has('json') ? `${JSON.stringify(report, null, 2)}\n` : `${renderDoctorReport(report)}\n`);
      return report.ok ? 0 : 1;
    }

    if (parsed.command === 'launch') {
      if (parsed.flags.has('project') || option(parsed.values, 'project') !== undefined) {
        throw new Error('The launch command is project-neutral and does not accept --project; choose a workspace in DSH Web.');
      }
      if (parsed.flags.has('preset') || option(parsed.values, 'preset') !== undefined) {
        throw new Error('The launch command uses the single default rpgmaker Agent preset and does not accept --preset.');
      }
      validateCliFixedBinding(argv);
      // This notice is intentionally unconditional: do not detect editor processes or infer write ownership.
      io.stdout.write(`${SINGLE_WRITER_NOTICE}\n\n`);
      const launchOptions = {
        ...baseOptions(parsed, dependencies),
        dshExecutable: option(parsed.values, 'dsh-executable'),
        dshArgs: [],
        spawnInteractive: dependencies.spawnInteractive,
        portProbe: dependencies.portProbe,
        onPortConflict: dependencies.onPortConflict,
        openExistingSession: dependencies.openExistingSession,
        notify: (message: string) => io.stdout.write(`${message}\n`)
      };
      const result = dependencies.rpgmaker === false
        ? await launchProject(launchOptions)
        : await launchRpgmakerProject(launchOptions);
      io.stdout.write(`Launching official DSH in neutral landing directory ${result.cwd}\n`);
      if (result.webUrl) io.stdout.write(`DSH web session: ${result.webUrl}\n`);
      return await childExitCode(result.child);
    }

    io.stderr.write(`${helpText()}\n`);
    return 2;
  } catch (error) {
    const message = error instanceof BootstrapError || error instanceof LauncherError || error instanceof Error
      ? error.message
      : String(error);
    io.stderr.write(`${redactSensitive(message, env)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  runCli().then((code) => { process.exitCode = code; });
}

export { parseArgs, helpText };
