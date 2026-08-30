import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Product-side entrypoint for the reusable dsh-electronbun host.
 *
 * The desktop host owns the window, Bun version check, supervisor, and Job
 * lifetime. This process owns only the existing RPG Maker DSH preparation and
 * loopback launch, so the product does not grow a second desktop lifecycle.
 */

function windowsProgramRoot(env: Record<string, string | undefined>): string {
  const localAppData = env.LOCALAPPDATA ?? join(env.USERPROFILE ?? process.cwd(), 'AppData', 'Local');
  return resolve(env.DSH_RPGMAKER_PROGRAM_ROOT ?? join(localAppData, 'Programs', 'BaiheStudio', 'DSH-RPGMaker-MV'));
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

  const programRoot = windowsProgramRoot(env);
  const loadProductLauncher = dependencies.loadProductLauncher ?? loadInstalledProductLauncher;
  const product = await loadProductLauncher(programRoot);
  const result = await product.launchRpgmakerProject({
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

  try {
    const wait = dependencies.waitForChildExit ?? waitForChildExit;
    return await wait(result.child);
  } finally {
    // launchRpgmakerProject also hooks child lifecycle events, but an
    // explicit release keeps the product-owned lease bounded even when the
    // host observes shutdown through a different process boundary.
    await result.releaseSession();
  }
}

if (import.meta.main) {
  runRpgMakerSidecar()
    .then((code) => { process.exitCode = code; })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
