import { bootstrapRuntime, BootstrapError } from './bootstrap';
import { runDoctor, renderDoctorReport } from './doctor';
import { launchProject, SINGLE_WRITER_NOTICE, LauncherError } from './launcher';
import { launchRpgmakerProject } from './rpgmaker';
import {
  createImageWorkshop,
  prepareImageToolchain,
  type ImageArchiveDownloader,
  type ImageArchiveExtractor,
  type ImageToolchainOptions
} from './image-workshop';
import type { ImageReleasePin } from './image-releases';
import { childExitCode, redactSensitive, runCommand, type CommandRunner, type InteractiveSpawner } from './process';
import { imageDiagnosticContextFromEnvironment, withImageDiagnostics } from './image-diagnostics';
import { WINDOWS_DSH_HOST, WINDOWS_DSH_PORT } from './config';
import { buildReleaseZip, inspectReleaseZip, installWindowsRelease, uninstallWindowsRelease } from './release-gate';
import type { PrerequisiteConsent } from './prerequisites';
import type { PortConflictAction, ExistingSessionOpener, PortProbe } from './windows';

export interface CliIO {
  stdout: { write: (text: string) => unknown };
  stderr: { write: (text: string) => unknown };
}

export interface CliDependencies {
  env?: Record<string, string | undefined>;
  platform?: string;
  io?: CliIO;
  commandRunner?: CommandRunner;
  downloadArchive?: ImageArchiveDownloader;
  extractArchive?: ImageArchiveExtractor;
  imageMagickRelease?: ImageReleasePin;
  oxipngRelease?: ImageReleasePin;
  spawnInteractive?: InteractiveSpawner;
  prerequisiteConsent?: PrerequisiteConsent;
  portProbe?: PortProbe;
  onPortConflict?: (url: string) => Promise<PortConflictAction> | PortConflictAction;
  openExistingSession?: ExistingSessionOpener;
  rpgmaker?: boolean;
  signal?: AbortSignal;
}

interface ParsedArgs {
  command: string;
  positionals: string[];
  values: Record<string, string>;
  flags: Set<string>;
}

const IMAGE_OPERATION_TOOL_NAMES: Readonly<Record<string, string>> = {
  inspect: 'image_inspect',
  'resize-pixel': 'image_resize_pixel',
  'trim-pad': 'image_trim_pad',
  'sheet-slice': 'image_sheet_slice',
  'sheet-assemble': 'image_sheet_assemble',
  'atlas-pack': 'image_atlas_pack',
  'optimize-png': 'image_optimize_png'
};

