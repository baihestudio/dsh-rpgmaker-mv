/**
 * Thin client for the harness Image Workshop CLI.
 *
 * The plugin never constructs ImageMagick or shell commands. It invokes the
 * harness CLI (resolved through DSH_IMAGE_WORKSHOP_CLI, an internal launcher
 * detail) with structured argv and parses the canonical JSON the CLI emits.
 * Each invocation owns one CLI process tree. Cancellation is cooperative at
 * the DSH boundary, then bounded cleanup confirms the child exit or reports a
 * truthful cleanup-unconfirmed error.
 */
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { spawn } from 'node:child_process'

const SECRET_KEYS = [
  'DEEPSEEK_API_KEY',
  'DSH_API_KEY',
  'ANIONEX_FREE_VISION',
  'NPM_TOKEN',
  'NODE_AUTH_TOKEN',
  'GITHUB_TOKEN',
  'GITLAB_TOKEN'
]

/** The only grace after the official tool budget that this plugin owns. */
export const IMAGE_OPERATION_CLEANUP_GRACE_MS = 5000
const TERMINATION_COMMAND_TIMEOUT_MS = 1000
const FORCE_KILL_DELAY_MS = 1000

/**
 * Bounded manifest output ceiling.
 *
 * The CLI echoes the canonical manifest to stdout. Sheet slicing is bounded to
 * 4096 frames (Image Workshop resource contract), each frame entry ~430 bytes
 * pretty-printed (~1.8 MiB worst case); atlas packing is bounded by the pixel
 * budget and a 120 s operation deadline, with realistic input counts staying
 * far below this ceiling. The accumulator preserves complete JSON below the
 * ceiling and fails loudly on overflow instead of slicing a truncated manifest
 * that could never be parsed (which previously surfaced as a successful commit
 * followed by a "no parseable JSON" error and an "output already exists" retry
 * trap).
 */
const MANIFEST_OUTPUT_LIMIT = 4 * 1024 * 1024

/** Bounded tail for error text; errors never carry the full canonical manifest. */
const ERROR_OUTPUT_LIMIT = 16 * 1024
const DIAGNOSTIC_TEXT_LIMIT = 512
const DIAGNOSTIC_LABEL_LIMIT = 160
const DIAGNOSTIC_LABELS_LIMIT = 16

/** Test-owned seams; production uses real child processes. */
let workshopRunner
let childSpawner
let treeTerminator

export function setWorkshopRunner(runner) {
  workshopRunner = runner
}

export function clearWorkshopRunner() {
  workshopRunner = undefined
}

export function setChildSpawner(spawner) {
  childSpawner = spawner
}

export function clearChildSpawner() {
  childSpawner = undefined
}

export function setTreeTerminator(terminator) {
  treeTerminator = terminator
}

export function clearTreeTerminator() {
  treeTerminator = undefined
}

/** Environment passed to the Image Workshop subprocess; credential values are never forwarded. */
export function workshopEnvironment(env = process.env) {
  const safe = { ...env }
  for (const key of SECRET_KEYS) {
    const found = Object.keys(safe).find((candidate) => candidate.toLowerCase() === key.toLowerCase())
    if (found) delete safe[found]
  }
  return safe
}

function boundedText(value, context) {
  let text = String(value ?? '')
  for (const secret of context?.redactionValues ?? []) text = text.split(secret).join('[redacted]')
  text = text.replace(/(?:DEEPSEEK_API_KEY|DSH_API_KEY|ANIONEX_FREE_VISION|NPM_TOKEN|NODE_AUTH_TOKEN|GITHUB_TOKEN|GITLAB_TOKEN)\s*[:=]\s*[^\s,;}]+/gi, '[redacted]')
  return text.length <= DIAGNOSTIC_TEXT_LIMIT ? text : text.slice(-DIAGNOSTIC_TEXT_LIMIT)
}

function boundedLabels(values) {
  if (!Array.isArray(values)) return undefined
  const labels = values
    .filter((value) => typeof value === 'string')
    .slice(0, DIAGNOSTIC_LABELS_LIMIT)
    .map((value) => value.length <= DIAGNOSTIC_LABEL_LIMIT ? value : value.slice(0, DIAGNOSTIC_LABEL_LIMIT))
  return labels.length > 0 ? labels : undefined
}

