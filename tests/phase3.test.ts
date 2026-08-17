import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runPlaytestDebug, type PlaytestToolCaller } from '../src/playtest';
import { createPlaytestProcessController } from '../src/playtest-process';

async function projectFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'phase3-含 %! spaces-playtest-'));
  await mkdir(join(root, 'data'), { recursive: true });
  await mkdir(join(root, 'js'), { recursive: true });
  await writeFile(join(root, 'Game.rpgproject'), '{}\n');
  return root;
}

describe('playtest-debug process controller', () => {
  test('uses direct Windows taskkill and PowerShell process-tree argv', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    let powershellCalls = 0;
    const controller = createPlaytestProcessController({
      platform: 'win32',
      pwshExecutable: String.raw`C:\\含 %! spaces\\PowerShell\\pwsh.exe`,
      env: { SystemRoot: String.raw`C:\\Windows` },
      commandRunner: async (command, args) => {
        calls.push({ command, args });
        if (args.includes('-Command')) {
          powershellCalls += 1;
          return powershellCalls === 1 || powershellCalls === 3 ? { exitCode: 0, stdout: 'clean', stderr: '' } : { exitCode: 0, stdout: '9002\n9001\n', stderr: '' };
        }
        return { exitCode: 0, stdout: '', stderr: '' };
      }
    });
    expect(await controller.verify(4123)).toBe(true);
    await controller.terminate(4123);
    expect(calls[0].args).toContain('-Command');
    const taskkillCalls = calls.filter(({ command }) => command.includes('taskkill.exe'));
    expect(taskkillCalls[0].args).toEqual(['/PID', '4123', '/T', '/F']);
    expect(taskkillCalls[1].args).toEqual(['/PID', '9002', '/T', '/F']);
    expect(taskkillCalls[2].args).toEqual(['/PID', '9001', '/T', '/F']);
  });

  if (process.platform === 'win32') {
    test('terminates a disposable child tree from a CJK/%/!/spaces working path', async () => {
      const root = await mkdtemp(join(tmpdir(), 'phase3-含 %! spaces-tree-'));
      const childSource = "const { spawn } = require('node:child_process'); spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true }); setInterval(() => {}, 1000);";
      const processTree = spawn(process.execPath, ['-e', childSource], { cwd: root, stdio: 'ignore', windowsHide: true });
      const controller = createPlaytestProcessController();
      try {
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(processTree.pid).toBeDefined();
        expect(await controller.verify(processTree.pid!)).toBe(false);
        await controller.terminate(processTree.pid!);
        expect(await controller.verify(processTree.pid!)).toBe(true);
      } finally {
        if (processTree.pid !== undefined && processTree.exitCode === null) await controller.terminate(processTree.pid).catch(() => undefined);
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

describe('playtest-debug workflow', () => {

  test('stops before launch when static validation fails', async () => {
    const project = await projectFixture();
    try {
      const calls: string[] = [];
      const report = await runPlaytestDebug({
        projectPath: project,
        callTool: async (tool) => {
          calls.push(tool);
          return { ok: false, errors: ['MapInfos.json is missing'] };
        }
      });
      expect(report.outcome).toBe('static-validation-failed');
      expect(report.processLaunched).toBe(false);
      expect(calls).toEqual(['validate_project']);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  test('refuses to start when another tracked Playtest is already running', async () => {
    const project = await projectFixture();
    try {
      const calls: string[] = [];
      const report = await runPlaytestDebug({
        projectPath: project,
        callTool: async (tool) => {
          calls.push(tool);
          if (tool === 'validate_project') return { ok: true, errors: [] };
          if (tool === 'playtest_status') return { running: true, mode: 'nwjs', pid: 99 };
          if (tool === 'playtest_start') throw new Error('must not start');
          return { running: false };
        }
      });
      expect(report.outcome).toBe('existing-playtest-active');
      expect(report.processLaunched).toBe(false);
      expect(calls).toEqual(['validate_project', 'playtest_status']);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  test('refuses to adopt a stale PID from an otherwise idle status', async () => {
    const project = await projectFixture();
    try {
      const calls: string[] = [];
      const report = await runPlaytestDebug({
        projectPath: project,
        callTool: async (tool) => {
          calls.push(tool);
          if (tool === 'validate_project') return { ok: true, errors: [] };
          if (tool === 'playtest_status') return { running: false, mode: null, pid: 88 };
          if (tool === 'playtest_start') throw new Error('must not start');
          return { running: false, mode: null, pid: null };
        }
      });
      expect(report.outcome).toBe('launch-failed');
      expect(report.processLaunched).toBe(false);
      expect(report.error).toContain('idle Playtest state');
      expect(calls).toEqual(['validate_project', 'playtest_status']);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });


  test('refuses cleanup when status PID changes after a successful start', async () => {
    const project = await projectFixture();
    try {
      const calls: string[] = [];
      const report = await runPlaytestDebug({
        projectPath: project,
        verifyProcessTree: async () => true,
        callTool: async (tool) => {
          calls.push(tool);
          if (tool === 'validate_project') return { ok: true, errors: [] };
          if (tool === 'playtest_status') {
            const statusCalls = calls.filter((name) => name === 'playtest_status').length;
            if (statusCalls === 1) return { running: false, mode: null, pid: null };
            if (statusCalls === 2) return { running: true, mode: 'nwjs', pid: 99 };
            if (statusCalls === 3) return { running: true, mode: 'nwjs', pid: 100 };
            return { running: true, mode: 'nwjs', pid: 99 };
          }
          if (tool === 'playtest_start') return { mode: 'nwjs', pid: 99 };
          if (tool === 'playtest_log') return 'stdout: running';
          if (tool === 'playtest_stop') throw new Error('must not stop mismatched PID');
          return { running: false };
        },
        maxPolls: 2,
        pollIntervalMs: 0
      });
      expect(report.outcome).toBe('observation-failed');
      expect(report.cleanupVerified).toBe(false);
      expect(calls).not.toContain('playtest_stop');
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  test('late start resolution is handled without an unhandled rejection and triggers bounded cleanup', async () => {
    const project = await projectFixture();
    try {
      const calls: string[] = [];
      let lateStarted = false;
      let resolveStart: ((value: unknown) => void) | undefined;
      let startSignal: AbortSignal | undefined;
      const report = await runPlaytestDebug({
        projectPath: project,
        callTimeoutMs: 5,
        callTool: async (tool, _args, signal) => {
          calls.push(tool);
          if (tool === 'validate_project') return { ok: true, errors: [] };
          if (tool === 'playtest_status') return lateStarted ? { running: true, mode: 'nwjs', pid: 77 } : { running: false, mode: null, pid: null };
          if (tool === 'playtest_start') return new Promise((resolve) => { startSignal = signal; resolveStart = resolve; });
          if (tool === 'playtest_log') return 'stderr: start timed out';
          if (tool === 'playtest_stop') return { stopped: [] };
          return { running: false, mode: null, pid: null };
        }
      });
      expect(report.outcome).toBe('timeout');
      expect(startSignal?.aborted).toBe(true);
      lateStarted = true;
      resolveStart?.({ mode: 'nwjs', pid: 77 });
      await new Promise((resolve) => setTimeout(resolve, 15));
      expect(calls).toContain('playtest_stop');
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });


  test('late start rejection is consumed after the deadline', async () => {
    const project = await projectFixture();
    try {
      let rejectStart: ((reason?: unknown) => void) | undefined;
      const report = await runPlaytestDebug({
        projectPath: project,
        callTimeoutMs: 5,
        callTool: async (tool) => {
          if (tool === 'validate_project') return { ok: true, errors: [] };
          if (tool === 'playtest_status') return { running: false, mode: null, pid: null };
          if (tool === 'playtest_start') return new Promise((_resolve, reject) => { rejectStart = reject; });
          if (tool === 'playtest_log') return 'stderr: start timed out';
          return { running: false, mode: null, pid: null };
        }
      });
      expect(report.outcome).toBe('timeout');
      rejectStart?.(new Error('late MCP rejection'));
      await new Promise((resolve) => setTimeout(resolve, 15));
      expect(report.cleanupVerified).toBe(false);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  test('validates, launches NW.js, captures logs, stops, and marks behavior unverified', async () => {
    const project = await projectFixture();
    try {
      const calls: string[] = [];
      const callTool: PlaytestToolCaller = async (tool, args) => {
        calls.push(tool);
        if (tool === 'validate_project') return { ok: true, errors: [], warnings: [] };
        if (tool === 'playtest_start') {
          expect(args).toEqual({ mode: 'nwjs', runtimePath: 'C:\\MV\\Game.exe' });
          return { mode: 'nwjs', pid: 42, runtimePath: 'C:\\MV\\Game.exe' };
        }
        if (tool === 'playtest_status') {
          const statusCalls = calls.filter((name) => name === 'playtest_status').length;
          if (statusCalls === 1) return { running: false, mode: null, pid: null };
          if (statusCalls === 2) return { running: true, mode: 'nwjs', pid: 42 };
          return { running: false, mode: null, pid: null };
        }
        if (tool === 'playtest_log') return 'stdout: boot ok\nstderr: no errors';
        if (tool === 'playtest_stop') return { stopped: ['nwjs process 42'] };
        throw new Error(`unexpected ${tool}`);
      };
      const report = await runPlaytestDebug({ projectPath: project, runtimePath: 'C:\\MV\\Game.exe', callTool, maxPolls: 1, pollIntervalMs: 0, verifyProcessTree: async () => true });
      expect(report.outcome).toBe('stopped-behavior-unverified');
      expect(report.processLaunched).toBe(true);
      expect(report.behaviorVerified).toBe(false);
      expect(report.cleanupVerified).toBe(true);
      expect(report.log).toContain('boot ok');
      expect(calls).toEqual(['validate_project', 'playtest_status', 'playtest_start', 'playtest_status', 'playtest_log', 'playtest_status', 'playtest_stop', 'playtest_status']);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  test('surfaces immediate startup failure and still stops/inspects logs', async () => {
    const project = await projectFixture();
    try {
      const calls: string[] = [];
      const report = await runPlaytestDebug({
        projectPath: project,
        callTool: async (tool) => {
          calls.push(tool);
          if (tool === 'validate_project') return { ok: true, errors: [] };
          if (tool === 'playtest_status') return { running: false, mode: null, pid: null };
          if (tool === 'playtest_start') return { isError: true, content: [{ type: 'text', text: 'NW.js runtime not found' }] };
          if (tool === 'playtest_log') return 'stderr: missing runtime';
          if (tool === 'playtest_stop') return { stopped: [] };
          return { running: false, mode: null, pid: null };
        }
      });
      expect(report.outcome).toBe('launch-failed');
      expect(report.processLaunched).toBe(false);
      expect(report.error).toContain('NW.js runtime not found');
      expect(report.log).toContain('missing runtime');
      expect(calls).toEqual(['validate_project', 'playtest_status', 'playtest_start', 'playtest_log', 'playtest_status']);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });


  test('bounds a never-settling start call and still completes cleanup attempt', async () => {
    const project = await projectFixture();
    try {
      const calls: string[] = [];
      const report = await runPlaytestDebug({
        projectPath: project,
        callTimeoutMs: 5,
        callTool: async (tool) => {
          calls.push(tool);
          if (tool === 'validate_project') return { ok: true, errors: [] };
          if (tool === 'playtest_status') return { running: false, mode: null, pid: null };
          if (tool === 'playtest_start') return new Promise(() => {});
          if (tool === 'playtest_log') return 'stderr: start timed out';
          if (tool === 'playtest_stop') return { stopped: [] };
          return { running: false, mode: null, pid: null };
        }
      });
      expect(report.outcome).toBe('timeout');
      expect(report.cleanupVerified).toBe(false);
      expect(calls).toEqual(['validate_project', 'playtest_status', 'playtest_start', 'playtest_log', 'playtest_status']);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  test('bounds a never-settling cleanup call independently and propagates cancellation', async () => {
    const project = await projectFixture();
    try {
      const calls: string[] = [];
      let stopSignal: AbortSignal | undefined;
      const startedAt = Date.now();
      const report = await runPlaytestDebug({
        projectPath: project,
        maxPolls: 1,
        pollIntervalMs: 0,
        callTimeoutMs: 5,
        cleanupTimeoutMs: 20,
        verifyProcessTree: async () => true,
        callTool: async (tool, _args, signal) => {
          calls.push(tool);
          if (tool === 'validate_project') return { ok: true, errors: [] };
          if (tool === 'playtest_start') return { mode: 'nwjs', pid: 17 };
          if (tool === 'playtest_status') {
            const statusCalls = calls.filter((name) => name === 'playtest_status').length;
            return statusCalls === 1 ? { running: false, mode: null, pid: null } : { running: true, mode: 'nwjs', pid: 17 };
          }
          if (tool === 'playtest_log') return 'stdout: still running';
          if (tool === 'playtest_stop') { stopSignal = signal; return new Promise(() => {}); }
          return { running: false, mode: null, pid: null };
        }
      });
      expect(Date.now() - startedAt).toBeLessThan(250);
      expect(stopSignal?.aborted).toBe(true);
      expect(report.cleanupVerified).toBe(false);
      expect(calls).toContain('playtest_stop');
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  test('awaits an owned process-tree terminator before reporting cleanup', async () => {
    const project = await projectFixture();
    try {
      let verifyCalls = 0;
      let terminated = false;
      const report = await runPlaytestDebug({
        projectPath: project,
        maxPolls: 1,
        pollIntervalMs: 0,
        processTree: {
          verify: async () => { verifyCalls += 1; return terminated; },
          terminate: async () => { await new Promise((resolve) => setTimeout(resolve, 10)); terminated = true; }
        },
        callTool: async (tool, _args) => {
          if (tool === 'validate_project') return { ok: true, errors: [] };
          if (tool === 'playtest_start') return { mode: 'nwjs', pid: 18 };
          if (tool === 'playtest_status') return { running: false, mode: null, pid: null };
          if (tool === 'playtest_log') return 'stdout: exited';
          if (tool === 'playtest_stop') return { stopped: ['nwjs process 18'] };
          throw new Error(`unexpected ${tool}`);
        }
      });
      expect(report.cleanupVerified).toBe(true);
      expect(verifyCalls).toBe(2);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  test('timeout stops a still-running Playtest and reports cleanup', async () => {
    const project = await projectFixture();
    try {
      const calls: string[] = [];
      const report = await runPlaytestDebug({
        projectPath: project,
        timeoutMs: 1,
        maxPolls: 2,
        pollIntervalMs: 5,
        verifyProcessTree: async () => true,
        callTool: async (tool) => {
          calls.push(tool);
          if (tool === 'validate_project') return { ok: true, errors: [] };
          if (tool === 'playtest_start') return { mode: 'nwjs', pid: 8 };
          if (tool === 'playtest_status') {
            const statusCalls = calls.filter((name) => name === 'playtest_status').length;
            if (statusCalls === 1) return { running: false, mode: null, pid: null };
            if (statusCalls === 2) return { running: true, mode: 'nwjs', pid: 8 };
            return { running: false, mode: null, pid: null };
          }
          if (tool === 'playtest_log') return 'stderr: still running';
          if (tool === 'playtest_stop') return { stopped: ['nwjs process 8'] };
          return { running: false };
        }
      });
      expect(report.outcome).toBe('timeout');
      expect(report.cleanupVerified).toBe(true);
      expect(calls).toContain('playtest_stop');
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
  test('cancellation stops a running Playtest and reports cleanup', async () => {
    const project = await projectFixture();
    try {
      const controller = new AbortController();
      const calls: string[] = [];
      const report = await runPlaytestDebug({
        projectPath: project,
        signal: controller.signal,
        callTool: async (tool) => {
          calls.push(tool);
          if (tool === 'validate_project') return { ok: true, errors: [] };
          if (tool === 'playtest_start') return { mode: 'nwjs', pid: 7 };
          if (tool === 'playtest_status') {
            const statusCalls = calls.filter((name) => name === 'playtest_status').length;
            if (statusCalls === 1) return { running: false, mode: null, pid: null };
            if (statusCalls === 2) { controller.abort(); return { running: true, mode: 'nwjs', pid: 7 }; }
            return { running: false, mode: null, pid: null };
          }
          if (tool === 'playtest_log') return 'stdout: running';
          if (tool === 'playtest_stop') return { stopped: ['nwjs process 7'] };
          return { running: false };
        },
        maxPolls: 2,
        pollIntervalMs: 0,
        verifyProcessTree: async () => true
      });
      expect(report.outcome).toBe('cancelled');
      expect(report.cleanupVerified).toBe(true);
      expect(calls).toContain('playtest_stop');
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
});
