import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ELECTROBUN_BUN_VERSION,
  ELECTROBUN_OUTPUT_MARKER,
  ELECTROBUN_PRODUCT_MANIFEST,
  ELECTROBUN_SIDECAR,
  ELECTROBUN_SUPERVISOR,
  assertSeparateAdapterOutput,
  prepareAdapterOutput,
} from '../scripts/stage-electrobun-adapter';
import { ELECTROBUN_PRODUCT_VERSION } from '../src/desktop-host';
import { runRpgMakerSidecar } from '../src/electrobun-sidecar';
import { acquireHarnessLock } from '../src/lock';

describe('Electrobun RPG Maker adapter', () => {
  test('delegates product launch and returns the normal child event', async () => {
    const installationRoot = '/tmp/dsh-rpgmaker-adapter-installation';
    const programRoot = `${installationRoot}/program`;
    const env = {
      LOCALAPPDATA: '/tmp/dsh-rpgmaker-localappdata',
      DSH_RPGMAKER_INSTALLATION_ROOT: installationRoot,
      DSH_RPGMAKER_DATA_ROOT: '/tmp/dsh-rpgmaker-adapter-data',
      DSH_HOME: '/tmp/dsh-rpgmaker-adapter-data/state',
      DSH_RPGMAKER_RUNTIME: `${programRoot}/runtime/dsh`,
    };
    const child = new EventEmitter() as EventEmitter & { exitCode: number | null; signalCode: string | null };
    child.exitCode = null;
    child.signalCode = null;
    let launchOptions: Record<string, unknown> | undefined;
    let releaseCount = 0;

    const running = runRpgMakerSidecar(env, {
      platform: 'win32',
      entrypointPath: join(programRoot, 'desktop-host', 'Resources', 'app', 'payload', 'sidecar', 'dsh-rpgmaker-sidecar.js'),
      loadProductLauncher: async (actualProgramRoot) => {
        expect(actualProgramRoot).toBe(programRoot);
        return {
          launchRpgmakerProject: async (options) => {
            launchOptions = options;
            return {
              child,
              releaseSession: async () => { releaseCount += 1; },
            };
          },
        };
      },
      writeStartupDiagnostic: async () => undefined,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    child.exitCode = 23;
    child.emit('exit', 23);
    await expect(running).resolves.toBe(23);

    expect(releaseCount).toBe(1);
    expect(launchOptions).toMatchObject({
      platform: 'win32',
      env,
      installationRoot,
      localStateRoot: join(env.LOCALAPPDATA, 'BaiheStudio', 'DSH-RPGMaker-MV'),
      sourceRoot: join(programRoot, 'presets', 'rpgmaker'),
      openWebBrowser: false,
      bindWeb: true,
      webHost: '127.0.0.1',
      webPort: 3081,
    });
    // The product launcher turns this explicit sidecar setting into DSH's
    // `--no-open` argument; the native WebView remains the sole UI opener.
    expect(launchOptions?.openWebBrowser).toBe(false);
    expect(launchOptions).not.toHaveProperty('mutableRoot');
    expect(launchOptions).not.toHaveProperty('dshHome');
    expect(launchOptions?.runtimeDir).toBe(join(programRoot, 'runtime', 'dsh'));
    const openExistingSession = launchOptions?.openExistingSession as (() => Promise<unknown>) | undefined;
    expect(openExistingSession).toBeDefined();
    await expect(openExistingSession?.()).resolves.toBeUndefined();
  });

  test('returns immediately for an already-exited product child', async () => {
    const child = new EventEmitter() as EventEmitter & {
      exitCode: number | null;
      signalCode: string | null;
    };
    child.exitCode = 7;
    child.signalCode = null;
    let releaseCount = 0;

    const running = runRpgMakerSidecar({ DSH_RPGMAKER_INSTALLATION_ROOT: '/tmp/already-exited-installation' }, {
      platform: 'win32',
      entrypointPath: join('/tmp/already-exited-installation', 'program', 'desktop-host', 'Resources', 'app', 'payload', 'sidecar', 'dsh-rpgmaker-sidecar.js'),
      loadProductLauncher: async () => ({
        launchRpgmakerProject: async () => ({
          child,
          releaseSession: async () => { releaseCount += 1; },
        }),
      }),
      writeStartupDiagnostic: async () => undefined,
    });
    const result = await Promise.race([
      running,
      new Promise<number>((resolve) => setTimeout(() => resolve(-1), 100)),
    ]);
    expect(result).toBe(7);
    expect(releaseCount).toBe(1);
  });

  test('catches a child that exits while listeners are being registered', async () => {
    const child = new EventEmitter() as EventEmitter & { exitCode: number | null; signalCode: string | null };
    child.exitCode = null;
    child.signalCode = null;
    const once = child.once.bind(child);
    child.once = ((event: string, listener: (...args: unknown[]) => void) => {
      const registered = once(event, listener);
      if (event === 'error') child.exitCode = 11;
      return registered;
    }) as typeof child.once;

    const running = runRpgMakerSidecar({ DSH_RPGMAKER_INSTALLATION_ROOT: '/tmp/race-installation' }, {
      platform: 'win32',
      entrypointPath: join('/tmp/race-installation', 'program', 'desktop-host', 'Resources', 'app', 'payload', 'sidecar', 'dsh-rpgmaker-sidecar.js'),
      loadProductLauncher: async () => ({
        launchRpgmakerProject: async () => ({
          child,
          releaseSession: async () => undefined,
        }),
      }),
      writeStartupDiagnostic: async () => undefined,
    });
    const result = await Promise.race([
      running,
      new Promise<number>((resolve) => setTimeout(() => resolve(-1), 100)),
    ]);
    expect(result).toBe(11);
  });

  test('rejects non-Windows before loading the installed product', async () => {
    let loaded = false;
    await expect(runRpgMakerSidecar({}, {
      platform: 'linux',
      loadProductLauncher: async () => {
        loaded = true;
        throw new Error('must not load');
      },
    })).rejects.toThrow(/Windows only/i);
    expect(loaded).toBe(false);
  });

  test('keeps the product manifest on the generic host contract', () => {
    expect(ELECTROBUN_PRODUCT_MANIFEST).toMatchObject({
      app: {
        name: 'RPG Maker Agent',
        identifier: 'dev.baihestudio.dsh-rpgmaker-mv',
        version: ELECTROBUN_PRODUCT_VERSION,
      },
      bun: { version: ELECTROBUN_BUN_VERSION, packageId: 'Oven-sh.Bun' },
      sidecar: { entrypoint: ELECTROBUN_SIDECAR, args: [] },
      readiness: { url: 'http://127.0.0.1:3081/' },
      navigation: { url: 'http://127.0.0.1:3081/' },
      supervisor: { executable: ELECTROBUN_SUPERVISOR },
    });
  });

  test('refuses generated output nested in either source checkout', () => {
    const root = '/tmp/dsh-rpgmaker-adapter-test';
    const productRoot = join(root, 'product');
    const hostRoot = join(root, 'host');

    expect(() => assertSeparateAdapterOutput(productRoot, hostRoot, join(root, 'generated'))).not.toThrow();
    expect(() => assertSeparateAdapterOutput(productRoot, hostRoot, join(productRoot, 'generated'))).toThrow(/separate/i);
    expect(() => assertSeparateAdapterOutput(productRoot, hostRoot, join(hostRoot, 'generated'))).toThrow(/separate/i);
    expect(() => assertSeparateAdapterOutput(productRoot, hostRoot, productRoot)).toThrow(/separate/i);
  });

  test('replaces only output directories previously created by the adapter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-electrobun-output-marker-'));
    const outputRoot = join(root, 'output');
    try {
      await mkdir(outputRoot);
      const userFile = join(outputRoot, 'keep.txt');
      await writeFile(userFile, 'user-owned\n');
      await expect(prepareAdapterOutput(outputRoot, true)).rejects.toThrow(/not created by this adapter/i);
      expect(await Bun.file(userFile).text()).toBe('user-owned\n');

      await rm(outputRoot, { recursive: true });
      await prepareAdapterOutput(outputRoot);
      expect(await Bun.file(join(outputRoot, ELECTROBUN_OUTPUT_MARKER)).text()).toBe('dsh-electronbun-adapter-v1\n');
      const generatedFile = join(outputRoot, 'generated.txt');
      await writeFile(generatedFile, 'replaceable\n');

      await prepareAdapterOutput(outputRoot, true);
      expect(await Bun.file(generatedFile).exists()).toBe(false);
      expect(await Bun.file(join(outputRoot, ELECTROBUN_OUTPUT_MARKER)).exists()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('reclaims a dead-owner lock left by Job termination', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-electrobun-stale-lock-'));
    const lockPath = join(root, 'runtime.lock');
    try {
      await mkdir(lockPath);
      await writeFile(join(lockPath, 'owner.json'), JSON.stringify({ pid: 2_147_483_647, token: 'dead' }));
      const lock = await acquireHarnessLock(lockPath, { timeoutMs: 1_000, retryMs: 5 });
      expect(lock.path).toBe(lockPath);
      await lock.release();
      expect(await Bun.file(join(lockPath, 'owner.json')).exists()).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
