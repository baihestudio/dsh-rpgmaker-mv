import { spawn } from 'node:child_process'
import { basename, join } from 'node:path'

const OBSERVER_CLEANUP_TIMEOUT_MS = 2_000

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null
}

function waitForObserverExit(child, timeoutMs) {
  if (hasExited(child)) return Promise.resolve(true)
  return new Promise((resolve) => {
    let settled = false
    let timer
    const finish = (confirmed) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.removeListener('exit', onExit)
      child.removeListener('close', onClose)
      resolve(confirmed || hasExited(child))
    }
    const onExit = () => finish(true)
    const onClose = () => finish(true)
    timer = setTimeout(() => finish(false), timeoutMs)
    child.once('exit', onExit)
    child.once('close', onClose)
  })
}

async function cleanupObserver(child) {
  if (hasExited(child)) return { confirmed: true }
  let killError
  try {
    child.kill()
  } catch (error) {
    killError = error
  }
  const confirmed = await waitForObserverExit(child, OBSERVER_CLEANUP_TIMEOUT_MS)
  return { confirmed, killError }
}

export async function run(command, args, env, timeoutMs = 10_000, spawnProcess = spawn) {
  const child = spawnProcess(command, args, {
    env: Object.fromEntries(Object.entries(env ?? process.env).filter((entry) => entry[1] !== undefined)),
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  const completion = new Promise((resolve, reject) => {
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => { stdout += chunk })
    child.stderr?.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
  let timer
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`process observation command timed out after ${timeoutMs} ms`)), timeoutMs)
      timer.unref?.()
    })
    return await Promise.race([completion, timeout])
  } catch (error) {
    const cleanup = await cleanupObserver(child)
    if (!cleanup.confirmed) {
      const detail = cleanup.killError instanceof Error ? `: ${cleanup.killError.message}` : ''
      throw new Error(`${error instanceof Error ? error.message : String(error)}; observer process cleanup did not confirm termination within ${OBSERVER_CLEANUP_TIMEOUT_MS} ms${detail}`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function normalize(value, platform) {
  const text = String(value ?? '').replaceAll('\\', '/')
  return platform === 'win32' ? text.toLowerCase() : text
}

function parseWindowsProcesses(text) {
  if (!text.trim()) return []
  const parsed = JSON.parse(text.replace(/^\uFEFF/, ''))
  const entries = Array.isArray(parsed) ? parsed : [parsed]
  return entries.filter((entry) => entry && typeof entry === 'object').map((entry) => ({
    pid: Number(entry.ProcessId),
    parentPid: Number(entry.ParentProcessId),
    image: String(entry.Name ?? ''),
    commandLine: String(entry.CommandLine ?? '')
  }))
}

function parseUnixProcesses(text) {
  return text.split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/)
    if (!match) return undefined
    return { pid: Number(match[1]), parentPid: Number(match[2]), image: match[3], commandLine: match[4] }
  }).filter(Boolean)
}

export async function listProcessRecords(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    const powershell = env.SystemRoot
      ? join(env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : 'powershell.exe'
    const script = "$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress"
    const result = await run(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], env)
    if (result.code !== 0) throw new Error(`Windows process observation failed with exit code ${result.code}`)
    return parseWindowsProcesses(result.stdout)
  }
  const result = await run('ps', ['-axo', 'pid=,ppid=,comm=,args='], env)
  if (result.code !== 0) throw new Error(`Process observation failed with exit code ${result.code}`)
  return parseUnixProcesses(result.stdout)
}

function shellImage(image) {
  const name = basename(String(image ?? '')).toLowerCase()
  return new Set(['cmd', 'cmd.exe', 'command.com', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe', 'sh', 'bash', 'zsh', 'fish']).has(name)
}

function summarize(record, project, entry, platform) {
  const commandLine = String(record.commandLine ?? '')
  const normalizedCommand = normalize(commandLine, platform)
  const projectToken = normalize(project, platform)
  const entryToken = normalize(entry, platform)
  const projectObserved = projectToken.length > 0 && normalizedCommand.includes(projectToken)
  const entryObserved = entryToken.length > 0 && normalizedCommand.includes(entryToken)
  const projectArgumentObserved = /(?:^|[\s"'])--project(?:=|[\s"']|$)/i.test(commandLine)
  return {
    pid: Number.isInteger(record.pid) ? record.pid : null,
    parentPid: Number.isInteger(record.parentPid) ? record.parentPid : null,
    image: basename(String(record.image ?? '')).toLowerCase(),
    entryObserved,
    projectObserved,
    projectArgumentObserved
  }
}

export async function observeXeroloChildren({ project, entry, platform = process.platform, env = process.env }) {
  const records = await listProcessRecords(platform, env)
  const summaries = records.map((record) => summarize(record, project, entry, platform))
  const children = summaries.filter((record) => record.entryObserved && record.projectObserved && record.projectArgumentObserved)
  const shellProcesses = summaries.filter((record) => record.projectObserved && record.projectArgumentObserved && shellImage(record.image))
  return {
    processTableSize: records.length,
    children,
    shellProcesses
  }
}

export async function observeLauncherProcesses({ installedRoot, platform = process.platform, env = process.env }) {
  const records = await listProcessRecords(platform, env)
  const rootToken = normalize(installedRoot, platform)
  const scoped = records.filter((record) => normalize(record.commandLine, platform).includes(rootToken))
  const launchers = scoped.filter((record) => {
    const command = normalize(record.commandLine, platform)
    return command.includes('launch.ps1') || command.includes('launch.cmd') || command.includes('/src/cli.ts launch') || command.includes('\\src\\cli.ts launch')
  })
  const projectArgumentCount = launchers.filter((record) => /(?:^|[\s"'])--project(?:=|[\s"']|$)/i.test(record.commandLine)).length
  return {
    processTableSize: records.length,
    launcherProcessCount: launchers.length,
    projectArgumentCount,
    launcherProcessObserved: launchers.length > 0
  }
}
