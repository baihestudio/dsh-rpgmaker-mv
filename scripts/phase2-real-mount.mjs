import { pathToFileURL } from 'node:url'
import { realpath } from 'node:fs/promises'
import { observeXeroloChildren } from './process-observation.mjs'

const profileModule = await import(pathToFileURL(process.env.PROFILE_FILE).href)
const environmentModule = await import(pathToFileURL(process.env.ENVIRONMENT_MODULE).href)
const bundle = await import(pathToFileURL(process.env.WORKSPACE_BUNDLE_ENTRY).href)
const { assembleContextFor } = await import(new URL('../../dsh-agent/lib/index.js', pathToFileURL(process.env.PROFILE_FILE)).href)
const environment = environmentModule.createLaunchEnvironmentSnapshot([{
  source: 'process',
  values: Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && key !== 'DEEPSEEK_API_KEY' && key !== 'DSH_API_KEY'))
}])

function unwrap(value) {
  const text = value?.content?.find?.((block) => block?.type === 'text')?.text
  if (typeof text !== 'string') return value
  try { return JSON.parse(text) } catch { return text }
}

function assertValidation(label, value) {
  const validation = unwrap(value)
  if (validation?.ok !== true || !Array.isArray(validation.errors) || validation.errors.length > 0) {
    throw new Error(`${label} project validation failed: ${JSON.stringify(validation)}`)
  }
}

function stableNames(schemas) {
  return schemas.filter((schema) => typeof schema?.name === 'string' && schema.name.startsWith('rpgmaker_')).map((schema) => schema.name).sort()
}

const project = process.env.PROJECT_PATH
const neutralLanding = process.env.NEUTRAL_LANDING_DIR
const xeroloEntry = process.env.XEROLO_ENTRY
if (!project || !neutralLanding || !xeroloEntry) throw new Error('PROJECT_PATH, NEUTRAL_LANDING_DIR, and XEROLO_ENTRY are required')
const [actualNeutralLanding, expectedNeutralLanding] = await Promise.all([realpath(process.cwd()), realpath(neutralLanding)])
if (actualNeutralLanding !== expectedNeutralLanding) throw new Error(`DSH did not start from the neutral landing directory: ${process.cwd()}`)
if (!project.includes('选择') || !project.includes('spaces')) throw new Error(`CJK/space project fixture was lost: ${project}`)
if (process.argv.some((argument) => argument === '--project' || argument.startsWith('--project='))) {
  throw new Error('project-neutral acceptance received an unexpected --project argument')
}