function diagnosticLogPath(env) {
  const explicit = env.DSH_IMAGE_WORKSHOP_LOG
  if (explicit) return explicit
  const logDir = env.DSH_RPGMAKER_LOG_DIR
  if (logDir) return join(logDir, 'image-workshop.jsonl')
  const mutableRoot = env.DSH_RPGMAKER_DATA_ROOT ?? env.DSH_RPGMAKER_MUTABLE_ROOT
  if (mutableRoot) return join(mutableRoot, 'logs', 'image-workshop.jsonl')
  if (env.DSH_HOME) return join(dirname(env.DSH_HOME), 'logs', 'image-workshop.jsonl')
  return undefined
}

function operationContext(operation, env, diagnostics = {}) {
  const redactionValues = SECRET_KEYS
    .map((key) => Object.entries(env ?? {}).find(([candidate]) => candidate.toLowerCase() === key.toLowerCase())?.[1])
    .filter((value) => typeof value === 'string' && value.length > 0)
  return {
    operationId: typeof diagnostics.operationId === 'string' && diagnostics.operationId.length > 0 ? diagnostics.operationId : randomUUID(),
    operation,
    toolName: typeof diagnostics.toolName === 'string' ? diagnostics.toolName : undefined,
    inputLabels: boundedLabels(diagnostics.inputLabels),
    outputLabels: boundedLabels(diagnostics.outputLabels),
    stagingLocation: typeof diagnostics.stagingLocation === 'string' ? diagnostics.stagingLocation : undefined,
    logPath: diagnostics.logPath ?? diagnosticLogPath(env),
    redactionValues,
    cleanupConfirmed: undefined,
    terminationLog: undefined,
    diagnosticChain: undefined
  }
}

function diagnosticEntry(context, event, stage, executable, values = {}) {
  return {
    schemaVersion: 1,
    at: new Date().toISOString(),
    event,
    operationId: context.operationId,
    toolName: context.toolName ?? context.operation,
    operation: context.operation,
    stage,
    executable: executable ? basename(String(executable).replaceAll('\\', '/')) : undefined,
    ...(context.inputLabels ? { inputs: context.inputLabels } : {}),
    ...(context.outputLabels ? { outputs: context.outputLabels } : {}),
    ...(values.pid !== undefined ? { pid: values.pid } : {}),
    ...(values.startedAt ? { startedAt: values.startedAt } : {}),
    ...(values.finishedAt ? { finishedAt: values.finishedAt } : {}),
    ...(values.elapsedMs !== undefined ? { elapsedMs: values.elapsedMs } : {}),
    ...(values.outcome ? { outcome: values.outcome } : {}),
    ...(values.error ? { error: boundedText(values.error, context) } : {}),
    ...(values.stagingLocation ? { stagingLocation: boundedText(values.stagingLocation, context) } : {})
  }
}

function appendDiagnostic(context, entry) {
  if (!context.logPath) return Promise.resolve()
  const previous = context.diagnosticChain ?? Promise.resolve()
  const next = previous.then(async () => {
    try {
      await mkdir(dirname(context.logPath), { recursive: true })
      await appendFile(context.logPath, `${JSON.stringify(entry)}\n`, 'utf8')
    } catch {
      // Diagnostics must never turn a bounded image failure into another hang.
    }
  })
  context.diagnosticChain = next.catch(() => undefined)
  return next
}

function executableBasename(command) {
  return basename(String(command).replaceAll('\\', '/'))
}

function isRunning(child) {
  return child && child.exitCode == null && child.signalCode == null
}

function cancellationKind(signal) {
  if (!signal) return 'cancelled'
  const reason = signal.reason
  const text = reason instanceof Error ? `${reason.name} ${reason.message}` : String(reason ?? '')
  return /TOOL_TIMEOUT|timeout/i.test(text) ? 'timed-out' : 'cancelled'
}

function operationError(message, code, info = {}) {
  const error = new Error(message)
  error.code = code
  error.info = { name: code === 'CLEANUP_UNCONFIRMED' ? 'CleanupUnconfirmedError' : 'ImageOperationError', code, ...info }
  return error
}

