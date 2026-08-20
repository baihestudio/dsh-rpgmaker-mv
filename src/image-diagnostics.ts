import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { redactSensitive, type CommandOptions, type CommandResult, type CommandRunner } from './process';

export const IMAGE_DIAGNOSTIC_LOG_NAME = 'image-workshop.jsonl';
export const IMAGE_DIAGNOSTIC_MAX_BYTES = 1 * 1024 * 1024;
export const IMAGE_DIAGNOSTIC_ROTATED_NAME = `${IMAGE_DIAGNOSTIC_LOG_NAME}.1`;

const DIAGNOSTIC_TEXT_LIMIT = 512;
const DIAGNOSTIC_LABEL_LIMIT = 160;
const DIAGNOSTIC_LABELS_LIMIT = 16;
const DIAGNOSTIC_OPTIONS_LIMIT = 16;
const DIAGNOSTIC_RECORD_LIMIT = 8 * 1024;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_OPTION_KEYS = new Set([
  'scale', 'width', 'height', 'trim', 'gravity', 'cellWidth', 'cellHeight',
  'columns', 'inputCount', 'maxSize', 'padding', 'extrusion', 'fixedGrid', 'level'
]);
const SAFE_STAGE_NAMES = new Set([
  'harness-cli-spawn',
  'toolchain-version-check',
  'metadata-inspection',
  'pixel-dimension-probe',
  'raw-pixel-extraction',
  'transform-encode',
  'atlas-helper',
  'oxipng',
  'termination'
]);

type DiagnosticOutcome = 'completed' | 'failed' | 'timed-out' | 'cancelled' | 'cleanup-unconfirmed';
type DiagnosticErrorCode = 'CHILD_EXIT_NONZERO' | 'COMMAND_FAILED' | 'ATLAS_HELPER_FAILED' | 'CANCELLED' | 'TOOL_TIMEOUT';
const SAFE_ERROR_CODES: ReadonlySet<DiagnosticErrorCode> = new Set([
  'CHILD_EXIT_NONZERO',
  'COMMAND_FAILED',
  'ATLAS_HELPER_FAILED',
  'CANCELLED',
  'TOOL_TIMEOUT'
]);

export interface ImageDiagnosticContext {
  operationId?: string;
  toolName?: string;
  operation?: string;
  inputLabels?: string[];
  outputLabels?: string[];
  options?: Record<string, string | number | boolean>;
  logPath?: string;
  /** Kept in memory only to redact app-owned labels and options; child output is never passed here. */
  redactionValues?: string[];
  writeChain?: Promise<void>;
}

export interface ImageDiagnosticRecord {
  event: 'start' | 'terminal';
  stage: string;
  executable?: string;
  pid?: number;
  startedAt?: string;
  finishedAt?: string;
  elapsedMs?: number;
  outcome?: DiagnosticOutcome;
  errorCode?: DiagnosticErrorCode;
  processCleanupConfirmed?: boolean;
}

function boundedText(value: unknown, context?: ImageDiagnosticContext): string | undefined {
  let text = String(value ?? '');
  for (const secret of context?.redactionValues ?? []) text = text.split(secret).join('[redacted]');
  text = redactSensitive(text);
  text = text.replace(
    /(ANIONEX_FREE_VISION|NPM_TOKEN|NODE_AUTH_TOKEN|GITHUB_TOKEN|GITLAB_TOKEN)\s*[:=]\s*[^\s,;}]+/gi,
    '$1=[redacted]'
  );
  return text.length <= DIAGNOSTIC_TEXT_LIMIT ? text : text.slice(-DIAGNOSTIC_TEXT_LIMIT);
}

function safeRelativeLabel(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized === '.' || normalized === '..') return undefined;
  const parts = normalized.split('/');
  if (parts.some((part) => part.length === 0 || part === '..' || part === '.')) return undefined;
  return normalized.length <= DIAGNOSTIC_LABEL_LIMIT ? normalized : normalized.slice(0, DIAGNOSTIC_LABEL_LIMIT);
}

function labels(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value
    .map((entry) => safeRelativeLabel(entry))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, DIAGNOSTIC_LABELS_LIMIT);
  return result.length > 0 ? result : undefined;
}

