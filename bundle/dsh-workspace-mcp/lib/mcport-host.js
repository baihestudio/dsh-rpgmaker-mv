/**
 * The narrow MCPorter Host pattern, reused from pi-fabric's tested provider:
 * one lazily imported, single-flight Runtime with explicit programmatic
 * configuration; dynamic stdio registration; schema-bearing listing; pooled
 * calls with cancellation containment through per-server close; result
 * normalization; and one final Runtime close. No generic config discovery,
 * descriptor cache, stale revalidation, management API, or daemon surface is
 * copied here.
 *
 * State is Host-lifetime and shared by every RPG Maker preset mount: the
 * plugin row is a host-level bundle layer, so this module holds exactly one
 * Runtime and one per-workspace server cache for the process.
 */
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { MCPORTER_CALL_TIMEOUT_MS } from './workspace.js'

const RUNTIME_MODULE = join('node_modules', 'mcporter', 'dist', 'index.js')
const CLIENT_INFO = { name: 'dsh-workspace-mcp', version: '0.1.0' }
/** A cancellation may wait only this long for MCPorter to confirm quiescence. */
export const MCPORTER_CANCELLATION_CLEANUP_GRACE_MS = 1_000
const QUIET_LOGGER = {
  info() {},
  warn(...args) { console.warn(...args) },
  error(...args) { console.error(...args) },
  debug() {}
}

let runtimePromise
let settledRuntime
let runtimeDir
let closed = false
const workspaceServers = new Map() // canonical -> { promise }

/** Test/ops introspection: never model-facing. */
export function hostState() {
  return {
    closed,
    runtimeDir: runtimeDir ?? undefined,
    workspaces: [...workspaceServers.keys()]
  }
}

/** Test seam: reset all Host-lifetime state between scenarios. */
export function resetHostState() {
  runtimePromise = undefined
  settledRuntime = undefined
  runtimeDir = undefined
  closed = false
  workspaceServers.clear()
}

async function loadRuntime(paths) {
  const url = pathToFileURL(join(paths.mcporterRuntime, RUNTIME_MODULE)).href
  const module = await import(url)
  if (typeof module?.createRuntime !== 'function') {
    throw new Error(`dsh-workspace-mcp: ${url} does not export createRuntime`)
  }
  // An explicit empty server list means mcporter never reads home/project
  // config, editor imports, or daemon state.
  return module.createRuntime({ servers: [], clientInfo: CLIENT_INFO, logger: QUIET_LOGGER })
}

/** Lazy single-flight Runtime creation from the owned mcporter package. */
export async function getHostRuntime(paths) {
  if (closed) throw new Error('dsh-workspace-mcp: the Host MCPorter runtime is closed')
  if (settledRuntime) return settledRuntime
  if (!runtimePromise) {
    runtimeDir = paths.mcporterRuntime
    runtimePromise = loadRuntime(paths)
  } else if (runtimeDir !== paths.mcporterRuntime) {
    throw new Error('dsh-workspace-mcp: the app-owned MCPorter runtime changed during the Host lifetime')
  }
  const runtime = await runtimePromise
  if (closed) {
    await runtime.close().catch(() => undefined)
    throw new Error('dsh-workspace-mcp: the Host MCPorter runtime was closed during creation')
  }
  settledRuntime = runtime
  return runtime
}

/** Register one dynamic stdio definition; a duplicate name fails closed. */
export async function registerServer(paths, definition) {
  const runtime = await getHostRuntime(paths)
  runtime.registerDefinition(definition, { overwrite: false })
  return definition.name
}

/**
 * Single-flight per-workspace acquisition: the first caller registers the
 * server and lists its tools; concurrent and later callers await the same
 * promise. A failed acquisition stays failed for the Host lifetime.
 */
export function acquireWorkspaceServer(paths, canonical, definition) {
  const existing = workspaceServers.get(canonical)
  if (existing) return existing.promise
  const promise = (async () => {
    const runtime = await getHostRuntime(paths)
    if (closed) throw new Error('dsh-workspace-mcp: the Host closed during workspace server acquisition')
    try {
      runtime.registerDefinition(definition, { overwrite: false })
      const tools = await runtime.listTools(definition.name, { includeSchema: true, disableOAuth: true })
      if (closed) throw new Error('dsh-workspace-mcp: the Host closed during workspace server acquisition')
      return { name: definition.name, canonical, tools }
    } finally {
      // Host shutdown may close the Runtime before this listing establishes
      // its child. Close this capability after listing settles so a late
      // connection cannot outlive the Host.
      if (closed) await runtime.close(definition.name).catch(() => undefined)
    }
  })()
  workspaceServers.set(canonical, { promise })
  return promise
}

/** Schema-bearing tool listing for one registered workspace server. */
export async function listWorkspaceTools(paths, canonical) {
  const entry = workspaceServers.get(canonical)
  if (!entry) throw new Error(`dsh-workspace-mcp: no workspace server is registered for ${canonical}`)
  const runtime = await getHostRuntime(paths)
  const { name } = await entry.promise
  return runtime.listTools(name, { includeSchema: true, disableOAuth: true })
}

