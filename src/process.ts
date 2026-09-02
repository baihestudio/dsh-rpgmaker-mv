import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

export interface CommandOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  platform?: string;
  signal?: AbortSignal;
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
  newConsole?: boolean;
}

export type InteractiveSpawner = (command: string, args: string[], options: InteractiveSpawnOptions) => ChildProcess | unknown;

export interface ProcessInvocation {
  command: string;
  args: string[];
}

export type ProcessTreeTerminator = (child: ChildProcess, options: CommandOptions) => Promise<void>;

export interface CommandExecutionDependencies {
  spawnProcess?: typeof spawn;
  terminateProcessTree?: ProcessTreeTerminator;
}

export class ProcessTerminationError extends Error {
  readonly processTreeTerminated = false;

  constructor(message: string) {
    super(message);
    this.name = 'ProcessTerminationError';
  }
}

function quoteWindowsCommandArgument(value: string): string {
  // cmd.exe expands percent variables even inside quotes. A caret protects
  // each percent from that expansion; /v:off below prevents delayed !
  // expansion. Keep all other argv data quoted when cmd could parse it.
  const cmdSafe = value.replaceAll('%', '^%');
  const escaped = cmdSafe.replaceAll('"', `${String.fromCharCode(92)}"`);
  if (escaped.length > 0 && !/[\s\"&|<>^!%]/.test(value)) return escaped;
  return `"${escaped}"`;
}

function windowsCommandInterpreter(env: Record<string, string | undefined>): string {
  return env.ComSpec ?? env.COMSPEC ?? process.env.ComSpec ?? process.env.COMSPEC ?? 'cmd.exe';
}

function windowsCommandLine(command: string, args: readonly string[]): string {
  return [quoteWindowsCommandArgument(command), ...args.map(quoteWindowsCommandArgument)].join(' ');
}

export function prepareProcessInvocation(
  command: string,
  args: string[],
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env
): ProcessInvocation {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(command)) return { command, args };
  return {
    command: windowsCommandInterpreter(env),
    args: ['/d', '/v:off', '/s', '/c', `"${windowsCommandLine(command, args)}"`]
  };
}

export function prepareConsoleProcessInvocation(
  command: string,
  args: string[],
  platform: string = process.platform,
  env: Record<string, string | undefined> = process.env
): ProcessInvocation {
  if (platform !== 'win32') return prepareProcessInvocation(command, args, platform, env);
  const invocation = prepareProcessInvocation(command, args, platform, env);
  return {
    command: windowsCommandInterpreter(env),
    // `start` is the supported cmd boundary that requests a distinct console
    // for a console application. `/wait` keeps lifecycle ownership with the
    // sidecar until the DSH process exits.
    args: ['/d', '/v:off', '/s', '/c', `"start "DSH launch token" /wait ${windowsCommandLine(invocation.command, invocation.args)}"`]
  };
}

function mergedEnvironment(env?: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env ?? process.env)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function waitForChildExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once('close', done);
    child.once('error', done);
  });
}

async function runTaskkill(pid: number, env?: Record<string, string | undefined>): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const taskkill = env?.SystemRoot ? join(env.SystemRoot, 'System32', 'taskkill.exe') : 'taskkill.exe';
    const child = spawn(taskkill, ['/PID', String(pid), '/T', '/F'], {
      env: mergedEnvironment(env),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore']
    });
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}

export const terminateProcessTree: ProcessTreeTerminator = async (child, options) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if ((options.platform ?? process.platform) === 'win32' && child.pid) {
    const exitCode = await runTaskkill(child.pid, options.env);
    if (exitCode !== 0 && child.exitCode === null && child.signalCode === null) {
      throw new ProcessTerminationError(`taskkill could not terminate process tree for PID ${child.pid}`);
    }
  } else {
    if (!child.kill('SIGTERM')) throw new ProcessTerminationError('the child process rejected termination');
  }
  await waitForChildExit(child);
};

export async function executeCommand(
  command: string,
  args: string[],
  options: CommandOptions,
  dependencies: CommandExecutionDependencies = {}
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    let settled = false;
    let terminating = false;
    let terminationStarted = false;
    let stdout = '';
    let stderr = '';
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let onAbort = (): void => undefined;
    const spawnProcess = dependencies.spawnProcess ?? spawn;
    const terminate = dependencies.terminateProcessTree ?? terminateProcessTree;
    const invocation = prepareProcessInvocation(command, args, options.platform, options.env);
    const child = spawnProcess(invocation.command, invocation.args, {
      cwd: options.cwd,
      env: mergedEnvironment(options.env),
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: (options.platform ?? process.platform) === 'win32' && /\.(?:cmd|bat)$/i.test(command),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const finish = (result: CommandResult): void => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (options.signal) options.signal.removeEventListener('abort', onAbort);
      resolve(result);
    };

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', (error) => {
      if (terminating) {
        stderr += `\n${error instanceof Error ? error.message : String(error)}`;
        return;
      }
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (options.signal) options.signal.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.once('close', (code) => {
      if (terminating) return;
      finish({ exitCode: code ?? 1, stdout, stderr });
    });

    const startTermination = (exitCode: number, message: string): void => {
      if (terminationStarted || settled) return;
      terminationStarted = true;
      terminating = true;
      void (async () => {
        try {
          await terminate(child, options);
          finish({ exitCode, stdout, stderr: `${stderr}\n${message}`.trim() });
        } catch (error) {
          if (settled) return;
          settled = true;
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if (options.signal) options.signal.removeEventListener('abort', onAbort);
          reject(error instanceof ProcessTerminationError ? error : new ProcessTerminationError(error instanceof Error ? error.message : String(error)));
        }
      })();
    };

    onAbort = (): void => startTermination(130, 'command cancelled');
    if (options.signal) {
      options.signal.addEventListener('abort', onAbort, { once: true });
      if (options.signal.aborted) onAbort();
    }
    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => startTermination(124, 'command timed out'), options.timeoutMs);
      timeoutHandle.unref?.();
    }
  });
}