function cancellationError(context, signal) {
  const kind = cancellationKind(signal)
  if (context.cleanupConfirmed === false) {
    const pid = context.pid === undefined ? 'unknown' : String(context.pid)
    const staging = context.stagingLocation ?? `the staging location recorded in ${context.logPath ?? 'image-workshop.jsonl'}`
    return operationError(`image workspace operation ${kind} cleanup-unconfirmed: the Harness CLI process tree did not confirm termination (PID ${pid}); inspect ${staging} before retrying.`, 'CLEANUP_UNCONFIRMED', { pid: context.pid, stagingLocation: staging, outcome: 'cleanup-unconfirmed' })
  }
  return operationError(`image workspace operation was ${kind}.`, kind === 'timed-out' ? 'TOOL_TIMEOUT' : 'TOOL_CANCELLED', { outcome: kind })
}

function defaultSpawn(bun, args, options) {
  return spawn(bun, args, options)
}

function waitForTerminationCommand(child, timeoutMs) {
  if (!child || typeof child.once !== 'function') return Promise.resolve()
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.removeListener?.('error', onError)
      child.removeListener?.('close', onClose)
      error ? rejectPromise(error) : resolvePromise()
    }
    const onError = (error) => finish(error)
    const onClose = (code) => code === null || code === 0 ? finish() : finish(new Error(`process-tree termination command exited with code ${code}`))
    const timer = setTimeout(() => {
      try { child.kill?.() } catch { /* the bounded wait is already the truth */ }
      finish(new Error('process-tree termination command timed out'))
    }, timeoutMs)
    child.once('error', onError)
    child.once('close', onClose)
  })
}

/**
 * Request termination of the CLI and everything it spawned. POSIX children are
 * spawned as process-group leaders so a negative-pid signal reaches the whole
 * tree; Windows uses taskkill /T /F. The caller separately bounds the wait and
 * performs one direct-child/process-group force escalation.
 */
async function defaultTerminateTree(child, options = {}) {
  if (!isRunning(child)) return
  const platform = options.platform ?? process.platform
  if (platform === 'win32' && child.pid !== undefined) {
    const taskkill = options.env?.SystemRoot
      ? join(options.env.SystemRoot, 'System32', 'taskkill.exe')
      : 'taskkill.exe'
    const killer = spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], {
      env: workshopEnvironment(options.env ?? process.env),
      stdio: 'ignore',
      windowsHide: true
    })
    await waitForTerminationCommand(killer, options.timeoutMs ?? TERMINATION_COMMAND_TIMEOUT_MS)
    return
  }
  if (child.pid !== undefined && platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGTERM')
      return
    } catch {
      // Fall through to the direct child handle when the group is already gone
      // or the test-owned handle has no real process group.
    }
  }
  try {
    if (!child.kill('SIGTERM')) throw new Error('the child process rejected termination')
  } catch (error) {
    throw operationError(`the image CLI process could not be terminated: ${error instanceof Error ? error.message : String(error)}`, 'CLEANUP_UNCONFIRMED')
  }
}

function forceTerminateTree(child, platform) {
  if (!isRunning(child)) return
  if (platform !== 'win32' && child.pid !== undefined) {
    try {
      process.kill(-child.pid, 'SIGKILL')
      return
    } catch {
      // The direct handle is the remaining escalation path.
    }
  }
  try {
    child.kill(platform === 'win32' ? undefined : 'SIGKILL')
  } catch {
    // The cleanup deadline records the unconfirmed state if the child remains.
  }
}

function cleanupListeners(child, signal, onAbort, onClose, onError, onExit, onStdout, onStderr) {
  signal?.removeEventListener?.('abort', onAbort)
  child.removeListener?.('close', onClose)
  child.removeListener?.('error', onError)
  child.removeListener?.('exit', onExit)
  child.stdout?.removeListener?.('data', onStdout)
  child.stderr?.removeListener?.('data', onStderr)
}

