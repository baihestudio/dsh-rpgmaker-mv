import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { redactSensitive, type CommandResult } from './process';
import type { InstallationOperation, InstallationRendererMode, InstallPhaseName, SessionEvent } from './install-events';
import type { InstallationCapacity } from './installation-root';

export const INSTALL_TIMING_SCHEMA_VERSION = 1;
/** Stable event written before any install work begins. */
export const INSTALL_RUN_STARTED_EVENT = 'install-run-started';

export interface InstallPhaseTiming {
  phase: InstallPhaseName;
  status: Exclude<SessionEvent['status'], 'started'> | 'succeeded';
  startedAt?: string;
  endedAt?: string;
  elapsedMs?: number;
  retries?: number;
}

export interface InstallTimingRecord {
  schemaVersion: number;
  runId: string;
  operation: InstallationOperation;
  productVersion: string;
  runtimeVersion: string;
  startedAt: string;
  endedAt: string;
  totalDurationMs: number;
  renderer: InstallationRendererMode;
  finalStatus: Exclude<SessionEvent['status'], 'started'>;
  installationRoot: string;
  localStateRoot: string;
  prerequisites: Record<string, 'verified' | 'installed' | 'failed' | 'skipped'>;
  phases: InstallPhaseTiming[];
  failedPhase?: InstallPhaseName;
  exitCode?: number;
  retries?: number;
  error?: string;
  capacity?: InstallationCapacity;
}

export interface InstallRunEvidenceOptions {
  localStateRoot: string;
  installationRoot: string;
  operation: InstallationOperation;
  renderer: InstallationRendererMode;
  productVersion?: string;
  runtimeVersion?: string;
  runId?: string;
  now?: () => Date;
  env?: Record<string, string | undefined>;
}

export interface InstallRunEvidenceFinishDetails {
  failedPhase?: InstallPhaseName;
  exitCode?: number;
  error?: string;
  retries?: number;
}

/**
 * Per-run evidence writer.  Timing JSON is deliberately a small allow-list of
 * fields; command lines, environment dumps, and child output belong only in
 * the paired redacted text log.
 */
export class InstallRunEvidence {
  readonly runId: string;
  readonly startedAt: Date;
  readonly timingPath: string;
  readonly logPath: string;
  private readonly options: InstallRunEvidenceOptions;
  private readonly now: () => Date;
  private readonly env: Record<string, string | undefined>;
  private readonly phases: InstallPhaseTiming[] = [];
  private readonly prerequisites: Record<string, 'verified' | 'installed' | 'failed' | 'skipped'> = {};
  private activePhase?: { phase: InstallPhaseName; at: Date; index: number };
  private retries = 0;
  private finished = false;
  private logQueue: Promise<void> = Promise.resolve();
  private failedPhase?: InstallPhaseName;
  private failedExitCode?: number;
  private capacity?: InstallationCapacity;

  constructor(options: InstallRunEvidenceOptions) {
    this.options = options;
    this.runId = options.runId ?? randomUUID();
    this.now = options.now ?? (() => new Date());
    this.env = options.env ?? process.env;
    this.startedAt = this.now();
    const stamp = this.startedAt.toISOString().replace(/[-:.TZ]/g, '');
    const dir = join(options.localStateRoot, 'logs', 'install-runs');
    this.timingPath = join(dir, `${stamp}-${this.runId}.json`);
    this.logPath = join(dir, `${stamp}-${this.runId}.log`);
  }

  async start(): Promise<void> {
    await mkdir(join(this.options.localStateRoot, 'logs', 'install-runs'), { recursive: true });
    // Write one complete record before the lock or any install phase is
    // entered.  If the process is forcibly terminated later, this header is
    // still useful evidence and the log can never be an unexplained empty
    // file.  Keep this an allow-list of identifying fields: no environment,
    // command line, or child output belongs in the initial record.
    const header = {
      at: this.startedAt.toISOString(),
      event: INSTALL_RUN_STARTED_EVENT,
      runId: this.runId,
      operation: this.options.operation,
      productVersion: this.options.productVersion ?? 'unknown',
      runtimeVersion: this.options.runtimeVersion ?? 'unknown',
      renderer: this.options.renderer,
      installationRoot: this.options.installationRoot,
      localStateRoot: this.options.localStateRoot
    };
    await writeFile(this.logPath, `${redactSensitive(JSON.stringify(header), this.env)}\n`, 'utf8');
  }