function imageToolName(operation: string): string {
  const toolName = Object.prototype.hasOwnProperty.call(IMAGE_OPERATION_TOOL_NAMES, operation)
    ? IMAGE_OPERATION_TOOL_NAMES[operation]
    : undefined;
  if (!toolName) throw new Error(`Unknown image operation ${operation}.`);
  return toolName;
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
      if (command !== 'image' && command !== 'asset') throw new Error(`Unexpected argument: ${value}`);
      positionals.push(value);
      continue;
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
    'DSH RPG Maker MV harness',
    '',
    'Commands:',
    '  bootstrap   Install or repair the pinned DSH runtime using Bun',
    '  doctor      Check Windows prerequisites and DSH metadata',
    '  install     Install a Release ZIP into the per-user Windows roots',
    '  uninstall   Remove program files/cache (use --purge for state/credentials)',
    '  release-zip Build and inspect a distributable Release ZIP',
    '  launch      Start project-neutral DSH Web; choose workspaces in its UI',
      '  image       Run a deterministic Asset Workshop image operation',
    '',
    'Options:',
    '  --release-root <path>     Extracted Release ZIP root (install)',
    '  --zip <path>              Release ZIP path (release-zip)',
    '  --program-root <path>     Per-user installed program root override',
    '  --mutable-root <path>     Per-user mutable data root override',
    '  --start-menu-shortcut <path> Override the owned Start Menu shortcut path',
    '  --dsh-home <path>         Override DSH_HOME for this invocation',
    '  --runtime-dir <path>      Override the app-owned runtime tree',
    '  --dsh-executable <path>   Use an explicit DSH executable',
    '  --preset <id>              Agent preset (rpgmaker, game-design, or asset-workshop)',
    '  --image-magick <path>     Use the resolved pinned ImageMagick executable (requires SHA-256)',
    '  --image-magick-sha256 <hex> Expected SHA-256 for an explicit ImageMagick override',
    '  --image-magick-url <url>  Exact pinned ImageMagick release URL',
    '  --image-toolchain-root <path>  Use the app-owned image toolchain directory',
    '  --image-helper-runtime <path> Use the app-owned atlas helper runtime',
    '  --oxipng <path>            Use an explicit pinned oxipng override (requires SHA-256)',
    '  --install-oxipng          Download and install the optional pinned oxipng optimizer',
    '  --oxipng-sha256 <hex>     Expected SHA-256 for an explicit oxipng override',
    '  --oxipng-url <url>        Exact pinned oxipng release URL',
    '  --bun-executable <path>   Use an explicit Bun executable',
    '  --js-executable <path>    Use an explicit Bun or Node executable for MCP',
    '  --mcp-runtime-dir <path>  Use the app-owned RPG Maker MCP runtime',
    '  --source-root <path>      Preset source root override',
    '  --pwsh-executable <path>  Use an explicit PowerShell executable',
    '  --node-executable <path>  Use an explicit Node.js executable',
    '  --npm-executable <path>   Use an explicit npm executable',
    '  --winget-executable <path> Use an explicit WinGet executable',
    '  --git-executable <path>   Use an explicit Git executable',
    '  --coreutils-executable <path> Use an explicit Coreutils manager',
    '  --yes                     Consent to prerequisite installation',
    '  --purge                   Explicitly delete mutable state/credentials (uninstall)',
    '  --json                    Render doctor output as JSON',
    '',
    'Image operations:',
    '  image inspect --input <path>',
    '  image resize-pixel --input <path> --output <path> --scale <integer>',
    '  image trim-pad --input <path> --output <path> --trim --width <n> --height <n>',
    '  image sheet-slice --input <path> --output-dir <dir> --cell-width <n> --cell-height <n>',
    '  image sheet-assemble --inputs-json <json-array> --output <path> --columns <n>',
    '  image atlas-pack --inputs-json <json-array> --output <new-directory> --max-size <n>',
    '  image optimize-png --input <path> --output <path> --level <0-6>',
    '  image tool flags: --image-magick <path> --helper-root <path> --oxipng <path>',
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
    programRoot: option(parsed.values, 'program-root'),
    mutableRoot: option(parsed.values, 'mutable-root'),
    startMenuShortcutPath: option(parsed.values, 'start-menu-shortcut'),
    imageMagickExecutable: option(parsed.values, 'image-magick'),
    imageMagickSha256: option(parsed.values, 'image-magick-sha256'),
    imageMagickUrl: option(parsed.values, 'image-magick-url'),
    imageMagickRelease: dependencies.imageMagickRelease,
    imageToolchainRoot: option(parsed.values, 'image-toolchain-root'),
    imageHelperRuntimeDir: option(parsed.values, 'image-helper-runtime'),
    oxipngExecutable: option(parsed.values, 'oxipng'),
    oxipngSha256: option(parsed.values, 'oxipng-sha256'),
    oxipngUrl: option(parsed.values, 'oxipng-url'),
    oxipngRelease: dependencies.oxipngRelease,
    installOxipng: parsed.flags.has('install-oxipng') || (parsed.flags.has('oxipng') && !option(parsed.values, 'oxipng')),
    bunExecutable: option(parsed.values, 'bun-executable'),
    jsExecutable: option(parsed.values, 'js-executable'),
    downloadArchive: dependencies.downloadArchive,
    extractArchive: dependencies.extractArchive,
    commandRunner: dependencies.commandRunner
  };
}

function requiredOption(parsed: ParsedArgs, name: string): string {
  const value = option(parsed.values, name);
  if (!value) throw new Error(`Missing required option --${name}.`);
  return value;
}

function numericOption(parsed: ParsedArgs, name: string): number | undefined {
  const value = option(parsed.values, name);
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number)) throw new Error(`Option --${name} must be an integer.`);
  return number;
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

function inputList(parsed: ParsedArgs): string[] {
  const encoded = requiredOption(parsed, 'inputs-json');
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new Error('--inputs-json must be a JSON array of paths.');
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error('--inputs-json must be a JSON array of paths.');
  return value;
}

