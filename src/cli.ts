import { bootstrapRuntime, BootstrapError } from './bootstrap';
import { runDoctor, renderDoctorReport } from './doctor';
import { launchProject, SINGLE_WRITER_NOTICE, LauncherError } from './launcher';
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
  spawnInteractive?: InteractiveSpawner;
}

interface ParsedArgs {
  command: string;
  values: Record<string, string>;
  flags: Set<string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [first, ...rest] = argv;
  const command = first && !first.startsWith('-') ? first : 'launch';
  const args = first && !first.startsWith('-') ? rest : argv;
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith('--')) throw new Error(`Unexpected argument: ${value}`);
    const key = value.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      values[key] = next;
      index += 1;
    } else {
      flags.add(key);
    }
  }
  return { command, values, flags };
}

function helpText(): string {
  return [
    'DSH RPG Maker MV harness',
    '',
    'Commands:',
    '  bootstrap   Install or repair the pinned DSH runtime using Bun',
    '  doctor      Check Windows prerequisites and DSH metadata',
    '  launch      Pick or launch an RPG Maker MV project in DSH',
    '',
    'Options:',
    '  --project <path>          Skip the native folder picker',
    '  --dsh-home <path>         Override DSH_HOME for this invocation',
    '  --runtime-dir <path>      Override the app-owned runtime tree',
    '  --dsh-executable <path>   Use an explicit DSH executable',
    '  --bun-executable <path>   Use an explicit Bun executable',
    '  --pwsh-executable <path>  Use an explicit PowerShell executable',
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
    commandRunner: dependencies.commandRunner
  };
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
    if (parsed.command === 'bootstrap') {
      const result = await bootstrapRuntime({
        ...baseOptions(parsed, dependencies),
        bunExecutable: option(parsed.values, 'bun-executable')
      });
      io.stdout.write(`Bootstrap ${result.status}: ${result.runtimeDir}\n`);
      if (result.rollbackDir) io.stdout.write(`Previous runtime retained for rollback: ${result.rollbackDir}\n`);
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
      const result = await launchProject({
        ...baseOptions(parsed, dependencies),
        projectPath: option(parsed.values, 'project'),
        dshExecutable: option(parsed.values, 'dsh-executable'),
        dshArgs: [],
        spawnInteractive: dependencies.spawnInteractive,
        notify: (message) => io.stdout.write(`${message}\n`)
      });
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
