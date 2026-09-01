/**
 * Small, stable installation-session event vocabulary.
 *
 * The installer core owns this state machine.  Renderers and evidence writers
 * subscribe to it; none of them are allowed to infer completion from child
 * process output.  Keeping the contract in one module also makes redirected
 * and interactive runs observe the same phase order.
 */

export const INSTALL_PHASES = [
  'destination',
  'prerequisites',
  'runtime',
  'tools',
  'profile',
  'metadata',
  'shortcut',
  'verification'
] as const;

export type InstallPhaseName = (typeof INSTALL_PHASES)[number];
export type InstallationOperation = 'install' | 'upgrade' | 'repair';
export type InstallStatus = 'started' | 'succeeded' | 'failed' | 'cancelled';

export interface InstallProgress {
  completed: number;
  total: number;
  unit?: string;
}

export interface SessionEvent {
  kind: 'session' | 'phase';
  operation: InstallationOperation;
  status: InstallStatus;
  at: string;
  elapsedMs?: number;
  phase?: InstallPhaseName;
  ordinal?: number;
  totalPhases?: number;
  operationLabel?: string;
  progress?: InstallProgress;
  error?: { message: string; exitCode?: number; retries?: number };
}

export type InstallationEvent = SessionEvent;

export type InstallationEventListener = (event: SessionEvent) => void;

export interface InstallationSessionOptions {
  operation?: InstallationOperation;
  now?: () => Date;
  phases?: readonly InstallPhaseName[];
  onEvent?: InstallationEventListener;
}

/** A single-use state machine that guarantees one terminal session event. */
export class InstallationSession {
  readonly operation: InstallationOperation;
  readonly phases: readonly InstallPhaseName[];
  private readonly now: () => Date;
  private readonly listeners = new Set<InstallationEventListener>();
  private readonly startedAt: number;
  private terminal = false;
  private sessionStarted = false;
  private current?: { phase: InstallPhaseName; startedAt: number };
  private lastPhaseIndex = -1;

  constructor(options: InstallationSessionOptions = {}) {
    this.operation = options.operation ?? 'install';
    this.phases = options.phases ?? INSTALL_PHASES;
    this.now = options.now ?? (() => new Date());
    this.startedAt = this.now().getTime();
    if (options.onEvent) this.listeners.add(options.onEvent);
  }

  on(listener: InstallationEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get isTerminal(): boolean { return this.terminal; }

  emit(event: Omit<SessionEvent, 'operation' | 'at'> & { at?: string }): SessionEvent {
    const next: SessionEvent = {
      ...event,
      operation: this.operation,
      at: event.at ?? this.now().toISOString()
    };
    if (next.kind === 'session' && next.status !== 'started') {
      if (!this.sessionStarted) throw new Error('Cannot finish an installation session before it starts.');
      if (this.terminal) throw new Error('Installation session already has a terminal state.');
      this.terminal = true;
      next.elapsedMs ??= Math.max(0, this.now().getTime() - this.startedAt);
    }
    if (next.kind === 'session' && next.status === 'started') {
      if (this.sessionStarted) throw new Error('Installation session has already started.');
      if (this.terminal) throw new Error('Cannot start an installation session after it ended.');
      this.sessionStarted = true;
    }
    for (const listener of [...this.listeners]) listener(next);
    return next;
  }

  start(): SessionEvent {
    return this.emit({ kind: 'session', status: 'started' });
  }

  startPhase(phase: InstallPhaseName, operationLabel?: string): SessionEvent {
    if (this.terminal) throw new Error('Cannot start a phase after the installation session ended.');
    if (!this.sessionStarted) throw new Error('Cannot start an installation phase before the session starts.');
    if (this.current) throw new Error(`Installation phase ${this.current.phase} is still active.`);
    const index = this.phases.indexOf(phase);
    if (index < 0) throw new Error(`Unknown installation phase: ${phase}`);
    if (index < this.lastPhaseIndex) throw new Error(`Installation phase ${phase} is out of order.`);
    this.lastPhaseIndex = index;
    this.current = { phase, startedAt: this.now().getTime() };
    return this.emit({
      kind: 'phase',
      phase,
      ordinal: index + 1,
      totalPhases: this.phases.length,
      operationLabel,
      status: 'started'
    });
  }

  progress(progress: InstallProgress, operationLabel?: string): SessionEvent {
    if (!this.sessionStarted) throw new Error('Cannot report progress before the session starts.');
    if (!this.current) throw new Error('Cannot report progress before a phase starts.');
    return this.emit({
      kind: 'phase',
      phase: this.current.phase,
      ordinal: this.phases.indexOf(this.current.phase) + 1,
      totalPhases: this.phases.length,
      operationLabel,
      status: 'started',
      progress
    });
  }

  finishPhase(status: Exclude<InstallStatus, 'started'>, error?: SessionEvent['error']): SessionEvent {
    if (!this.current) throw new Error('Cannot finish an installation phase before it starts.');
    const current = this.current;
    this.current = undefined;
    return this.emit({
      kind: 'phase',
      phase: current.phase,
      ordinal: this.phases.indexOf(current.phase) + 1,
      totalPhases: this.phases.length,
      status,
      elapsedMs: Math.max(0, this.now().getTime() - current.startedAt),
      ...(error ? { error } : {})
    });
  }

  succeed(): SessionEvent { return this.emit({ kind: 'session', status: 'succeeded' }); }
  fail(error: SessionEvent['error']): SessionEvent {
    if (this.current) this.finishPhase('failed', error);
    return this.emit({ kind: 'session', status: 'failed', error });
  }
  cancel(message = 'Installation cancelled.'): SessionEvent {
    const error = { message };
    if (this.current) this.finishPhase('cancelled', error);
    return this.emit({ kind: 'session', status: 'cancelled', error });
  }
}

export function createInstallationSession(options: InstallationSessionOptions = {}): InstallationSession {
  return new InstallationSession(options);
}

export type InstallationRendererMode = 'interactive' | 'plain' | 'ndjson';

export function rendererMode(options: { mode?: InstallationRendererMode; stdoutIsTTY?: boolean } = {}): InstallationRendererMode {
  if (options.mode) return options.mode;
  return options.stdoutIsTTY ?? process.stdout.isTTY ? 'interactive' : 'plain';
}

/** Render append-only output without terminal control sequences. */
export function renderPlainEvent(event: SessionEvent): string {
  const prefix = event.kind === 'session' ? 'INSTALL' : `PHASE ${event.ordinal ?? '?'}${event.totalPhases ? `/${event.totalPhases}` : ''}`;
  const name = event.phase ? ` ${event.phase}` : '';
  const operation = event.operationLabel ? ` — ${event.operationLabel}` : '';
  const elapsed = event.elapsedMs === undefined ? '' : ` (${event.elapsedMs}ms)`;
  const progress = event.progress ? ` ${event.progress.completed}/${event.progress.total}${event.progress.unit ? ` ${event.progress.unit}` : ''}` : '';
  const detail = event.error?.message ? `: ${event.error.message}` : '';
  return `${prefix}${name} ${event.status}${operation}${progress}${elapsed}${detail}`;
}

/** NDJSON keeps the exact event stream available to automation callers. */
export function renderNdjsonEvent(event: SessionEvent): string {
  return `${JSON.stringify(event)}\n`;
}