async function runImageCommand(parsed: ParsedArgs, dependencies: CliDependencies, io: CliIO, signal?: AbortSignal): Promise<void> {
  const operation = parsed.positionals[0] ?? option(parsed.values, 'operation');
  if (!operation) throw new Error('Image operation is required.');
  imageToolName(operation);
  const imageEnv = dependencies.env ?? process.env;
  const diagnostics = imageDiagnosticContextFromEnvironment(imageEnv, { operation });
  const baseCommandRunner = dependencies.commandRunner ?? runCommand;
  const commandRunner = withImageDiagnostics((command, args, options) => baseCommandRunner(command, args, {
    ...options,
    signal: signal ?? options.signal
  }), diagnostics, { nativeCommandRunner: dependencies.commandRunner === undefined });
  const toolchainOptions: ImageToolchainOptions = {
    platform: dependencies.platform,
    env: dependencies.env,
    dshHome: option(parsed.values, 'dsh-home'),
    toolchainRoot: option(parsed.values, 'toolchain-root'),
    manifestPath: option(parsed.values, 'manifest'),
    imageMagickExecutable: option(parsed.values, 'image-magick'),
    imageMagickSha256: option(parsed.values, 'image-magick-sha256'),
    imageMagickUrl: option(parsed.values, 'image-magick-url'),
    imageMagickRelease: dependencies.imageMagickRelease,
    helperRoot: option(parsed.values, 'helper-root'),
    oxipngExecutable: option(parsed.values, 'oxipng'),
    oxipngSha256: option(parsed.values, 'oxipng-sha256'),
    oxipngUrl: option(parsed.values, 'oxipng-url'),
    oxipngRelease: dependencies.oxipngRelease,
    installOxipng: parsed.flags.has('install-oxipng') || (parsed.flags.has('oxipng') && !option(parsed.values, 'oxipng')),
    downloadArchive: dependencies.downloadArchive,
    extractArchive: dependencies.extractArchive,
    commandRunner
  };
  const toolchain = (await prepareImageToolchain(toolchainOptions)).toolchain;
  const workshop = createImageWorkshop(toolchain, {
    commandRunner,
    platform: dependencies.platform,
    env: dependencies.env,
    signal,
    diagnostics
  });
  if (operation === 'inspect') {
    io.stdout.write(`${JSON.stringify(await workshop.inspect(requiredOption(parsed, 'input')), null, 2)}\n`);
    return;
  }
  let result;
  if (operation === 'resize-pixel') {
    result = await workshop.resizePixel({
      input: requiredOption(parsed, 'input'),
      output: requiredOption(parsed, 'output'),
      scale: numericOption(parsed, 'scale'),
      width: numericOption(parsed, 'width'),
      height: numericOption(parsed, 'height')
    });
  } else if (operation === 'trim-pad') {
    result = await workshop.trimPad({
      input: requiredOption(parsed, 'input'),
      output: requiredOption(parsed, 'output'),
      trim: !parsed.flags.has('no-trim'),
      width: numericOption(parsed, 'width'),
      height: numericOption(parsed, 'height'),
      gravity: option(parsed.values, 'gravity') as 'center' | 'north' | 'south' | 'east' | 'west' | 'northeast' | 'northwest' | 'southeast' | 'southwest' | undefined
    });
  } else if (operation === 'sheet-slice') {
    result = await workshop.sheetSlice({
      input: requiredOption(parsed, 'input'),
      outputDir: requiredOption(parsed, 'output-dir'),
      cellWidth: numericOption(parsed, 'cell-width') ?? 0,
      cellHeight: numericOption(parsed, 'cell-height') ?? 0
    });
  } else if (operation === 'sheet-assemble') {
    result = await workshop.sheetAssemble({
      inputs: inputList(parsed),
      output: requiredOption(parsed, 'output'),
      columns: numericOption(parsed, 'columns') ?? 0
    });
  } else if (operation === 'atlas-pack') {
    result = await workshop.atlasPack({
      inputs: inputList(parsed),
      output: requiredOption(parsed, 'output'),
      maxSize: numericOption(parsed, 'max-size') ?? 0,
      padding: numericOption(parsed, 'padding'),
      extrusion: numericOption(parsed, 'extrusion'),
      fixedGrid: parsed.flags.has('fixed-grid')
    });
  } else if (operation === 'optimize-png') {
    result = await workshop.optimizePng({
      input: requiredOption(parsed, 'input'),
      output: requiredOption(parsed, 'output'),
      level: numericOption(parsed, 'level')
    });
  } else {
    throw new Error(`Unknown image operation ${operation}.`);
  }
  io.stdout.write(`${JSON.stringify(result.manifest, null, 2)}\n`);
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
    if (parsed.command === 'image' || parsed.command === 'asset') {
      const controller = dependencies.signal ? undefined : new AbortController();
      const signal = dependencies.signal ?? controller?.signal;
      const onSignal = (): void => controller?.abort();
      if (controller) {
        process.once('SIGTERM', onSignal);
        process.once('SIGINT', onSignal);
      }
      try {
        await runImageCommand(parsed, dependencies, io, signal);
        return 0;
      } finally {
        if (controller) {
          process.removeListener('SIGTERM', onSignal);
          process.removeListener('SIGINT', onSignal);
        }
      }
    }

    if (parsed.command === 'bootstrap') {
      const result = await bootstrapRuntime({
        ...baseOptions(parsed, dependencies),
        bunExecutable: option(parsed.values, 'bun-executable')
      });
      io.stdout.write(`Bootstrap ${result.status}: ${result.runtimeDir}\n`);
      if (result.rollbackDir) io.stdout.write(`Previous runtime retained for rollback: ${result.rollbackDir}\n`);
      return 0;
    }

    if (parsed.command === 'install') {
      const result = await installWindowsRelease({
        platform: dependencies.platform,
        env: dependencies.env,
        releaseRoot: option(parsed.values, 'release-root') ?? process.cwd(),
        dshHome: option(parsed.values, 'dsh-home'),
        runtimeDir: option(parsed.values, 'runtime-dir'),
        programRoot: option(parsed.values, 'program-root'),
        mutableRoot: option(parsed.values, 'mutable-root'),
        startMenuShortcutPath: option(parsed.values, 'start-menu-shortcut'),
        bunExecutable: option(parsed.values, 'bun-executable'),
        pwshExecutable: option(parsed.values, 'pwsh-executable'),
        nodeExecutable: option(parsed.values, 'node-executable'),
        npmExecutable: option(parsed.values, 'npm-executable'),
        gitExecutable: option(parsed.values, 'git-executable'),
        coreutilsExecutable: option(parsed.values, 'coreutils-executable'),
        wingetExecutable: option(parsed.values, 'winget-executable'),
        consent: dependencies.prerequisiteConsent ?? parsed.flags.has('yes'),
        commandRunner: dependencies.commandRunner
      });
      io.stdout.write(`Installed DSH for RPG Maker MV under ${result.paths.programRoot}\n`);
      io.stdout.write(`Mutable state: ${result.paths.mutableRoot}; DSH_HOME: ${result.paths.dshHome}\n`);
      io.stdout.write(`Start Menu shortcut: ${result.shortcutPath}\n`);
      return 0;
    }

    if (parsed.command === 'uninstall') {
      const result = await uninstallWindowsRelease({
        platform: dependencies.platform,
        env: dependencies.env,
        dshHome: option(parsed.values, 'dsh-home'),
        runtimeDir: option(parsed.values, 'runtime-dir'),
        programRoot: option(parsed.values, 'program-root'),
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
      const archive = await buildReleaseZip({ sourceRoot, outputZip: zipPath, platform: dependencies.platform, env: dependencies.env, commandRunner: dependencies.commandRunner });
      const inspection = await inspectReleaseZip({ zipPath: archive, platform: dependencies.platform, env: dependencies.env, commandRunner: dependencies.commandRunner });
      if (!inspection.valid) throw new Error(`Release ZIP is missing required entries: ${inspection.missing.join(', ')}`);
      io.stdout.write(`Release ZIP: ${archive}\n${inspection.entries.length} entries inspected.\n`);
      return 0;
    }

    if (parsed.command === 'doctor') {
      const report = await runDoctor({
        ...baseOptions(parsed, dependencies),
        bunExecutable: option(parsed.values, 'bun-executable'),
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
      validateCliFixedBinding(argv);
      // This notice is intentionally unconditional: do not detect editor processes or infer write ownership.
      io.stdout.write(`${SINGLE_WRITER_NOTICE}\n\n`);
      const launchOptions = {
        ...baseOptions(parsed, dependencies),
        dshExecutable: option(parsed.values, 'dsh-executable'),
        dshArgs: [],
        agentPreset: option(parsed.values, 'preset'),
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
