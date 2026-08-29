import { pathToFileURL } from 'node:url'
import { realpath } from 'node:fs/promises'
import { observeRpgMakerChildren } from './process-observation.mjs'

if (process.platform !== 'win32') throw new Error('Phase 2 real mount is supported on Windows only.')

const hostBundleEntry = process.env.WORKSPACE_HOST_BUNDLE_ENTRY
const agentBundleEntry = process.env.WORKSPACE_AGENT_BUNDLE_ENTRY
if (!hostBundleEntry || !agentBundleEntry) throw new Error('WORKSPACE_HOST_BUNDLE_ENTRY and WORKSPACE_AGENT_BUNDLE_ENTRY are required')
const profileModule = await import(pathToFileURL(process.env.PROFILE_FILE).href)
const environmentModule = await import(pathToFileURL(process.env.ENVIRONMENT_MODULE).href)
const hostBundle = await import(pathToFileURL(hostBundleEntry).href)
const agentBundle = await import(pathToFileURL(agentBundleEntry).href)
const runtimePaths = agentBundle.resolveRuntimePaths(process.env)
const { assembleContextFor } = await import(new URL('../../dsh-agent/lib/index.js', pathToFileURL(process.env.PROFILE_FILE)).href)
const { livePresetMounts } = await import(new URL('../../dsh-agent-presets/lib/index.js', pathToFileURL(process.env.PROFILE_FILE)).href)
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

