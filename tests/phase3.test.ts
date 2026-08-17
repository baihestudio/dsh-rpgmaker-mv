import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runPlaytestDebug, type PlaytestToolCaller } from '../src/playtest';

async function projectFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'phase3-playtest-'));
  await mkdir(join(root, 'data'), { recursive: true });
  await mkdir(join(root, 'js'), { recursive: true });
  await writeFile(join(root, 'Game.rpgproject'), '{}\n');
  return root;
}

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
      expect(calls).toEqual(['validate_project', 'playtest_status', 'playtest_start', 'playtest_log', 'playtest_status', 'playtest_stop', 'playtest_status']);
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