/**
 * Pooled call for one workspace by raw Xerolo tool name. Cancellation is
 * contained by closing that server (killing its pooled child), mirroring the
 * pi-fabric provider; mcporter reconnects on the next call.
 */
export async function callWorkspaceTool(paths, canonical, toolName, args, options = {}) {
  const entry = workspaceServers.get(canonical)
  if (!entry) throw new Error(`dsh-workspace-mcp: no workspace server is registered for ${canonical}`)
  const { name } = await entry.promise
  return callServerTool(paths, name, toolName, args, options)
}

function closeServerForCancellation(paths, serverName) {
  const cleanup = getHostRuntime(paths).then((runtime) => runtime.close(serverName))
  return new Promise((resolve, reject) => {
    let finished = false
    let timer
    const finish = (settle, value) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      settle(value)
    }
    timer = setTimeout(() => finish(reject, new Error(`MCPorter did not confirm workspace server ${serverName} quiescence within ${MCPORTER_CANCELLATION_CLEANUP_GRACE_MS} ms`)), MCPORTER_CANCELLATION_CLEANUP_GRACE_MS)
    void cleanup.then(
      () => finish(resolve, undefined),
      (error) => finish(reject, error instanceof Error ? error : new Error(String(error)))
    )
  })
}

/** Pooled call with cancellation containment and MCPorter's fixed timeout, by server name. */
export function callServerTool(paths, serverName, toolName, args, options = {}) {
  return new Promise((resolve, reject) => {
    const signal = options.signal
    let settled = false
    let cancelling = false
    let listenerAttached = false
    const removeAbortListener = () => {
      if (!listenerAttached) return
      listenerAttached = false
      signal?.removeEventListener('abort', onAbort)
    }
    const settle = (fn, value) => {
      if (settled) return
      settled = true
      removeAbortListener()
      fn(value)
    }
    const beginCancellation = () => {
      if (cancelling || settled) return
      cancelling = true
      void closeServerForCancellation(paths, serverName).then(
        () => settle(reject, new Error('RPG Maker MCP call cancelled')),
        (error) => settle(reject, new Error(`RPG Maker MCP call cancellation cleanup-unconfirmed for workspace server ${serverName}: ${error instanceof Error ? error.message : String(error)}`))
      )
    }
    const onAbort = () => beginCancellation()

    if (signal?.aborted) {
      beginCancellation()
      return
    }
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
      listenerAttached = true
      if (signal.aborted) {
        beginCancellation()
        return
      }
    }

    // Keep this continuation attached even after cancellation. MCPorter may
    // resolve or reject the old call after close; the result is intentionally
    // ignored so it cannot create a second settlement or an unhandled rejection.
    const call = getHostRuntime(paths).then((runtime) => {
      if (cancelling) return undefined
      return runtime.callTool(serverName, toolName, { args, timeoutMs: MCPORTER_CALL_TIMEOUT_MS, disableOAuth: true })
    })
    void call.then(
      (value) => { if (!cancelling) settle(resolve, value) },
      (error) => { if (!cancelling) settle(reject, error instanceof Error ? error : new Error(String(error))) }
    )
  })
}

/** Per-server close: the definition stays registered; the pooled child is gone. */
export async function closeWorkspaceServer(paths, canonical) {
  const entry = workspaceServers.get(canonical)
  if (!entry) return
  const { name } = await entry.promise
  await closeServer(paths, name)
}

export async function closeServer(paths, serverName) {
  const runtime = await getHostRuntime(paths)
  await runtime.close(serverName).catch(() => undefined)
}

/** Final Host shutdown: closes the one Runtime and every pooled child. */
export async function closeHost() {
  if (closed && !runtimePromise && !settledRuntime) return
  closed = true
  const pending = runtimePromise
  const runtime = settledRuntime
  const entries = [...workspaceServers.values()]
  runtimePromise = undefined
  settledRuntime = undefined
  runtimeDir = undefined
  workspaceServers.clear()
  const created = pending ? await pending.catch(() => undefined) : undefined
  const targets = new Set([runtime, created].filter(Boolean))
  for (const target of targets) await target.close().catch(() => undefined)
  // A workspace acquisition can still be between registration and tools/list
  // when Host shutdown begins. The Runtime close above terminates its pooled
  // children; await the cached promises so no in-flight server survives the
  // Host generation or produces an unhandled rejection after shutdown.
  await Promise.allSettled(entries.map((entry) => entry.promise))
}

/** pi-fabric result normalization: text projection, MCP errors as failures. */
export function normalizeMcpResult(result) {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return result
  const record = result
  if (!Array.isArray(record.content)) return result
  const text = record.content
    .filter((part) => part !== null && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
  if (record.isError === true) throw new Error(text || 'RPG Maker MCP tool returned an error')
  return { text, content: record.content, structuredContent: record.structuredContent ?? null }
}

/** Canonical lossless-JSON tool value: structured content, else parsed text. */
export function canonicalMcpValue(result) {
  const normalized = normalizeMcpResult(result)
  if (normalized === null || typeof normalized !== 'object' || Array.isArray(normalized)) return normalized
  if (normalized.structuredContent !== undefined && normalized.structuredContent !== null) {
    return normalized.structuredContent
  }
  try {
    return JSON.parse(normalized.text)
  } catch {
    return normalized.text
  }
}
