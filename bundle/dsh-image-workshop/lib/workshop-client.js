/**
 * Thin client for the harness Image Workshop CLI.
 *
 * The plugin never constructs ImageMagick or shell commands. It invokes the
 * harness CLI (resolved through DSH_IMAGE_WORKSHOP_CLI, an internal launcher
 * detail) with structured argv and parses the canonical JSON the CLI emits.
 * Each invocation owns one CLI process tree. Cancellation is cooperative at
 * the DSH boundary, then bounded cleanup requires the Node child `close`
 * event and a non-running child before it is considered confirmed.
 */
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { basename, join } from 'node:path'
import { appendImageDiagnostic, createImageDiagnosticContext, diagnosticAbortOutcome, diagnosticEntry } from './diagnostics.js'

const SECRET_KEYS = [
  'DEEPSEEK_API_KEY',
  'DSH_API_KEY',
  'NPM_TOKEN',
  'NODE_AUTH_TOKEN',
  'GITHUB_TOKEN',
  'GITLAB_TOKEN'
]
const OWNED_DIAGNOSTIC_ENV_KEYS = [
  'DSH_IMAGE_WORKSHOP_OPERATION_ID',
  'DSH_IMAGE_WORKSHOP_TOOL_NAME',
  'DSH_IMAGE_WORKSHOP_OPERATION',
  'DSH_IMAGE_WORKSHOP_INPUT_LABELS',
  'DSH_IMAGE_WORKSHOP_OUTPUT_LABELS',
  'DSH_IMAGE_WORKSHOP_OPTIONS'
]
const IMAGE_OPERATION_TOOL_NAMES = Object.freeze({
  inspect: 'image_inspect',
  'resize-pixel': 'image_resize_pixel',
  'trim-pad': 'image_trim_pad',
  'sheet-slice': 'image_sheet_slice',
  'sheet-assemble': 'image_sheet_assemble',
  'atlas-pack': 'image_atlas_pack',
  'optimize-png': 'image_optimize_png'
})
const SAFE_SIGNAL_PATTERN = /^[A-Z0-9_]{1,32}$/
const SAFE_EXECUTABLE_NAMES = new Set([
  'bun',
  'bun.exe',
  'node',
  'node.exe',
  'magick',
  'magick.exe',
  'oxipng',
  'oxipng.exe',
  'free-tex-packer-core'
])

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
 * budget, with realistic input counts staying far below this ceiling. The
 * accumulator preserves complete JSON below the ceiling and fails loudly on
 * overflow instead of parsing a truncated manifest.
 */
const MANIFEST_OUTPUT_LIMIT = 4 * 1024 * 1024

/** Test-owned seams; production uses real child processes. */
let workshopRunner
let childSpawner
let treeTerminator
let terminationCommandSpawner
let cleanupTimerScheduler

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

export function setTerminationCommandSpawner(spawner) {
  terminationCommandSpawner = spawner
}

export function clearTerminationCommandSpawner() {
  terminationCommandSpawner = undefined
}

/** Test-owned timing seam; production always uses the fixed five-second grace. */
export function setCleanupTimerScheduler(scheduler) {
  cleanupTimerScheduler = scheduler
}

export function clearCleanupTimerScheduler() {
  cleanupTimerScheduler = undefined
}

function scheduleCleanupTimer(callback) {
  return cleanupTimerScheduler
    ? cleanupTimerScheduler(callback, IMAGE_OPERATION_CLEANUP_GRACE_MS)
    : setTimeout(callback, IMAGE_OPERATION_CLEANUP_GRACE_MS)
}

/** Environment passed to the Image Workshop subprocess; credential values are never forwarded. */
export function workshopEnvironment(env = process.env) {
  const safe = { ...env }
  for (const key of [...SECRET_KEYS, ...OWNED_DIAGNOSTIC_ENV_KEYS]) {
    for (const candidate of Object.keys(safe)) {
      if (candidate.toLowerCase() === key.toLowerCase()) delete safe[candidate]
    }
  }
  return safe
}

function isRunning(child) {
  return child && child.exitCode == null && child.signalCode == null
}