async function runReal(args, env, signal, context) {
  const cli = env.DSH_IMAGE_WORKSHOP_CLI
  if (!cli) {
    throw new Error('image workspace: DSH_IMAGE_WORKSHOP_CLI is not configured; the harness launcher must set it.')
  }
  const bun = env.BUN_EXECUTABLE ?? 'bun'
  const platform = process.platform
  if (signal?.aborted) {
    context.cleanupConfirmed = true
    throw cancellationError(context, signal)
  }
  const spawnChild = childSpawner ?? defaultSpawn
  const terminateTree = treeTerminator ?? defaultTerminateTree
  const startedAt = new Date().toISOString()
  const startedTime = Date.now()
  await appendDiagnostic(context, diagnosticEntry(context, 'start', 'harness-cli', bun, { startedAt }))
  return new Promise((resolvePromise, rejectPromise) => {
    let child
    try {
      child = spawnChild(bun, [cli, 'image', ...args], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: platform !== 'win32'
      })
    } catch (error) {
      void appendDiagnostic(context, diagnosticEntry(context, 'terminal', 'harness-cli', bun, {
        startedAt,
        finishedAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedTime,
        outcome: 'failed',
        error: error instanceof Error ? error.message : String(error)
      }))
      rejectPromise(error)
      return
    }
    context.pid = child.pid
    void appendDiagnostic(context, diagnosticEntry(context, 'stage', 'harness-cli', bun, { pid: child.pid, startedAt, outcome: 'spawned' }))

    let stdout = ''
    let stderr = ''
    let stdoutOverflow = false
    let aborted = false
    let forceKillAttempted = false
    let settled = false
    let terminationError
    let forceKillTimer
    let cleanupTimer
    let terminationStarted = false

    const finish = (kind, value) => {
      if (settled) return
      settled = true
      if (forceKillTimer) clearTimeout(forceKillTimer)
      if (cleanupTimer) clearTimeout(cleanupTimer)
      cleanupListeners(child, signal, onAbort, onClose, onError, onExit, onStdout, onStderr)
      if (kind === 'resolve') resolvePromise(value)
      else rejectPromise(value)
    }

    const finishCancellation = (confirmed) => {
      if (settled) return
      context.cleanupConfirmed = confirmed
      context.terminationLog = appendDiagnostic(context, diagnosticEntry(context, 'terminal', 'termination', bun, {
        pid: child.pid,
        startedAt,
        finishedAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedTime,
        outcome: confirmed ? cancellationKind(signal) : 'cleanup-unconfirmed',
        error: terminationError?.message,
        stagingLocation: context.stagingLocation
      }))
      finish('reject', cancellationError(context, signal))
    }

    const escalate = () => {
      if (settled || !aborted || forceKillAttempted || !isRunning(child)) return
      forceKillAttempted = true
      void appendDiagnostic(context, diagnosticEntry(context, 'start', 'termination', executableBasename(bun), {
        pid: child.pid,
        startedAt: new Date().toISOString()
      }))
      forceTerminateTree(child, platform)
    }

    const startTermination = () => {
      if (terminationStarted || settled) return
      terminationStarted = true
      void appendDiagnostic(context, diagnosticEntry(context, 'start', 'termination', executableBasename(bun), {
        pid: child.pid,
        startedAt: new Date().toISOString()
      }))
      forceKillTimer = setTimeout(escalate, FORCE_KILL_DELAY_MS)
      cleanupTimer = setTimeout(() => {
        if (!aborted || settled) return
        finishCancellation(!isRunning(child))
      }, IMAGE_OPERATION_CLEANUP_GRACE_MS)
      try {
        const result = terminateTree(child, { env, platform, timeoutMs: TERMINATION_COMMAND_TIMEOUT_MS })
        Promise.resolve(result).then(() => {
          if (aborted && !isRunning(child)) finishCancellation(true)
        }, (error) => {
          terminationError = error instanceof Error ? error : new Error(String(error))
        })
      } catch (error) {
        terminationError = error instanceof Error ? error : new Error(String(error))
      }
    }

    const onAbort = () => {
      if (aborted || settled) return
      aborted = true
      if (isRunning(child)) startTermination()
      else finishCancellation(true)
    }
    const onStdout = (chunk) => {
      if (stdoutOverflow) return
      stdout += chunk
      if (stdout.length > MANIFEST_OUTPUT_LIMIT) {
        stdoutOverflow = true
        stdout = ''
      }
    }
    const onStderr = (chunk) => {
      stderr += chunk
      if (stderr.length > ERROR_OUTPUT_LIMIT) stderr = stderr.slice(-ERROR_OUTPUT_LIMIT)
    }
    const onError = (error) => {
      if (aborted) {
        if (!isRunning(child)) finishCancellation(true)
        return
      }
      finish('reject', error)
    }
    const onExit = () => {
      if (aborted) finishCancellation(true)
    }
    const onClose = (code) => {
      if (aborted) {
        finishCancellation(true)
        return
      }
      if (stdoutOverflow) {
        finish('reject', new Error(`image workspace operation output exceeded the bounded manifest limit; refusing to parse a truncated manifest for ${args[0]}.`))
        return
      }
      if (code === 0) finish('resolve', stdout)
      else finish('reject', new Error(`image workspace CLI failed (exit ${code ?? 'signal'}): ${(stderr.trim() || stdout.trim()).slice(-ERROR_OUTPUT_LIMIT)}`))
    }

    child.stdout?.on('data', onStdout)
    child.stderr?.on('data', onStderr)
    child.on('error', onError)
    child.on('exit', onExit)
    child.on('close', onClose)
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    }
  })
}

