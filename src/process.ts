import { spawn, type ChildProcess } from 'node:child_process';

export interface CommandOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  platform?: string;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: string[], options: CommandOptions) => Promise<CommandResult>;

export interface InteractiveSpawnOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  platform?: string;
}

export type InteractiveSpawner = (command: string, args: string[], options: InteractiveSpawnOptions) => ChildProcess | unknown;

export interface ProcessInvocation {
  command: string;
  args: string[];
}

function quoteWindowsCommandArgument(value: string): string {
  if (value.length > 0 && !/[\s\"&|<>^]/.test(value)) return value;
  return `\"${value.replace(/(\\*)\"/g, '$1$1\\\"').replace(/(\\*)$/g, '$1$1')}\"`;
}

export function prepareProcessInvocation(
  command: string,
  args: string[],
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env
): ProcessInvocation {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(command)) return { command, args };
  const comspec = env.ComSpec ?? env.COMSPEC ?? process.env.ComSpec ?? process.env.COMSPEC ?? 'cmd.exe';
  const commandLine = ['call', quoteWindowsCommandArgument(command), ...args.map(quoteWindowsCommandArgument)].join(' ');
  return { command: comspec, args: ['/d', '/s', '/c', commandLine] };
}

function mergedEnvironment(env?: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env ?? process.env)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

export const runCommand: CommandRunner = async (command, args, options) => {
  return new Promise<CommandResult>((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    const invocation = prepareProcessInvocation(command, args, options.platform, options.env);
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.cwd,
      env: mergedEnvironment(options.env),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const finish = (result: CommandResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once('close', (code) => {
      finish({ exitCode: code ?? 1, stdout, stderr });
    });

    if (options.timeoutMs && options.timeoutMs > 0) {
      setTimeout(() => {
        if (settled) return;
        child.kill();
        finish({ exitCode: 124, stdout, stderr: `${stderr}\ncommand timed out`.trim() });
      }, options.timeoutMs).unref();
    }
  });
};

export const spawnInteractive: InteractiveSpawner = (command, args, options) => {
  const invocation = prepareProcessInvocation(command, args, options.platform, options.env);
  return spawn(invocation.command, invocation.args, {
    cwd: options.cwd,
    env: mergedEnvironment(options.env),
    shell: false,
    windowsHide: false,
    stdio: 'inherit'
  });
};

export function withoutCredentials(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const safe = { ...env };
  delete safe.DEEPSEEK_API_KEY;
  delete safe.DSH_API_KEY;
  return safe;
}

export function redactSensitive(text: string, env: Record<string, string | undefined> = process.env): string {
  let redacted = text;
  const secrets = [env.DEEPSEEK_API_KEY, env.DSH_API_KEY].filter((value): value is string => Boolean(value));
  for (const secret of secrets) redacted = redacted.split(secret).join('[redacted]');
  return redacted.replace(/(DEEPSEEK_API_KEY\s*[:=]\s*)[^\s,;}]+/gi, '$1[redacted]');
}

export function commandFailure(command: string, args: string[], result: CommandResult, env?: Record<string, string | undefined>): Error {
  const details = redactSensitive(result.stderr || result.stdout, env).trim();
  return new Error(`${command} ${args.join(' ')} failed with exit code ${result.exitCode}${details ? `: ${details}` : ''}`);
}

export function childExitCode(child: unknown): Promise<number> {
  if (!child || typeof (child as { once?: unknown }).once !== 'function') return Promise.resolve(0);
  return new Promise((resolve) => {
    (child as ChildProcess).once('error', () => resolve(1));
    (child as ChildProcess).once('exit', (code) => resolve(code ?? 1));
  });
}