function parseLabels(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  try {
    return labels(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function safeOptions(value: unknown): Record<string, string | number | boolean> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(value).slice(0, DIAGNOSTIC_OPTIONS_LIMIT)) {
    if (!SAFE_OPTION_KEYS.has(key)) continue;
    if (typeof raw === 'boolean' || (typeof raw === 'number' && Number.isFinite(raw))) {
      result[key] = raw;
    } else if (typeof raw === 'string' && raw.length <= DIAGNOSTIC_LABEL_LIMIT && !/[\\/]/.test(raw)) {
      result[key] = raw;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function parseOptions(value: string | undefined): Record<string, string | number | boolean> | undefined {
  if (!value) return undefined;
  try {
    return safeOptions(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function safeToken(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_TOKEN_PATTERN.test(value) ? value : undefined;
}

function executableName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const name = basename(value.replaceAll('\\', '/'));
  return name.length <= DIAGNOSTIC_LABEL_LIMIT ? name : name.slice(-DIAGNOSTIC_LABEL_LIMIT);
}

function operationId(value: string | undefined): string {
  return value && OPERATION_ID_PATTERN.test(value) ? value : randomUUID();
}

export function imageDiagnosticLogPath(env: Record<string, string | undefined> = process.env): string | undefined {
  // DSH_IMAGE_WORKSHOP_LOG is an explicit test/diagnostic seam. Production
  // launchers provide DSH_RPGMAKER_LOG_DIR, which is always app-owned state.
  if (env.DSH_IMAGE_WORKSHOP_LOG) return env.DSH_IMAGE_WORKSHOP_LOG;
  if (env.DSH_RPGMAKER_LOG_DIR) return join(env.DSH_RPGMAKER_LOG_DIR, IMAGE_DIAGNOSTIC_LOG_NAME);
  const mutableRoot = env.DSH_RPGMAKER_DATA_ROOT ?? env.DSH_RPGMAKER_MUTABLE_ROOT;
  if (mutableRoot) return join(mutableRoot, 'logs', IMAGE_DIAGNOSTIC_LOG_NAME);
  if (env.DSH_HOME) return join(dirname(env.DSH_HOME), 'logs', IMAGE_DIAGNOSTIC_LOG_NAME);
  return undefined;
}

export function imageDiagnosticContextFromEnvironment(env: Record<string, string | undefined> = process.env): ImageDiagnosticContext {
  const redactionValues = [
    env.DEEPSEEK_API_KEY,
    env.DSH_API_KEY,
    env.ANIONEX_FREE_VISION,
    env.NPM_TOKEN,
    env.NODE_AUTH_TOKEN,
    env.GITHUB_TOKEN,
    env.GITLAB_TOKEN
  ].filter((value): value is string => Boolean(value));
  return {
    operationId: operationId(env.DSH_IMAGE_WORKSHOP_OPERATION_ID),
    ...(safeToken(env.DSH_IMAGE_WORKSHOP_TOOL_NAME) ? { toolName: env.DSH_IMAGE_WORKSHOP_TOOL_NAME } : {}),
    ...(safeToken(env.DSH_IMAGE_WORKSHOP_OPERATION) ? { operation: env.DSH_IMAGE_WORKSHOP_OPERATION } : {}),
    inputLabels: parseLabels(env.DSH_IMAGE_WORKSHOP_INPUT_LABELS),
    outputLabels: parseLabels(env.DSH_IMAGE_WORKSHOP_OUTPUT_LABELS),
    options: parseOptions(env.DSH_IMAGE_WORKSHOP_OPTIONS),
    logPath: imageDiagnosticLogPath(env),
    redactionValues
  };
}

function recordFor(context: ImageDiagnosticContext, record: ImageDiagnosticRecord): Record<string, unknown> {
  const stage = SAFE_STAGE_NAMES.has(record.stage) ? record.stage : 'harness-cli-spawn';
  const inputs = context.inputLabels?.map((label) => boundedText(label, context));
  const outputs = context.outputLabels?.map((label) => boundedText(label, context));
  const options = context.options
    ? Object.fromEntries(Object.entries(context.options).map(([key, value]) => [key, typeof value === 'string' ? boundedText(value, context) : value]))
    : undefined;
  return {
    schemaVersion: 1,
    at: new Date().toISOString(),
    event: record.event,
    operationId: context.operationId ?? 'unknown',
    toolName: safeToken(context.toolName) ?? safeToken(context.operation) ?? 'image-operation',
    ...(safeToken(context.operation) ? { operation: context.operation } : {}),
    stage,
    ...(executableName(record.executable) ? { executable: executableName(record.executable) } : {}),
    ...(inputs ? { inputs } : {}),
    ...(outputs ? { outputs, expectedPaths: outputs } : {}),
    ...(options ? { options } : {}),
    ...(record.pid !== undefined && Number.isInteger(record.pid) && record.pid >= 0 ? { pid: record.pid } : {}),
    ...(record.startedAt ? { startedAt: record.startedAt } : {}),
    ...(record.finishedAt ? { finishedAt: record.finishedAt } : {}),
    ...(record.elapsedMs !== undefined && Number.isFinite(record.elapsedMs) ? { elapsedMs: Math.max(0, Math.round(record.elapsedMs)) } : {}),
    ...(record.outcome ? { outcome: record.outcome } : {}),
    ...(record.processCleanupConfirmed !== undefined ? { processCleanupConfirmed: record.processCleanupConfirmed } : {}),
    ...(record.errorCode && SAFE_ERROR_CODES.has(record.errorCode) ? { errorCode: record.errorCode } : {})
  };
}

function encodedRecord(context: ImageDiagnosticContext, record: ImageDiagnosticRecord): string {
  const full = `${JSON.stringify(recordFor(context, record))}\n`;
  if (Buffer.byteLength(full, 'utf8') <= DIAGNOSTIC_RECORD_LIMIT) return full;
  const fallback = recordFor(context, {
    event: record.event,
    stage: record.stage,
    executable: record.executable,
    pid: record.pid,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    elapsedMs: record.elapsedMs,
    outcome: record.outcome,
    processCleanupConfirmed: record.processCleanupConfirmed,
    errorCode: record.errorCode
  });
  return `${JSON.stringify(fallback)}\n`;
}

async function appendBoundedLine(path: string, line: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const current = await stat(path).catch(() => undefined);
  if (current && current.size + Buffer.byteLength(line, 'utf8') > IMAGE_DIAGNOSTIC_MAX_BYTES) {
    const rotated = `${path}.1`;
    await rm(rotated, { force: true }).catch(() => undefined);
    await rename(path, rotated).catch(() => undefined);
  }
  await appendFile(path, line, 'utf8');
}

export async function writeImageDiagnostic(context: ImageDiagnosticContext, record: ImageDiagnosticRecord): Promise<void> {
  if (!context.logPath) return;
  context.operationId ??= randomUUID();
  const previous = context.writeChain ?? Promise.resolve();
  const next = previous.then(() => appendBoundedLine(context.logPath!, encodedRecord(context, record))).catch(() => undefined);
  context.writeChain = next;
  await next;
}

function cancellationErrorCode(signal: AbortSignal | undefined): 'CANCELLED' | 'TOOL_TIMEOUT' {
  if (!signal?.aborted) return 'CANCELLED';
  const reason = signal.reason;
  const text = reason instanceof Error ? `${reason.name} ${reason.message}` : String(reason ?? '');
  return /TOOL_TIMEOUT|timeout/i.test(text) ? 'TOOL_TIMEOUT' : 'CANCELLED';
}

function cancellationOutcome(signal: AbortSignal | undefined): DiagnosticOutcome {
  if (!signal?.aborted) return 'failed';
  return cancellationErrorCode(signal) === 'TOOL_TIMEOUT' ? 'timed-out' : 'cancelled';
}

export function imageCommandStage(command: string, args: string[]): string | undefined {
  const executable = executableName(command)?.toLowerCase() ?? '';
  const formatIndex = args.findIndex((arg) => arg === '-format');
  const format = formatIndex >= 0 ? String(args[formatIndex + 1] ?? '') : '';
  if (args.some((arg) => arg === '--version' || arg === '-version')) return 'toolchain-version-check';
  if (executable === 'oxipng' || executable === 'oxipng.exe') return 'oxipng';
  if (format.includes('%w %h')) return 'pixel-dimension-probe';
  if (format.includes('%w|%h|')) return 'metadata-inspection';
  if (args.some((arg) => /^rgba:/i.test(String(arg)))) return 'raw-pixel-extraction';
  if (executable === 'magick' || executable === 'magick.exe') return 'transform-encode';
  return undefined;
}

export function withImageDiagnostics(runner: CommandRunner, context: ImageDiagnosticContext): CommandRunner {
  return async (command: string, args: string[], options: CommandOptions): Promise<CommandResult> => {
    const stage = imageCommandStage(command, args);
    if (!stage) return runner(command, args, options);
    const startedAt = new Date().toISOString();
    const startedTime = Date.now();
    await writeImageDiagnostic(context, { event: 'start', stage, executable: command, startedAt });
    try {
      const result = await runner(command, args, options);
      await writeImageDiagnostic(context, {
        event: 'terminal',
        stage,
        executable: command,
        startedAt,
        finishedAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedTime,
        outcome: options.signal?.aborted ? cancellationOutcome(options.signal) : result.exitCode === 0 ? 'completed' : 'failed',
        ...(result.exitCode === 0 ? {} : { errorCode: options.signal?.aborted ? cancellationErrorCode(options.signal) : 'CHILD_EXIT_NONZERO' })
      });
      return result;
    } catch (error) {
      await writeImageDiagnostic(context, {
        event: 'terminal',
        stage,
        executable: command,
        startedAt,
        finishedAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedTime,
        outcome: options.signal?.aborted ? cancellationOutcome(options.signal) : 'failed',
        errorCode: options.signal?.aborted ? cancellationErrorCode(options.signal) : 'COMMAND_FAILED'
      });
      throw error;
    }
  };
}

export async function runImageDiagnosticStage<T>(
  context: ImageDiagnosticContext | undefined,
  stage: 'atlas-helper',
  executable: string,
  action: () => Promise<T>
): Promise<T> {
  if (!context) return action();
  const startedAt = new Date().toISOString();
  const startedTime = Date.now();
  await writeImageDiagnostic(context, { event: 'start', stage, executable, startedAt });
  try {
    const value = await action();
    await writeImageDiagnostic(context, { event: 'terminal', stage, executable, startedAt, finishedAt: new Date().toISOString(), elapsedMs: Date.now() - startedTime, outcome: 'completed' });
    return value;
  } catch (error) {
    await writeImageDiagnostic(context, { event: 'terminal', stage, executable, startedAt, finishedAt: new Date().toISOString(), elapsedMs: Date.now() - startedTime, outcome: 'failed', errorCode: 'ATLAS_HELPER_FAILED' });
    throw error;
  }
}
