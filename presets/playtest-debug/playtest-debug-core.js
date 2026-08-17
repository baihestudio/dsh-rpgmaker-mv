import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const WINDOWS_TREE_PROBE = `$target=[int]$env:DSH_PLAYTEST_PID; $parents=@($target); $seen=@{}; do { $next=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $parents -contains [int]$_.ParentProcessId -and -not $seen.ContainsKey([int]$_.ProcessId) } | ForEach-Object { $seen[[int]$_.ProcessId]=$true; [int]$_.ProcessId }); if ($next.Count -gt 0) { $parents += $next } } while ($next.Count -gt 0); $running=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $parents -contains [int]$_.ProcessId }); if ($running.Count -eq 0) { 'clean' } else { 'running' }`

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
    const child = spawn(command, args, { cwd: options.cwd, env: Object.fromEntries(Object.entries(options.env ?? process.env).filter(([, value]) => value !== undefined)), shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timer
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', chunk => { stdout += chunk })
    child.stderr?.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('close', code => { if (timer) clearTimeout(timer); resolve({ exitCode: code ?? 1, stdout, stderr }) })
    if (options.timeoutMs) timer = setTimeout(() => { child.kill(); resolve({ exitCode: 124, stdout, stderr: `${stderr}\ncommand timed out`.trim() }) }, options.timeoutMs)
  })
}

export function createPlaytestProcessController(options = {}) {
  const platform = options.platform ?? process.platform
  const env = envWithoutSecrets(options.env ?? process.env)
  const runner = options.commandRunner ?? shortCommand
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
    const result = await runner(pwsh, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_TREE_PROBE], { env: { ...env, DSH_PLAYTEST_PID: String(pid) }, timeoutMs: 5000, platform })
    return result.exitCode === 0 && result.stdout.trim().toLowerCase() === 'clean'
  }
  return {
    verify,
    terminate: async pid => {
      const result = await runner(taskkill, ['/PID', String(pid), '/T', '/F'], { env, timeoutMs: 10000, platform })
      if (result.exitCode !== 0 && !(await verify(pid))) throw new Error(`taskkill could not terminate Playtest PID ${pid}: ${result.stderr || result.stdout}`)
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
    const onAbort = () => { if (timer) clearTimeout(timer); reject(new Error('Playtest cancelled')) }
    timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
}

async function callWithDeadline(callTool, tool, args, externalSignal, timeoutMs, lateResult) {
  const controller = new AbortController()
  let timer
  let rejectAbort
  const forward = () => controller.abort()
  externalSignal?.addEventListener('abort', forward, { once: true })
  const abortPromise = new Promise((_, reject) => { rejectAbort = reject })
  const timeoutPromise = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error(`${tool} timed out after ${timeoutMs}ms`)) }, timeoutMs) })
  let raceSettled = false
  const task = Promise.resolve().then(() => callTool(tool, args, controller.signal)).then(result => { const value = unwrap(result); if (raceSettled && lateResult) void Promise.resolve(lateResult(value)).catch(() => undefined); const error = toolError(result); if (error) throw new Error(`${tool}: ${error}`); return value })
  const onAbort = () => { controller.abort(); rejectAbort?.(new Error('Playtest cancelled')) }
  externalSignal?.addEventListener('abort', onAbort, { once: true })
  try { const value = await Promise.race([task, timeoutPromise, abortPromise]); raceSettled = true; return value }
  catch (error) { raceSettled = true; controller.abort(); void task.catch(() => undefined); throw error }
  finally { if (timer) clearTimeout(timer); externalSignal?.removeEventListener('abort', forward); externalSignal?.removeEventListener('abort', onAbort) }
}

function crashEvidence(log) {
  if (/spawn error|process exited with code [1-9]\d*/i.test(log)) return true
  return [...log.matchAll(/stderr:\s*(.*)/gi)].some(match => { const text = match[1].trim(); return text !== '' && !/^no errors?$/i.test(text) })
}

