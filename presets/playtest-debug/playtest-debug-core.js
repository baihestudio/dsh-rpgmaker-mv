import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export const WINDOWS_TREE_PROBE = `$target=[int]$env:DSH_PLAYTEST_PID; $parents=@($target); $seen=@{}; do { $next=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $parents -contains [int]$_.ParentProcessId -and -not $seen.ContainsKey([int]$_.ProcessId) } | ForEach-Object { $seen[[int]$_.ProcessId]=$true; [int]$_.ProcessId }); if ($next.Count -gt 0) { $parents += $next } } while ($next.Count -gt 0); $running=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $parents -contains [int]$_.ProcessId }); if ($running.Count -eq 0) { 'clean' } else { 'running' }`

export const WINDOWS_TREE_IDS = `$target=[int]$env:DSH_PLAYTEST_PID; $parents=@($target); $seen=@{$target=$true}; do { $next=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $parents -contains [int]$_.ParentProcessId -and -not $seen.ContainsKey([int]$_.ProcessId) } | ForEach-Object { $seen[[int]$_.ProcessId]=$true; [int]$_.ProcessId }); if ($next.Count -gt 0) { $parents += $next } } while ($next.Count -gt 0); $seen.Keys | ForEach-Object { [int]$_ } | Where-Object { $_ -ne $target }`

function envWithoutSecrets(env = process.env) {
  const copy = { ...env }
  delete copy.DEEPSEEK_API_KEY
  delete copy.DSH_API_KEY
  return copy
}

function directExecutable(name, platform, env) {
  if (name.includes('/') || name.includes('\\')) return existsSync(name) ? name : undefined
  const delimiter = platform === 'win32' ? ';' : ':'
  const candidates = platform === 'win32' ? [name, `${name}.exe`] : [name]
  for (const directory of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const candidate of candidates) {
      const path = join(directory, candidate)
      if (existsSync(path)) return path
    }
  }
  return undefined
}

function shortCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    let timedOut = false
    let stdout = ''
    let stderr = ''
    let timer
    const child = spawn(command, args, { cwd: options.cwd, env: Object.fromEntries(Object.entries(options.env ?? process.env).filter(([, value]) => value !== undefined)), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const finish = result => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', chunk => { stdout += chunk })
    child.stderr?.on('data', chunk => { stderr += chunk })
    child.once('error', error => {
      if (timedOut) { stderr = `${stderr}\n${error instanceof Error ? error.message : String(error)}`.trim(); return }
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      reject(error)
    })
    child.once('close', code => finish({ exitCode: timedOut ? 124 : code ?? 1, stdout, stderr: timedOut ? `${stderr}\ncommand timed out`.trim() : stderr }))
    if (options.timeoutMs) timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, options.timeoutMs)
  })
}

export function createPlaytestProcessController(options = {}) {
  const platform = options.platform ?? process.platform
  const env = envWithoutSecrets(options.env ?? process.env)
  const runner = options.commandRunner ?? shortCommand
  const boundedRunner = (command, args, runnerOptions, timeoutMs) => settleWithin(() => runner(command, args, runnerOptions), timeoutMs, `${command} process helper`)
  if (platform !== 'win32') {
    return {
      verify: async pid => { try { process.kill(pid, 0); return false } catch (error) { return error?.code === 'ESRCH' } },
      terminate: async pid => { try { process.kill(pid, 'SIGTERM') } catch (error) { if (error?.code !== 'ESRCH') throw error } },
    }
  }
  const configuredPwsh = options.pwshExecutable ?? env.PWSH_EXECUTABLE
  const taskkill = env.SystemRoot ? join(env.SystemRoot, 'System32', 'taskkill.exe') : 'taskkill.exe'
  const verify = async pid => {
    const pwsh = configuredPwsh ?? directExecutable('pwsh.exe', platform, env)
    if (!pwsh) return false
    try {
      const result = await boundedRunner(pwsh, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_TREE_PROBE], { env: { ...env, DSH_PLAYTEST_PID: String(pid) }, timeoutMs: 5000, platform }, 5000)
      return result.exitCode === 0 && result.stdout.trim().toLowerCase() === 'clean'
    } catch {
      return false
    }
  }
  return {
    verify,
    terminate: async pid => {
      const pwsh = configuredPwsh ?? directExecutable('pwsh.exe', platform, env)
      let descendantPids = []
      if (pwsh) {
        try {
          const descendants = await boundedRunner(pwsh, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_TREE_IDS], { env: { ...env, DSH_PLAYTEST_PID: String(pid) }, timeoutMs: 5000, platform }, 5000)
          descendantPids = [...new Set(descendants.stdout.split(/\r?\n/).map(value => Number(value.trim())).filter(value => Number.isInteger(value) && value > 0 && value !== pid))].sort((left, right) => right - left)
        } catch { /* taskkill /T remains the bounded, PID-scoped fallback */ }
      }
      const result = await boundedRunner(taskkill, ['/PID', String(pid), '/T', '/F'], { env, timeoutMs: 10000, platform }, 10000)
      for (const descendantPid of descendantPids) {
        try { await boundedRunner(taskkill, ['/PID', String(descendantPid), '/T', '/F'], { env, timeoutMs: 10000, platform }, 10000) } catch { /* the process may have exited between enumeration and termination */ }
      }
      if (!(await verify(pid))) throw new Error(`taskkill could not terminate Playtest PID ${pid}: ${result.stderr || result.stdout}`)
    },
  }
}