function isQuiescent(child, closeObserved) {
  return closeObserved && !isRunning(child)
}

function operationError(message, code, info = {}) {
  const error = new Error(message)
  error.code = code
  error.info = { name: code === 'IMAGE_CANCELLATION_INCOMPLETE' ? 'ImageCancellationIncompleteError' : 'ImageOperationError', code, ...info }
  return error
}

function executableName(value) {
  const name = basename(String(value ?? '').replaceAll('\\', '/')).toLowerCase()
  return SAFE_EXECUTABLE_NAMES.has(name) ? name : 'unknown'
}

function safeSignal(value) {
  return typeof value === 'string' && SAFE_SIGNAL_PATTERN.test(value) ? value : undefined
}

function toolNameForOperation(operation) {
  return Object.prototype.hasOwnProperty.call(IMAGE_OPERATION_TOOL_NAMES, operation)
    ? IMAGE_OPERATION_TOOL_NAMES[operation]
    : undefined
}

function childFailure(operation, executable, stage, code = 'COMMAND_FAILED', facts = {}) {
  const exitCode = Number.isInteger(facts.exitCode) ? facts.exitCode : undefined
  const signal = safeSignal(facts.signal)
  const status = signal ? `signal ${signal}` : exitCode === undefined ? 'unknown status' : `exit code ${exitCode}`
  const safeExecutable = executableName(executable)
  return operationError(`image workspace operation ${operation} failed at ${stage} (${safeExecutable}, ${status}).`, code, {
    stage,
    executable: safeExecutable,
    ...(facts.pid !== undefined ? { pid: facts.pid } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(signal ? { signal } : {})
  })
}

async function expectedTargetState(expectedTargets) {
  let unknown = false
  for (const target of expectedTargets) {
    try {
      await stat(target.path)
      return 'exists'
    } catch (error) {
      if (error?.code !== 'ENOENT') unknown = true
    }
  }
  return unknown ? 'unknown' : 'absent'
}

function cancellationError(operation, cleanupConfirmed, pid, expectedTargets = [], targetState = 'unknown') {
  const expectedPaths = expectedTargets.map((target) => target.projectPath)
  const info = { pid, expectedPaths, processCleanupConfirmed: cleanupConfirmed }
  if (!cleanupConfirmed) {
    const processId = pid === undefined ? 'unknown' : String(pid)
    const targets = expectedPaths.length > 0 ? expectedPaths.join(', ') : 'none'
    return operationError(`image workspace operation ${operation} cancellation incomplete: cleanup of the Harness CLI process tree (PID ${processId}) could not be confirmed within the ${IMAGE_OPERATION_CLEANUP_GRACE_MS}ms cleanup grace; expected output paths remain uncertain (${targets}).`, 'IMAGE_CANCELLATION_INCOMPLETE', { ...info, outcome: 'cleanup-unconfirmed' })
  }
  if (targetState !== 'absent') {
    const targets = expectedPaths.length > 0 ? expectedPaths.join(', ') : 'none'
    const state = targetState === 'exists' ? 'may already exist' : 'could not be checked'
    return operationError(`image workspace operation ${operation} cancellation incomplete: expected output paths ${state} after the Harness CLI process tree stopped (${targets}).`, 'IMAGE_CANCELLATION_INCOMPLETE', { ...info, outcome: 'expected-target-uncertain' })
  }
  return operationError(`image workspace operation ${operation} was cancelled.`, 'cancelled', { ...info, outcome: 'cancelled' })
}

async function cancellationErrorFor(operation, cleanupConfirmed, pid, expectedTargets = []) {
  const targetState = cleanupConfirmed ? await expectedTargetState(expectedTargets) : 'unknown'
  return cancellationError(operation, cleanupConfirmed, pid, expectedTargets, targetState)
}

function defaultSpawn(bun, args, options) {
  return spawn(bun, args, options)
}

function waitForTerminationCommand(child, timeoutMs) {
  if (!child || typeof child.once !== 'function') return Promise.reject(new Error('process-tree termination command unavailable'))
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false
    let timer
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.removeListener?.('error', onError)
      child.removeListener?.('close', onClose)
      error ? rejectPromise(error) : resolvePromise()
    }
    const onError = (error) => finish(error)
    const onClose = (code) => code === 0
      ? finish()
      : finish(new Error(`process-tree termination command exited ${code === null ? 'by signal' : `with code ${code}`}`))
    timer = setTimeout(() => {
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
  if (!isRunning(child)) return false
  const platform = options.platform ?? process.platform
  if (platform === 'win32' && child.pid !== undefined) {
    const taskkill = options.env?.SystemRoot
      ? join(options.env.SystemRoot, 'System32', 'taskkill.exe')
      : 'taskkill.exe'
    const spawnTerminationCommand = terminationCommandSpawner ?? spawn
    const killer = spawnTerminationCommand(taskkill, ['/PID', String(child.pid), '/T', '/F'], {
      env: workshopEnvironment(options.env ?? process.env),
      stdio: 'ignore',
      windowsHide: true
    })
    await waitForTerminationCommand(killer, options.timeoutMs ?? TERMINATION_COMMAND_TIMEOUT_MS)
    return true
  }
  if (child.pid !== undefined && platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGTERM')
      return true
    } catch {
      // Fall through to the direct child handle when the group is already gone
      // or the test-owned handle has no real process group.
    }
  }
  try {
    if (!child.kill('SIGTERM')) throw new Error('the child process rejected termination')
    // A direct-child fallback is cleanup effort, never proof that descendants
    // in the intended process tree stopped.
    return false
  } catch {
    throw operationError('the image CLI process could not be terminated.', 'CLEANUP_UNCONFIRMED', {
      stage: 'termination',
      executable: 'unknown',
      pid: child.pid
    })
  }
}

function processGroupAbsent(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return undefined
  try {
    process.kill(-pid, 0)
    return false
  } catch (error) {
    // ESRCH is the only positive proof that the process group is gone. EPERM
    // and every other failure leave the tree state unconfirmed.
    return error?.code === 'ESRCH' ? true : undefined
  }
}

function forceTerminateTree(child, platform) {
  // The leader may already have exited while descendants retain its process
  // group. Always attempt the group SIGKILL; the leader's state is not proof.
  if (platform !== 'win32' && child.pid !== undefined) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch (error) {
      // A direct handle is cleanup effort only. If the group is already gone,
      // signal-0 below will provide the actual proof; EPERM/unknown remain
      // unconfirmed even when the direct handle accepts SIGKILL.
      try { child.kill('SIGKILL') } catch { /* the bounded wait records failure */ }
      return processGroupAbsent(child.pid) === true
    }
    return processGroupAbsent(child.pid) === true
  }
  try {
    child.kill(platform === 'win32' ? undefined : 'SIGKILL')
  } catch {
    // The cleanup deadline records the unconfirmed state if the child remains.
  }
  return false
}

