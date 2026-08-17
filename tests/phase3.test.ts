import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runPlaytestDebug, type PlaytestToolCaller } from '../src/playtest';
import { createPlaytestProcessController } from '../src/playtest-process';

async function projectFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'phase3-playtest-'));
  await mkdir(join(root, 'data'), { recursive: true });
  await mkdir(join(root, 'js'), { recursive: true });
  await writeFile(join(root, 'Game.rpgproject'), '{}\n');
  return root;
}

describe('playtest-debug process controller', () => {
  test('uses direct Windows taskkill and PowerShell process-tree argv', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const controller = createPlaytestProcessController({
      platform: 'win32',
      pwshExecutable: String.raw`C:\\含 %! spaces\\PowerShell\\pwsh.exe`,
      env: { SystemRoot: String.raw`C:\\Windows` },
      commandRunner: async (command, args) => {
        calls.push({ command, args });
        if (args.includes('-Command')) return { exitCode: 0, stdout: 'clean', stderr: '' };
        return { exitCode: 0, stdout: '', stderr: '' };
      }
    });
    expect(await controller.verify(4123)).toBe(true);
    await controller.terminate(4123);
    expect(calls[0].args).toContain('-Command');
    expect(calls[1].command).toContain('taskkill.exe');
    expect(calls[1].args).toEqual(['/PID', '4123', '/T', '/F']);
  });
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
            return { running: true, mode: 'nwjs' };
          }
          if (tool === 'playtest_start') return { mode: 'nwjs', pid: 99 };
          if (tool === 'playtest_log') return 'stdout: running';
          if (tool === 'playtest_stop') throw new Error('must not stop mismatched PID');
          return { running: false };
        },
        maxPolls: 1,
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
      const report = await runPlaytestDebug({
        projectPath: project,
        callTimeoutMs: 5,
        callTool: async (tool) => {
          calls.push(tool);
          if (tool === 'validate_project') return { ok: true, errors: [] };
          if (tool === 'playtest_status') return lateStarted ? { running: true, mode: 'nwjs', pid: 77 } : { running: false, mode: null, pid: null };
          if (tool === 'playtest_start') return new Promise((resolve) => { resolveStart = resolve; });
          if (tool === 'playtest_log') return 'stderr: start timed out';
          if (tool === 'playtest_stop') return { stopped: [] };
          return { running: false, mode: null, pid: null };
        }
      });
      expect(report.outcome).toBe('timeout');
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