function runInjected(runner, bun, args, env, signal, context) {
  if (signal?.aborted) {
    context.cleanupConfirmed = true
    return Promise.reject(cancellationError(context, signal))
  }
  const value = Promise.resolve().then(() => runner(bun, args, env, signal))
  if (!signal) return value
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false
    const onAbort = () => {
      if (settled) return
      settled = true
      context.cleanupConfirmed = true
      signal.removeEventListener('abort', onAbort)
      rejectPromise(cancellationError(context, signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    value.then((result) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      resolvePromise(result)
    }, (error) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      rejectPromise(error)
    })
  })
}

function diagnosticOutcome(error, signal) {
  if (!error) return 'completed'
  if (error.code === 'CLEANUP_UNCONFIRMED') return 'cleanup-unconfirmed'
  if (signal?.aborted) return cancellationKind(signal)
  return 'failed'
}

/**
 * Run one Image Workshop operation with structured argv and parse the canonical
 * JSON the CLI writes to stdout. An injected runner receives the operation argv
 * (without the CLI entry) and the optional abort signal; the real path prepends
 * the harness CLI and owns bounded process-tree cleanup.
 */
export async function invokeImageOperation(operation, cliArgs, env = process.env, signal, diagnostics = {}) {
  const args = [operation, ...cliArgs]
  const rawEnv = env ?? process.env
  const safeEnv = workshopEnvironment(rawEnv)
  const context = operationContext(operation, rawEnv, diagnostics)
  const operationEnv = {
    ...safeEnv,
    DSH_IMAGE_WORKSHOP_OPERATION_ID: context.operationId,
    DSH_IMAGE_WORKSHOP_TOOL_NAME: context.toolName ?? operation,
    DSH_IMAGE_WORKSHOP_OPERATION: operation,
    ...(context.inputLabels ? { DSH_IMAGE_WORKSHOP_INPUT_LABELS: JSON.stringify(context.inputLabels) } : {}),
    ...(context.outputLabels ? { DSH_IMAGE_WORKSHOP_OUTPUT_LABELS: JSON.stringify(context.outputLabels) } : {}),
    ...(context.stagingLocation ? { DSH_IMAGE_WORKSHOP_STAGING: context.stagingLocation } : {})
  }
  const startedAt = new Date().toISOString()
  const startedTime = Date.now()
  if (workshopRunner) {
    await appendDiagnostic(context, diagnosticEntry(context, 'start', 'harness-cli', safeEnv.BUN_EXECUTABLE ?? 'bun', { startedAt }))
  }
  try {
    const stdout = workshopRunner
      ? await runInjected(workshopRunner, safeEnv.BUN_EXECUTABLE ?? 'bun', args, operationEnv, signal, context)
      : await runReal(args, operationEnv, signal, context)
    if (signal?.aborted) {
      context.cleanupConfirmed = context.cleanupConfirmed ?? true
      throw cancellationError(context, signal)
    }
    const trimmed = String(stdout ?? '').trim()
    let parsed
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error(`image workspace CLI returned no parseable JSON for ${operation}.`)
    }
    await appendDiagnostic(context, diagnosticEntry(context, 'terminal', 'harness-cli', safeEnv.BUN_EXECUTABLE ?? 'bun', {
      startedAt,
      finishedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedTime,
      outcome: 'completed'
    }))
    return parsed
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error))
    if (context.terminationLog) await context.terminationLog
    await appendDiagnostic(context, diagnosticEntry(context, 'terminal', 'harness-cli', safeEnv.BUN_EXECUTABLE ?? 'bun', {
      startedAt,
      finishedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedTime,
      outcome: diagnosticOutcome(failure, signal),
      error: failure.message,
      pid: context.pid,
      stagingLocation: context.stagingLocation
    }))
    throw failure
  }
}