async function runDualMount() {
  const mvProject = process.env.PROJECT_PATH_MV
  const mzProject = process.env.PROJECT_PATH_MZ
  const neutralLanding = process.env.NEUTRAL_LANDING_DIR
  const mvEntry = process.env.MV_ENTRY
  const mzEntry = process.env.MZ_ENTRY
  if (!mvProject || !mzProject || !neutralLanding || !mvEntry || !mzEntry) throw new Error('PROJECT_PATH_MV, PROJECT_PATH_MZ, NEUTRAL_LANDING_DIR, MV_ENTRY, and MZ_ENTRY are required')
  const [actualNeutralLanding, expectedNeutralLanding, canonicalMv, canonicalMz] = await Promise.all([
    realpath(process.cwd()), realpath(neutralLanding), realpath(mvProject), realpath(mzProject)
  ])
  if (actualNeutralLanding !== expectedNeutralLanding) throw new Error(`DSH did not start from the neutral landing directory: ${process.cwd()}`)
  for (const project of [mvProject, mzProject]) {
    if (!/[\u4e00-\u9fff]/.test(project) || !project.includes(' ')) throw new Error(`CJK/space project fixture was lost: ${project}`)
  }
  if (process.argv.some((argument) => argument === '--project' || argument.startsWith('--project='))) throw new Error('project-neutral acceptance received an unexpected --project argument')

  const mounted = await profileModule.runProfile({
    profile: 'web',
    patchFiles: [process.env.COMPOSITION_FILE],
    args: ['--port', '0'],
    environment
  })
  const handles = []
  try {
    const presets = mounted.ctx.get('agentPresets')
    if (!presets) throw new Error('official DSH agent preset service did not mount')
    const presetIds = (await presets.list()).map((entry) => entry.id)
    for (const id of ['rpgmaker', 'playtest-debug']) if (!presetIds.includes(id)) throw new Error(`shipped preset ${id} was not available in the neutral Host`)
    const systemPrompt = mounted.ctx.get('systemPrompt')
    const agentLoop = mounted.ctx.get('agentLoop')
    const tools = mounted.ctx.get('tools')
    if (!systemPrompt || !agentLoop || !tools) throw new Error('official DSH agent, system-prompt, or tools service did not mount')
    async function createAgent(project, sessionId) {
      const handle = await agentLoop.createAgent(mounted.ctx, {
        sessionId,
        meta: { cwd: project, agentPreset: 'rpgmaker' },
        setup: async (agentCtx) => {
          if (!agentCtx.agent) throw new Error('DSH Agent setup did not supply agentCtx.agent')
          await presets.mount(agentCtx, 'rpgmaker')
        }
      })
      handles.push(handle)
      return handle
    }
    const [mv, mz] = await Promise.all([
      createAgent(mvProject, 'phase2-real-workspace-mv'),
      createAgent(mzProject, 'phase2-real-workspace-mz')
    ])
    const [mvAssembly, mzAssembly] = await Promise.all([
      systemPrompt.assemble(assembleContextFor(mv.agent)),
      systemPrompt.assemble(assembleContextFor(mz.agent))
    ])
    const mvNames = agentBundle.XEROLO_TOOL_NAMES.map((name) => `rpgmaker_${name}`).sort()
    const mzNames = agentBundle.MZ_TOOL_NAMES.map((name) => `rpgmaker_${name}`).sort()
    const mvSdk = (mvAssembly.sections ?? []).find((section) => section?.name === 'tools:sdk')
    const mzSdk = (mzAssembly.sections ?? []).find((section) => section?.name === 'tools:sdk')
    if (typeof mvSdk?.text !== 'string' || mvNames.some((name) => !mvSdk.text.includes(name))) throw new Error('MV first assembly did not carry its complete SDK surface')
    if (typeof mzSdk?.text !== 'string' || mzNames.some((name) => !mzSdk.text.includes(name))) throw new Error('MZ first assembly did not carry its complete SDK surface')
    if (stableNames(mvAssembly.tools ?? []).length !== 0 || stableNames(mzAssembly.tools ?? []).length !== 0) throw new Error('dual-engine Code Mode assembly exposed RPG Maker tools natively')
    if (!mzAssembly.tools?.some((schema) => schema?.name === 'run_code')) throw new Error('MZ Code Mode assembly did not retain run_code')
    if (mzSdk.text.includes('rpgmaker_get_project_info')) throw new Error('MZ SDK leaked the MV-only get_project_info tool')

    const state = hostBundle.hostState(mounted.ctx)
    if (state.workspaces.length !== 2 || !state.workspaces.includes(canonicalMv) || !state.workspaces.includes(`mz:${canonicalMz}`)) throw new Error(`expected one pooled pair per engine/workspace, got ${JSON.stringify(state.workspaces)}`)
    const directAgentToolCalls = []
    async function call(handle, rawName, args) {
      const modelName = `rpgmaker_${rawName}`
      const result = await tools.execute({
        callId: `phase2-real-dual-${directAgentToolCalls.length + 1}`,
        name: 'run_code',
        arguments: { code: `const __result = await tools['${modelName}'](${JSON.stringify(args)});\nreturn __result`, description: `Call ${modelName}` },
        agent: handle.agent,
        signal: new AbortController().signal
      })
      if (result.isError) throw new Error(`stable RPG Maker tool ${rawName} failed without retry: ${JSON.stringify(result)}`)
      directAgentToolCalls.push({ name: modelName, isError: result.isError === true, valueObserved: result.value !== undefined })
      return result.value ?? result
    }
    const mvInfo = unwrap(await call(mv, 'get_project_info', {}))
    const mzInfo = unwrap(await call(mz, 'get_project', {}))
    if (typeof mvInfo?.gameTitle !== 'string' || mvInfo.gameTitle.length === 0 || mzInfo?.valid !== true) throw new Error(`unexpected dual-engine project info: ${JSON.stringify({ mvInfo, mzInfo })}`)
    assertValidation('dual MV', await call(mv, 'validate_project', {}))
    assertValidation('dual MZ', await call(mz, 'validate_project', {}))
    const stateAfterCalls = hostBundle.hostState(mounted.ctx)
    if (stateAfterCalls.workspaces.length !== 2) throw new Error('dual-engine calls changed pooled pair count')
    const [mvProcessEvidence, mzProcessEvidence] = await Promise.all([
      observeRpgMakerChildren({ project: canonicalMv, entry: mvEntry, engine: 'mv', platform: 'win32', env: process.env }),
      observeRpgMakerChildren({ project: canonicalMz, entry: mzEntry, engine: 'mz', platform: 'win32', env: process.env })
    ])
    if (mvProcessEvidence.children.length === 0 || mzProcessEvidence.children.length === 0) throw new Error('dual-engine acceptance did not observe both selected MCP children')
    console.log(JSON.stringify({
      ok: true,
      launchCwd: process.cwd(),
      workspaces: [canonicalMv, canonicalMz],
      hostRuntime: stateAfterCalls.runtimeDir,
      workspaceServers: stateAfterCalls.workspaces.length,
      mv: { stableTools: mvNames.length, engine: 'mv', workspaceServers: stateAfterCalls.workspaces.length, pooledChildren: mvProcessEvidence.children.length, processEvidence: mvProcessEvidence },
      mz: { stableTools: mzNames.length, engine: 'mz', workspaceServers: stateAfterCalls.workspaces.length, pooledChildren: mzProcessEvidence.children.length, processEvidence: mzProcessEvidence },
      directAgentToolCalls
    }))
  } finally {
    for (const handle of handles) if (typeof handle.dispose === 'function') await handle.dispose().catch(() => undefined)
    await mounted.shutdown.shutdown(0)
  }
}