function objectValue(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

function unwrap(value) {
  const object = objectValue(value)
  if (!Array.isArray(object?.content)) return value
  const text = object.content.find(item => objectValue(item)?.type === 'text')?.text
  if (typeof text !== 'string') return value
  try { return JSON.parse(text) } catch { return text }
}

function toolError(value) {
  const object = objectValue(value)
  if (object?.isError === true) return object.content?.find(item => typeof objectValue(item)?.text === 'string')?.text ?? 'MCP tool returned isError=true'
  return objectValue(unwrap(value))?.isError === true ? 'MCP tool returned isError=true' : undefined
}

function validationReport(value) {
  const object = objectValue(unwrap(value))
  const errors = Array.isArray(object?.errors) ? object.errors.map(String) : []
  return { ok: object?.ok === true && errors.length === 0, errors, warnings: Array.isArray(object?.warnings) ? object.warnings.map(String) : [] }
}

function wait(ms, signal) {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    let timer
    const onAbort = () => { if (timer) clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(new Error('Playtest cancelled')) }
    timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
}

function settleWithin(operation, timeoutMs, label) {
  const task = Promise.resolve().then(operation)
  void task.catch(() => undefined)
  const duration = Math.max(1, timeoutMs)
  let timer
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${duration}ms`)), duration) })
  return Promise.race([task, timeout]).finally(() => { if (timer) clearTimeout(timer) })
}

async function callWithDeadline(callTool, tool, args, externalSignal, timeoutMs, lateResult) {
  const controller = new AbortController()
  let timer
  let rejectAbort
  let raceSettled = false
  const abortPromise = new Promise((_, reject) => { rejectAbort = reject })
  const timeoutPromise = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error(`${tool} timed out after ${timeoutMs}ms`)) }, Math.max(1, timeoutMs)) })
  const task = Promise.resolve().then(() => {
    if (controller.signal.aborted) throw new Error('Playtest cancelled')
    return callTool(tool, args, controller.signal)
  }).then(result => {
    const value = unwrap(result)
    const error = toolError(result)
    if (!error && raceSettled && lateResult) void Promise.resolve().then(() => lateResult(value)).catch(() => undefined)
    if (error) throw new Error(`${tool}: ${error}`)
    return value
  })
  void task.catch(() => undefined)
  const onAbort = () => { controller.abort(); rejectAbort?.(new Error('Playtest cancelled')) }
  externalSignal?.addEventListener('abort', onAbort, { once: true })
  if (externalSignal?.aborted) onAbort()
  try { const value = await Promise.race([task, timeoutPromise, abortPromise]); raceSettled = true; return value }
  catch (error) { raceSettled = true; controller.abort(); throw error }
  finally { if (timer) clearTimeout(timer); externalSignal?.removeEventListener('abort', onAbort) }
}

function crashEvidence(log) {
  if (/spawn error|process exited with code [1-9]\d*/i.test(log)) return true
  return [...log.matchAll(/stderr:\s*(.*)/gi)].some(match => { const text = match[1].trim(); return text !== '' && !/^no errors?$/i.test(text) })
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function isPositivePid(value) {
  return Number.isInteger(value) && value > 0
}

function isIdleStatus(status) {
  return status?.running === false && (status.pid === null || status.pid === undefined)
}

function statusMatchesOwned(status, pid) {
  if (!status || status.running !== true && status.running !== false) return false
  if (status.running === true) return status.mode === 'nwjs' && status.pid === pid
  return status.pid === null || status.pid === undefined || status.pid === pid
}

function statusText(status) {
  return JSON.stringify({ running: status?.running, mode: status?.mode, pid: status?.pid })
}

function appendError(report, message) {
  report.error = `${report.error ? `${report.error}; ` : ''}${message}`
}

function cleanupRemaining(deadline) {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new Error('Playtest cleanup timed out')
  return remaining
}

function cleanupCall(options, tool, args, callTimeoutMs, deadline) {
  return callWithDeadline(options.callTool, tool, args, undefined, Math.max(1, Math.min(callTimeoutMs, cleanupRemaining(deadline))))
}

async function verifyOwnedTree(options, processTree, pid, deadline) {
  const verify = options.verifyProcessTree ?? processTree.verify
  const terminate = options.terminateProcessTree ?? processTree.terminate
  let gone = await settleWithin(() => verify(pid), cleanupRemaining(deadline), 'Playtest process-tree verification')
  if (!gone) {
    await settleWithin(() => terminate(pid), cleanupRemaining(deadline), 'Playtest process-tree termination')
    gone = await settleWithin(() => verify(pid), cleanupRemaining(deadline), 'Playtest process-tree verification')
  }
  return gone
}

async function cleanupLateStart(options, processTree, pid, callTimeoutMs, cleanupTimeoutMs) {
  const deadline = Date.now() + cleanupTimeoutMs
  const before = objectValue(await cleanupCall(options, 'playtest_status', {}, callTimeoutMs, deadline))
  if (before?.running !== true || before.mode !== 'nwjs' || before.pid !== pid) return false
  await cleanupCall(options, 'playtest_stop', {}, callTimeoutMs, deadline)
  const after = objectValue(await cleanupCall(options, 'playtest_status', {}, callTimeoutMs, deadline))
  if (!statusMatchesOwned(after, pid)) return false
  const treeGone = await verifyOwnedTree(options, processTree, pid, deadline)
  const final = objectValue(await cleanupCall(options, 'playtest_status', {}, callTimeoutMs, deadline))
  const processGone = final?.running === false && (final.pid === null || final.pid === undefined)
  return treeGone && processGone
}

async function runPlaytestWorkflowUnlocked(options) {
  const report = { outcome: 'static-validation-failed', staticValidation: { ok: false, errors: [], warnings: [] }, processLaunched: false, behaviorVerified: false, statuses: [], log: '', cleanupVerified: false }
  const callTimeoutMs = options.callTimeoutMs ?? 30000
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? Math.max(1000, Math.min(15000, callTimeoutMs * 4))
  const processTree = options.processTree ?? createPlaytestProcessController(options)
  if (options.signal?.aborted) { report.outcome = 'cancelled'; report.error = 'Playtest cancelled before static validation.'; return report }
  try {
    const validation = await callWithDeadline(options.callTool, 'validate_project', {}, options.signal, callTimeoutMs)
    report.staticValidation = validationReport(validation)
  } catch (error) {
    report.staticValidation.errors.push(errorMessage(error)); report.error = report.staticValidation.errors[0]; report.outcome = options.signal?.aborted ? 'cancelled' : 'launch-failed'; return report
  }
  if (!report.staticValidation.ok) { report.error = report.staticValidation.errors.join('; ') || 'Static project validation failed.'; return report }
  let startAttempted = false
  let ownedPid
  let processEnded = false
  let logCaptured = false
  let ownershipConflict = false
  let startTimedOut = false
  let workflowActive = true
  let preflightWasIdle = false
  let resolveLateCompletion
  let resolveNormalCleanup
  const lateCompletion = new Promise(resolve => { resolveLateCompletion = resolve })
  const normalCleanupDone = new Promise(resolve => { resolveNormalCleanup = resolve })
  try {
    const before = objectValue(await callWithDeadline(options.callTool, 'playtest_status', {}, options.signal, callTimeoutMs))
    report.statuses.push(before)
    if (before?.running === true) {
      report.outcome = 'existing-playtest-active'
      report.error = `A Playtest is already running (PID ${isPositivePid(before.pid) ? before.pid : 'unknown'}); stop it before starting another session.`
      return report
    }
    if (!isIdleStatus(before)) throw new Error(`playtest_status did not prove an idle Playtest state: ${statusText(before)}`)
    preflightWasIdle = true
  } catch (error) {
    report.error = errorMessage(error); report.outcome = options.signal?.aborted ? 'cancelled' : 'launch-failed'; return report
  }
  try {
    startAttempted = true
    const startArgs = { mode: 'nwjs', ...(options.runtimePath === undefined ? {} : { runtimePath: options.runtimePath }) }
    let started
    try {
      started = objectValue(await callWithDeadline(options.callTool, 'playtest_start', startArgs, options.signal, callTimeoutMs, async lateValue => {
        const completeLate = async () => {
          await normalCleanupDone
          try {
            const lateLaunch = objectValue(lateValue)
            if (preflightWasIdle && lateLaunch?.mode === 'nwjs' && isPositivePid(lateLaunch.pid)) {
              const cleaned = await cleanupLateStart(options, processTree, lateLaunch.pid, callTimeoutMs, Math.max(1, options.lateGraceMs ?? 50))
              if (cleaned) report.cleanupVerified = true
            }
          } finally { resolveLateCompletion() }
        }
        if (workflowActive) return completeLate()
        return withWorkflowLock(completeLate)
      }))
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('playtest_start timed out')) startTimedOut = true
      throw error
    }
    if (started?.mode !== 'nwjs' || !isPositivePid(started.pid)) throw new Error('playtest_start did not return an NW.js mode and positive PID.')
    ownedPid = started.pid; report.processLaunched = true
    const maxPolls = options.maxPolls ?? 8
    const deadline = options.timeoutMs === undefined ? undefined : Date.now() + options.timeoutMs
    for (let poll = 0; poll < maxPolls; poll += 1) {
      if (options.signal?.aborted) throw new Error('Playtest cancelled')
      if (deadline !== undefined && Date.now() >= deadline) throw new Error('Playtest observation timed out')
      const status = await callWithDeadline(options.callTool, 'playtest_status', {}, options.signal, callTimeoutMs)
      report.statuses.push(status)
      const statusObject = objectValue(status)
      if (!statusMatchesOwned(statusObject, ownedPid)) {
        ownershipConflict = true
        throw new Error(`playtest_status did not match owned NW.js PID ${ownedPid}: ${statusText(statusObject)}`)
      }
      if (statusObject.running === false) {
        processEnded = true
        break
      }
      if (poll + 1 < maxPolls) await wait(options.pollIntervalMs ?? 250, options.signal)
    }
    const logs = await callWithDeadline(options.callTool, 'playtest_log', { tail: 50 }, options.signal, callTimeoutMs)
    report.log = typeof logs === 'string' ? logs : JSON.stringify(logs); logCaptured = true
    if (processEnded) report.outcome = crashEvidence(report.log) ? 'crashed' : 'stopped-behavior-unverified'
  } catch (error) {
    report.error = errorMessage(error)
    report.outcome = options.signal?.aborted || report.error.toLowerCase().includes('cancelled') ? 'cancelled' : report.error.toLowerCase().includes('timed out') ? 'timeout' : report.processLaunched ? 'observation-failed' : 'launch-failed'
    if (!logCaptured) { try { const logs = await callWithDeadline(options.callTool, 'playtest_log', { tail: 50 }, undefined, callTimeoutMs); report.log = typeof logs === 'string' ? logs : JSON.stringify(logs) } catch (logError) { report.log = `${report.log}\n${errorMessage(logError)}`.trim() } }
  } finally {
    if (startAttempted) {
      const cleanupDeadline = Date.now() + cleanupTimeoutMs
      try {
        let statusBeforeStop
        try {
          statusBeforeStop = objectValue(await cleanupCall(options, 'playtest_status', {}, callTimeoutMs, cleanupDeadline)); report.statuses.push(statusBeforeStop)
        } catch (error) { appendError(report, `cleanup status failed: ${errorMessage(error)}`) }
        if (ownedPid === undefined) {
          if (!isIdleStatus(statusBeforeStop)) appendError(report, `an unowned Playtest state was observed after launch failure (${statusText(statusBeforeStop)}); it was not stopped`)
          report.cleanupVerified = false
        } else if (ownershipConflict || !statusMatchesOwned(statusBeforeStop, ownedPid)) {
          appendError(report, `Playtest PID ownership changed before cleanup (${statusText(statusBeforeStop)}); no unrelated process was stopped`)
          report.cleanupVerified = false
        } else {
          report.stop = await cleanupCall(options, 'playtest_stop', {}, callTimeoutMs, cleanupDeadline)
          const after = objectValue(await cleanupCall(options, 'playtest_status', {}, callTimeoutMs, cleanupDeadline)); report.statuses.push(after)
          if (!statusMatchesOwned(after, ownedPid)) {
            appendError(report, `Playtest PID ownership changed after stop (${statusText(after)}); no unrelated process was stopped`)
            report.cleanupVerified = false
          } else {
            let processGone = after.running === false && (after.pid === null || after.pid === undefined)
            const treeGone = await verifyOwnedTree(options, processTree, ownedPid, cleanupDeadline)
            if (!processGone) {
              const final = objectValue(await cleanupCall(options, 'playtest_status', {}, callTimeoutMs, cleanupDeadline)); report.statuses.push(final)
              processGone = final?.running === false && (final.pid === null || final.pid === undefined)
            }
            report.cleanupVerified = processGone && treeGone
            if (!report.cleanupVerified) appendError(report, 'playtest process/descendant cleanup was not confirmed')
          }
        }
      } catch (error) { report.cleanupVerified = false; appendError(report, `cleanup failed: ${errorMessage(error)}`) }
      finally { resolveNormalCleanup() }
    }
  }
  if (startTimedOut) await Promise.race([lateCompletion, wait(options.lateGraceMs ?? 50)])
  workflowActive = false
  if (report.outcome === 'static-validation-failed') report.outcome = report.processLaunched ? (processEnded ? 'crashed' : 'stopped-behavior-unverified') : 'launch-failed'
  return report
}

async function hasProjectEntry(path, kind) {
  try {
    const info = await stat(path)
    return kind === 'directory' ? info.isDirectory() : info.isFile()
  } catch {
    return false
  }
}

async function assertValidMvProject(projectPath) {
  const root = resolve(projectPath)
  const missing = []
  if (!(await hasProjectEntry(join(root, 'Game.rpgproject'), 'file'))) missing.push('Game.rpgproject')
  for (const directory of ['data', 'js']) if (!(await hasProjectEntry(join(root, directory), 'directory'))) missing.push(directory)
  if (missing.length > 0) throw new Error(`invalid RPG Maker MV project ${root}; missing ${missing.join(', ')}`)
}

export async function runPlaytestDebug(options) {
  try {
    await assertValidMvProject(options.projectPath)
  } catch (error) {
    const message = errorMessage(error)
    return { outcome: 'static-validation-failed', staticValidation: { ok: false, errors: [message], warnings: [] }, processLaunched: false, behaviorVerified: false, statuses: [], log: '', cleanupVerified: false, error: message }
  }
  return runPlaytestWorkflow(options)
}

let workflowLock = Promise.resolve()

function withWorkflowLock(operation) {
  const previous = workflowLock
  let release
  workflowLock = new Promise(resolve => { release = resolve })
  return previous.then(operation).finally(() => release())
}

export function runPlaytestWorkflow(options) {
  return withWorkflowLock(() => runPlaytestWorkflowUnlocked(options))
}
