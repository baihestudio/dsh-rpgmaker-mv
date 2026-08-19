/**
 * @baihestudio/dsh-workspace-mcp — app-owned Host plugin for workspace-scoped
 * RPG Maker MCP. One lazy Host MCPorter Runtime; one warm stdio Xerolo server
 * per canonical RPG Maker workspace; stable Agent-scoped `rpgmaker_<raw>` tools
 * generated from the pinned machine-generated manifest.
 *
 * Mounted as a host-level bundle layer (cordis.patch.yml). It activates only
 * live Agents whose session preset is one of the four RPG Maker presets and
 * whose header cwd is a valid RPG Maker MV project root. Workspace and session
 * identity never appear in model-facing names, and app-owned source is never
 * executed through the Agent shell.
 */
import { resolveRuntimePaths } from './env.js'
import { createHost } from './mcport-host.js'
import { XEROLO_MANIFEST, validateDiscoveredTools, validateModelNames, verifyManifest } from './contract.js'
import { createMcpTool, toModelName } from './tools.js'
import { buildWorkspaceDefinition, canonicalWorkspace, validateWorkspace } from './workspace.js'

export const name = '@baihestudio/dsh-workspace-mcp'
export const inject = []

/** Presets that compose a workspace-scoped RPG Maker Agent. */
export const RPG_PRESETS = ['rpgmaker', 'playtest-debug', 'asset-workshop', 'build-release']
const RPG_PRESET_SET = new Set(RPG_PRESETS)

// Testable narrow surface re-exported for disposable probes and the Agent seam.
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

const hostByContext = new WeakMap()

function hostOwner(ctx) {
  return ctx?.root && typeof ctx.root === 'object' ? ctx.root : ctx
}

/** Inspect the Host capability owned by an applied context. */
export function hostState(ctx) {
  const host = hostByContext.get(ctx) ?? hostByContext.get(hostOwner(ctx))
  if (!host) throw new Error('dsh-workspace-mcp: no Host capability is bound to this context')
  return host.hostState()
}
export {
  XEROLO_MANIFEST,
  XEROLO_TOOL_NAMES,
  XEROLO_MANIFEST_SHA256,
  TOOL_NAME_PREFIX,
  RESERVED_DSH_TOOL_NAME,
  schemaProblem,
  manifestDigest,
  verifyManifest,
  validateDiscoveredTools,
  validateModelNames
} from './contract.js'
export {
  resolveRuntimePaths,
  neutralizedServerEnv,
  SECRET_MARKER,
  MCPORTER_RUNTIME_ENV,
  XEROLO_RUNTIME_ENV,
  JS_RUNNER_ENV
} from './env.js'
export {
  canonicalWorkspace,
  validateWorkspace,
  privateServerName,
  buildWorkspaceDefinition,
  MV_PROJECT_MARKER,
  MV_REQUIRED_DIRECTORIES,
  MCPORTER_CALL_TIMEOUT_MS
} from './workspace.js'
export { toModelName, createMcpTool } from './tools.js'

/** Host plugin entry: one generation-owned runtime and per-Agent initialization. */
export function apply(ctx) {
  const host = createHost()
  hostByContext.set(ctx, host)
  hostByContext.set(hostOwner(ctx), host)
  ctx.on('agent/created', ({ agent }) => {
    const preset = agent?.session?.header?.agentPreset
    if (!RPG_PRESET_SET.has(preset)) return
    const agentCtx = agent?.ctx
    if (!agentCtx) return
    // Synchronous manifest-backed registration: DSH rc.7 collects tool-provider
    // schemas BEFORE the system-prompt/assemble waterfall, so an immediately
    // started first assembly already carries every stable rpgmaker_* tool.
    // One registration factory copies the pinned manifest's descriptions and
    // input schemas; no per-tool wrapper is hand-written.
    const init = initializeAgent(host, ctx, agent)
    const disposers = XEROLO_MANIFEST.tools.map((rawTool) => agentCtx.tools.register(createMcpTool(rawTool, { init })))
    ctx.logger?.info?.('dsh-workspace-mcp synchronously registered %d manifest tools for agent %s', disposers.length, agent?.id ?? 'unknown')
    // Gate the Agent's first prompt assembly on initialization so the first
    // request either carries the complete validated tool set or fails visibly.
    // The gate only makes init/schema failures reject; it never re-projects or
    // overwrites the synchronously collected tool schemas.
    agentCtx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      await init
      return next()
    })
  })
  const shutdown = () => host.closeHost()
  ctx.effect(() => shutdown, 'dsh-workspace-mcp.closeHost()')
}

async function initializeAgent(host, ctx, agent) {
  // The pinned manifest is verified like a runtime lock fact before any
  // workspace server is acquired or any tool may execute.
  const manifest = verifyManifest()
  if (manifest.errors.length > 0) {
    throw new Error(`Pinned Xerolo manifest is not trustworthy: ${manifest.errors.join('; ')}`)
  }
  const cwd = agent?.session?.header?.cwd
  const canonical = await canonicalWorkspace(cwd)
  const validation = await validateWorkspace(canonical)
  if (!validation.valid) {
    throw new Error(`Not a valid RPG Maker MV workspace: ${canonical}. Missing ${validation.missing.join(', ')}.`)
  }
  const paths = resolveRuntimePaths(process.env)
  const definition = await buildWorkspaceDefinition(canonical, paths)
  const acquired = await host.acquireWorkspaceServer(paths, canonical, definition)
  const contract = validateDiscoveredTools(acquired.tools)
  if (contract.errors.length > 0) throw new Error(contract.errors.join('; '))
  const modelNames = acquired.tools.map((tool) => toModelName(tool.name))
  const names = validateModelNames(modelNames)
  if (names.errors.length > 0) throw new Error(names.errors.join('; '))
  ctx.logger?.info?.('dsh-workspace-mcp initialized workspace server %s (%d tools matched the pinned manifest)', acquired.name, acquired.tools.length)
  return { host, canonical, paths, serverName: acquired.name }
}
