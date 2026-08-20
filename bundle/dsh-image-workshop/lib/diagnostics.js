import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export const IMAGE_DIAGNOSTIC_LOG_NAME = 'image-workshop.jsonl'
export const IMAGE_DIAGNOSTIC_MAX_BYTES = 1 * 1024 * 1024
const IMAGE_DIAGNOSTIC_ROTATED_NAME = `${IMAGE_DIAGNOSTIC_LOG_NAME}.1`
const DIAGNOSTIC_TEXT_LIMIT = 512
const DIAGNOSTIC_LABEL_LIMIT = 160
const DIAGNOSTIC_LABELS_LIMIT = 16
const DIAGNOSTIC_OPTIONS_LIMIT = 16
const DIAGNOSTIC_RECORD_LIMIT = 8 * 1024
const OPERATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const IMAGE_OPERATION_TOOL_NAMES = Object.freeze({
  inspect: 'image_inspect',
  'resize-pixel': 'image_resize_pixel',
  'trim-pad': 'image_trim_pad',
  'sheet-slice': 'image_sheet_slice',
  'sheet-assemble': 'image_sheet_assemble',
  'atlas-pack': 'image_atlas_pack',
  'optimize-png': 'image_optimize_png'
})
const SAFE_ERROR_CODES = new Set([
  'CHILD_EXIT_NONZERO',
  'COMMAND_FAILED',
  'ATLAS_HELPER_FAILED',
  'TERMINATION_FAILED',
  'IMAGE_CANCELLATION_INCOMPLETE',
  'CANCELLED',
  'TOOL_TIMEOUT'
])
const SAFE_OPTION_KEYS = new Set([
  'scale', 'width', 'height', 'trim', 'gravity', 'cellWidth', 'cellHeight',
  'columns', 'inputCount', 'maxSize', 'padding', 'extrusion', 'fixedGrid', 'level'
])
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
])
const SAFE_EXECUTABLE_NAMES = Object.freeze({
  bun: 'bun',
  'bun.exe': 'bun.exe',
  node: 'node',
  'node.exe': 'node.exe',
  magick: 'magick',
  'magick.exe': 'magick.exe',
  oxipng: 'oxipng',
  'oxipng.exe': 'oxipng.exe',
  'free-tex-packer-core': 'free-tex-packer-core'
})

function redactText(value, context) {
  let text = String(value ?? '')
  for (const secret of context?.redactionValues ?? []) text = text.split(secret).join('[redacted]')
  text = text.replace(/(?:DEEPSEEK_API_KEY|DSH_API_KEY|ANIONEX_FREE_VISION|NPM_TOKEN|NODE_AUTH_TOKEN|GITHUB_TOKEN|GITLAB_TOKEN)\s*[:=]\s*[^\s,;}]+/gi, '[redacted]')
  return text.length <= DIAGNOSTIC_TEXT_LIMIT ? text : text.slice(-DIAGNOSTIC_TEXT_LIMIT)
}

