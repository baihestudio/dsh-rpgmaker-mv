import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { defaultLocalStateRoot } from './installation-root';
import { redactSensitive } from './process';

/**
 * Product-side entrypoint for the reusable dsh-electronbun host.
 *
 * The desktop host owns the window, Bun version check, supervisor, and Job
 * lifetime. This process owns only the existing RPG Maker DSH preparation and
 * loopback launch, so the product does not grow a second desktop lifecycle.
 */

export const SIDECAR_STARTUP_FAILURE_EVENT = 'rpgmaker-sidecar-startup-failed';
const SIDECAR_DIAGNOSTIC_LIMIT = 2_000;

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
  const injectedEntrypoint = dependencies.entrypointPath
    ?? dependencies.packagedEntrypoint
    ?? dependencies.sidecarEntrypoint;
  if (injectedEntrypoint) return resolveProgramRootFromSidecarEntrypoint(injectedEntrypoint);
  return resolveProgramRootFromSidecarEntrypoint(productionSidecarEntrypoint());
}

function sidecarLocalStateRoot(env: Record<string, string | undefined>, dependencies: SidecarDependencies): string {
  return resolve(
    dependencies.localStateRoot
      ?? env.DSH_RPGMAKER_LOCAL_STATE_ROOT
      ?? env.DSH_RPGMAKER_DATA_ROOT
      ?? defaultLocalStateRoot(env),
  );
}

function boundedDiagnostic(error: unknown, env: Record<string, string | undefined>): string {
  const message = redactDiagnosticCredentials(redactSensitive(error instanceof Error ? error.message : String(error), env)).trim();
  if (message.length <= SIDECAR_DIAGNOSTIC_LIMIT) return message;
  const marker = '[diagnostic truncated]\n';
  return `${marker}${message.slice(0, SIDECAR_DIAGNOSTIC_LIMIT - marker.length)}`;
}

/**
 * The shared redactor knows the product's named environment secrets.  A
 * loader or dependency may still surface a conventional credential field
 * without putting its value in the environment, so startup diagnostics apply
 * one final key-oriented pass before they are persisted.
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
  error: string;
}

export type SidecarStartupDiagnosticWriter = (path: string, content: string) => Promise<void>;

async function appendSidecarStartupDiagnostic(
  env: Record<string, string | undefined>,
  dependencies: SidecarDependencies,
  error: unknown,
): Promise<void> {
  try {
    const localStateRoot = sidecarLocalStateRoot(env, dependencies);
    const path = join(localStateRoot, 'logs', 'launcher.log');
    const diagnostic: SidecarStartupDiagnostic = {
      at: (dependencies.now ?? (() => new Date()))().toISOString(),
      event: SIDECAR_STARTUP_FAILURE_EVENT,
      error: boundedDiagnostic(error, env)
    };
    const content = `${redactDiagnosticCredentials(redactSensitive(JSON.stringify(diagnostic), env))}\n`;
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
  /** Alias used by host-facing tests for the injected packaged location. */
  packagedEntrypoint?: string;
  /** Alias matching the desktop-host manifest field. */
  sidecarEntrypoint?: string;
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
  const modulePath = join(programRoot, 'src', 'rpgmaker.ts');
  const loaded = await import(pathToFileURL(modulePath).href) as Partial<ProductLauncherModule>;
  if (typeof loaded.launchRpgmakerProject !== 'function') {
    throw new Error(`The installed RPG Maker product launcher is missing: ${modulePath}`);
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
  try {
    const programRoot = sidecarProgramRoot(dependencies);
    const loadProductLauncher = dependencies.loadProductLauncher ?? loadInstalledProductLauncher;
    const product = await loadProductLauncher(programRoot);
    result = await product.launchRpgmakerProject({
      platform,
      env,
      // The installed launcher owns mutable/state/runtime resolution; the
      // adapter only needs the program tree to load it and its shipped preset.
      programRoot,
      sourceRoot: join(programRoot, 'presets', 'rpgmaker'),
      bunExecutable: process.execPath,
      jsExecutable: process.execPath,
      openWebBrowser: false,
      bindWeb: true,
      webHost: '127.0.0.1',
      webPort: 3081,
      // Electrobun owns the native WebView. Never open a second browser window
      // from the product sidecar.
      openExistingSession: async () => undefined,
      notify: () => undefined,
    });
    const wait = dependencies.waitForChildExit ?? waitForChildExit;
    const exitCode = await wait(result.child);
    if (exitCode !== 0) {
      await appendSidecarStartupDiagnostic(env, dependencies, new Error(`product launcher child exited with code ${exitCode}`));
    }
    return exitCode;
  } catch (error) {
    startupFailed = true;
    await appendSidecarStartupDiagnostic(env, dependencies, error);
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
      process.stderr.write(`${boundedDiagnostic(error, process.env)}\n`);
      process.exitCode = 1;
    });
}
