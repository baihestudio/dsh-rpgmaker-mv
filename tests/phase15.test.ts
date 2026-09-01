import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  DESKTOP_HOST_MANIFEST_NAME,
  DESKTOP_HOST_PROVENANCE_SCHEMA_VERSION,
  DESKTOP_HOST_SIDECAR_RELATIVE,
  DESKTOP_HOST_SUPERVISOR_RELATIVE,
  ELECTROBUN_BUN_VERSION,
  ELECTROBUN_HOST_COMMIT,
  ELECTROBUN_PRODUCT_IDENTIFIER,
  ELECTROBUN_PRODUCT_VERSION,
  verifyDesktopHostPayload,
} from '../src/desktop-host';
import {
  INSTALL_RUN_STARTED_EVENT,
  createInstallRunEvidence,
} from '../src/install-evidence';
import { computeSidecarProvenance } from '../scripts/stage-electrobun-adapter';
import { runRpgMakerSidecar, SIDECAR_STARTUP_FAILURE_EVENT } from '../src/electrobun-sidecar';
import { PRODUCT_NAME, PROGRAM_OWNER } from '../src/config';

async function temporary(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function childWithExit(code: number): EventEmitter & { exitCode: number | null; signalCode: string | null } {
  const child = new EventEmitter() as EventEmitter & { exitCode: number | null; signalCode: string | null };
  child.exitCode = null;
  child.signalCode = null;
  queueMicrotask(() => {
    child.exitCode = code;
    child.emit('exit', code);
  });
  return child;
}

describe('windows install recovery contracts', () => {
  test('writes a useful redacted run header before evidence phases begin', async () => {
    const root = await temporary('phase15-evidence-header');
    try {
      const secret = 'phase15-header-secret';
      const evidence = createInstallRunEvidence({
        localStateRoot: root,
        installationRoot: join(root, 'selected-root'),
        operation: 'install',
        renderer: 'plain',
        productVersion: '0.1.0',
        runtimeVersion: '0.1.1-rc.2',
        runId: 'phase15-run',
        now: () => new Date('2026-09-01T00:00:00.000Z'),
        env: { DEEPSEEK_API_KEY: secret },
      });

      await evidence.start();
      const firstLine = (await readFile(evidence.logPath, 'utf8')).trim();
      const header = JSON.parse(firstLine) as Record<string, unknown>;
      expect(header).toMatchObject({
        event: INSTALL_RUN_STARTED_EVENT,
        runId: 'phase15-run',
        operation: 'install',
        installationRoot: join(root, 'selected-root'),
        localStateRoot: root,
      });
      expect(firstLine).not.toContain(secret);
      expect(firstLine.length).toBeGreaterThan(0);

      await evidence.finish('failed', { error: `DEEPSEEK_API_KEY=${secret}` });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('derives a non-default program root from the packaged sidecar location', async () => {
    const root = await temporary('phase15-sidecar-location');
    try {
      const programRoot = join(root, 'chosen', 'program');
      const entrypoint = join(programRoot, 'desktop-host', 'Resources', 'app', 'payload', 'sidecar', 'dsh-rpgmaker-sidecar.js');
      let loadedRoot = '';
      const running = runRpgMakerSidecar({
        DSH_RPGMAKER_INSTALLATION_ROOT: join(root, 'legacy-root-that-must-be-ignored'),
        LOCALAPPDATA: join(root, 'wrong-local-app-data'),
      }, {
        platform: 'win32',
        entrypointPath: entrypoint,
        loadProductLauncher: async (actualRoot) => {
          loadedRoot = actualRoot;
          return {
            launchRpgmakerProject: async () => ({
              child: childWithExit(0),
              releaseSession: async () => undefined,
            }),
          };
        },
      });

      await expect(running).resolves.toBe(0);
      expect(loadedRoot).toBe(programRoot);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('records a bounded redacted startup failure and preserves it when log writing fails', async () => {
    const root = await temporary('phase15-sidecar-diagnostic');
    try {
      const entrypoint = join(root, 'program', 'desktop-host', 'Resources', 'app', 'payload', 'sidecar', 'dsh-rpgmaker-sidecar.js');
      const localStateRoot = join(root, 'local-state');
      const secret = 'phase15-sidecar-secret';
      const bearer = 'phase15-bearer-secret';
      const basic = 'phase15-basic-secret';
      const original = new Error(`startup failed DEEPSEEK_API_KEY=${secret}; token=${secret}; Authorization: Bearer ${bearer}; authorization: Basic ${basic}; ${'x'.repeat(3000)}`);
      await expect(runRpgMakerSidecar({}, {
        platform: 'win32',
        entrypointPath: entrypoint,
        localStateRoot,
        now: () => new Date('2026-09-01T00:00:00.000Z'),
        loadProductLauncher: async () => { throw original; },
      })).rejects.toBe(original);

      const line = (await readFile(join(localStateRoot, 'logs', 'launcher.log'), 'utf8')).trim();
      const diagnostic = JSON.parse(line) as { at: string; event: string; operation: string; category: string; summary: string; modulePath?: string };
      expect(diagnostic).toMatchObject({
        at: '2026-09-01T00:00:00.000Z',
        event: SIDECAR_STARTUP_FAILURE_EVENT,
        operation: 'load-installed-launcher',
        category: 'installed-launcher-load-failed',
        summary: 'Installed product launcher could not be loaded.',
        modulePath: join(root, 'program', 'src', 'rpgmaker.ts'),
      });
      expect(line).not.toContain(secret);
      expect(line).not.toContain(bearer);
      expect(line).not.toContain(basic);
      expect(diagnostic.summary.length).toBeLessThanOrEqual(2_000);

      const writeFailure = new Error('the original startup failure');
      await expect(runRpgMakerSidecar({}, {
        platform: 'win32',
        entrypointPath: entrypoint,
        localStateRoot: join(root, 'unwritable-seam'),
        loadProductLauncher: async () => { throw writeFailure; },
        writeStartupDiagnostic: async () => { throw new Error('disk full'); },
      })).rejects.toBe(writeFailure);

      const childFailureState = join(root, 'child-failure-state');
      await expect(runRpgMakerSidecar({}, {
        platform: 'win32',
        entrypointPath: entrypoint,
        localStateRoot: childFailureState,
        loadProductLauncher: async () => ({
          launchRpgmakerProject: async () => ({ child: childWithExit(9), releaseSession: async () => undefined }),
        }),
      })).resolves.toBe(9);
      const childDiagnostic = JSON.parse(await readFile(join(childFailureState, 'logs', 'launcher.log'), 'utf8')) as { operation: string; category: string; summary: string; exitCode?: number };
      expect(childDiagnostic).toMatchObject({
        operation: 'wait-for-child',
        category: 'product-child-exited',
        summary: 'Product launcher child exited with code 9.',
        exitCode: 9,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('records only a structured summary for product-launch errors', async () => {
    const root = await temporary('phase15-sidecar-structured-diagnostic');
    try {
      const entrypoint = join(root, 'program', 'desktop-host', 'Resources', 'app', 'payload', 'sidecar', 'dsh-rpgmaker-sidecar.js');
      const localStateRoot = join(root, 'local-state');
      const rawChildOutput = 'phase15-raw-child-output-marker-7f4d';
      const original = new Error(`product launch failed: ${rawChildOutput}`);
      await expect(runRpgMakerSidecar({}, {
        platform: 'win32',
        entrypointPath: entrypoint,
        localStateRoot,
        loadProductLauncher: async () => ({
          launchRpgmakerProject: async () => { throw original; },
        }),
      })).rejects.toBe(original);

      const log = await readFile(join(localStateRoot, 'logs', 'launcher.log'), 'utf8');
      const diagnostic = JSON.parse(log) as { operation: string; category: string; summary: string };
      expect(diagnostic).toMatchObject({
        operation: 'launch-product',
        category: 'product-launch-failed',
        summary: 'Product launcher failed before readiness.',
      });
      expect(log).not.toContain(rawChildOutput);
      expect(log).not.toContain(original.message);
      expect(diagnostic.summary.length).toBeLessThanOrEqual(2_000);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('keeps the expected installed launcher path in a missing-launcher summary', async () => {
    const root = await temporary('phase15-sidecar-missing-launcher');
    try {
      const programRoot = join(root, 'program');
      const entrypoint = join(programRoot, 'desktop-host', 'Resources', 'app', 'payload', 'sidecar', 'dsh-rpgmaker-sidecar.js');
      const localStateRoot = join(root, 'local-state');
      const modulePath = join(programRoot, 'src', 'rpgmaker.ts');
      await expect(runRpgMakerSidecar({}, {
        platform: 'win32',
        entrypointPath: entrypoint,
        localStateRoot,
      })).rejects.toThrow(/missing/i);

      const log = await readFile(join(localStateRoot, 'logs', 'launcher.log'), 'utf8');
      const diagnostic = JSON.parse(log) as { operation: string; category: string; summary: string; modulePath?: string };
      expect(diagnostic).toMatchObject({
        operation: 'load-installed-launcher',
        category: 'installed-launcher-missing',
        modulePath,
      });
      expect(diagnostic.summary).toContain(modulePath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('staging computes canonical source and bundled-sidecar digests from disposable files', async () => {
    const root = await temporary('phase15-staging-provenance');
    try {
      const source = join(root, 'src', 'electrobun-sidecar.ts');
      const sidecar = join(root, 'payload', 'dsh-rpgmaker-sidecar.js');
      await mkdir(dirname(source), { recursive: true });
      await mkdir(dirname(sidecar), { recursive: true });
      const sourceText = 'export const adapter = true;\n';
      const sidecarText = 'console.log("sidecar");\n';
      await writeFile(source, sourceText);
      await writeFile(sidecar, sidecarText);

      const provenance = await computeSidecarProvenance(source, sidecar);
      expect(provenance).toEqual({
        schemaVersion: DESKTOP_HOST_PROVENANCE_SCHEMA_VERSION,
        adapterSourceSha256: sha256(sourceText),
        sidecarSha256: sha256(sidecarText),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('accepts coherent host provenance and rejects source or sidecar drift', async () => {
    const root = await temporary('phase15-host-provenance');
    try {
      const payload = join(root, 'host');
      const source = join(root, 'src', 'electrobun-sidecar.ts');
      const sidecar = join(payload, DESKTOP_HOST_SIDECAR_RELATIVE);
      const supervisor = join(payload, DESKTOP_HOST_SUPERVISOR_RELATIVE);
      const launchTarget = join(payload, 'app', 'RPG Maker Agent.exe');
      await mkdir(dirname(sidecar), { recursive: true });
      await mkdir(dirname(supervisor), { recursive: true });
      await mkdir(dirname(launchTarget), { recursive: true });
      await mkdir(dirname(source), { recursive: true });
      const sourceText = 'export const sidecar = true;\n';
      const sidecarText = 'bundled sidecar\n';
      await writeFile(source, sourceText);
      await writeFile(sidecar, sidecarText);
      await writeFile(supervisor, 'supervisor\n');
      await writeFile(launchTarget, 'native host\n');
      const provenance = {
        schemaVersion: DESKTOP_HOST_PROVENANCE_SCHEMA_VERSION,
        adapterSourceSha256: sha256(sourceText),
        sidecarSha256: sha256(sidecarText),
      };
      await writeFile(join(payload, DESKTOP_HOST_MANIFEST_NAME), JSON.stringify({
        format: 1,
        owner: PROGRAM_OWNER,
        product: PRODUCT_NAME,
        hostCommit: ELECTROBUN_HOST_COMMIT,
        bunVersion: ELECTROBUN_BUN_VERSION,
        productVersion: ELECTROBUN_PRODUCT_VERSION,
        app: { identifier: ELECTROBUN_PRODUCT_IDENTIFIER },
        launchTarget: 'app/RPG Maker Agent.exe',
        sidecarEntrypoint: DESKTOP_HOST_SIDECAR_RELATIVE,
        supervisorExecutable: DESKTOP_HOST_SUPERVISOR_RELATIVE,
        sidecarProvenance: provenance,
      }));

      const coherent = await verifyDesktopHostPayload(payload, { adapterSourcePath: source });
      expect(coherent.valid).toBe(true);
      expect(coherent.adapterSourceSha256).toBe(provenance.adapterSourceSha256);
      expect(coherent.sidecarSha256).toBe(provenance.sidecarSha256);

      const manifestPath = join(payload, DESKTOP_HOST_MANIFEST_NAME);
      const baselineManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
      const malformedCases: Array<[string, unknown, RegExp]> = [
        ['extra field', { ...provenance, extra: true }, /unsupported fields/i],
        ['wrong schema', { ...provenance, schemaVersion: 2 }, /schemaVersion/i],
        ['missing digest', { ...provenance, sidecarSha256: undefined }, /sidecarSha256/i],
        ['primitive', 'not-an-object', /must be an object/i],
      ];
      for (const [, value, pattern] of malformedCases) {
        await writeFile(manifestPath, JSON.stringify({ ...baselineManifest, sidecarProvenance: value }));
        const malformed = await verifyDesktopHostPayload(payload, { adapterSourcePath: source });
        expect(malformed.valid).toBe(false);
        expect(malformed.errors.join(' ')).toMatch(pattern);
      }
      await writeFile(manifestPath, JSON.stringify({ ...baselineManifest, sidecarProvenance: undefined, provenance }));
      const aliased = await verifyDesktopHostPayload(payload, { adapterSourcePath: source });
      expect(aliased.valid).toBe(false);
      expect(aliased.errors.join(' ')).toMatch(/provenance is missing/i);
      await writeFile(manifestPath, JSON.stringify(baselineManifest));

      await writeFile(source, 'export const sidecar = false;\n');
      const staleSource = await verifyDesktopHostPayload(payload, { adapterSourcePath: source });
      expect(staleSource.valid).toBe(false);
      expect(staleSource.errors.join(' ')).toMatch(/adapterSourceSha256.*current adapter source/i);

      await writeFile(source, sourceText);
      await writeFile(sidecar, 'tampered sidecar\n');
      const tamperedSidecar = await verifyDesktopHostPayload(payload, { adapterSourcePath: source });
      expect(tamperedSidecar.valid).toBe(false);
      expect(tamperedSidecar.errors.join(' ')).toMatch(/sidecarSha256.*packaged sidecar/i);

      const missing = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
      delete missing.sidecarProvenance;
      await writeFile(manifestPath, JSON.stringify(missing));
      const preProvenance = await verifyDesktopHostPayload(payload, { adapterSourcePath: source });
      expect(preProvenance.valid).toBe(false);
      expect(preProvenance.errors.join(' ')).toMatch(/provenance is missing/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

});
