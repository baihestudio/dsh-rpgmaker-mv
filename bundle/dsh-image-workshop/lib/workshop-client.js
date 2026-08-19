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
import { spawn } from 'node:child_process'
import { join } from 'node:path'

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

function isRunning(child) {
  return child && child.exitCode == null && child.signalCode == null
}

function isQuiescent(child, closeObserved) {
  return closeObserved && !isRunning(child)
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

function cancellationError(operation, signal, cleanupConfirmed, pid) {
  const kind = cancellationKind(signal)
  if (!cleanupConfirmed) {
    const processId = pid === undefined ? 'unknown' : String(pid)
    return operationError(`image workspace operation ${kind} cleanup-unconfirmed: the Harness CLI process tree (PID ${processId}) did not provide a quiescent close event within the ${IMAGE_OPERATION_CLEANUP_GRACE_MS}ms cleanup grace.`, 'CLEANUP_UNCONFIRMED', { pid, outcome: 'cleanup-unconfirmed' })
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
    const onClose = (code) => code === null || code === 0 ? finish() : finish(new Error(`process-tree termination command exited with code ${code}`))
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

async function runReal(operation, args, env, signal) {
  const cli = env.DSH_IMAGE_WORKSHOP_CLI
  if (!cli) {
    throw new Error('image workspace: DSH_IMAGE_WORKSHOP_CLI is not configured; the harness launcher must set it.')
  }
  const bun = env.BUN_EXECUTABLE ?? 'bun'
  const spawnChild = childSpawner ?? defaultSpawn
  const terminateTree = treeTerminator ?? defaultTerminateTree
  if (signal?.aborted) throw cancellationError(operation, signal, true)
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
    let stdout = ''
    let stderr = ''
    let stdoutOverflow = false
    let aborted = false
    let settled = false
    let closeObserved = false
    let forceKillAttempted = false
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

    const finishCancellation = (confirmed = isQuiescent(child, closeObserved)) => {
      if (settled) return
      finish('reject', cancellationError(operation, signal, confirmed, child.pid))
    }

    const escalate = () => {
      if (settled || !aborted || forceKillAttempted || !isRunning(child)) return
      forceKillAttempted = true
      forceTerminateTree(child, platform)
    }

    const startCancellation = () => {
      if (terminationStarted || settled) return
      terminationStarted = true
      forceKillTimer = setTimeout(escalate, FORCE_KILL_DELAY_MS)
      cleanupTimer = setTimeout(() => {
        if (aborted) finishCancellation()
      }, IMAGE_OPERATION_CLEANUP_GRACE_MS)
      if (!isRunning(child)) return
      try {
        const result = terminateTree(child, { env, platform, timeoutMs: TERMINATION_COMMAND_TIMEOUT_MS })
        Promise.resolve(result).then(() => {
          if (aborted && isQuiescent(child, closeObserved)) finishCancellation(true)
        }, () => {
          // The bounded cleanup timer owns the final truth if termination fails.
        })
      } catch {
        // The bounded cleanup timer owns the final truth if termination fails.
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
        if (isQuiescent(child, closeObserved)) finishCancellation(true)
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
        if (isQuiescent(child, closeObserved)) finishCancellation(true)
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

function runInjected(runner, bun, args, env, signal, operation) {
  if (signal?.aborted) return Promise.reject(cancellationError(operation, signal, true))
  const value = Promise.resolve().then(() => runner(bun, args, env, signal))
  if (!signal) return value
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false
    const onAbort = () => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      rejectPromise(cancellationError(operation, signal, true))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
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

/**
 * Run one Image Workshop operation with structured argv and parse the canonical
 * JSON the CLI writes to stdout. An injected runner receives the operation argv
 * (without the CLI entry) and the optional abort signal; the real path prepends
 * the harness CLI and owns bounded process-tree cleanup.
 */
export async function invokeImageOperation(operation, cliArgs, env = process.env, signal) {
  const args = [operation, ...cliArgs]
  const safeEnv = workshopEnvironment(env ?? process.env)
  const stdout = workshopRunner
    ? await runInjected(workshopRunner, safeEnv.BUN_EXECUTABLE ?? 'bun', args, safeEnv, signal, operation)
    : await runReal(operation, args, safeEnv, signal)
  if (signal?.aborted) throw cancellationError(operation, signal, true)
  const trimmed = String(stdout ?? '').trim()
  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error(`image workspace CLI returned no parseable JSON for ${operation}.`)
  }
  if (signal?.aborted) throw cancellationError(operation, signal, true)
  return parsed
}
