import type { PlaytestProcessController } from './playtest-process';
// @ts-ignore The preset copy is the runtime-shared JS module loaded by DSH and tests.
import { runPlaytestDebug as runCorePlaytestDebug } from '../presets/playtest-debug/playtest-debug-core.js';

export type PlaytestToolCaller = (tool: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;

export interface PlaytestDebugOptions {
  projectPath: string;
  runtimePath?: string;
  callTool: PlaytestToolCaller;
  signal?: AbortSignal;
  maxPolls?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
  callTimeoutMs?: number;
  cleanupTimeoutMs?: number;
  lateGraceMs?: number;
  verifyProcessTree?: (pid: number) => Promise<boolean>;
  terminateProcessTree?: (pid: number) => Promise<void>;
  processTree?: PlaytestProcessController;
}

export interface StaticValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface PlaytestDebugReport {
  outcome: 'static-validation-failed' | 'existing-playtest-active' | 'launch-failed' | 'observation-failed' | 'crashed' | 'cancelled' | 'timeout' | 'stopped-behavior-unverified';
  staticValidation: StaticValidationReport;
  processLaunched: boolean;
  behaviorVerified: false;
  statuses: unknown[];
  log: string;
  error?: string;
  cleanupVerified: boolean;
  stop?: unknown;
}

export async function runPlaytestDebug(options: PlaytestDebugOptions): Promise<PlaytestDebugReport> {
  return runCorePlaytestDebug(options) as Promise<PlaytestDebugReport>;
}