function safeRelativeLabel(value) {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const normalized = value.replaceAll('\\', '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized === '.' || normalized === '..') return undefined
  const parts = normalized.split('/')
  if (parts.some((part) => part.length === 0 || part === '..' || part === '.')) return undefined
  return normalized.length <= DIAGNOSTIC_LABEL_LIMIT ? normalized : normalized.slice(0, DIAGNOSTIC_LABEL_LIMIT)
}

function boundedLabels(value) {
  if (!Array.isArray(value)) return undefined
  const labels = value.map(safeRelativeLabel).filter(Boolean).slice(0, DIAGNOSTIC_LABELS_LIMIT)
  return labels.length > 0 ? labels : undefined
}

function safeOptions(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const result = {}
  for (const [key, raw] of Object.entries(value).slice(0, DIAGNOSTIC_OPTIONS_LIMIT)) {
    if (!SAFE_OPTION_KEYS.has(key)) continue
    if (typeof raw === 'boolean' || (typeof raw === 'number' && Number.isFinite(raw))) result[key] = raw
    else if (typeof raw === 'string' && raw.length <= DIAGNOSTIC_LABEL_LIMIT && !/[\\/]/.test(raw)) result[key] = raw
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function operationId(value) {
  return value && OPERATION_ID_PATTERN.test(value) ? value : randomUUID()
}

function safeSignal(value) {
  return typeof value === 'string' && /^[A-Z0-9_]{1,32}$/.test(value) ? value : undefined
}

function toolNameForOperation(operation) {
  return Object.prototype.hasOwnProperty.call(IMAGE_OPERATION_TOOL_NAMES, operation)
    ? IMAGE_OPERATION_TOOL_NAMES[operation]
    : undefined
}

function safeErrorCode(value) {
  return typeof value === 'string' && SAFE_ERROR_CODES.has(value) ? value : undefined
}

function executableName(value) {
  if (!value) return undefined
  const name = basename(String(value).replaceAll('\\', '/')).toLowerCase()
  return SAFE_EXECUTABLE_NAMES[name] ?? 'unknown'
}

function diagnosticLogPath(env) {
  if (env.DSH_IMAGE_WORKSHOP_LOG) return env.DSH_IMAGE_WORKSHOP_LOG
  if (env.DSH_RPGMAKER_LOG_DIR) return join(env.DSH_RPGMAKER_LOG_DIR, IMAGE_DIAGNOSTIC_LOG_NAME)
  const mutableRoot = env.DSH_RPGMAKER_DATA_ROOT ?? env.DSH_RPGMAKER_MUTABLE_ROOT
  if (mutableRoot) return join(mutableRoot, 'logs', IMAGE_DIAGNOSTIC_LOG_NAME)
  if (env.DSH_HOME) return join(dirname(env.DSH_HOME), 'logs', IMAGE_DIAGNOSTIC_LOG_NAME)
  return undefined
}

export function createImageDiagnosticContext(operation, env = process.env, metadata = {}) {
  const redactionValues = [
    env.DEEPSEEK_API_KEY,
    env.DSH_API_KEY,
    env.ANIONEX_FREE_VISION,
    env.NPM_TOKEN,
    env.NODE_AUTH_TOKEN,
    env.GITHUB_TOKEN,
    env.GITLAB_TOKEN
  ].filter((value) => typeof value === 'string' && value.length > 0)
  const toolName = toolNameForOperation(operation)
  return {
    operationId: operationId(metadata.operationId ?? env.DSH_IMAGE_WORKSHOP_OPERATION_ID),
    operation,
    ...(toolName ? { toolName } : {}),
    inputLabels: boundedLabels(metadata.inputLabels),
    outputLabels: boundedLabels(metadata.outputLabels),
    options: safeOptions(metadata.options),
    logPath: metadata.logPath ?? diagnosticLogPath(env),
    redactionValues,
    writeChain: undefined,
    pid: undefined
  }
}

function recordFor(context, record) {
  const stage = SAFE_STAGE_NAMES.has(record.stage) ? record.stage : 'harness-cli-spawn'
  const inputs = context.inputLabels?.map((label) => redactText(label, context))
  const outputs = context.outputLabels?.map((label) => redactText(label, context))
  const options = context.options
    ? Object.fromEntries(Object.entries(context.options).map(([key, value]) => [key, typeof value === 'string' ? redactText(value, context) : value]))
    : undefined
  const toolName = toolNameForOperation(context.operation)
  return {
    schemaVersion: 1,
    at: new Date().toISOString(),
    event: record.event,
    operationId: operationId(context.operationId),
    toolName: toolName ?? 'image-operation',
    ...(toolName ? { operation: context.operation } : {}),
    stage,
    ...(executableName(record.executable) ? { executable: executableName(record.executable) } : {}),
    ...(inputs ? { inputs } : {}),
    ...(outputs ? { outputs, expectedPaths: outputs } : {}),
    ...(options ? { options } : {}),
    ...(Number.isInteger(record.pid) && record.pid >= 0 ? { pid: record.pid } : {}),
    ...(Number.isInteger(record.exitCode) ? { exitCode: record.exitCode } : {}),
    ...(safeSignal(record.signal) ? { signal: record.signal } : {}),
    ...(record.startedAt ? { startedAt: record.startedAt } : {}),
    ...(record.finishedAt ? { finishedAt: record.finishedAt } : {}),
    ...(Number.isFinite(record.elapsedMs) ? { elapsedMs: Math.max(0, Math.round(record.elapsedMs)) } : {}),
    ...(record.outcome ? { outcome: record.outcome } : {}),
    ...(record.processCleanupConfirmed !== undefined ? { processCleanupConfirmed: record.processCleanupConfirmed } : {}),
    ...(safeErrorCode(record.errorCode) ? { errorCode: record.errorCode } : {})
  }
}

function encodedRecord(context, record) {
  const full = `${JSON.stringify(recordFor(context, record))}\n`
  if (Buffer.byteLength(full, 'utf8') <= DIAGNOSTIC_RECORD_LIMIT) return full
  return `${JSON.stringify(recordFor(context, {
    event: record.event,
    stage: record.stage,
    executable: record.executable,
    pid: record.pid,
    exitCode: record.exitCode,
    signal: record.signal,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    elapsedMs: record.elapsedMs,
    outcome: record.outcome,
    processCleanupConfirmed: record.processCleanupConfirmed,
    errorCode: record.errorCode
  }))}\n`
}

async function appendBoundedLine(path, line) {
  await mkdir(dirname(path), { recursive: true })
  const current = await stat(path).catch(() => undefined)
  if (current && current.size + Buffer.byteLength(line, 'utf8') > IMAGE_DIAGNOSTIC_MAX_BYTES) {
    const rotated = `${path}.1`
    await rm(rotated, { force: true }).catch(() => undefined)
    await rename(path, rotated).catch(() => undefined)
  }
  await appendFile(path, line, 'utf8')
}

export function appendImageDiagnostic(context, record) {
  if (!context.logPath) return Promise.resolve()
  context.operationId = operationId(context.operationId)
  const previous = context.writeChain ?? Promise.resolve()
  const next = previous.then(() => appendBoundedLine(context.logPath, encodedRecord(context, record))).catch(() => undefined)
  context.writeChain = next
  return next
}

export function diagnosticAbortOutcome(signal) {
  if (!signal?.aborted) return 'failed'
  const reason = signal.reason
  const text = reason instanceof Error ? `${reason.name} ${reason.message}` : String(reason ?? '')
  return /TOOL_TIMEOUT|timeout/i.test(text) ? 'timed-out' : 'cancelled'
}

export function diagnosticEntry(context, event, stage, executable, values = {}) {
  return {
    event,
    stage,
    executable,
    ...(values.pid !== undefined ? { pid: values.pid } : {}),
    ...(values.exitCode !== undefined ? { exitCode: values.exitCode } : {}),
    ...(values.signal !== undefined ? { signal: values.signal } : {}),
    ...(values.startedAt ? { startedAt: values.startedAt } : {}),
    ...(values.finishedAt ? { finishedAt: values.finishedAt } : {}),
    ...(values.elapsedMs !== undefined ? { elapsedMs: values.elapsedMs } : {}),
    ...(values.outcome ? { outcome: values.outcome } : {}),
    ...(values.processCleanupConfirmed !== undefined ? { processCleanupConfirmed: values.processCleanupConfirmed } : {}),
    ...(values.errorCode ? { errorCode: values.errorCode } : {})
  }
}