if (process.env.PROJECT_PATH_MV && process.env.PROJECT_PATH_MZ) {
  await runDualMount()
} else {
  const engine = process.env.RPGMAKER_ENGINE === 'mz' ? 'mz' : 'mv'
  const project = process.env.PROJECT_PATH
  const neutralLanding = process.env.NEUTRAL_LANDING_DIR
  const rpgmakerEntry = engine === 'mz' ? process.env.MZ_ENTRY : process.env.MV_ENTRY
  if (!project || !neutralLanding || !rpgmakerEntry) throw new Error(`PROJECT_PATH, NEUTRAL_LANDING_DIR, and ${engine === 'mz' ? 'MZ_ENTRY' : 'MV_ENTRY'} are required`)
  const [actualNeutralLanding, expectedNeutralLanding] = await Promise.all([realpath(process.cwd()), realpath(neutralLanding)])
  if (actualNeutralLanding !== expectedNeutralLanding) throw new Error(`DSH did not start from the neutral landing directory: ${process.cwd()}`)
  if (!/[\u4e00-\u9fff]/.test(project) || !project.includes(' ')) throw new Error(`CJK/space project fixture was lost: ${project}`)
  if (process.argv.some((argument) => argument === '--project' || argument.startsWith('--project='))) {
    throw new Error('project-neutral acceptance received an unexpected --project argument')
  }

  let mounted
  const handles = []
  try {
    mounted = await profileModule.runProfile({
      profile: 'web',
      patchFiles: [process.env.COMPOSITION_FILE],
      // The Agent/RPG Maker probe needs the pinned DSH Web profile services, not its
      // default listener. The pinned DSH accepts port 0 as an OS-assigned port, so this
      // disposable mount stays off 3080.
      args: ['--port', '0'],
      environment
    })
    const presets = mounted.ctx.get('agentPresets')
    if (!presets) throw new Error('official DSH agent preset service did not mount')
    const presetIds = (await presets.list()).map((entry) => entry.id)
    for (const id of ['rpgmaker', 'playtest-debug']) {
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
        setup: async (agentCtx) => {
          if (!agentCtx.agent) throw new Error('DSH Agent setup did not supply agentCtx.agent')
          await presets.mount(agentCtx, 'rpgmaker')
        }
      })
      handles.push(handle)
      return handle
    }

    const first = await createAgent('phase2-real-workspace-a')
    const compositionMount = livePresetMounts().find((mount) => mount.presetId === 'rpgmaker')
    if (!compositionMount) throw new Error('DSH did not expose the mounted rpgmaker composition')
    if (compositionMount.fiber.ctx.agent !== undefined) {
      throw new Error('preset composition unexpectedly received ctx.agent; Agent must arrive at assembly/execution seams')
    }
    const immediateSchemas = first.agent?.ctx?.tools?.schemas?.(first.agent?.ctx?.agent)
    if (!Array.isArray(immediateSchemas)) throw new Error('Agent tool provider did not expose synchronous schemas')
    const expectedNames = (engine === 'mz' ? agentBundle.MZ_TOOL_NAMES : agentBundle.XEROLO_TOOL_NAMES).map((name) => `rpgmaker_${name}`).sort()
    if (JSON.stringify(stableNames(immediateSchemas)) !== JSON.stringify(expectedNames)) {
      throw new Error(`stable manifest tools were not synchronously collected: ${stableNames(immediateSchemas).length}`)
    }

    const firstAssembly = await systemPrompt.assemble(assembleContextFor(first.agent))
    // Code mode (the pinned DSH default for the shipped presets): the model calls
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

    const stateAfterAgents = hostBundle.hostState(mounted.ctx)
    const canonicalProject = await realpath(project)
    if (stateAfterAgents.runtimeDir !== runtimePaths.mcporterRuntime) {
      throw new Error(`Host used an unexpected MCPorter runtime: ${stateAfterAgents.runtimeDir}`)
    }
    const expectedWorkspace = engine === 'mz' ? `mz:${canonicalProject}` : canonicalProject
    if (stateAfterAgents.workspaces.length !== 1 || stateAfterAgents.workspaces[0] !== expectedWorkspace) {
      throw new Error(`expected one pooled canonical workspace server, got ${JSON.stringify(stateAfterAgents.workspaces)}`)
    }

    const directAgentToolCalls = []
    async function call(handle, rawName, args) {
      // Code mode (the pinned DSH shipped preset): the model calls tools through the
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

    const infoA = unwrap(await call(first, engine === 'mz' ? 'get_project' : 'get_project_info', {}))
    if (engine === 'mz' ? !infoA || typeof infoA !== 'object' : typeof infoA?.gameTitle !== 'string' || infoA.gameTitle.length === 0) throw new Error(`unexpected project info: ${JSON.stringify(infoA)}`)
    assertValidation('real workspace', await call(second, 'validate_project', {}))
    const stateAfterCalls = hostBundle.hostState(mounted.ctx)
    if (stateAfterCalls.runtimeDir !== runtimePaths.mcporterRuntime || stateAfterCalls.workspaces.length !== 1) {
      throw new Error('pooled workspace calls did not remain on the single Host runtime/server')
    }

    const processEvidence = await observeRpgMakerChildren({
      project: canonicalProject,
      entry: rpgmakerEntry,
      engine,
      platform: 'win32',
      env: process.env
    })
    if (processEvidence.children.length === 0) {
      throw new Error(`no live RPG Maker child matched the canonical workspace and pinned entry (process table size ${processEvidence.processTableSize})`)
    }
    console.log(JSON.stringify({
      ok: true,
      launchCwd: process.cwd(),
      workspace: canonicalProject,
      hostRuntime: stateAfterCalls.runtimeDir,
      workspaceServers: stateAfterCalls.workspaces.length,
      pooledChildren: processEvidence.children.length,
      engine,
      stableTools: expectedNames.length,
      directAgentToolCalls,
      processEvidence
    }))
  } finally {
    for (const handle of handles) {
      if (typeof handle.dispose === 'function') await handle.dispose().catch(() => undefined)
    }
    if (mounted) await mounted.shutdown.shutdown(0)
  }
}
