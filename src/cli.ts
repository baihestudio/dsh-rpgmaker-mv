import { bootstrapRuntime, BootstrapError } from './bootstrap';
import { runDoctor, renderDoctorReport } from './doctor';
import { launchProject, SINGLE_WRITER_NOTICE, LauncherError } from './launcher';
import { launchRpgmakerProject } from './rpgmaker';
import { buildRelease, releaseSummary, type ReleaseTarget } from './release';
import {
  createImageWorkshop,
  prepareImageToolchain,
  type ImageArchiveDownloader,
  type ImageArchiveExtractor,
  type ImageToolchainOptions
} from './image-workshop';
import type { ImageReleasePin } from './image-releases';
import { childExitCode, redactSensitive, type CommandRunner, type InteractiveSpawner } from './process';

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
  rpgmaker?: boolean;
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
      if (command !== 'image' && command !== 'asset') throw new Error(`Unexpected argument: ${value}`);
      positionals.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      values[key] = next;
      index += 1;
    } else {
      flags.add(key);
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
    '  launch      Pick or launch an RPG Maker MV project in DSH',
    '  build-release  Package and smoke-test Windows and Browser artifacts',
    '  image       Run a deterministic Asset Workshop image operation',
    '',
    'Options:',
    '  --project <path>          Project to launch or package',
    '  --output <path>           Fresh release output directory (build-release)',
    '  --dsh-home <path>         Override DSH_HOME for this invocation',
    '  --runtime-dir <path>      Override the app-owned runtime tree',
    '  --dsh-executable <path>   Use an explicit DSH executable',
    '  --preset <id>              Agent preset (rpgmaker, playtest-debug, asset-workshop, or build-release)',
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
    '  --js-executable <path>    Use an explicit Bun or Node executable for packaging/MCP',
    '  --release-runtime-dir <path>  Use the app-owned rpgmpacker runtime',
    '  --rpgmaker-installation <path>  Explicit RPG Maker MV installation folder',
    '  --mcp-runtime-dir <path>  Use the app-owned RPG Maker MCP runtime',
    '  --source-root <path>      Preset source root override',
    '  --platforms <list>        Comma-separated Windows and/or Browser targets',
    '  --pwsh-executable <path>  Use an explicit PowerShell executable',
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

function releaseTargets(parsed: ParsedArgs): ReleaseTarget[] | undefined {
  const encoded = option(parsed.values, 'platforms');
  if (encoded === undefined) return undefined;
  const values = encoded.split(',').map((value) => value.trim()).filter(Boolean);
  if (values.some((value) => value !== 'Windows' && value !== 'Browser')) throw new Error('--platforms must contain only Windows and Browser.');
  return values as ReleaseTarget[];
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

async function runImageCommand(parsed: ParsedArgs, dependencies: CliDependencies, io: CliIO): Promise<void> {
  const operation = parsed.positionals[0] ?? option(parsed.values, 'operation');
  if (!operation) throw new Error('Image operation is required.');
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
    commandRunner: dependencies.commandRunner
  };
  const toolchain = (await prepareImageToolchain(toolchainOptions)).toolchain;
  const workshop = createImageWorkshop(toolchain, {
    commandRunner: dependencies.commandRunner,
    platform: dependencies.platform,
    env: dependencies.env
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
      await runImageCommand(parsed, dependencies, io);
      return 0;
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

    if (parsed.command === 'build-release' || parsed.command === 'release') {
      const result = await buildRelease({
        platform: dependencies.platform,
        env: dependencies.env,
        dshHome: option(parsed.values, 'dsh-home'),
        runtimeDir: option(parsed.values, 'runtime-dir'),
        projectPath: requiredOption(parsed, 'project'),
        outputRoot: requiredOption(parsed, 'output'),
        targets: releaseTargets(parsed),
        rpgmakerInstallationPath: option(parsed.values, 'rpgmaker-installation'),
        releaseRuntimeDir: option(parsed.values, 'release-runtime-dir'),
        bunExecutable: option(parsed.values, 'bun-executable'),
        jsExecutable: option(parsed.values, 'js-executable'),
        dshExecutable: option(parsed.values, 'dsh-executable'),
        mcpRuntimeDir: option(parsed.values, 'mcp-runtime-dir'),
        sourceRoot: option(parsed.values, 'source-root'),
        commandRunner: dependencies.commandRunner
      });
      io.stdout.write(`${releaseSummary(result)}\n`);
      if (parsed.flags.has('json')) io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }

    if (parsed.command === 'doctor') {
      const report = await runDoctor({
        ...baseOptions(parsed, dependencies),
        bunExecutable: option(parsed.values, 'bun-executable'),
        pwshExecutable: option(parsed.values, 'pwsh-executable')
      });
      io.stdout.write(parsed.flags.has('json') ? `${JSON.stringify(report, null, 2)}\n` : `${renderDoctorReport(report)}\n`);
      return report.ok ? 0 : 1;
    }

    if (parsed.command === 'launch') {
      // This notice is intentionally unconditional: do not detect editor processes or infer write ownership.
      io.stdout.write(`${SINGLE_WRITER_NOTICE}\n\n`);
      const launchOptions = {
        ...baseOptions(parsed, dependencies),
        projectPath: option(parsed.values, 'project'),
        dshExecutable: option(parsed.values, 'dsh-executable'),
        dshArgs: [],
        agentPreset: option(parsed.values, 'preset'),
        spawnInteractive: dependencies.spawnInteractive,
        notify: (message: string) => io.stdout.write(`${message}\n`)
      };
      const result = dependencies.rpgmaker === false
        ? await launchProject(launchOptions)
        : await launchRpgmakerProject(launchOptions);
      io.stdout.write(`Launching official DSH in ${result.projectPath}\n`);
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
