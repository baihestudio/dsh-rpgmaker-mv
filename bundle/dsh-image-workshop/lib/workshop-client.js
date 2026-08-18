/**
 * Thin client for the harness Image Workshop CLI.
 *
 * The plugin never constructs ImageMagick or shell commands. It invokes the
 * harness CLI (resolved through DSH_IMAGE_WORKSHOP_CLI, an internal launcher
 * detail) with structured argv and parses the canonical JSON the CLI emits.
 * The runner is injectable so tests can substitute a deterministic fake. An
 * optional AbortSignal cancels a running operation by terminating the child
 * process tree.
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

/** Environment passed to the Image Workshop subprocess; credential values are never forwarded. */
export function workshopEnvironment(env = process.env) {
  const safe = { ...env }
  for (const key of SECRET_KEYS) {
    const found = Object.keys(safe).find((candidate) => candidate.toLowerCase() === key.toLowerCase())
    if (found) delete safe[found]
  }
  return safe
}

/** Test-owned seam; defaults to a real child process. */
export function setWorkshopRunner(runner) {
  workshopRunner = runner
}

export function clearWorkshopRunner() {
  workshopRunner = undefined
}

let workshopRunner

const OUTPUT_LIMIT = 16 * 1024

function runReal(args, env, signal) {
  const cli = env.DSH_IMAGE_WORKSHOP_CLI
  if (!cli) {
    throw new Error('image workspace: DSH_IMAGE_WORKSHOP_CLI is not configured; the harness launcher must set it.')
  }
  const bun = env.BUN_EXECUTABLE ?? 'bun'
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bun, [cli, 'image', ...args], {
      env: workshopEnvironment(env),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    let aborted = false
    const abort = () => {
      aborted = true
      if (!child.killed) child.kill()
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
      stdout += chunk
      if (stdout.length > OUTPUT_LIMIT) stdout = stdout.slice(-OUTPUT_LIMIT)
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
      if (stderr.length > OUTPUT_LIMIT) stderr = stderr.slice(-OUTPUT_LIMIT)
    })
    child.on('error', (error) => {
      detach()
      reject(error)
    })
    child.on('close', (code) => {
      detach()
      if (aborted) {
        reject(new Error('image workspace operation was cancelled.'))
        return
      }
      if (code === 0) resolvePromise(stdout)
      else reject(new Error(`image workspace CLI failed (exit ${code ?? 'signal'}): ${(stderr.trim() || stdout.trim()).slice(-2000)}`))
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
