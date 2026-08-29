/**
 * @baihestudio/dsh-workspace-mcp/agent — Agent-scoped access to the Host
 * workspace MCP service. The selected engine is discovered from the actual
 * Agent session cwd during the first assembly/call; only that engine's
 * generated manifest remains visible to the Agent.
 */
import { resolveRuntimePaths } from './env.js'
import { renderToolsSdk } from '@deepseek-ai/dsh-tools'
import { hostForRoot } from './index.js'
import {
  ENGINE_CONTRACTS,
  MZ_MANIFEST,
  RPGMAKER_MV_MANIFEST,
  RPGMAKER_MZ_MANIFEST,
  MZ_MANIFEST_SHA256,
  MZ_TOOL_NAMES,
  XEROLO_MANIFEST,
  XEROLO_MANIFEST_SHA256,
  XEROLO_TOOL_NAMES,
  RESERVED_DSH_TOOL_NAME,
  TOOL_NAME_PREFIX,
  contractFor,
  manifestDigest,
  manifestFor,
  missingCriticalTools,
  schemaProblem,
  validateDiscoveredTools,
  validateModelNames,
  verifyManifest
} from './contract.js'
import { createMcpTool, projectDshObjectJsonSchema, toModelName } from './tools.js'
import {
  ENGINE_IDS,
  MZ_PROJECT_MARKER,
  MZ_REQUIRED_DIRECTORIES,
  MV_PROJECT_MARKER,
  MV_REQUIRED_DIRECTORIES,
  buildWorkspaceDefinition,
  canonicalWorkspace,
  classifyWorkspace,
  privateServerName,
  MCPORTER_CALL_TIMEOUT_MS
} from './workspace.js'

export const name = '@baihestudio/dsh-workspace-mcp/agent'
export const inject = ['tools']

function registrationSchemas(ctx) {
  const state = { engine: 'mv', disposers: [], manifest: undefined }
  const register = (engine) => {
    const manifest = manifestFor(engine)
    if (state.engine === engine && state.manifest === manifest && state.disposers.length > 0) return
    for (const dispose of state.disposers.splice(0)) {
      try { dispose() } catch { /* scope disposal remains authoritative */ }
    }
    state.engine = engine
    state.manifest = manifest
    state.disposers = manifest.tools.map((rawTool) => ctx.tools.register(createMcpTool(rawTool, capability, engine)))
  }
  // `capability` is assigned immediately below before any registration is used.
  let capability
  return {
    state,
    bind(value) { capability = value },
    register,
    modelNames: () => state.manifest?.tools.map((tool) => toModelName(tool.name)) ?? []
  }
}

/** Agent plugin entry. Registration is replaced with the selected manifest at first assembly. */
export function apply(ctx) {
  const host = hostForRoot(ctx.root)
  if (!host) throw new Error('dsh-workspace-mcp/agent: no Host service is bound to this root context')

  const registrations = registrationSchemas(ctx)
  const initializations = new WeakMap()
  const capability = {
    init: (agent) => {
      if (!agent || typeof agent !== 'object') throw new Error('dsh-workspace-mcp/agent: tool execution supplied no Agent')
      let pending = initializations.get(agent)
      if (!pending) {
        pending = initializeAgent(host, ctx, agent, registrations)
        initializations.set(agent, pending)
      }
      return pending
    }
  }
  registrations.bind(capability)
  // Preserve the established MV roster until rc.8 supplies the real Agent.
  // The first assembly listener atomically swaps this scoped contribution to
  // MZ when the direct-child marker says so; the code-mode lazy section then
  // sees only the selected set. This also keeps agentless diagnostics useful.
  registrations.register('mv')
  ctx.logger?.info?.('dsh-workspace-mcp synchronously registered %d manifest tools', registrations.state.manifest.tools.length)

  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const agent = context.agent
    if (!agent) throw new Error('dsh-workspace-mcp/agent: system-prompt assembly supplied no Agent')
    const initialized = await capability.init(agent)
    if (initialized.engine === 'mz') replaceAssemblyTools(assembly, registrations.state.manifest)
    return next()
  })
}

function replaceAssemblyTools(assembly, manifest) {
  if (!assembly || typeof assembly !== 'object' || !manifest) return
  const sdkSchemas = manifest.tools.map((tool) => ({
    name: toModelName(tool.name),
    description: tool.description,
    parameters: projectDshObjectJsonSchema(tool.inputSchema),
    output: tool.outputSchema ?? {}
  }))
  const sdkText = renderToolsSdk(sdkSchemas)
  if (Array.isArray(assembly.tools)) {
    const runCode = assembly.tools.filter((tool) => tool && typeof tool === 'object' && tool.name === RESERVED_DSH_TOOL_NAME)
    assembly.tools.splice(0, assembly.tools.length, ...runCode)
  }
  if (Array.isArray(assembly.sections)) {
    for (const section of assembly.sections) {
      if (section && typeof section === 'object' && (section.name === 'tools:sdk' || section.id === 'tools:sdk')) {
        if ('text' in section) section.text = sdkText
      }
    }
  }
}