let mounted
const handles = []
try {
  mounted = await profileModule.runProfile({
    profile: 'web',
    patchFiles: [process.env.COMPOSITION_FILE],
    args: [],
    environment
  })
  const presets = mounted.ctx.get('agentPresets')
  if (!presets) throw new Error('official DSH agent preset service did not mount')
  const presetIds = (await presets.list()).map((entry) => entry.id)
  for (const id of ['rpgmaker', 'playtest-debug', 'asset-workshop', 'build-release']) {
    if (!presetIds.includes(id)) throw new Error(`shipped preset ${id} was not available in the neutral Host`)
  }

  const systemPrompt = mounted.ctx.get('systemPrompt')
  const agentLoop = mounted.ctx.get('agentLoop')
  const tools = mounted.ctx.get('tools')
  if (!systemPrompt || !agentLoop || !tools) throw new Error('official DSH agent, system-prompt, or tools service did not mount')

  async function createAgent(sessionId) {
    const handle = await agentLoop.createAgent(mounted.ctx, {
      sessionId,
      meta: { cwd: project, agentPreset: 'rpgmaker' },
      setup: async (agentCtx) => { await presets.mount(agentCtx, 'rpgmaker') }
    })
    handles.push(handle)
    return handle
  }

  const first = await createAgent('phase2-real-workspace-a')
  const immediateSchemas = first.agent?.ctx?.tools?.schemas?.()
  if (!Array.isArray(immediateSchemas)) throw new Error('Agent tool provider did not expose synchronous schemas')
  const expectedNames = bundle.XEROLO_TOOL_NAMES.map((name) => `rpgmaker_${name}`).sort()
  if (JSON.stringify(stableNames(immediateSchemas)) !== JSON.stringify(expectedNames)) {
    throw new Error(`stable manifest tools were not synchronously collected: ${stableNames(immediateSchemas).length}`)
  }

  const firstAssembly = await systemPrompt.assemble(assembleContextFor(first.agent))
  if (JSON.stringify(stableNames(firstAssembly.tools ?? [])) !== JSON.stringify(expectedNames)) {
    throw new Error('first system-prompt assembly did not contain the complete stable rpgmaker_* tool set')
  }
  if (stableNames(firstAssembly.tools ?? []).some((name) => /(?:mcp__|[0-9a-f]{8,}|-)/.test(name))) {
    throw new Error('model-facing tool names exposed runtime identity')
  }

  const second = await createAgent('phase2-real-workspace-b')
  const secondAssembly = await systemPrompt.assemble(assembleContextFor(second.agent))
  if (JSON.stringify(stableNames(secondAssembly.tools ?? [])) !== JSON.stringify(expectedNames)) {
    throw new Error('second Agent did not receive the same stable tool set')
  }

  const stateAfterAgents = bundle.hostState()
  const canonicalProject = await realpath(project)
  if (stateAfterAgents.runtimeDir !== process.env.MCPORTER_RUNTIME) {
    throw new Error(`Host used an unexpected MCPorter runtime: ${stateAfterAgents.runtimeDir}`)
  }
  if (stateAfterAgents.workspaces.length !== 1 || stateAfterAgents.workspaces[0] !== canonicalProject) {
    throw new Error(`expected one pooled canonical workspace server, got ${JSON.stringify(stateAfterAgents.workspaces)}`)
  }

  const directAgentToolCalls = []
  async function call(handle, rawName, args) {
    const modelName = `rpgmaker_${rawName}`
    const result = await tools.execute({
      callId: `phase2-real-workspace-${directAgentToolCalls.length + 1}`,
      name: modelName,
      arguments: args,
      agent: handle.agent,
      signal: new AbortController().signal
    })
    if (result.isError) throw new Error(`stable RPG Maker tool ${rawName} failed without retry: ${JSON.stringify(result)}`)
    directAgentToolCalls.push({
      name: modelName,
      isError: result.isError === true,
      valueObserved: result.value !== undefined
    })
    return result.value ?? result
  }

  const infoA = unwrap(await call(first, 'get_project_info', {}))
  if (infoA?.gameTitle !== 'Workspace MCP real acceptance') throw new Error(`unexpected project info: ${JSON.stringify(infoA)}`)
  assertValidation('real workspace', await call(second, 'validate_project', {}))
  const stateAfterCalls = bundle.hostState()
  if (stateAfterCalls.runtimeDir !== process.env.MCPORTER_RUNTIME || stateAfterCalls.workspaces.length !== 1) {
    throw new Error('pooled workspace calls did not remain on the single Host runtime/server')
  }

  const xeroloProcessEvidence = await observeXeroloChildren({
    project: canonicalProject,
    entry: xeroloEntry,
    platform: process.platform,
    env: process.env
  })
  if (xeroloProcessEvidence.children.length === 0) {
    throw new Error(`no live Xerolo child matched the canonical workspace and pinned entry (process table size ${xeroloProcessEvidence.processTableSize})`)
  }
  console.log(JSON.stringify({
    ok: true,
    launchCwd: process.cwd(),
    workspace: canonicalProject,
    hostRuntime: stateAfterCalls.runtimeDir,
    workspaceServers: stateAfterCalls.workspaces.length,
    pooledXeroloChildren: xeroloProcessEvidence.children.length,
    stableTools: expectedNames.length,
    directAgentToolCalls,
    xeroloProcessEvidence
  }))
} finally {
  for (const handle of handles) {
    if (typeof handle.dispose === 'function') await handle.dispose().catch(() => undefined)
  }
  if (mounted) await mounted.shutdown.shutdown(0)
}