export const runCommand: CommandRunner = (command, args, options) => executeCommand(command, args, options);

export const spawnInteractive: InteractiveSpawner = (command, args, options) => {
  const windows = (options.platform ?? process.platform) === 'win32';
  const newConsole = windows && options.newConsole === true;
  const invocation = newConsole
    ? prepareConsoleProcessInvocation(command, args, options.platform, options.env)
    : prepareProcessInvocation(command, args, options.platform, options.env);
  return spawn(invocation.command, invocation.args, {
    cwd: options.cwd,
    env: mergedEnvironment(options.env),
    shell: false,
    windowsHide: newConsole,
    windowsVerbatimArguments: newConsole || (windows && /\.(?:cmd|bat)$/i.test(command)),
    stdio: newConsole ? 'ignore' : 'inherit'
  });
};

const SENSITIVE_ENVIRONMENT_KEYS = new Set([
  'DEEPSEEK_API_KEY',
  'DSH_API_KEY',
  'DSH_FORGEJO_ACCESS_TOKEN',
  'FORGEJO_ACCESS_TOKEN',
  'NPM_TOKEN',
  'NODE_AUTH_TOKEN',
  'GITHUB_TOKEN',
  'GITLAB_TOKEN',
  'NPM_CONFIG__AUTH'
]);

function sensitiveEnvironmentKey(key: string): boolean {
  const normalized = key.toUpperCase();
  return SENSITIVE_ENVIRONMENT_KEYS.has(normalized)
    || /^NPM_CONFIG_.+:_AUTH(?:_?TOKEN)?$/.test(normalized);
}

export function withoutCredentials(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const safe: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!sensitiveEnvironmentKey(key)) safe[key] = value;
  }
  return safe;
}

export function redactSensitive(text: string, env: Record<string, string | undefined> = process.env): string {
  let redacted = text;
  const secrets: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (sensitiveEnvironmentKey(key) && value) secrets.push(value);
  }
  for (const secret of new Set(secrets)) redacted = redacted.split(secret).join('[redacted]');
  return redacted
    .replace(/((?:DEEPSEEK_API_KEY|DSH_API_KEY|DSH_FORGEJO_ACCESS_TOKEN|FORGEJO_ACCESS_TOKEN|NPM_TOKEN|NODE_AUTH_TOKEN|GITHUB_TOKEN|GITLAB_TOKEN|NPM_CONFIG__AUTH|NPM_CONFIG_[^\s=]*:_AUTH(?:_?TOKEN)?)\s*[:=]\s*)[^\s,;}]+/gi, '$1[redacted]')
    .replace(/(\bAuthorization\s*:\s*(?:Bearer|Basic)\s+)[^\s,;}\r\n]+/gi, '$1[redacted]');
}

export function commandFailure(command: string, args: string[], result: CommandResult, env?: Record<string, string | undefined>): Error {
  const details = redactSensitive(result.stderr || result.stdout, env).trim();
  return new Error(`${command} ${args.join(' ')} failed with exit code ${result.exitCode}${details ? `: ${details}` : ''}`);
}

export function childExitCode(child: unknown): Promise<number> {
  if (!child || typeof (child as { once?: unknown }).once !== 'function') return Promise.resolve(0);
  const lifecycle = child as ChildProcess;
  if (typeof lifecycle.exitCode === 'number') return Promise.resolve(lifecycle.exitCode);
  if (lifecycle.signalCode !== null && lifecycle.signalCode !== undefined) return Promise.resolve(1);
  return new Promise((resolve) => {
    let settled = false;
    const listeners: Array<[string, (...args: unknown[]) => void]> = [];
    const cleanup = (): void => {
      if (typeof lifecycle.removeListener !== 'function') return;
      for (const [event, listener] of listeners) lifecycle.removeListener(event, listener);
    };
    const finish = (code: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(typeof code === 'number' ? code : 1);
    };
    const register = (event: string, listener: (...args: unknown[]) => void): void => {
      listeners.push([event, listener]);
      lifecycle.once(event, listener);
    };
    register('error', () => finish(1));
    register('exit', (code) => finish(code));
    register('close', (code) => finish(code));
    if (typeof lifecycle.exitCode === 'number') finish(lifecycle.exitCode);
    else if (lifecycle.signalCode !== null && lifecycle.signalCode !== undefined) finish(1);
  });
}
