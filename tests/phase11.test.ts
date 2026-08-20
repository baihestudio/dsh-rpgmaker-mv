import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  imageCommandStage,
  imageDiagnosticContextFromEnvironment,
  runImageDiagnosticStage,
  withImageDiagnostics,
  writeImageDiagnostic
} from '../src/image-diagnostics';
import {
  IMAGE_OPERATION_CLEANUP_GRACE_MS,
  clearChildSpawner,
  clearCleanupTimerScheduler,
  clearTerminationCommandSpawner,
  clearTreeTerminator,
  clearWorkshopRunner,
  invokeImageOperation,
  setChildSpawner,
  setCleanupTimerScheduler,
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
        DSH_IMAGE_WORKSHOP_OPERATION_ID: '00000000-0000-4000-8000-000000000002',
        DSH_IMAGE_WORKSHOP_TOOL_NAME: 'caller-tool-token',
        DSH_IMAGE_WORKSHOP_OPERATION: 'caller-operation-token',
        DSH_IMAGE_WORKSHOP_INPUT_LABELS: JSON.stringify(['/absolute/source.png', 'sprites/hero.png']),
        DSH_IMAGE_WORKSHOP_OUTPUT_LABELS: JSON.stringify(['out.png', 'out.png.manifest.json']),
        DSH_IMAGE_WORKSHOP_OPTIONS: JSON.stringify({ width: 64, gravity: 'center', path: 'C:\\secret' }),
        DSH_IMAGE_WORKSHOP_LOG: logPath,
        DEEPSEEK_API_KEY: secret
      }, { operation: 'trim-pad' });
      const invalidContext = imageDiagnosticContextFromEnvironment({
        DSH_IMAGE_WORKSHOP_OPERATION_ID: 'caller-operation-token',
        DSH_IMAGE_WORKSHOP_TOOL_NAME: 'caller-tool-token',
        DSH_IMAGE_WORKSHOP_OPERATION: 'caller-operation-token'
      }, { operation: 'inspect' });
      expect(invalidContext.operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(invalidContext.operationId).not.toBe('caller-operation-token');
      expect(invalidContext.toolName).toBe('image_inspect');
      expect(invalidContext.operation).toBe('inspect');

      const runner = withImageDiagnostics(async () => ({
        exitCode: 1,
        stdout: `${secret} ${'raw stdout command token '.repeat(1000)}`,
        stderr: `${secret} ${'raw stderr image bytes '.repeat(1000)}`
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
      expect(records[0]).toMatchObject({ event: 'start', operationId: '00000000-0000-4000-8000-000000000002', operation: 'trim-pad', toolName: 'image_trim_pad', stage: 'pixel-dimension-probe', executable: 'magick.exe' });
      expect(records[0].inputs).toEqual(['sprites/hero.png']);
      expect(records[0].expectedPaths).toEqual(['out.png', 'out.png.manifest.json']);
      expect(records[0].options).toEqual({ width: 64, gravity: 'center' });
      expect(records[1]).toMatchObject({ event: 'terminal', outcome: 'failed', errorCode: 'CHILD_EXIT_NONZERO', elapsedMs: expect.any(Number) });
      expect(records[1].error).toBeUndefined();
      expect(JSON.stringify(records)).not.toContain(secret);
      expect(JSON.stringify(records)).not.toContain('raw stdout command token');
      expect(JSON.stringify(records)).not.toContain('raw stderr image bytes');
      expect(JSON.stringify(records)).not.toContain('C:\\tools');
      expect(JSON.stringify(records)).not.toContain('RGBA:');
      expect(JSON.stringify(records)).not.toContain('caller-tool-token');
      expect(JSON.stringify(records)).not.toContain('caller-operation-token');

      const unmatched = imageDiagnosticContextFromEnvironment({ DSH_IMAGE_WORKSHOP_OPERATION_ID: '00000000-0000-4000-8000-000000000003', DSH_IMAGE_WORKSHOP_LOG: logPath });
      await writeImageDiagnostic(unmatched, {
        event: 'start',
        stage: 'metadata-inspection',
        executable: 'magick.exe',
        startedAt: new Date().toISOString()
      });
      const restarted = await readJsonLines(logPath);
      expect(restarted.at(-1)).toMatchObject({ event: 'start', operationId: '00000000-0000-4000-8000-000000000003', stage: 'metadata-inspection', executable: 'magick.exe' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('correlates plugin and CLI diagnostics across a real child process', async () => {
    const root = await temp('image-plugin-cli-correlation');
    try {
      clearWorkshopRunner();
      clearChildSpawner();
      const logPath = join(root, 'logs', 'image-workshop.jsonl');
      const cliPath = join(root, 'test-owned-image-cli.mjs');
      const diagnosticsModule = new URL('../bundle/dsh-image-workshop/lib/diagnostics.js', import.meta.url).href;
      await writeFile(cliPath, [
        `const { appendImageDiagnostic, createImageDiagnosticContext, diagnosticEntry } = await import(${JSON.stringify(diagnosticsModule)});`,
        "const context = createImageDiagnosticContext(process.argv[3] ?? 'inspect', process.env);",
        "await appendImageDiagnostic(context, diagnosticEntry(context, 'start', 'toolchain-version-check', 'test-owned-cli'));",
        "await appendImageDiagnostic(context, diagnosticEntry(context, 'terminal', 'toolchain-version-check', 'test-owned-cli', { outcome: 'completed' }));",
        "console.log(JSON.stringify({ path: 'sprites/hero.png', width: 1, height: 1, format: 'PNG', channels: 'srgba', hasAlpha: true, opaque: false, bytes: 1, sha256: 'x' }));",
        ''
      ].join('\n'));
      const inheritedOperationId = '00000000-0000-4000-8000-000000000004';
      const maliciousTool = 'caller-tool-token';
      const maliciousOperation = 'caller-operation-token';
      const env = {
        DSH_IMAGE_WORKSHOP_CLI: cliPath,
        BUN_EXECUTABLE: process.execPath,
        DSH_IMAGE_WORKSHOP_LOG: logPath,
        DSH_IMAGE_WORKSHOP_OPERATION_ID: inheritedOperationId,
        DSH_IMAGE_WORKSHOP_TOOL_NAME: maliciousTool,
        DSH_IMAGE_WORKSHOP_OPERATION: maliciousOperation
      };
      const result = await invokeImageOperation('inspect', ['--input', 'sprites/hero.png'], env, undefined, [], {
        toolName: 'image_inspect',
        inputLabels: ['sprites/hero.png']
      });
      expect(result).toMatchObject({ path: 'sprites/hero.png' });
      const records = await readJsonLines(logPath);
      const pluginRecords = records.filter((record) => record.stage === 'harness-cli-spawn');
      const cliRecords = records.filter((record) => record.stage === 'toolchain-version-check');
      expect(pluginRecords.length).toBeGreaterThanOrEqual(2);
      expect(cliRecords).toHaveLength(2);
      expect(cliRecords.every((record) => record.executable === 'unknown')).toBe(true);
      const operationIds = new Set([...pluginRecords, ...cliRecords].map((record) => record.operationId));
      expect(operationIds.size).toBe(1);
      expect(pluginRecords[0].operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(pluginRecords[0].operationId).not.toBe(inheritedOperationId);
      expect(pluginRecords[0].operationId).toBe(cliRecords[0].operationId);
      expect(records.every((record) => record.toolName === 'image_inspect')).toBe(true);
      expect(records.every((record) => record.operation === 'inspect')).toBe(true);
      expect(JSON.stringify(records)).not.toContain(maliciousTool);
      expect(JSON.stringify(records)).not.toContain(maliciousOperation);
    } finally {
      clearWorkshopRunner();
      clearChildSpawner();
      await rm(root, { recursive: true, force: true });
    }
  });

  test('keeps child output out of plugin errors and durable diagnostics', async () => {
    const root = await temp('image-plugin-child-output');
    try {
      clearWorkshopRunner();
      clearChildSpawner();
      const logPath = join(root, 'logs', 'image-workshop.jsonl');
      const cliPath = join(root, 'test-owned-failing-image-cli.mjs');
      const token = 'ghp_child-output-token-never-surfaces';
      const binaryText = String.fromCharCode(0, 1, 255, 80, 78, 71, 137, 0);
      const absolutePath = join(root, 'absolute-output.png');
      const commandText = 'magick --input /private/secret/source.png --output /private/secret/output.png';
      await writeFile(cliPath, [
        `process.stdout.write(${JSON.stringify(`${token} ${binaryText} ${absolutePath} ${commandText}`)});`,
        `process.stderr.write(${JSON.stringify(`${token} ${binaryText} ${absolutePath} ${commandText}`)});`,
        'process.exitCode = 23;',
        ''
      ].join('\n'));
      const error = await invokeImageOperation('inspect', ['--input', 'sprites/hero.png'], {
        DSH_IMAGE_WORKSHOP_CLI: cliPath,
        BUN_EXECUTABLE: process.execPath,
        DSH_IMAGE_WORKSHOP_LOG: logPath
      }).then(() => undefined, (failure) => failure as Error & { code?: string; info?: Record<string, unknown> });
      expect(error).toMatchObject({ code: 'CHILD_EXIT_NONZERO', info: { stage: 'harness-cli-spawn', exitCode: 23, executable: 'bun' } });
      expect(error?.message).not.toContain(token);
      expect(error?.message).not.toContain(binaryText);
      expect(error?.message).not.toContain(absolutePath);
      expect(error?.message).not.toContain(commandText);
      const records = await readJsonLines(logPath);
      expect(records.some((record) => record.event === 'terminal' && record.stage === 'harness-cli-spawn' && record.errorCode === 'CHILD_EXIT_NONZERO' && record.exitCode === 23)).toBe(true);
      expect(JSON.stringify(records)).not.toContain(token);
      expect(JSON.stringify(records)).not.toContain(binaryText);
      expect(JSON.stringify(records)).not.toContain(absolutePath);
      expect(JSON.stringify(records)).not.toContain(commandText);
    } finally {
      clearWorkshopRunner();
      clearChildSpawner();
      await rm(root, { recursive: true, force: true });
    }
  });

  test('allowlists executable names in JSONL and model errors', async () => {
    const root = await temp('image-executable-allowlist');
    try {
      setWorkshopRunner(async () => {
        throw new Error('caller-controlled child output must not surface');
      });
      const cases = [
        { value: 'constructor', safe: 'unknown' },
        { value: '__proto__', safe: 'unknown' },
        { value: 'prototype', safe: 'unknown' },
        { value: 'BUN_EXECUTABLE_ghp_injected-token', safe: 'unknown' },
        { value: join(root, 'ghp_injected-executable-token.bin'), safe: 'unknown' },
        { value: 'bun', safe: 'bun' },
        { value: 'C:\\owned\\bun.exe', safe: 'bun.exe' },
        { value: '/owned/node', safe: 'node' }
      ];
      for (const [index, executable] of cases.entries()) {
        const logPath = join(root, `logs-${index}`, 'image-workshop.jsonl');
        const error = await invokeImageOperation('inspect', ['--input', 'sprites/hero.png'], {
          DSH_IMAGE_WORKSHOP_CLI: 'test-owned-image-cli',
          BUN_EXECUTABLE: executable.value,
          DSH_IMAGE_WORKSHOP_LOG: logPath
        }).then(() => undefined, (failure) => failure as Error & { code?: string; info?: Record<string, unknown> });
        expect(error).toMatchObject({ code: 'COMMAND_FAILED', info: { executable: executable.safe } });
        expect(error?.message).toContain(`(${executable.safe}, unknown status)`);
        const records = await readJsonLines(logPath);
        expect(records.length).toBeGreaterThanOrEqual(2);
        expect(records.every((record) => record.executable === executable.safe)).toBe(true);
        if (executable.safe === 'unknown') {
          expect(JSON.stringify(records)).not.toContain(executable.value);
          expect(JSON.stringify(error)).not.toContain(executable.value);
        }
      }
    } finally {
      clearWorkshopRunner();
      await rm(root, { recursive: true, force: true });
    }
  });

  test('writes unknown for inherited executable-shaped names in source JSONL', async () => {
    const root = await temp('image-source-executable-allowlist');
    try {
      const logPath = join(root, 'logs', 'image-workshop.jsonl');
      const context = imageDiagnosticContextFromEnvironment({ DSH_IMAGE_WORKSHOP_LOG: logPath }, { operation: 'inspect' });
      const cases = [
        { value: 'constructor', safe: 'unknown' },
        { value: '__proto__', safe: 'unknown' },
        { value: 'prototype', safe: 'unknown' },
        { value: 'BUN_EXECUTABLE_ghp_source-token', safe: 'unknown' },
        { value: 'bun', safe: 'bun' },
        { value: 'C:\\owned\\bun.exe', safe: 'bun.exe' },
        { value: '/owned/node', safe: 'node' }
      ];
      for (const executable of cases) {
        await writeImageDiagnostic(context, { event: 'start', stage: 'harness-cli-spawn', executable: executable.value });
      }
      const records = await readJsonLines(logPath);
      expect(records.map((record) => record.executable)).toEqual(cases.map((executable) => executable.safe));
      expect(JSON.stringify(records)).not.toContain('BUN_EXECUTABLE_ghp_source-token');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('records truthful cancellation cleanup for native external stages and atlas helper', async () => {
    const root = await temp('image-stage-cancellation');
    try {
      const logPath = join(root, 'logs', 'image-workshop.jsonl');
      const context = imageDiagnosticContextFromEnvironment({
        DSH_IMAGE_WORKSHOP_OPERATION_ID: '00000000-0000-4000-8000-000000000005',
        DSH_IMAGE_WORKSHOP_LOG: logPath
      }, { operation: 'trim-pad' });
      const nativeController = new AbortController();
      nativeController.abort('manual cancellation');
      const nativeRunner = withImageDiagnostics(async () => ({ exitCode: 130, stdout: '', stderr: '' }), context, { nativeCommandRunner: true });
      await nativeRunner('C:\\tools\\magick.exe', ['-format', '%w %h', 'info:'], { signal: nativeController.signal });

      const uncertainController = new AbortController();
      uncertainController.abort('manual cancellation');
      const uncertainRunner = withImageDiagnostics(async () => {
        throw Object.assign(new Error('native cleanup was not confirmed'), { processTreeTerminated: false });
      }, context, { nativeCommandRunner: true });
      await expect(uncertainRunner('C:\\tools\\oxipng.exe', ['-o', '4'], { signal: uncertainController.signal })).rejects.toThrow('native cleanup was not confirmed');

      const atlasController = new AbortController();
      atlasController.abort('manual cancellation');
      const atlasContext = imageDiagnosticContextFromEnvironment({
        DSH_IMAGE_WORKSHOP_OPERATION_ID: '00000000-0000-4000-8000-000000000006',
        DSH_IMAGE_WORKSHOP_LOG: logPath
      }, { operation: 'atlas-pack' });
      await expect(runImageDiagnosticStage(atlasContext, 'atlas-helper', 'free-tex-packer-core', async () => {
        throw new Error('atlas child-like output must not be logged');
      }, atlasController.signal)).rejects.toThrow('atlas child-like output must not be logged');

      const records = await readJsonLines(logPath);
      expect(records).toContainEqual(expect.objectContaining({ stage: 'pixel-dimension-probe', event: 'terminal', outcome: 'cancelled', processCleanupConfirmed: true }));
      expect(records).toContainEqual(expect.objectContaining({ stage: 'oxipng', event: 'terminal', outcome: 'cancelled', processCleanupConfirmed: false }));
      expect(records).toContainEqual(expect.objectContaining({ stage: 'atlas-helper', event: 'terminal', outcome: 'cancelled', processCleanupConfirmed: true, errorCode: 'CANCELLED' }));
      expect(JSON.stringify(records)).not.toContain('native cleanup was not confirmed');
      expect(JSON.stringify(records)).not.toContain('atlas child-like output must not be logged');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('records confirmed cleanup for pre-aborted and injected cancellations', async () => {
    const root = await temp('image-cancellation-diagnostics');
    try {
      const logPath = join(root, 'logs', 'image-workshop.jsonl');
      const env = { DSH_IMAGE_WORKSHOP_CLI: 'test-owned-image-cli', BUN_EXECUTABLE: 'bun', DSH_IMAGE_WORKSHOP_LOG: logPath };
      const preAborted = new AbortController();
      preAborted.abort(new Error('TOOL_TIMEOUT'));
      await expect(invokeImageOperation('inspect', ['--input', 'sprites/hero.png'], env, preAborted.signal)).rejects.toMatchObject({ code: 'cancelled' });

      const injected = new AbortController();
      clearWorkshopRunner();
      setWorkshopRunner(() => new Promise<string>(() => undefined));
      const pending = invokeImageOperation('inspect', ['--input', 'sprites/hero.png'], env, injected.signal);
      injected.abort('manual cancellation');
      await expect(pending).rejects.toMatchObject({ code: 'cancelled' });

      const records = await readJsonLines(logPath);
      const terminals = records.filter((record) => record.event === 'terminal' && record.stage === 'harness-cli-spawn');
      expect(terminals).toHaveLength(2);
      expect(terminals.every((record) => record.outcome === 'cancelled' || record.outcome === 'timed-out')).toBe(true);
      expect(terminals.every((record) => record.processCleanupConfirmed === true)).toBe(true);
    } finally {
      clearWorkshopRunner();
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
      clearCleanupTimerScheduler();
      clearTerminationCommandSpawner();
      setChildSpawner(spawner);
      setTreeTerminator(() => new Promise<void>(() => undefined));
      setCleanupTimerScheduler((callback, delayMs) => {
        expect(delayMs).toBe(IMAGE_OPERATION_CLEANUP_GRACE_MS);
        return setTimeout(callback, 0);
      });
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
      const settled = await pending.then(() => undefined, (error) => error);
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
      clearCleanupTimerScheduler();
      clearTerminationCommandSpawner();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      await rm(root, { recursive: true, force: true });
    }
  }, IMAGE_OPERATION_CLEANUP_GRACE_MS);

  test('does not confirm a POSIX tree when the leader exits and a descendant ignores TERM', async () => {
    if (process.platform === 'win32') return
    const root = await temp('image-posix-descendant')
    let descendantPid: number | undefined
    try {
      const logPath = join(root, 'logs', 'image-workshop.jsonl')
      const leaderMarker = join(root, 'leader-exited')
      const readyMarker = join(root, 'descendant-ready')
      const termMarker = join(root, 'descendant-term-seen')
      const descendantScript = join(root, 'ignore-term-descendant.mjs')
      const cliPath = join(root, 'leader-exits-image-cli.mjs')
      await writeFile(descendantScript, [
        "import { writeFileSync } from 'node:fs';",
        "process.on('SIGTERM', () => { try { writeFileSync(process.env.TERM_MARKER, 'term'); } catch {} });",
        "writeFileSync(process.env.READY_MARKER, 'ready');",
        'setInterval(() => {}, 1000);',
        ''
      ].join('\n'))
      await writeFile(cliPath, [
        "import { readFile, writeFile } from 'node:fs/promises';",
        "import { spawn } from 'node:child_process';",
        "process.on('SIGTERM', () => process.exit(0));",
        "const descendant = spawn(process.execPath, [process.env.DESCENDANT_SCRIPT], { env: process.env, stdio: ['ignore', 'inherit', 'inherit'] });",
        'let ready = false;',
        'for (let attempt = 0; attempt < 200; attempt += 1) {',
        "  try { await readFile(process.env.READY_MARKER); ready = true; break; } catch { await new Promise((resolve) => setTimeout(resolve, 5)); }",
        '}',
        "if (!ready) process.exit(23);",
        "await writeFile(process.env.LEADER_MARKER, String(descendant.pid));",
        'await new Promise(() => {});',
        ''
      ].join('\n'))

      clearWorkshopRunner()
      clearChildSpawner()
      clearTreeTerminator()
      const controller = new AbortController()
      let settled = false
      const env = {
        ...process.env,
        DSH_IMAGE_WORKSHOP_CLI: cliPath,
        BUN_EXECUTABLE: process.execPath,
        DSH_IMAGE_WORKSHOP_LOG: logPath,
        DESCENDANT_SCRIPT: descendantScript,
        LEADER_MARKER: leaderMarker,
        READY_MARKER: readyMarker,
        TERM_MARKER: termMarker
      }
      const pending = invokeImageOperation('inspect', ['--input', 'sprites/hero.png'], env, controller.signal)
      void pending.then(() => { settled = true }, () => { settled = true })
      await waitForFile(leaderMarker)
      descendantPid = Number(await readFile(leaderMarker, 'utf8'))
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25))
      controller.abort('manual cancellation')
      await waitForFile(termMarker)
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
      expect(settled).toBe(false)
      const failure = await pending.then(() => undefined, (error) => error as Error & { code?: string; info?: Record<string, unknown> })
      expect(failure).toMatchObject({ code: 'cancelled', info: { processCleanupConfirmed: true } })

      let gone = false
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
          process.kill(descendantPid, 0)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
            gone = true
            break
          }
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10))
      }
      expect(gone).toBe(true)
      const records = await readJsonLines(logPath)
      expect(records.some((record) => record.stage === 'harness-cli-spawn' && record.event === 'terminal' && record.processCleanupConfirmed === true)).toBe(true)
    } finally {
      if (descendantPid !== undefined) {
        try { process.kill(descendantPid, 'SIGKILL') } catch { /* already gone */ }
      }
      clearWorkshopRunner()
      clearChildSpawner()
      clearTreeTerminator()
      clearCleanupTimerScheduler()
      await rm(root, { recursive: true, force: true })
    }
  }, IMAGE_OPERATION_CLEANUP_GRACE_MS + 5000)
});
