import { pathToFileURL } from 'node:url'
import { realpath } from 'node:fs/promises'
import { observeXeroloChildren } from './process-observation.mjs'

const profileModule = await import(pathToFileURL(process.env.PROFILE_FILE).href)
const environmentModule = await import(pathToFileURL(process.env.ENVIRONMENT_MODULE).href)
const bundle = await import(pathToFileURL(process.env.WORKSPACE_BUNDLE_ENTRY).href)
const runtimePaths = bundle.resolveRuntimePaths(process.env)
const { assembleContextFor } = await import(new URL('../../dsh-agent/lib/index.js', pathToFileURL(process.env.PROFILE_FILE)).href)
const environment = environmentModule.createLaunchEnvironmentSnapshot([{
  source: 'process',
  values: Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && key !== 'DEEPSEEK_API_KEY' && key !== 'DSH_API_KEY'))
}])

function unwrap(value) {
  // run_code returns { logs, result } where result is the program's returned
  // canonical JSON value; native tool calls return an MCP-style content list.
  if (value && typeof value === 'object' && 'result' in value) return value.result
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
    // The Agent/Xerolo probe needs rc.7's Web profile services, not its
    // default listener. rc.7 accepts port 0 as an OS-assigned port, so this
    // disposable mount stays off 3080.
    args: ['--port', '0'],
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
  const immediateSchemas = first.agent?.ctx?.tools?.schemas?.(first.agent?.ctx?.agent)
  if (!Array.isArray(immediateSchemas)) throw new Error('Agent tool provider did not expose synchronous schemas')
  const expectedNames = bundle.XEROLO_TOOL_NAMES.map((name) => `rpgmaker_${name}`).sort()
  if (JSON.stringify(stableNames(immediateSchemas)) !== JSON.stringify(expectedNames)) {
    throw new Error(`stable manifest tools were not synchronously collected: ${stableNames(immediateSchemas).length}`)
  }

  const firstAssembly = await systemPrompt.assemble(assembleContextFor(first.agent))
  // Code mode (DSH rc.7 default for the shipped presets): the model calls
  // tools through the generated run_code SDK, so the complete stable
  // rpgmaker_* tool set must appear in the assembly's tools:sdk section, and
  // no rpgmaker_* name may leak into the native tool list.
  const sdkSection = (firstAssembly?.sections ?? []).find((section) => section?.name === 'tools:sdk')
  if (typeof sdkSection?.text !== 'string' || expectedNames.some((name) => !sdkSection.text.includes(name))) {
    throw new Error('first system-prompt assembly did not carry the complete stable rpgmaker_* tool set in the code-mode SDK section')
  }
  if (stableNames(firstAssembly.tools ?? []).some((name) => /(?:mcp__|[0-9a-f]{8,}|-)/.test(name))) {
    throw new Error('model-facing tool names exposed runtime identity')
  }
  if (stableNames(firstAssembly.tools ?? []).length !== 0) {
    throw new Error('code-mode assembly exposed rpgmaker_* tools in the native tool list')
  }

  const second = await createAgent('phase2-real-workspace-b')
  const secondAssembly = await systemPrompt.assemble(assembleContextFor(second.agent))
  const secondSdk = (secondAssembly?.sections ?? []).find((section) => section?.name === 'tools:sdk')
  if (typeof secondSdk?.text !== 'string' || expectedNames.some((name) => !secondSdk.text.includes(name))) {
    throw new Error('second Agent did not receive the same stable tool set in the code-mode SDK section')
  }
  if (stableNames(secondAssembly.tools ?? []).length !== 0) {
    throw new Error('second code-mode assembly exposed rpgmaker_* tools in the native tool list')
  }

  const stateAfterAgents = bundle.hostState(mounted.ctx)
  const canonicalProject = await realpath(project)
  if (stateAfterAgents.runtimeDir !== runtimePaths.mcporterRuntime) {
    throw new Error(`Host used an unexpected MCPorter runtime: ${stateAfterAgents.runtimeDir}`)
  }
  if (stateAfterAgents.workspaces.length !== 1 || stateAfterAgents.workspaces[0] !== canonicalProject) {
    throw new Error(`expected one pooled canonical workspace server, got ${JSON.stringify(stateAfterAgents.workspaces)}`)
  }

  const directAgentToolCalls = []
  async function call(handle, rawName, args) {
    // Code mode (DSH rc.7 shipped preset): the model calls tools through the
    // generated run_code SDK, so the representative call goes through the
    // same transport instead of a direct native dispatch.
    const modelName = `rpgmaker_${rawName}`
    const code = `const __result = await tools['${modelName}'](${JSON.stringify(args)});\nreturn __result`
    const result = await tools.execute({
      callId: `phase2-real-workspace-${directAgentToolCalls.length + 1}`,
      name: 'run_code',
      arguments: { code, description: `Call ${modelName}` },
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
  const stateAfterCalls = bundle.hostState(mounted.ctx)
  if (stateAfterCalls.runtimeDir !== runtimePaths.mcporterRuntime || stateAfterCalls.workspaces.length !== 1) {
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
