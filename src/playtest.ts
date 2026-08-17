import { assertValidMvProject } from './project';

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
  verifyProcessTree?: (pid: number) => Promise<boolean>;
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

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function unwrap(value: unknown): unknown {
  const object = objectValue(value);
  if (!Array.isArray(object?.content)) return value;
  const text = object.content.find((item) => objectValue(item)?.type === 'text');
  const textValue = objectValue(text)?.text;
  if (typeof textValue !== 'string') return value;
  try { return JSON.parse(textValue); } catch { return textValue; }
}

function toolError(value: unknown): string | undefined {
  const object = objectValue(value);
  if (object?.isError === true) {
    const text = Array.isArray(object.content) ? object.content.map((item) => objectValue(item)?.text).find((item): item is string => typeof item === 'string') : undefined;
    return text ?? 'MCP tool returned isError=true';
  }
  const unwrapped = objectValue(unwrap(value));
  return unwrapped?.isError === true ? 'MCP tool returned isError=true' : undefined;
}

function validationReport(value: unknown): StaticValidationReport {
  const result = unwrap(value);
  const object = objectValue(result);
  const errors = Array.isArray(object?.errors) ? object.errors.map(String) : [];
  const warnings = Array.isArray(object?.warnings) ? object.warnings.map(String) : [];
  return { ok: object?.ok === true && errors.length === 0, errors, warnings };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = (): void => {
      if (timer) clearTimeout(timer);
      reject(new Error('Playtest cancelled'));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

async function callWithDeadline(callTool: PlaytestToolCaller, tool: string, args: Record<string, unknown>, externalSignal: AbortSignal | undefined, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort();
  externalSignal?.addEventListener('abort', forwardAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: ((error: Error) => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${tool} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  const task = Promise.resolve().then(() => callTool(tool, args, controller.signal)).then((result) => {
    const error = toolError(result);
    if (error) throw new Error(`${tool}: ${error}`);
    return unwrap(result);
  });
  const onAbort = (): void => {
    controller.abort();
    rejectAbort?.(new Error('Playtest cancelled'));
  };
  externalSignal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await Promise.race([task, timeoutPromise, abortPromise]);
  } catch (error) {
    controller.abort();
    // The DSH tool runtime owns cancellation and promises to settle after its process work is quiescent.
    await task.catch(() => undefined);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    externalSignal?.removeEventListener('abort', forwardAbort);
    externalSignal?.removeEventListener('abort', onAbort);
  }
}

function crashEvidence(log: string): boolean {
  if (/spawn error|process exited with code [1-9]\d*/i.test(log)) return true;
  return [...log.matchAll(/stderr:\s*(.*)/gi)].some((match) => {
    const text = match[1].trim();
    return text !== '' && !/^no errors?$/i.test(text);
  });
}

export async function runPlaytestDebug(options: PlaytestDebugOptions): Promise<PlaytestDebugReport> {
  const base: PlaytestDebugReport = {
    outcome: 'static-validation-failed',
    staticValidation: { ok: false, errors: [], warnings: [] },
    processLaunched: false,
    behaviorVerified: false,
    statuses: [],
    log: '',
    cleanupVerified: false
  };
  const callTimeoutMs = options.callTimeoutMs ?? 30_000;
  if (options.signal?.aborted) {
    base.outcome = 'cancelled';
    base.error = 'Playtest cancelled before static validation.';
    return base;
  }
  try {
    await assertValidMvProject(options.projectPath);
    const validation = await callWithDeadline(options.callTool, 'validate_project', {}, options.signal, callTimeoutMs);
    base.staticValidation = validationReport(validation);
  } catch (error) {
    base.staticValidation.errors.push(errorMessage(error));
    base.error = errorMessage(error);
    if (options.signal?.aborted || base.error.toLowerCase().includes('cancelled')) base.outcome = 'cancelled';
    return base;
  }
  if (!base.staticValidation.ok) {
    base.error = base.staticValidation.errors.join('; ') || 'Static project validation failed.';
    return base;
  }

  let startAttempted = false;
  let ownedPid: number | undefined;
  let preExistingPid: number | undefined;
  let processEndedBeforeStop = false;
  let logCaptured = false;
  try {
    const before = await callWithDeadline(options.callTool, 'playtest_status', {}, options.signal, callTimeoutMs);
    base.statuses.push(before);
    const beforeObject = objectValue(before);
    if (beforeObject?.running === true && typeof beforeObject.pid === 'number') {
      preExistingPid = beforeObject.pid;
      base.outcome = 'existing-playtest-active';
      base.error = `A Playtest is already running (PID ${preExistingPid}); stop it before starting another session.`;
      return base;
    }
    if (beforeObject?.running !== false) throw new Error('playtest_status returned no boolean running state.');
  } catch (error) {
    base.error = errorMessage(error);
    base.outcome = options.signal?.aborted ? 'cancelled' : 'launch-failed';
    return base;
  }

  try {
    startAttempted = true;
    const startArgs: Record<string, unknown> = { mode: 'nwjs' };
    if (options.runtimePath !== undefined) startArgs.runtimePath = options.runtimePath;
    const started = await callWithDeadline(options.callTool, 'playtest_start', startArgs, options.signal, callTimeoutMs);
    const launch = objectValue(started);
    if (launch?.mode !== 'nwjs' || typeof launch.pid !== 'number') throw new Error('playtest_start did not return an NW.js mode and PID.');
    ownedPid = launch.pid;
    base.processLaunched = true;

    const maxPolls = options.maxPolls ?? 8;
    const deadline = options.timeoutMs === undefined ? undefined : Date.now() + options.timeoutMs;
    for (let poll = 0; poll < maxPolls; poll += 1) {
      if (options.signal?.aborted) throw new Error('Playtest cancelled');
      if (deadline !== undefined && Date.now() >= deadline) throw new Error('Playtest observation timed out');
      const status = await callWithDeadline(options.callTool, 'playtest_status', {}, options.signal, callTimeoutMs);
      base.statuses.push(status);
      const statusObject = objectValue(status);
      if (statusObject?.running !== true && statusObject?.running !== false) throw new Error('playtest_status returned no boolean running state.');
      if (statusObject.running === false) {
        processEndedBeforeStop = true;
        break;
      }
      if (poll + 1 < maxPolls) {
        const delay = options.pollIntervalMs ?? 250;
        await wait(deadline === undefined ? delay : Math.min(delay, Math.max(0, deadline - Date.now())), options.signal);
      }
    }
    const logs = await callWithDeadline(options.callTool, 'playtest_log', { tail: 50 }, options.signal, callTimeoutMs);
    base.log = typeof logs === 'string' ? logs : JSON.stringify(logs);
    logCaptured = true;
    if (processEndedBeforeStop) base.outcome = crashEvidence(base.log) ? 'crashed' : 'stopped-behavior-unverified';
  } catch (error) {
    base.error = errorMessage(error);
    if (options.signal?.aborted || base.error.toLowerCase().includes('cancelled')) base.outcome = 'cancelled';
    else if (base.error.toLowerCase().includes('timed out')) base.outcome = 'timeout';
    else base.outcome = base.processLaunched ? 'observation-failed' : 'launch-failed';
    if (!logCaptured) {
      try {
        const logs = await callWithDeadline(options.callTool, 'playtest_log', { tail: 50 }, undefined, callTimeoutMs);
        base.log = typeof logs === 'string' ? logs : JSON.stringify(logs);
      } catch (logError) {
        base.log = `${base.log}\n${errorMessage(logError)}`.trim();
      }
    }
  } finally {
    if (startAttempted) {
      let statusBeforeStop: Record<string, unknown> | undefined;
      try {
        const status = await callWithDeadline(options.callTool, 'playtest_status', {}, undefined, callTimeoutMs);
        base.statuses.push(status);
        statusBeforeStop = objectValue(status);
        if (ownedPid === undefined && statusBeforeStop?.running === true && typeof statusBeforeStop.pid === 'number' && statusBeforeStop.pid !== preExistingPid) {
          ownedPid = statusBeforeStop.pid;
          base.processLaunched = true;
        }
      } catch (error) {
        base.error = `${base.error ? `${base.error}; ` : ''}cleanup status failed: ${errorMessage(error)}`;
      }
      const shouldStop = ownedPid !== undefined || (statusBeforeStop?.running === false && preExistingPid === undefined);
      if (shouldStop) {
        try {
          base.stop = await callWithDeadline(options.callTool, 'playtest_stop', {}, undefined, callTimeoutMs);
          const afterStop = await callWithDeadline(options.callTool, 'playtest_status', {}, undefined, callTimeoutMs);
          base.statuses.push(afterStop);
          const afterObject = objectValue(afterStop);
          const processGone = afterObject?.running === false && (afterObject.pid === null || afterObject.pid === undefined);
          const treeGone = ownedPid !== undefined && options.verifyProcessTree ? await options.verifyProcessTree(ownedPid) : false;
          base.cleanupVerified = processGone && (ownedPid === undefined ? false : treeGone);
          if (!base.cleanupVerified) base.error = `${base.error ? `${base.error}; ` : ''}playtest process/descendant cleanup was not confirmed`;
        } catch (error) {
          base.cleanupVerified = false;
          base.error = `${base.error ? `${base.error}; ` : ''}cleanup failed: ${errorMessage(error)}`;
        }
      } else {
        base.cleanupVerified = false;
        base.error = `${base.error ? `${base.error}; ` : ''}existing Playtest ownership could not be distinguished safely`;
      }
    }
  }
  if (base.outcome === 'static-validation-failed') {
    base.outcome = base.processLaunched
      ? (processEndedBeforeStop ? 'crashed' : 'stopped-behavior-unverified')
      : 'launch-failed';
  }
  return base;
}