  phaseStarted(phase: InstallPhaseName, at = this.now()): void {
    if (this.activePhase) this.phaseFinished('cancelled', at);
    this.activePhase = { phase, at, index: this.phases.length };
    this.phases.push({ phase, status: 'succeeded', startedAt: at.toISOString() });
  }

  phaseFinished(status: InstallPhaseTiming['status'], at = this.now(), retries = 0, error?: string): void {
    const active = this.activePhase;
    if (!active) return;
    const record = this.phases[active.index];
    record.status = status;
    if (status !== 'succeeded') this.failedPhase = active.phase;
    record.endedAt = at.toISOString();
    record.elapsedMs = Math.max(0, at.getTime() - active.at.getTime());
    if (retries > 0) {
      record.retries = retries;
      this.retries += retries;
    }
    if (error) this.appendLog(`phase ${active.phase} failed: ${error}`);
    this.activePhase = undefined;
  }

  prerequisite(id: string, status: InstallTimingRecord['prerequisites'][string]): void {
    this.prerequisites[id] = status;
  }

  command(label: string, command: string, result: CommandResult): void {
    // The log is intentionally descriptive but never records a raw command
    // line.  Even an argument that looks harmless can contain a token.
    const detail = redactSensitive(`${label} (${basename(command)}) exited ${result.exitCode}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\n`, this.env);
    this.appendLog(detail);
    if (result.exitCode !== 0) {
      this.failedExitCode = result.exitCode;
      if (this.activePhase) this.failedPhase = this.activePhase.phase;
    }
  }

  setCapacity(capacity: InstallationCapacity): void {
    this.capacity = { ...capacity };
  }

  appendLog(text: string): void {
    // Keep writes ordered so a final command's diagnostics cannot race the
    // atomic timing-record write.  The queue intentionally remains private:
    // callers can continue emitting evidence while a child process runs.
    const line = `${redactSensitive(text, this.env)}\n`;
    this.logQueue = this.logQueue.then(() => appendFile(this.logPath, line, 'utf8')).catch(() => undefined);
  }

  async finish(status: InstallTimingRecord['finalStatus'], details: InstallRunEvidenceFinishDetails = {}): Promise<InstallTimingRecord> {
    if (this.finished) throw new Error('Install run evidence has already been finalized.');
    if (this.activePhase) this.phaseFinished(status === 'succeeded' ? 'failed' : status);
    this.finished = true;
    const endedAt = this.now();
    const record: InstallTimingRecord = {
      schemaVersion: INSTALL_TIMING_SCHEMA_VERSION,
      runId: this.runId,
      operation: this.options.operation,
      productVersion: this.options.productVersion ?? 'unknown',
      runtimeVersion: this.options.runtimeVersion ?? 'unknown',
      startedAt: this.startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      totalDurationMs: Math.max(0, endedAt.getTime() - this.startedAt.getTime()),
      renderer: this.options.renderer,
      finalStatus: status,
      installationRoot: this.options.installationRoot,
      localStateRoot: this.options.localStateRoot,
      prerequisites: { ...this.prerequisites },
      phases: this.phases.map((phase) => ({ ...phase })),
      ...((details.failedPhase ?? this.failedPhase) ? { failedPhase: details.failedPhase ?? this.failedPhase } : {}),
      ...((details.exitCode ?? this.failedExitCode) === undefined ? {} : { exitCode: details.exitCode ?? this.failedExitCode }),
      ...((details.retries ?? this.retries) > 0 ? { retries: details.retries ?? this.retries } : {}),
      ...(details.error ? { error: redactSensitive(details.error, this.env) } : {}),
      ...(this.capacity ? { capacity: this.capacity } : {})
    };
    const temporary = `${this.timingPath}.tmp-${randomUUID()}`;
    await mkdir(join(this.options.localStateRoot, 'logs', 'install-runs'), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    await rename(temporary, this.timingPath);
    // Ensure child output queued just before finalization is not lost.  The log
    // itself remains plain UTF-8 and is never used as a completion signal.
    await this.logQueue;
    return record;
  }

  /** Update the selected root once first-install destination selection ends. */
  setInstallationRoot(root: string): void {
    (this.options as InstallRunEvidenceOptions).installationRoot = root;
  }

}

export function createInstallRunEvidence(options: InstallRunEvidenceOptions): InstallRunEvidence {
  return new InstallRunEvidence(options);
}
