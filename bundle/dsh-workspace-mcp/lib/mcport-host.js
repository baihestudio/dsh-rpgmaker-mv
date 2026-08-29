/**
 * The narrow MCPorter Host pattern, reused from pi-fabric's tested provider:
 * one lazily imported, single-flight Runtime with explicit programmatic
 * configuration; dynamic stdio registration; schema-bearing listing; pooled
 * calls with cancellation containment through per-server close; result
 * normalization; and one final Runtime close. No generic config discovery,
 * descriptor cache, stale revalidation, management API, or daemon surface is
 * copied here.
 *
 * Each apply() creates one Host capability. Runtime and workspace state live on
 * that capability rather than in this module, so a loader reload can never
 * close or reuse a different live Host generation.
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

/** Create the capability for one live Host generation. */
export function createHost() {
  const state = createHostState()
  return {
    hostState: () => hostState(state),
    resetHostState: () => resetHostState(state),
    getHostRuntime: (paths) => getHostRuntime(state, paths),
    registerServer: (paths, definition) => registerServer(state, paths, definition),
    acquireWorkspaceServer: (...args) => acquireWorkspaceServer(state, ...args),
    listWorkspaceTools: (...args) => listWorkspaceTools(state, ...args),
    callWorkspaceTool: (...args) => callWorkspaceTool(state, ...args),
    callServerTool: (paths, serverName, toolName, args, options) => callServerTool(state, paths, serverName, toolName, args, options),
    closeWorkspaceServer: (...args) => closeWorkspaceServer(state, ...args),
    closeServer: (paths, serverName) => closeServer(state, paths, serverName),
    closeHost: () => closeHost(state),
    normalizeMcpResult,
    canonicalMcpValue
  }
}

function createHostState() {
  return {
    runtimePromise: undefined,
    settledRuntime: undefined,
    runtimeDir: undefined,
    closed: false,
    closePromise: undefined,
    workspaceServers: new Map()
  }
}

/** Test/ops introspection: never model-facing. */
export function hostState(host) {
  const pairs = [...host.workspaceServers.values()].map((entry) => ({ engine: entry.engine, canonical: entry.canonical, name: entry.name }))
  return {
    closed: host.closed,
    runtimeDir: host.runtimeDir ?? undefined,
    workspaces: pairs.map((pair) => pair.engine === 'mv' ? pair.canonical : `${pair.engine}:${pair.canonical}`),
    workspacePairs: pairs
  }
}

