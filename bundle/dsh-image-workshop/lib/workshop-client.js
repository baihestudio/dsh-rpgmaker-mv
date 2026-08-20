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
import { stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { appendImageDiagnostic, createImageDiagnosticContext, diagnosticAbortOutcome, diagnosticEntry } from './diagnostics.js'

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
 * budget, with realistic input counts staying far below this ceiling. The
 * accumulator preserves complete JSON below the ceiling and fails loudly on
 * overflow instead of parsing a truncated manifest.
 */
const MANIFEST_OUTPUT_LIMIT = 4 * 1024 * 1024

/** Bounded tail for error text; errors never carry the full canonical manifest. */
const ERROR_OUTPUT_LIMIT = 16 * 1024

/** Test-owned seams; production uses real child processes. */
let workshopRunner
let childSpawner
let treeTerminator
let terminationCommandSpawner

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

/** Environment passed to the Image Workshop subprocess; credential values are never forwarded. */
export function workshopEnvironment(env = process.env) {
  const safe = { ...env }
  for (const key of SECRET_KEYS) {
    const found = Object.keys(safe).find((candidate) => candidate.toLowerCase() === key.toLowerCase())
    if (found) delete safe[found]
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
  } catch (error) {
    throw operationError(`the image CLI process could not be terminated: ${error instanceof Error ? error.message : String(error)}`, 'CLEANUP_UNCONFIRMED')
  }
}

function forceTerminateTree(child, platform) {
  // The leader may already have exited while descendants retain its process
  // group. Do not use the leader's state to skip the group escalation.
  if (platform !== 'win32' && child.pid !== undefined) {
    try {
      process.kill(-child.pid, 'SIGKILL')
      return true
    } catch {
      // A direct handle is only cleanup effort, not tree proof.
    }
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
    } catch (error) {
      rejectPromise(error)
      return
    }
    // Test-owned child seams may expose a platform. Production ChildProcess
    // instances do not, so this remains the host platform in normal use.
    const platform = child.platform ?? requestedPlatform
    context.pid = child.pid
    let stdout = ''
    let stderr = ''
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

    const treeTerminationConfirmed = () => forceKillAttempted
      ? forceKillStatus === 'succeeded'
      : terminationStatus === 'succeeded'

    const canSettleCancellation = () => isQuiescent(child, closeObserved)
      && (forceKillAttempted || terminationStatus === 'succeeded')

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
      // A failed or still-pending tree request still needs process-group
      // escalation after the leader has exited; descendants can retain it.
      if (terminationStatus === 'succeeded' && !isRunning(child)) return
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
        processCleanupConfirmed: forceKillStatus === 'succeeded' && isQuiescent(child, closeObserved)
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
      cleanupTimer = setTimeout(() => {
        if (aborted) void finishCancellation()
      }, IMAGE_OPERATION_CLEANUP_GRACE_MS)
      if (!isRunning(child)) {
        terminationStatus = 'skipped'
        if (closeObserved) void finishCancellation()
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
            processCleanupConfirmed: terminationStatus === 'succeeded' && isQuiescent(child, closeObserved)
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
            error: error instanceof Error ? error.message : String(error)
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
          error: error instanceof Error ? error.message : String(error)
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
    const onStderr = (chunk) => {
      stderr += chunk
      if (stderr.length > ERROR_OUTPUT_LIMIT) stderr = stderr.slice(-ERROR_OUTPUT_LIMIT)
    }
    const onError = (error) => {
      if (aborted) {
        if (canSettleCancellation()) void finishCancellation()
        return
      }
      finish('reject', error)
    }
    const onExit = () => {
      // Node emits `exit` before inherited stdio has drained. It is evidence
      // that the process exited, not evidence that the child is quiescent.
    }
    const onClose = (code) => {
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

async function runInjected(runner, bun, args, env, signal, operation, expectedTargets) {
  if (signal?.aborted) throw await cancellationErrorFor(operation, true, undefined, expectedTargets)
  const value = Promise.resolve().then(() => runner(bun, args, env, signal))
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
  const args = [operation, ...cliArgs]
  const rawEnv = env ?? process.env
  const safeEnv = workshopEnvironment(rawEnv)
  const context = createImageDiagnosticContext(operation, rawEnv, diagnostics)
  const operationEnv = {
    ...safeEnv,
    DSH_IMAGE_WORKSHOP_OPERATION_ID: context.operationId,
    DSH_IMAGE_WORKSHOP_TOOL_NAME: context.toolName ?? operation,
    DSH_IMAGE_WORKSHOP_OPERATION: operation,
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
    if (signal?.aborted) throw await cancellationErrorFor(operation, true, context.pid, expectedTargets)
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
    const failure = error instanceof Error ? error : new Error(String(error))
    if (context.terminationLog) await context.terminationLog
    const incomplete = failure.code === 'IMAGE_CANCELLATION_INCOMPLETE'
    const cancelled = failure.code === 'cancelled' || incomplete || signal?.aborted
    await appendImageDiagnostic(context, diagnosticEntry(context, 'terminal', 'harness-cli-spawn', safeEnv.BUN_EXECUTABLE ?? 'bun', {
      pid: context.pid,
      startedAt,
      finishedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedTime,
      outcome: incomplete && context.cleanupConfirmed === false
        ? 'cleanup-unconfirmed'
        : cancelled
          ? diagnosticAbortOutcome(signal)
          : 'failed',
      ...(context.cleanupConfirmed !== undefined ? { processCleanupConfirmed: context.cleanupConfirmed } : {}),
      error: failure.message
    }))
    throw failure
  }
}
