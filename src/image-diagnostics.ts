import { appendFile, mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import type { CommandOptions, CommandRunner, CommandResult } from './process';

const TEXT_LIMIT = 512;
const LABEL_LIMIT = 160;
const LABELS_LIMIT = 16;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export interface ImageDiagnosticContext {
  operationId?: string;
  toolName?: string;
  operation?: string;
  inputLabels?: string[];
  outputLabels?: string[];
  stagingLocation?: string;
  logPath?: string;
  /** Kept only in memory so bounded error excerpts can redact inherited credentials. */
  redactionValues?: string[];
}

export interface ImageDiagnosticRecord {
  event: 'start' | 'terminal' | 'stage';
  stage: string;
  executable?: string;
  pid?: number;
  outcome?: 'completed' | 'failed' | 'timed-out' | 'cancelled' | 'cleanup-unconfirmed' | 'spawned';
  startedAt?: string;
  finishedAt?: string;
  elapsedMs?: number;
  error?: string;
  stagingLocation?: string;
}

function boundedText(value: unknown, context?: ImageDiagnosticContext): string {
  let redacted = String(value ?? '');
  for (const secret of context?.redactionValues ?? []) redacted = redacted.split(secret).join('[redacted]');
  redacted = redacted.replace(
    /(DEEPSEEK_API_KEY|DSH_API_KEY|ANIONEX_FREE_VISION|NPM_TOKEN|NODE_AUTH_TOKEN|GITHUB_TOKEN|GITLAB_TOKEN)\s*[:=]\s*[^\s,;}]+/gi,
    '$1[redacted]'
  );
  return redacted.length <= TEXT_LIMIT ? redacted : redacted.slice(-TEXT_LIMIT);
}

function labels(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value
    .filter((entry): entry is string => typeof entry === 'string')
    .slice(0, LABELS_LIMIT)
    .map((entry) => entry.length <= LABEL_LIMIT ? entry : entry.slice(0, LABEL_LIMIT));
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

export function imageDiagnosticLogPath(env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.DSH_IMAGE_WORKSHOP_LOG) return env.DSH_IMAGE_WORKSHOP_LOG;
  if (env.DSH_RPGMAKER_LOG_DIR) return join(env.DSH_RPGMAKER_LOG_DIR, 'image-workshop.jsonl');
  const mutableRoot = env.DSH_RPGMAKER_DATA_ROOT ?? env.DSH_RPGMAKER_MUTABLE_ROOT;
  if (mutableRoot) return join(mutableRoot, 'logs', 'image-workshop.jsonl');
  if (env.DSH_HOME) return join(dirname(env.DSH_HOME), 'logs', 'image-workshop.jsonl');
  return undefined;
}

export function imageDiagnosticContextFromEnvironment(env: Record<string, string | undefined> = process.env): ImageDiagnosticContext {
  const operationId = env.DSH_IMAGE_WORKSHOP_OPERATION_ID;
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
    ...(operationId && OPERATION_ID_PATTERN.test(operationId) ? { operationId } : {}),
    ...(env.DSH_IMAGE_WORKSHOP_TOOL_NAME ? { toolName: env.DSH_IMAGE_WORKSHOP_TOOL_NAME } : {}),
    ...(env.DSH_IMAGE_WORKSHOP_OPERATION ? { operation: env.DSH_IMAGE_WORKSHOP_OPERATION } : {}),
    inputLabels: parseLabels(env.DSH_IMAGE_WORKSHOP_INPUT_LABELS),
    outputLabels: parseLabels(env.DSH_IMAGE_WORKSHOP_OUTPUT_LABELS),
    ...(env.DSH_IMAGE_WORKSHOP_STAGING ? { stagingLocation: boundedText(env.DSH_IMAGE_WORKSHOP_STAGING) } : {}),
    logPath: imageDiagnosticLogPath(env),
    redactionValues
  };
}

function executableName(value: string | undefined): string | undefined {
  return value ? basename(value.replaceAll('\\', '/')) : undefined;
}

function recordFor(context: ImageDiagnosticContext, record: ImageDiagnosticRecord): Record<string, unknown> {
  return {
    schemaVersion: 1,
    at: new Date().toISOString(),
    event: record.event,
    operationId: context.operationId ?? 'unknown',
    toolName: context.toolName ?? context.operation ?? 'image-operation',
    ...(context.operation ? { operation: context.operation } : {}),
    stage: record.stage,
    ...(record.executable ? { executable: executableName(record.executable) } : {}),
    ...(context.inputLabels ? { inputs: context.inputLabels } : {}),
    ...(context.outputLabels ? { outputs: context.outputLabels } : {}),
    ...(record.pid !== undefined ? { pid: record.pid } : {}),
    ...(record.startedAt ? { startedAt: record.startedAt } : {}),
    ...(record.finishedAt ? { finishedAt: record.finishedAt } : {}),
    ...(record.elapsedMs !== undefined ? { elapsedMs: record.elapsedMs } : {}),
    ...(record.outcome ? { outcome: record.outcome } : {}),
    ...(record.error ? { error: boundedText(record.error, context) } : {}),
    ...(record.stagingLocation ?? context.stagingLocation ? { stagingLocation: boundedText(record.stagingLocation ?? context.stagingLocation, context) } : {})
  };
}

export async function writeImageDiagnostic(context: ImageDiagnosticContext, record: ImageDiagnosticRecord): Promise<void> {
  if (!context.logPath) return;
  try {
    await mkdir(dirname(context.logPath), { recursive: true });
    await appendFile(context.logPath, `${JSON.stringify(recordFor(context, record))}\n`, 'utf8');
  } catch {
    // Operational evidence is best effort and must never block the image call.
  }
}

export function imageCommandStage(command: string, args: string[]): string {
  const executable = executableName(command)?.toLowerCase() ?? '';
  const lowerArgs = args.map((arg) => String(arg).toLowerCase());
  if (lowerArgs.includes('--version') || lowerArgs.includes('-version')) return 'toolchain-version-check';
  if (executable.includes('oxipng')) return 'oxipng-optimization';
  if (lowerArgs.includes('info:') && lowerArgs.includes('-format')) return 'metadata-inspection';
  if (args.some((arg) => /^rgba:/i.test(String(arg)))) return 'raw-pixel-extraction';
  if (executable.includes('magick') || executable.includes('convert')) return 'transform-encode';
  return 'external-command';
}

export function withImageDiagnostics(runner: CommandRunner, context: ImageDiagnosticContext): CommandRunner {
  return async (command: string, args: string[], options: CommandOptions): Promise<CommandResult> => {
    if (options.signal?.aborted) throw new Error('image workspace operation was cancelled.');
    const stage = imageCommandStage(command, args);
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
        outcome: options.signal?.aborted
          ? (/timeout/i.test(String(options.signal.reason ?? '')) ? 'timed-out' : 'cancelled')
          : result.exitCode === 0 ? 'completed' : 'failed',
        error: result.exitCode === 0 ? undefined : result.stderr || result.stdout
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
        outcome: options.signal?.aborted ? 'cancelled' : 'failed',
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  };
}
