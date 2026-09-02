import { appendFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { defaultLocalStateRoot } from './installation-root';
import { redactSensitive } from './process';
import { resolveWindowsNode } from './executable';

/**
 * Product-side entrypoint for the reusable dsh-electronbun host.
 *
 * The desktop host owns the window, Bun version check, supervisor, and Job
 * lifetime. This process owns only the existing RPG Maker DSH preparation and
 * loopback launch, so the product does not grow a second desktop lifecycle.
 */

export const SIDECAR_STARTUP_FAILURE_EVENT = 'rpgmaker-sidecar-startup-failed';
const SIDECAR_DIAGNOSTIC_LIMIT = 2_000;

export type SidecarStartupDiagnosticOperation =
  | 'load-installed-launcher'
  | 'launch-product'
  | 'wait-for-child';

export type SidecarStartupDiagnosticCategory =
  | 'installed-launcher-missing'
  | 'installed-launcher-load-failed'
  | 'product-launch-failed'
  | 'product-child-status-failed'
  | 'product-child-exited';

/**
 * The native host stages this file at
 * <program>/desktop-host/Resources/app/payload/sidecar/<entrypoint>.  Keep
 * the production path deliberately single-sourced: the installed program
 * root is five parents above the sidecar directory.
 */
export function resolveProgramRootFromSidecarEntrypoint(entrypointPath: string): string {
  return resolve(dirname(entrypointPath), '..', '..', '..', '..', '..');
}

function productionSidecarEntrypoint(): string {
  return fileURLToPath(import.meta.url);
}

function sidecarProgramRoot(
  dependencies: SidecarDependencies,
): string {
  if (dependencies.entrypointPath) return resolveProgramRootFromSidecarEntrypoint(dependencies.entrypointPath);
  return resolveProgramRootFromSidecarEntrypoint(productionSidecarEntrypoint());
}

function sidecarLocalStateRoot(env: Record<string, string | undefined>, dependencies: SidecarDependencies): string {
  return resolve(
    dependencies.localStateRoot
      ?? defaultLocalStateRoot(env),
  );
}

async function sidecarNodeExecutable(env: Record<string, string | undefined>): Promise<string | undefined> {
  return resolveWindowsNode({ platform: 'win32', env });
}

function boundedStderrDiagnostic(error: unknown, env: Record<string, string | undefined>): string {
  const message = redactDiagnosticCredentials(redactSensitive(error instanceof Error ? error.message : String(error), env)).trim();
  if (message.length <= SIDECAR_DIAGNOSTIC_LIMIT) return message;
  const marker = '[diagnostic truncated]\n';
  return `${marker}${message.slice(0, SIDECAR_DIAGNOSTIC_LIMIT - marker.length)}`;
}

function safeDiagnosticSummary(summary: string, env: Record<string, string | undefined>): string {
  const redacted = redactSensitive(summary, env).trim();
  if (redacted.length <= SIDECAR_DIAGNOSTIC_LIMIT) return redacted;
  const marker = '[diagnostic truncated]\n';
  return `${marker}${redacted.slice(0, SIDECAR_DIAGNOSTIC_LIMIT - marker.length)}`;
}

/**
 * The shared redactor knows the product's named environment secrets. The
 * non-persistent stderr path may still surface a conventional credential field
 * without putting its value in the environment, so it applies one final
 * key-oriented pass before printing.
 */
function redactDiagnosticCredentials(value: string): string {
  return value.replace(
    /((?:api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret|token)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi,
    '$1[redacted]'
  );
}

export interface SidecarStartupDiagnostic {
  at: string;
  event: typeof SIDECAR_STARTUP_FAILURE_EVENT;
  operation: SidecarStartupDiagnosticOperation;
  category: SidecarStartupDiagnosticCategory;
  summary: string;
  /** Bounded, redacted lead describing the caught cause for support logs. */
  cause?: string;
  modulePath?: string;
  exitCode?: number;
}

export type SidecarStartupDiagnosticWriter = (path: string, content: string) => Promise<void>;

async function appendSidecarStartupDiagnostic(
  env: Record<string, string | undefined>,
  dependencies: SidecarDependencies,
  details: Omit<SidecarStartupDiagnostic, 'at' | 'event'>,
): Promise<void> {
  try {
    const localStateRoot = sidecarLocalStateRoot(env, dependencies);
    const path = join(localStateRoot, 'logs', 'launcher.log');
    const diagnostic: SidecarStartupDiagnostic = {
      at: (dependencies.now ?? (() => new Date()))().toISOString(),
      event: SIDECAR_STARTUP_FAILURE_EVENT,
      ...details,
    };
    const content = `${JSON.stringify(diagnostic)}\n`;
    if (dependencies.writeStartupDiagnostic) await dependencies.writeStartupDiagnostic(path, content);
    else {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, content, 'utf8');
    }
  } catch {
    // The startup diagnostic is optional. Never replace the original sidecar
    // failure with a local-state permission or filesystem error.
  }
}

class InstalledProductLauncherMissingError extends Error {
  readonly modulePath: string;

  constructor(modulePath: string) {
    super(`The installed RPG Maker product launcher is missing: ${modulePath}`);
    this.name = 'InstalledProductLauncherMissingError';
    this.modulePath = modulePath;
  }
}

function installedProductLauncherPath(programRoot: string): string {
  return join(programRoot, 'src', 'rpgmaker.ts');
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function startupDiagnosticDetails(
  operation: SidecarStartupDiagnosticOperation,
  programRoot: string | undefined,
  error: unknown,
  env: Record<string, string | undefined>,
): Omit<SidecarStartupDiagnostic, 'at' | 'event'> {
  const cause = (() => {
    const name = error instanceof Error && error.name ? error.name : 'UnknownError';
    const message = boundedStderrDiagnostic(error, env);
    // Keep the operation's useful lead while dropping arbitrary child output
    // (which can contain secrets, tokens, or megabytes of diagnostics). Error
    // messages in the product use a colon to append child output, so retain
    // only the text before that separator. A Windows drive colon is not
    // followed by whitespace and is therefore preserved.
    const lead = message.split(/[;\r\n]/, 1)[0]?.split(/:\s+/, 1)[0]?.trim();
    return safeDiagnosticSummary(`${name}${lead ? `: ${lead}` : ''}`, env);
  })();
  if (operation === 'load-installed-launcher') {
    const modulePath = programRoot ? installedProductLauncherPath(programRoot) : undefined;
    if (error instanceof InstalledProductLauncherMissingError) {
      return {
        operation,
        category: 'installed-launcher-missing',
        summary: safeDiagnosticSummary(`Installed product launcher is missing: ${modulePath ?? error.modulePath}`, env),
        cause,
        modulePath: modulePath ?? error.modulePath,
      };
    }
    return {
      operation,
      category: 'installed-launcher-load-failed',
      summary: safeDiagnosticSummary('Installed product launcher could not be loaded.', env),
      cause,
      ...(modulePath ? { modulePath } : {}),
    };
  }
  if (operation === 'launch-product') {
    return {
      operation,
      category: 'product-launch-failed',
      summary: safeDiagnosticSummary('Product launcher failed before readiness.', env),
      cause,
    };
  }
  return {
    operation,
    category: 'product-child-status-failed',
    summary: safeDiagnosticSummary('Product launcher child status could not be observed.', env),
    cause,
  };
}

function childExitDiagnostic(
  exitCode: number,
  env: Record<string, string | undefined>,
): Omit<SidecarStartupDiagnostic, 'at' | 'event'> {
  if (!Number.isSafeInteger(exitCode)) {
    return {
      operation: 'wait-for-child',
      category: 'product-child-status-failed',
      summary: safeDiagnosticSummary('Product launcher child returned an invalid exit status.', env),
    };
  }
  return {
    operation: 'wait-for-child',
    category: 'product-child-exited',
    summary: safeDiagnosticSummary(`Product launcher child exited with code ${exitCode}.`, env),
    exitCode,
  };
}

export interface ProductLauncherResult {
  child: unknown;
  releaseSession: () => Promise<void>;
}

export interface ProductLauncherModule {
  launchRpgmakerProject(options: Record<string, unknown>): Promise<ProductLauncherResult>;
}

export interface SidecarDependencies {
  /** Test seam for exercising the Windows-only adapter on another host. */
  platform?: string;
  /** Inject the packaged sidecar entrypoint for a disposable test. */
  entrypointPath?: string;
  /** Test-owned local state root for startup diagnostics. */
  localStateRoot?: string;
  now?: () => Date;
  writeStartupDiagnostic?: SidecarStartupDiagnosticWriter;
  loadProductLauncher?: (programRoot: string) => Promise<ProductLauncherModule>;
  waitForChildExit?: (child: unknown) => Promise<number>;
}

function waitForChildExit(child: unknown): Promise<number> {
  if (!child || typeof (child as { once?: unknown }).once !== 'function') return Promise.resolve(1);
  const lifecycle = child as {
    once: (event: string, listener: (...args: unknown[]) => void) => unknown;
    removeListener?: (event: string, listener: (...args: unknown[]) => void) => unknown;
    exitCode?: number | null;
    signalCode?: string | null;
  };
  const currentExitCode = (): number | undefined => {
    if (typeof lifecycle.exitCode === 'number') return lifecycle.exitCode;
    if (lifecycle.signalCode !== undefined && lifecycle.signalCode !== null) return 1;
    return undefined;
  };
  const alreadyExited = currentExitCode();
  if (alreadyExited !== undefined) return Promise.resolve(alreadyExited);

  return new Promise((resolveExit) => {
    let settled = false;
    const registered: Array<[string, (...args: unknown[]) => void]> = [];
    const cleanup = (): void => {
      if (typeof lifecycle.removeListener !== 'function') return;
      for (const [event, listener] of registered) lifecycle.removeListener(event, listener);
    };
    const finish = (code: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolveExit(typeof code === 'number' ? code : 1);
    };
    const listeners: Array<[string, (...args: unknown[]) => void]> = [
      ['error', () => finish(1)],
      ['exit', (code) => finish(code)],
      ['close', (code) => finish(code)],
    ];
    try {
      for (const [event, listener] of listeners) {
        if (settled) break;
        registered.push([event, listener]);
        lifecycle.once(event, listener);
      }
    } catch (error) {
      cleanup();
      throw error;
    }

    // A ChildProcess normally cannot emit between these synchronous calls,
    // but the second read closes the check/register race for compatible
    // process-like implementations that update exit state while registering.
    const exitedAfterRegistration = currentExitCode();
    if (exitedAfterRegistration !== undefined) finish(exitedAfterRegistration);
  });
}

async function loadInstalledProductLauncher(programRoot: string): Promise<ProductLauncherModule> {
  const modulePath = installedProductLauncherPath(programRoot);
  if (!(await pathExists(modulePath))) throw new InstalledProductLauncherMissingError(modulePath);
  const loaded = await import(pathToFileURL(modulePath).href) as Partial<ProductLauncherModule>;
  if (typeof loaded.launchRpgmakerProject !== 'function') {
    throw new Error(`The installed RPG Maker product launcher is invalid: ${modulePath}`);
  }
  return loaded as ProductLauncherModule;
}

export async function runRpgMakerSidecar(
  env: Record<string, string | undefined> = process.env,
  dependencies: SidecarDependencies = {},
): Promise<number> {
  const platform = dependencies.platform ?? process.platform;
  if (platform !== 'win32') {
    throw new Error('The RPG Maker Electrobun sidecar is supported on Windows only.');
  }

  let result: ProductLauncherResult | undefined;
  let startupFailed = false;
  let operation: SidecarStartupDiagnosticOperation = 'load-installed-launcher';
  let programRoot: string | undefined;
  try {
    programRoot = sidecarProgramRoot(dependencies);
    const installationRoot = dirname(programRoot);
    const localStateRoot = sidecarLocalStateRoot(env, dependencies);
    const nodeExecutable = await sidecarNodeExecutable(env);
    const loadProductLauncher = dependencies.loadProductLauncher ?? loadInstalledProductLauncher;
    const product = await loadProductLauncher(programRoot);
    operation = 'launch-product';
    result = await product.launchRpgmakerProject({
      platform,
      env,
      installationRoot,
      localStateRoot,
      // Runtime is another receipt-backed program child; make it explicit so
      // a stale DSH_RPGMAKER_RUNTIME cannot relocate production startup.
      runtimeDir: join(programRoot, 'runtime', 'dsh'),
      sourceRoot: join(programRoot, 'presets', 'rpgmaker'),
      ...(nodeExecutable ? { jsExecutable: nodeExecutable } : {}),
      openWebBrowser: false,
      bindWeb: true,
      webHost: '127.0.0.1',
      webPort: 3081,
      // Electrobun owns the native WebView. Never open a second browser window
      // from the product sidecar.
      openExistingSession: async () => undefined,
      notify: () => undefined,
    });
    operation = 'wait-for-child';
    const wait = dependencies.waitForChildExit ?? waitForChildExit;
    const exitCode = await wait(result.child);
    if (exitCode !== 0) {
      await appendSidecarStartupDiagnostic(env, dependencies, childExitDiagnostic(exitCode, env));
    }
    return exitCode;
  } catch (error) {
    startupFailed = true;
    await appendSidecarStartupDiagnostic(env, dependencies, startupDiagnosticDetails(operation, programRoot, error, env));
    throw error;
  } finally {
    // launchRpgmakerProject also hooks child lifecycle events, but an
    // explicit release keeps the product-owned lease bounded even when the
    // host observes shutdown through a different process boundary.
    if (result) {
      try {
        await result.releaseSession();
      } catch (error) {
        // Preserve the startup/child failure that caused this cleanup path.
        // A cleanup error can surface on an otherwise successful launch.
        if (!startupFailed) throw error;
      }
    }
  }
}

if (import.meta.main) {
  runRpgMakerSidecar()
    .then((code) => { process.exitCode = code; })
    .catch((error: unknown) => {
      process.stderr.write(`${boundedStderrDiagnostic(error, process.env)}\n`);
      process.exitCode = 1;
    });
}