function cleanupListeners(child, signal, onAbort, onClose, onError, onExit, onStdout, onStderr) {
  signal?.removeEventListener?.('abort', onAbort)
  child.removeListener?.('close', onClose)
  child.removeListener?.('error', onError)
  child.removeListener?.('exit', onExit)
  child.stdout?.removeListener?.('data', onStdout)
  child.stderr?.removeListener?.('data', onStderr)
}

async function runReal(operation, args, env, signal, expectedTargets, context) {
  const cli = env.DSH_IMAGE_WORKSHOP_CLI
  if (!cli) {
    throw new Error('image workspace: DSH_IMAGE_WORKSHOP_CLI is not configured; the harness launcher must set it.')
  }
  const bun = env.BUN_EXECUTABLE ?? 'bun'
  const spawnChild = childSpawner ?? defaultSpawn
  const terminateTree = treeTerminator ?? defaultTerminateTree
  if (signal?.aborted) throw await cancellationErrorFor(operation, true, undefined, expectedTargets)
  return new Promise((resolvePromise, rejectPromise) => {
    let child
    const requestedPlatform = childSpawner?.platform ?? process.platform
    try {
      child = spawnChild(bun, [cli, 'image', ...args], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: requestedPlatform !== 'win32'
      })
    } catch {
      rejectPromise(childFailure(operation, bun, 'harness-cli-spawn'))
      return
    }
    // Test-owned child seams may expose a platform. Production ChildProcess
    // instances do not, so this remains the host platform in normal use.
    const platform = child.platform ?? requestedPlatform
    context.pid = child.pid
    let stdout = ''
    let stdoutOverflow = false
    let aborted = false
    let settled = false
    let closeObserved = false
    let forceKillAttempted = false
    let cancellationSettling = false
    let forceKillTimer
    let cleanupTimer
    let terminationStarted = false
    let terminationStatus = 'not-started'
    let forceKillStatus = 'not-attempted'

    const finish = (kind, value) => {
      if (settled) return
      settled = true
      if (forceKillTimer) clearTimeout(forceKillTimer)
      if (cleanupTimer) clearTimeout(cleanupTimer)
      cleanupListeners(child, signal, onAbort, onClose, onError, onExit, onStdout, onStderr)
      if (kind === 'resolve') resolvePromise(value)
      else rejectPromise(value)
    }

    const treeTerminationConfirmed = () => {
      if (!isQuiescent(child, closeObserved)) return false
      if (platform !== 'win32') return forceKillAttempted && processGroupAbsent(child.pid) === true
      return forceKillAttempted
        ? forceKillStatus === 'succeeded'
        : terminationStatus === 'succeeded'
    }

    const canSettleCancellation = () => treeTerminationConfirmed()

    const finishCancellation = async () => {
      if (settled || cancellationSettling) return
      cancellationSettling = true
      const confirmed = treeTerminationConfirmed() && isQuiescent(child, closeObserved)
      context.cleanupConfirmed = confirmed
      const error = await cancellationErrorFor(operation, confirmed, child.pid, expectedTargets)
      if (settled) return
      finish('reject', error)
    }

    const escalate = () => {
      if (settled || !aborted || forceKillAttempted) return
      // SIGTERM is cleanup effort, never final proof. Escalate once within the
      // existing grace even when the leader already emitted close; descendants
      // can retain the POSIX process group.
      forceKillAttempted = true
      const startedAt = new Date().toISOString()
      const startedTime = Date.now()
      forceKillStatus = forceTerminateTree(child, platform) ? 'succeeded' : 'failed'
      void appendImageDiagnostic(context, diagnosticEntry(context, 'terminal', 'termination', bun, {
        pid: child.pid,
        startedAt,
        finishedAt: new Date().toISOString(),
        elapsedMs: Date.now() - startedTime,
        outcome: forceKillStatus === 'succeeded' ? 'completed' : 'failed',
        processCleanupConfirmed: treeTerminationConfirmed()
      }))
      if (aborted && canSettleCancellation()) void finishCancellation()
    }

    const startCancellation = () => {
      if (terminationStarted || settled) return
      terminationStarted = true
      const startedAt = new Date().toISOString()
      const startedTime = Date.now()
      void appendImageDiagnostic(context, diagnosticEntry(context, 'start', 'termination', bun, { pid: child.pid, startedAt }))
      forceKillTimer = setTimeout(escalate, FORCE_KILL_DELAY_MS)
      cleanupTimer = scheduleCleanupTimer(() => {
        if (aborted) void finishCancellation()
      })
      if (!isRunning(child)) {
        terminationStatus = 'skipped'
        return
      }
      terminationStatus = 'pending'
      try {
        const result = terminateTree(child, { env, platform, timeoutMs: TERMINATION_COMMAND_TIMEOUT_MS })
        Promise.resolve(result).then((completed) => {
          terminationStatus = completed === true ? 'succeeded' : 'failed'
          context.terminationLog = appendImageDiagnostic(context, diagnosticEntry(context, 'terminal', 'termination', bun, {
            pid: child.pid,
            startedAt,
            finishedAt: new Date().toISOString(),
            elapsedMs: Date.now() - startedTime,
            outcome: terminationStatus === 'succeeded' ? 'completed' : 'failed',
            processCleanupConfirmed: platform === 'win32' && terminationStatus === 'succeeded' && isQuiescent(child, closeObserved)
          }))
          if (aborted && canSettleCancellation()) void finishCancellation()
        }, (error) => {
          terminationStatus = 'failed'
          context.terminationLog = appendImageDiagnostic(context, diagnosticEntry(context, 'terminal', 'termination', bun, {
            pid: child.pid,
            startedAt,
            finishedAt: new Date().toISOString(),
            elapsedMs: Date.now() - startedTime,
            outcome: 'failed',
            processCleanupConfirmed: false,
            errorCode: 'TERMINATION_FAILED'
          }))
          // A direct close after an unsuccessful tree request is not proof of
          // descendant cleanup; wait for the bounded escalation before settling.
          if (aborted && canSettleCancellation()) void finishCancellation()
        })
      } catch (error) {
        terminationStatus = 'failed'
        context.terminationLog = appendImageDiagnostic(context, diagnosticEntry(context, 'terminal', 'termination', bun, {
          pid: child.pid,
          startedAt,
          finishedAt: new Date().toISOString(),
          elapsedMs: Date.now() - startedTime,
          outcome: 'failed',
          processCleanupConfirmed: false,
          errorCode: 'TERMINATION_FAILED'
        }))
        if (aborted && canSettleCancellation()) void finishCancellation()
      }
    }

    const onAbort = () => {
      if (aborted || settled) return
      aborted = true
      startCancellation()
    }
    const onStdout = (chunk) => {
      if (stdoutOverflow) return
      stdout += chunk
      if (stdout.length > MANIFEST_OUTPUT_LIMIT) {
        stdoutOverflow = true
        stdout = ''
      }
    }
    const onStderr = () => {
      // Drain child stderr without retaining or exposing it.
    }
    const onError = () => {
      if (aborted) {
        if (canSettleCancellation()) void finishCancellation()
        return
      }
      finish('reject', childFailure(operation, bun, 'harness-cli-spawn'))
    }
    const onExit = () => {
      // Node emits `exit` before inherited stdio has drained. It is evidence
      // that the process exited, not evidence that the child is quiescent.
    }
    const onClose = (code, childSignal) => {
      closeObserved = true
      if (aborted) {
        if (canSettleCancellation()) void finishCancellation()
        return
      }
      if (isRunning(child)) {
        finish('reject', operationError(`image workspace CLI emitted close before becoming quiescent for ${operation}.`, 'CLEANUP_UNCONFIRMED'))
        return
      }
      if (stdoutOverflow) {
        finish('reject', new Error(`image workspace operation output exceeded the bounded manifest limit; refusing to parse a truncated manifest for ${args[0]}.`))
        return
      }
      if (code === 0) finish('resolve', stdout)
      else finish('reject', childFailure(operation, bun, 'harness-cli-spawn', 'CHILD_EXIT_NONZERO', {
        pid: child.pid,
        exitCode: code,
        signal: childSignal ?? child.signalCode
      }))
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

async function runInjected(runner, bun, args, env, signal, operation, expectedTargets) {
  if (signal?.aborted) throw await cancellationErrorFor(operation, true, undefined, expectedTargets)
  const value = Promise.resolve()
    .then(() => runner(bun, args, env, signal))
    .catch(() => {
      throw childFailure(operation, bun, 'harness-cli-spawn')
    })
  if (!signal) return value
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false
    let cancellationStarted = false
    const onAbort = () => {
      if (settled || cancellationStarted) return
      cancellationStarted = true
      void cancellationErrorFor(operation, true, undefined, expectedTargets).then((error) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        rejectPromise(error)
      })
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    value.then((result) => {
      if (settled || cancellationStarted) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      resolvePromise(result)
    }, (error) => {
      if (settled || cancellationStarted) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      rejectPromise(error)
    })
  })
}

/**
 * Run one Image Workshop operation with structured argv and parse the canonical
 * JSON the CLI writes to stdout. An injected runner receives the operation argv
 * (without the CLI entry) and the optional abort signal; the real path prepends
 * the harness CLI and owns bounded process-tree cleanup.
 */
export async function invokeImageOperation(operation, cliArgs, env = process.env, signal, expectedTargets = [], diagnostics = {}) {
  const toolName = toolNameForOperation(operation)
  if (!toolName) throw operationError('image workspace operation is not an app-owned image command.', 'COMMAND_FAILED', { stage: 'harness-cli-spawn', executable: 'unknown' })
  const args = [operation, ...cliArgs]
  const rawEnv = env ?? process.env
  const safeEnv = workshopEnvironment(rawEnv)
  const context = createImageDiagnosticContext(operation, rawEnv, { ...diagnostics, operationId: randomUUID(), toolName })
  const operationEnv = {
    ...safeEnv,
    DSH_IMAGE_WORKSHOP_OPERATION_ID: context.operationId,
    ...(context.inputLabels ? { DSH_IMAGE_WORKSHOP_INPUT_LABELS: JSON.stringify(context.inputLabels) } : {}),
    ...(context.outputLabels ? { DSH_IMAGE_WORKSHOP_OUTPUT_LABELS: JSON.stringify(context.outputLabels) } : {}),
    ...(context.options ? { DSH_IMAGE_WORKSHOP_OPTIONS: JSON.stringify(context.options) } : {})
  }
  const startedAt = new Date().toISOString()
  const startedTime = Date.now()
  await appendImageDiagnostic(context, diagnosticEntry(context, 'start', 'harness-cli-spawn', safeEnv.BUN_EXECUTABLE ?? 'bun', { startedAt }))
  try {
    const stdout = workshopRunner
      ? await runInjected(workshopRunner, safeEnv.BUN_EXECUTABLE ?? 'bun', args, operationEnv, signal, operation, expectedTargets)
      : await runReal(operation, args, operationEnv, signal, expectedTargets, context)
    if (signal?.aborted) {
      context.cleanupConfirmed ??= true
      throw await cancellationErrorFor(operation, true, context.pid, expectedTargets)
    }
    const trimmed = String(stdout ?? '').trim()
    let parsed
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error(`image workspace CLI returned no parseable JSON for ${operation}.`)
    }
    await appendImageDiagnostic(context, diagnosticEntry(context, 'terminal', 'harness-cli-spawn', safeEnv.BUN_EXECUTABLE ?? 'bun', {
      pid: context.pid,
      startedAt,
      finishedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedTime,
      outcome: 'completed'
    }))
    return parsed
  } catch (error) {
    const failure = error instanceof Error ? error : new Error('image workspace operation failed.')
    if (context.terminationLog) await context.terminationLog
    const failureInfo = failure.info && typeof failure.info === 'object' ? failure.info : {}
    const incomplete = failure.code === 'IMAGE_CANCELLATION_INCOMPLETE'
    const timedOut = failure.code === 'TOOL_TIMEOUT' || (signal?.aborted && diagnosticAbortOutcome(signal) === 'timed-out')
    const cancelled = failure.code === 'cancelled' || incomplete || timedOut || signal?.aborted
    if (cancelled && context.cleanupConfirmed === undefined) context.cleanupConfirmed = context.pid === undefined
    const errorCode = incomplete
      ? 'IMAGE_CANCELLATION_INCOMPLETE'
      : timedOut
        ? 'TOOL_TIMEOUT'
        : cancelled
          ? 'CANCELLED'
          : failure.code === 'CHILD_EXIT_NONZERO'
            ? 'CHILD_EXIT_NONZERO'
            : 'COMMAND_FAILED'
    const cancellationOutcome = context.cleanupConfirmed === false
      ? 'cleanup-unconfirmed'
      : timedOut
        ? 'timed-out'
        : signal
          ? diagnosticAbortOutcome(signal)
          : 'cancelled'
    await appendImageDiagnostic(context, diagnosticEntry(context, 'terminal', 'harness-cli-spawn', safeEnv.BUN_EXECUTABLE ?? 'bun', {
      pid: context.pid,
      exitCode: Number.isInteger(failureInfo.exitCode) ? failureInfo.exitCode : undefined,
      signal: safeSignal(failureInfo.signal),
      startedAt,
      finishedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedTime,
      outcome: cancelled ? cancellationOutcome : 'failed',
      ...(cancelled ? { processCleanupConfirmed: context.cleanupConfirmed } : {}),
      errorCode
    }))
    throw failure
  }
}