async function initializeAgent(host, ctx, agent, registrations) {
  const cwd = agent.session?.header?.cwd
  const canonical = await canonicalWorkspace(cwd)
  const validation = await classifyWorkspace(canonical)
  if (!validation.valid || !validation.engine) throw workspaceError(canonical, validation)
  const engine = validation.engine
  // Manifest verification is a pinned release fact and must precede child
  // registration. A failed initialization remains failed for this Agent.
  const manifestCheck = verifyManifest(engine)
  if (manifestCheck.errors.length > 0) throw new Error(`Pinned RPG Maker ${engine.toUpperCase()} manifest is not trustworthy: ${manifestCheck.errors.join('; ')}`)
  registrations.register(engine)
  const paths = resolveRuntimePaths(process.env)
  const definition = await buildWorkspaceDefinition(engine, canonical, paths, process.env)
  const acquired = await host.acquireWorkspaceServer(paths, engine, canonical, definition)
  const contract = validateDiscoveredTools(acquired.tools, engine)
  if (contract.errors.length > 0) throw new Error(`RPG Maker ${engine.toUpperCase()} tools/list does not match its pinned manifest: ${contract.errors.join('; ')}`)
  const modelNames = acquired.tools.map((tool) => toModelName(tool.name))
  const names = validateModelNames(modelNames)
  if (names.errors.length > 0) throw new Error(names.errors.join('; '))
  if (engine === 'mv') {
    ctx.logger?.info?.('dsh-workspace-mcp initialized workspace server %s (%d tools matched the pinned manifest)', acquired.name, acquired.tools.length)
  } else {
    ctx.logger?.info?.('dsh-workspace-mcp initialized %s workspace server %s (%d tools matched the pinned manifest)', engine.toUpperCase(), acquired.name, acquired.tools.length)
  }
  return { host, engine, canonical, paths, serverName: acquired.name, manifest: manifestFor(engine) }
}

function workspaceError(canonical, validation) {
  const expectedMarkers = `${MV_PROJECT_MARKER}, ${MZ_PROJECT_MARKER}`
  if (validation.ambiguous) {
    return new Error(`Ambiguous RPG Maker workspace: ${canonical}. Direct-child engine markers conflict (${validation.markers.join(', ')}); keep exactly one of ${expectedMarkers}.`)
  }
  const missing = validation.missing.length > 0 ? validation.missing.join(', ') : `${expectedMarkers}, ${MV_REQUIRED_DIRECTORIES.join(', ')}`
  return new Error(`Not a valid RPG Maker workspace: ${canonical}. Missing direct-child markers or directories: ${missing}. Expected exactly one of ${expectedMarkers} plus data and js.`)
}

export {
  ENGINE_CONTRACTS,
  MZ_MANIFEST,
  RPGMAKER_MV_MANIFEST,
  RPGMAKER_MZ_MANIFEST,
  MZ_MANIFEST_SHA256,
  MZ_TOOL_NAMES,
  XEROLO_MANIFEST,
  XEROLO_MANIFEST_SHA256,
  XEROLO_TOOL_NAMES,
  TOOL_NAME_PREFIX,
  RESERVED_DSH_TOOL_NAME,
  schemaProblem,
  manifestDigest,
  manifestFor,
  contractFor,
  missingCriticalTools,
  verifyManifest,
  validateDiscoveredTools,
  validateModelNames
} from './contract.js'
export {
  resolveRuntimePaths,
  neutralizedServerEnv,
  SECRET_MARKER,
  MCPORTER_RUNTIME_ENV,
  RPGMAKER_MCP_RUNTIME_ENV,
  JS_RUNNER_ENV
} from './env.js'
export {
  ENGINE_IDS,
  RPGMAKER_ENGINES,
  canonicalWorkspace,
  classifyWorkspace,
  privateServerName,
  resolveEngineEntry,
  buildWorkspaceDefinition,
  MV_PROJECT_MARKER,
  MV_REQUIRED_DIRECTORIES,
  MZ_PROJECT_MARKER,
  MZ_REQUIRED_DIRECTORIES,
  MCPORTER_CALL_TIMEOUT_MS
} from './workspace.js'
export { toModelName, createMcpTool } from './tools.js'
