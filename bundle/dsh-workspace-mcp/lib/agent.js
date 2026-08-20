/**
 * @baihestudio/dsh-workspace-mcp/agent — Agent-scoped access to the Host
 * workspace MCP service.
 *
 * Preset compositions mount this entry point explicitly. It has no preset
 * roster knowledge: the composition decides which Agents receive the 41
 * manifest-backed tools. The shared Host is resolved through the root context
 * WeakMap owned by the package-root Host entry point.
 */
import { resolveRuntimePaths } from './env.js'
import { hostForRoot } from './index.js'
import { XEROLO_MANIFEST, validateDiscoveredTools, validateModelNames, verifyManifest } from './contract.js'
import { createMcpTool, toModelName } from './tools.js'
import { buildWorkspaceDefinition, canonicalWorkspace, validateWorkspace } from './workspace.js'

export const name = '@baihestudio/dsh-workspace-mcp/agent'
export const inject = ['tools']

/** Agent plugin entry: register manifest tools synchronously in this scope. */
export function apply(ctx) {
  const agent = ctx.agent
  if (!agent) throw new Error('dsh-workspace-mcp/agent: no Agent is bound to this scope')
  const host = hostForRoot(ctx.root)
  if (!host) throw new Error('dsh-workspace-mcp/agent: no Host service is bound to this root context')

  // Synchronous manifest-backed registration: DSH rc.7 collects tool-provider
  // schemas before the system-prompt/assemble waterfall, so the first
  // assembly already carries every stable rpgmaker_* tool.
  const init = initializeAgent(host, ctx, agent)
  const disposers = XEROLO_MANIFEST.tools.map((rawTool) => ctx.tools.register(createMcpTool(rawTool, { init })))
  ctx.logger?.info?.('dsh-workspace-mcp synchronously registered %d manifest tools for agent %s', disposers.length, agent.id ?? 'unknown')

  // Gate the first prompt on workspace validation, connection acquisition, and
  // live schema parity. The synchronous registrations remain untouched.
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    await init
    return next()
  })
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