/** Test seam: reset one disposable Host capability between scenarios. */
export function resetHostState(host) {
  host.runtimePromise = undefined
  host.settledRuntime = undefined
  host.runtimeDir = undefined
  host.closed = false
  host.closePromise = undefined
  host.workspaceServers.clear()
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

/** Lazy single-flight Runtime creation for one Host capability. */
export async function getHostRuntime(host, paths) {
  if (host.closed) throw new Error('dsh-workspace-mcp: the Host MCPorter runtime is closed')
  if (host.settledRuntime) return host.settledRuntime
  if (!host.runtimePromise) {
    host.runtimeDir = paths.mcporterRuntime
    host.runtimePromise = loadRuntime(paths)
  } else if (host.runtimeDir !== paths.mcporterRuntime) {
    throw new Error('dsh-workspace-mcp: the app-owned MCPorter runtime changed during the Host lifetime')
  }
  const runtime = await host.runtimePromise
  if (host.closed) {
    await runtime.close().catch(() => undefined)
    throw new Error('dsh-workspace-mcp: the Host MCPorter runtime was closed during creation')
  }
  host.settledRuntime = runtime
  return runtime
}

/** Register one dynamic stdio definition; a duplicate name fails closed. */
export async function registerServer(host, paths, definition) {
  const runtime = await getHostRuntime(host, paths)
  runtime.registerDefinition(definition, { overwrite: false })
  return definition.name
}

/**
 * Single-flight per-workspace acquisition: the first caller registers the
 * server and lists its tools; concurrent and later callers await the same
 * promise. A failed acquisition stays failed for this Host generation.
 */
function parseWorkspaceArgs(engineOrCanonical, canonicalOrDefinition, maybeDefinition) {
  if (maybeDefinition === undefined) return { engine: 'mv', canonical: engineOrCanonical, definition: canonicalOrDefinition }
  return { engine: engineOrCanonical, canonical: canonicalOrDefinition, definition: maybeDefinition }
}

function workspaceKey(engine, canonical) {
  return `${engine}\u0000${canonical}`
}

export function acquireWorkspaceServer(host, paths, engineOrCanonical, canonicalOrDefinition, maybeDefinition) {
  const { engine, canonical, definition } = parseWorkspaceArgs(engineOrCanonical, canonicalOrDefinition, maybeDefinition)
  if (host.closed) return Promise.reject(new Error('dsh-workspace-mcp: the Host MCPorter runtime is closed'))
  const existing = host.workspaceServers.get(workspaceKey(engine, canonical))
  if (existing) return existing.promise
  const promise = (async () => {
    const runtime = await getHostRuntime(host, paths)
    if (host.closed) throw new Error('dsh-workspace-mcp: the Host closed during workspace server acquisition')
    try {
      runtime.registerDefinition(definition, { overwrite: false })
      const tools = await runtime.listTools(definition.name, { includeSchema: true, disableOAuth: true })
      if (host.closed) throw new Error('dsh-workspace-mcp: the Host closed during workspace server acquisition')
      return { name: definition.name, engine, canonical, tools }
    } finally {
      // Host shutdown may close the Runtime before this listing establishes
      // its child. Close this capability after listing settles so a late
      // connection cannot outlive the Host generation.
      if (host.closed) await runtime.close(definition.name).catch(() => undefined)
    }
  })()
  host.workspaceServers.set(workspaceKey(engine, canonical), { promise, engine, canonical, name: definition.name })
  return promise
}

/** Schema-bearing tool listing for one registered workspace server. */
export async function listWorkspaceTools(host, paths, engineOrCanonical, maybeCanonical) {
  const engine = maybeCanonical === undefined ? 'mv' : engineOrCanonical
  const canonical = maybeCanonical === undefined ? engineOrCanonical : maybeCanonical
  const entry = host.workspaceServers.get(workspaceKey(engine, canonical))
  if (!entry) throw new Error(`dsh-workspace-mcp: no workspace server is registered for ${canonical}`)
  const runtime = await getHostRuntime(host, paths)
  const { name } = await entry.promise
  return runtime.listTools(name, { includeSchema: true, disableOAuth: true })
}

/**
 * Pooled call for one workspace by raw Xerolo tool name. Cancellation is
 * contained by closing that server (killing its pooled child), mirroring the
 * pi-fabric provider; mcporter reconnects on the next call.
 */
export async function callWorkspaceTool(host, paths, engineOrCanonical, canonicalOrToolName, toolOrArgs, argsOrOptions, maybeOptions = {}) {
  const explicitEngine = engineOrCanonical === 'mv' || engineOrCanonical === 'mz'
  const engine = explicitEngine ? engineOrCanonical : 'mv'
  const canonical = explicitEngine ? canonicalOrToolName : engineOrCanonical
  const toolName = explicitEngine ? toolOrArgs : canonicalOrToolName
  const args = explicitEngine ? argsOrOptions : toolOrArgs
  const options = explicitEngine ? (maybeOptions ?? {}) : (argsOrOptions ?? {})
  const entry = host.workspaceServers.get(workspaceKey(engine, canonical))
  if (!entry) throw new Error(`dsh-workspace-mcp: no workspace server is registered for ${canonical}`)
  const { name } = await entry.promise
  return callServerTool(host, paths, name, toolName, args, options)
}

function closeServerForCancellation(host, paths, serverName) {
  const cleanup = getHostRuntime(host, paths).then((runtime) => runtime.close(serverName))
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
export function callServerTool(host, paths, serverName, toolName, args, options = {}) {
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
      void closeServerForCancellation(host, paths, serverName).then(
        () => settle(reject, new Error('MCP call cancelled')),
        (error) => settle(reject, new Error(`MCP call cancellation cleanup-unconfirmed for server ${serverName}: ${error instanceof Error ? error.message : String(error)}`))
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
    const call = getHostRuntime(host, paths).then((runtime) => {
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
export async function closeWorkspaceServer(host, paths, engineOrCanonical, maybeCanonical) {
  const engine = maybeCanonical === undefined ? 'mv' : engineOrCanonical
  const canonical = maybeCanonical === undefined ? engineOrCanonical : maybeCanonical
  const entry = host.workspaceServers.get(workspaceKey(engine, canonical))
  if (!entry) return
  const { name } = await entry.promise
  await closeServer(host, paths, name)
}

export async function closeServer(host, paths, serverName) {
  const runtime = await getHostRuntime(host, paths)
  await runtime.close(serverName).catch(() => undefined)
}

/** Final Host shutdown: closes the one Runtime and every pooled child. */
export function closeHost(host) {
  if (host.closePromise) return host.closePromise
  host.closed = true
  const pending = host.runtimePromise
  const runtime = host.settledRuntime
  const entries = [...host.workspaceServers.values()]
  host.runtimePromise = undefined
  host.settledRuntime = undefined
  host.runtimeDir = undefined
  host.workspaceServers.clear()
  const closing = (async () => {
    const created = pending ? await pending.catch(() => undefined) : undefined
    const targets = new Set([runtime, created].filter(Boolean))
    for (const target of targets) await target.close().catch(() => undefined)
    // A workspace acquisition can still be between registration and tools/list
    // when Host shutdown begins. The Runtime close above terminates its pooled
    // children; await the cached promises so no in-flight server survives the
    // Host generation or produces an unhandled rejection after shutdown.
    await Promise.allSettled(entries.map((entry) => entry.promise))
  })()
  host.closePromise = closing
  return closing
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
