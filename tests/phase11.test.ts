import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  imageCommandStage,
  imageDiagnosticContextFromEnvironment,
  withImageDiagnostics,
  writeImageDiagnostic
} from '../src/image-diagnostics';
import {
  IMAGE_OPERATION_CLEANUP_GRACE_MS,
  clearChildSpawner,
  clearTerminationCommandSpawner,
  clearTreeTerminator,
  clearWorkshopRunner,
  invokeImageOperation,
  setChildSpawner,
  setTreeTerminator,
  setWorkshopRunner
} from '../bundle/dsh-image-workshop/lib/workshop-client.js';

async function temp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

async function readJsonLines(path: string): Promise<Array<Record<string, unknown>>> {
  const content = await readFile(path, 'utf8');
  return content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await readFile(path);
      return;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

describe('image diagnostics', () => {
  test('records named external stages with bounded safe fields and leaves starts durable', async () => {
    const root = await temp('image-diagnostics');
    try {
      const logPath = join(root, 'logs', 'image-workshop.jsonl');
      const secret = 'diagnostic-secret-never-written';
      const context = imageDiagnosticContextFromEnvironment({
        DSH_IMAGE_WORKSHOP_OPERATION_ID: 'ticket02-operation',
        DSH_IMAGE_WORKSHOP_TOOL_NAME: 'image_trim_pad',
        DSH_IMAGE_WORKSHOP_INPUT_LABELS: JSON.stringify(['/absolute/source.png', 'sprites/hero.png']),
        DSH_IMAGE_WORKSHOP_OUTPUT_LABELS: JSON.stringify(['out.png', 'out.png.manifest.json']),
        DSH_IMAGE_WORKSHOP_OPTIONS: JSON.stringify({ width: 64, gravity: 'center', path: 'C:\\secret' }),
        DSH_IMAGE_WORKSHOP_LOG: logPath,
        DEEPSEEK_API_KEY: secret
      });
      const runner = withImageDiagnostics(async () => ({
        exitCode: 1,
        stdout: '',
        stderr: `${secret} ${'unbounded-looking diagnostic output '.repeat(1000)}`
      }), context);

      expect(imageCommandStage('magick.exe', ['--version'])).toBe('toolchain-version-check');
      expect(imageCommandStage('magick.exe', ['-format', '%w|%h|%m', 'info:'])).toBe('metadata-inspection');
      expect(imageCommandStage('magick.exe', ['-format', '%w %h', 'info:'])).toBe('pixel-dimension-probe');
      expect(imageCommandStage('magick.exe', ['RGBA:C:/staging/rgba.bin'])).toBe('raw-pixel-extraction');
      expect(imageCommandStage('magick.exe', ['-sample', '64x64', 'out.png'])).toBe('transform-encode');
      expect(imageCommandStage('oxipng.exe', ['-o', '4'])).toBe('oxipng');

      await runner('C:\\tools\\magick.exe', ['-format', '%w %h', 'info:'], {});
      await waitForFile(logPath);
      const records = await readJsonLines(logPath);
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({ event: 'start', operationId: 'ticket02-operation', stage: 'pixel-dimension-probe', executable: 'magick.exe' });
      expect(records[0].inputs).toEqual(['sprites/hero.png']);
      expect(records[0].expectedPaths).toEqual(['out.png', 'out.png.manifest.json']);
      expect(records[0].options).toEqual({ width: 64, gravity: 'center' });
      expect(records[1]).toMatchObject({ event: 'terminal', outcome: 'failed', elapsedMs: expect.any(Number) });
      expect(String(records[1].error)).not.toContain(secret);
      expect(String(records[1].error).length).toBeLessThanOrEqual(512);
      expect(JSON.stringify(records)).not.toContain('C:\\tools');
      expect(JSON.stringify(records)).not.toContain('RGBA:');

      const unmatched = imageDiagnosticContextFromEnvironment({ DSH_IMAGE_WORKSHOP_OPERATION_ID: 'stalled-after-restart', DSH_IMAGE_WORKSHOP_LOG: logPath });
      await writeImageDiagnostic(unmatched, {
        event: 'start',
        stage: 'metadata-inspection',
        executable: 'magick.exe',
        startedAt: new Date().toISOString()
      });
      const restarted = await readJsonLines(logPath);
      expect(restarted.at(-1)).toMatchObject({ event: 'start', operationId: 'stalled-after-restart', stage: 'metadata-inspection', executable: 'magick.exe' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('keeps an HTTP sentinel responsive while a hung CLI is cancelled, then permits another plugin call', async () => {
    const root = await temp('image-plugin-sentinel');
    const server = createServer((_request, response) => {
      response.statusCode = 200;
      response.end('sentinel');
    });
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(0, '127.0.0.1', () => resolveListen());
    });
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const logPath = join(root, 'logs', 'image-workshop.jsonl');
    const child = new EventEmitter() as EventEmitter & {
      pid?: number;
      platform?: string;
      exitCode: number | null;
      signalCode: string | null;
      kill: (signal?: string) => boolean;
      stdout: PassThrough;
      stderr: PassThrough;
    };
    child.pid = 7722;
    child.platform = 'win32';
    child.exitCode = null;
    child.signalCode = null;
    child.kill = () => true;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const spawner = Object.assign(() => child, { platform: 'win32' });
    const controller = new AbortController();
    const env = {
      DSH_IMAGE_WORKSHOP_CLI: 'test-owned-hung-image-cli',
      BUN_EXECUTABLE: 'bun',
      DSH_IMAGE_WORKSHOP_LOG: logPath,
      DEEPSEEK_API_KEY: 'plugin-secret-never-written'
    };
    try {
      clearWorkshopRunner();
      clearTreeTerminator();
      clearTerminationCommandSpawner();
      setChildSpawner(spawner);
      setTreeTerminator(() => new Promise<void>(() => undefined));
      const pending = invokeImageOperation('trim-pad', ['--input', 'sprites/hero.png', '--output', 'out.png'], env, controller.signal, [{ path: join(root, 'out.png'), projectPath: 'out.png' }], {
        toolName: 'image_trim_pad',
        inputLabels: ['sprites/hero.png'],
        outputLabels: ['out.png', 'out.png.manifest.json'],
        options: { trim: true, width: 64, height: 64 }
      });
      await waitForFile(logPath);
      const response = await fetch(`http://127.0.0.1:${port}/sentinel`);
      expect(response.status).toBe(200);

      controller.abort(new Error('TOOL_TIMEOUT'));
      const settled = await Promise.race([
        pending.then(() => undefined, (error) => error),
        new Promise<Error>((_, reject) => setTimeout(() => reject(new Error('hung plugin call exceeded cleanup grace')), IMAGE_OPERATION_CLEANUP_GRACE_MS + 1000))
      ]);
      expect(settled).toMatchObject({ code: 'IMAGE_CANCELLATION_INCOMPLETE', info: { processCleanupConfirmed: false, expectedPaths: ['out.png'] } });

      const records = await readJsonLines(logPath);
      expect(records.some((record) => record.event === 'start' && record.stage === 'termination')).toBe(true);
      expect(records.some((record) => record.event === 'terminal' && record.stage === 'harness-cli-spawn' && record.processCleanupConfirmed === false)).toBe(true);
      expect(JSON.stringify(records)).not.toContain('plugin-secret-never-written');
      expect(JSON.stringify(records)).not.toContain(join(root, 'out.png'));
      const firstOperationId = records.find((record) => record.stage === 'harness-cli-spawn')?.operationId;
      expect(typeof firstOperationId).toBe('string');

      clearChildSpawner();
      clearTreeTerminator();
      let forwardedEnvironment: Record<string, string | undefined> | undefined;
      setWorkshopRunner(async (_bun, _args, operationEnvironment) => {
        forwardedEnvironment = operationEnvironment;
        return JSON.stringify({ path: 'sprites/hero.png', width: 1, height: 1, format: 'PNG', channels: 'srgba', hasAlpha: true, opaque: false, bytes: 1, sha256: 'x' });
      });
      const harmless = await invokeImageOperation('inspect', ['--input', 'sprites/hero.png'], env, undefined, [], { toolName: 'image_inspect', inputLabels: ['sprites/hero.png'] });
      expect(harmless).toMatchObject({ path: 'sprites/hero.png' });
      expect(forwardedEnvironment?.DSH_IMAGE_WORKSHOP_OPERATION_ID).toBeDefined();
      expect(imageDiagnosticContextFromEnvironment(forwardedEnvironment!).operationId).toBe(forwardedEnvironment!.DSH_IMAGE_WORKSHOP_OPERATION_ID!);
      const allRecords = await readJsonLines(logPath);
      expect(new Set(allRecords.map((record) => record.operationId)).size).toBeGreaterThanOrEqual(2);
      expect(allRecords.some((record) => record.operationId === firstOperationId)).toBe(true);
    } finally {
      clearWorkshopRunner();
      clearChildSpawner();
      clearTreeTerminator();
      clearTerminationCommandSpawner();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      await rm(root, { recursive: true, force: true });
    }
  }, IMAGE_OPERATION_CLEANUP_GRACE_MS + 3000);
});
