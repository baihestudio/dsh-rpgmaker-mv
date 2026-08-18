/**
 * Thin client for the harness Image Workshop CLI.
 *
 * The plugin never constructs ImageMagick or shell commands. It invokes the
 * harness CLI (resolved through DSH_IMAGE_WORKSHOP_CLI, an internal launcher
 * detail) with structured argv and parses the canonical JSON the CLI emits.
 * The runner is injectable so tests can substitute a deterministic fake. An
 * optional AbortSignal cancels a running operation by terminating the child
 * process tree (taskkill /T on Windows, process-group termination on POSIX).
 */
import { spawn } from 'node:child_process'

const SECRET_KEYS = [
  'DEEPSEEK_API_KEY',
  'ANIONEX_FREE_VISION',
  'NPM_TOKEN',
  'NODE_AUTH_TOKEN',
  'GITHUB_TOKEN',
  'GITLAB_TOKEN'
]

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

function defaultSpawn(bun, args, options) {
  return spawn(bun, args, options)
}

/**
 * Terminate the CLI and everything it spawned. POSIX children are spawned as
 * process-group leaders so a negative-pid signal reaches the whole tree;
 * Windows uses taskkill /T /F which walks the parent/child tree. The optional
 * seams let tests observe the calls without touching real processes.
 */
function defaultTerminateTree(child) {
  if (child.exitCode !== null && child.signalCode !== null) return
  if (child.pid === undefined) {
    try { child.kill() } catch { /* nothing to signal */ }
    return
  }
  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.on('error', () => {})
      killer.unref?.()
    } catch {
      try { child.kill() } catch { /* fall through */ }
    }
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      try { child.kill('SIGTERM') } catch { /* nothing to signal */ }
    }
  }
}

function runReal(args, env, signal) {
  const cli = env.DSH_IMAGE_WORKSHOP_CLI
  if (!cli) {
    throw new Error('image workspace: DSH_IMAGE_WORKSHOP_CLI is not configured; the harness launcher must set it.')
  }
  const bun = env.BUN_EXECUTABLE ?? 'bun'
  const spawnChild = childSpawner ?? defaultSpawn
  const terminateTree = treeTerminator ?? defaultTerminateTree
  return new Promise((resolvePromise, reject) => {
    const child = spawnChild(bun, [cli, 'image', ...args], {
      env: workshopEnvironment(env),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32'
    })
    let stdout = ''
    let stderr = ''
    let stdoutOverflow = false
    let aborted = false
    let forceKillTimer
    const abort = () => {
      if (aborted) return
      aborted = true
      terminateTree(child)
      // If tree teardown never settles (e.g. a child ignores SIGTERM), force it.
      forceKillTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try {
            if (process.platform === 'win32') child.kill()
            else {
              try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch { /* already gone */ } }
            }
          } catch { /* already gone */ }
        }
      }, 3000)
      if (forceKillTimer.unref) forceKillTimer.unref()
    }
    if (signal) {
      if (signal.aborted) {
        abort()
        reject(new Error('image workspace operation was cancelled.'))
        return
      }
      signal.addEventListener('abort', abort, { once: true })
    }
    const detach = () => {
      if (signal) signal.removeEventListener('abort', abort)
    }
    child.stdout.on('data', (chunk) => {
      if (stdoutOverflow) return
      stdout += chunk
      if (stdout.length > MANIFEST_OUTPUT_LIMIT) {
        stdoutOverflow = true
        stdout = ''
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
      if (stderr.length > ERROR_OUTPUT_LIMIT) stderr = stderr.slice(-ERROR_OUTPUT_LIMIT)
    })
    child.on('error', (error) => {
      detach()
      if (forceKillTimer) clearTimeout(forceKillTimer)
      reject(error)
    })
    child.on('close', (code) => {
      detach()
      if (forceKillTimer) clearTimeout(forceKillTimer)
      if (aborted) {
        reject(new Error('image workspace operation was cancelled.'))
        return
      }
      if (stdoutOverflow) {
        reject(new Error(`image workspace operation output exceeded the bounded manifest limit; refusing to parse a truncated manifest for ${args[0]}.`))
        return
      }
      if (code === 0) resolvePromise(stdout)
      else reject(new Error(`image workspace CLI failed (exit ${code ?? 'signal'}): ${(stderr.trim() || stdout.trim()).slice(-ERROR_OUTPUT_LIMIT)}`))
    })
  })
}

/**
 * Run one Image Workshop operation with structured argv and parse the canonical
 * JSON the CLI writes to stdout. An injected runner receives the operation argv
 * (without the CLI entry) and the optional abort signal; the real path prepends
 * the harness CLI and runner.
 */
export async function invokeImageOperation(operation, cliArgs, env = process.env, signal) {
  const args = [operation, ...cliArgs]
  const safeEnv = workshopEnvironment(env)
  const stdout = workshopRunner
    ? await workshopRunner(safeEnv.BUN_EXECUTABLE ?? 'bun', args, safeEnv, signal)
    : await runReal(args, safeEnv, signal)
  const trimmed = String(stdout ?? '').trim()
  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error(`image workspace CLI returned no parseable JSON for ${operation}.`)
  }
  return parsed
}
