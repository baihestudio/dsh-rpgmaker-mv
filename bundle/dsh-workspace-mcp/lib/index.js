/**
 * @baihestudio/dsh-workspace-mcp — app-owned Host service for workspace-scoped
 * RPG Maker MCP. One lazy MCPorter Runtime and one warm stdio Xerolo server
 * per canonical workspace live for the Host generation.
 *
 * The package root is the Host entry point. Agent access is mounted separately
 * from `./agent` by each preset composition. This layer registers no tools and
 * does not inspect or name any preset.
 */
import { createHost } from './mcport-host.js'

export const name = '@baihestudio/dsh-workspace-mcp'
export const inject = []

// The Host bundle row and every preset-mounted Agent row share this module
// instance. The root context is the only publication boundary: no Cordis
// service is provided into the ROOT realm.
const hostByRoot = new WeakMap()

function rootOf(ctx) {
  const root = ctx?.root
  if ((typeof root !== 'object' && typeof root !== 'function') || root === null) {
    throw new Error('dsh-workspace-mcp: Host context has no root context')
  }
  return root
}

/** Resolve the Host capability for one loader root. */
export function hostForRoot(root) {
  return hostByRoot.get(root)
}

/** Inspect the Host capability owned by a loader context. */
export function hostState(ctx) {
  const host = hostForRoot(rootOf(ctx))
  if (!host) throw new Error('dsh-workspace-mcp: no Host capability is bound to this root context')
  return host.hostState()
}

/** Host plugin entry: create one generation-owned runtime for this root. */
export function apply(ctx) {
  const root = rootOf(ctx)
  const host = createHost()
  hostByRoot.set(root, host)
  ctx.effect(() => () => host.closeHost(), 'dsh-workspace-mcp.closeHost()')
}

// Testable narrow Host surface re-exported for disposable probes.
export {
  createHost,
  resetHostState,
  getHostRuntime,
  registerServer,
  acquireWorkspaceServer,
  listWorkspaceTools,
  callWorkspaceTool,
  callServerTool,
  closeWorkspaceServer,
  closeServer,
  closeHost,
  normalizeMcpResult,
  canonicalMcpValue,
  MCPORTER_CANCELLATION_CLEANUP_GRACE_MS
} from './mcport-host.js'