export async function runPlaytestWorkflow(options) {
  const report = { outcome: 'static-validation-failed', staticValidation: { ok: false, errors: [], warnings: [] }, processLaunched: false, behaviorVerified: false, statuses: [], log: '', cleanupVerified: false }
  const callTimeoutMs = options.callTimeoutMs ?? 30000
  const processTree = options.processTree ?? createPlaytestProcessController(options)
  if (options.signal?.aborted) { report.outcome = 'cancelled'; report.error = 'Playtest cancelled before static validation.'; return report }
  try {
    const validation = await callWithDeadline(options.callTool, 'validate_project', {}, options.signal, callTimeoutMs)
    report.staticValidation = validationReport(validation)
  } catch (error) {
    report.staticValidation.errors.push(error instanceof Error ? error.message : String(error)); report.error = report.staticValidation.errors[0]; report.outcome = options.signal?.aborted ? 'cancelled' : 'launch-failed'; return report
  }
  if (!report.staticValidation.ok) { report.error = report.staticValidation.errors.join('; ') || 'Static project validation failed.'; return report }
  let startAttempted = false
  let ownedPid
  let preExistingPid
  let processEnded = false
  let logCaptured = false
  try {
    const before = await callWithDeadline(options.callTool, 'playtest_status', {}, options.signal, callTimeoutMs)
    report.statuses.push(before)
    const beforeObject = objectValue(before)
    if (beforeObject?.running === true) { preExistingPid = beforeObject.pid; report.outcome = 'existing-playtest-active'; report.error = `A Playtest is already running (PID ${preExistingPid ?? 'unknown'}); stop it before starting another session.`; return report }
    if (beforeObject?.running !== false) throw new Error('playtest_status returned no boolean running state.')
  } catch (error) { report.error = error instanceof Error ? error.message : String(error); report.outcome = options.signal?.aborted ? 'cancelled' : 'launch-failed'; return report }
  try {
    startAttempted = true
    const startArgs = { mode: 'nwjs', ...(options.runtimePath === undefined ? {} : { runtimePath: options.runtimePath }) }
    const started = objectValue(await callWithDeadline(options.callTool, 'playtest_start', startArgs, options.signal, callTimeoutMs, async (lateValue) => {
      const lateLaunch = objectValue(lateValue);
      if (preExistingPid === undefined && Number.isInteger(lateLaunch?.pid) && lateLaunch.pid > 0) {
        const lateStatus = objectValue(await callWithDeadline(options.callTool, 'playtest_status', {}, undefined, callTimeoutMs));
        if (lateStatus?.running === true && lateStatus.pid === lateLaunch.pid) {
          await callWithDeadline(options.callTool, 'playtest_stop', {}, undefined, callTimeoutMs);
          await callWithDeadline(options.callTool, 'playtest_status', {}, undefined, callTimeoutMs);
        }
      }
    }))
    if (started?.mode !== 'nwjs' || !Number.isInteger(started.pid) || started.pid <= 0) throw new Error('playtest_start did not return an NW.js mode and positive PID.')
    ownedPid = started.pid; report.processLaunched = true
    const maxPolls = options.maxPolls ?? 8
    const deadline = options.timeoutMs === undefined ? undefined : Date.now() + options.timeoutMs
    for (let poll = 0; poll < maxPolls; poll += 1) {
      if (options.signal?.aborted) throw new Error('Playtest cancelled')
      if (deadline !== undefined && Date.now() >= deadline) throw new Error('Playtest observation timed out')
      const status = await callWithDeadline(options.callTool, 'playtest_status', {}, options.signal, callTimeoutMs)
      report.statuses.push(status)
      const statusObject = objectValue(status)
      if (statusObject?.running !== true && statusObject?.running !== false) throw new Error('playtest_status returned no boolean running state.')
      if (statusObject.running === false) {
        if (statusObject.pid !== null && statusObject.pid !== undefined && statusObject.pid !== ownedPid) throw new Error(`playtest_status PID ${statusObject.pid} did not match owned PID ${ownedPid}`);
        processEnded = true;
        break;
      }
      if (statusObject.pid !== ownedPid) throw new Error(`playtest_status PID ${statusObject.pid ?? 'missing'} did not match owned PID ${ownedPid}`);
      if (poll + 1 < maxPolls) await wait(options.pollIntervalMs ?? 250, options.signal)
    }
    const logs = await callWithDeadline(options.callTool, 'playtest_log', { tail: 50 }, options.signal, callTimeoutMs)
    report.log = typeof logs === 'string' ? logs : JSON.stringify(logs); logCaptured = true
    if (processEnded) report.outcome = crashEvidence(report.log) ? 'crashed' : 'stopped-behavior-unverified'
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error)
    report.outcome = options.signal?.aborted || report.error.toLowerCase().includes('cancelled') ? 'cancelled' : report.error.toLowerCase().includes('timed out') ? 'timeout' : report.processLaunched ? 'observation-failed' : 'launch-failed'
    if (!logCaptured) { try { const logs = await callWithDeadline(options.callTool, 'playtest_log', { tail: 50 }, undefined, callTimeoutMs); report.log = typeof logs === 'string' ? logs : JSON.stringify(logs) } catch (logError) { report.log = `${report.log}\n${logError instanceof Error ? logError.message : String(logError)}`.trim() } }
  } finally {
    if (startAttempted) {
      let statusBeforeStop
      try {
        statusBeforeStop = objectValue(await callWithDeadline(options.callTool, 'playtest_status', {}, undefined, callTimeoutMs)); report.statuses.push(statusBeforeStop)
        if (ownedPid === undefined && statusBeforeStop?.running === true) report.error = `${report.error ? `${report.error}; ` : ''}an unowned Playtest PID was observed after launch failure; it was not stopped`
      } catch (error) { report.error = `${report.error ? `${report.error}; ` : ''}cleanup status failed: ${error instanceof Error ? error.message : String(error)}` }
      const statusPidConflicts = ownedPid !== undefined && (statusBeforeStop === undefined || (statusBeforeStop.running !== true && statusBeforeStop.running !== false) || (statusBeforeStop.running === true && statusBeforeStop.pid !== ownedPid) || (statusBeforeStop.pid !== null && statusBeforeStop.pid !== undefined && statusBeforeStop.pid !== ownedPid));
      if (statusPidConflicts) {
        report.error = `${report.error ? `${report.error}; ` : ''}Playtest PID ownership changed before cleanup; no unrelated process was stopped`;
        if (report.outcome === 'static-validation-failed') report.outcome = 'observation-failed';
      }
      const shouldStop = ownedPid !== undefined && !statusPidConflicts;
      if (shouldStop) {
        try {
          report.stop = await callWithDeadline(options.callTool, 'playtest_stop', {}, undefined, callTimeoutMs)
          const after = objectValue(await callWithDeadline(options.callTool, 'playtest_status', {}, undefined, callTimeoutMs)); report.statuses.push(after)
          const afterPidConflicts = after === undefined || (after.running !== true && after.running !== false) || (after.running === true && after.pid !== ownedPid) || (after.pid !== null && after.pid !== undefined && after.pid !== ownedPid);
          const processGone = !afterPidConflicts && after?.running === false && (after.pid === null || after.pid === undefined)
          let treeGone = false
          if (!afterPidConflicts && ownedPid !== undefined) { treeGone = options.verifyProcessTree ? await options.verifyProcessTree(ownedPid) : await processTree.verify(ownedPid); if (!treeGone) { await (options.terminateProcessTree ?? processTree.terminate)(ownedPid); treeGone = await (options.verifyProcessTree ? options.verifyProcessTree(ownedPid) : processTree.verify(ownedPid)) } }
          report.cleanupVerified = processGone && ownedPid !== undefined && treeGone
          if (!report.cleanupVerified) report.error = `${report.error ? `${report.error}; ` : ''}playtest process/descendant cleanup was not confirmed`
        } catch (error) { report.cleanupVerified = false; report.error = `${report.error ? `${report.error}; ` : ''}cleanup failed: ${error instanceof Error ? error.message : String(error)}` }
      } else { report.cleanupVerified = false; report.error = `${report.error ? `${report.error}; ` : ''}existing Playtest ownership could not be distinguished safely` }
    }
  }
  if (report.outcome === 'static-validation-failed') report.outcome = report.processLaunched ? (processEnded ? 'crashed' : 'stopped-behavior-unverified') : 'launch-failed'
  return report
}
