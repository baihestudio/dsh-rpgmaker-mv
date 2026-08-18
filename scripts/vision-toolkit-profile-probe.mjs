import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

export const EXPECTED_VISION_TOOLS = [
  'vision_glance',
  'vision_ground',
  'vision_detect',
  'vision_trace',
  'vision_crop',
  'vision_pixel_diff',
  'vision_long_screenshot_ocr',
  'vision_extract_foreground',
  'vision_dominant_colors',
  'vision_html_screenshot',
]

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

export async function runVisionToolkitProfileProbe({ includePresets = process.env.VISION_TOOLKIT_CHECK_PRESETS === '1' } = {}) {
  const profileModule = await import(pathToFileURL(process.env.PROFILE_FILE).href)
  const environmentModule = await import(pathToFileURL(process.env.ENVIRONMENT_MODULE).href)
  const environment = environmentModule.createLaunchEnvironmentSnapshot([{
    source: 'process',
    values: Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)),
  }])
  const presetIds = ['rpgmaker', 'playtest-debug', 'asset-workshop', 'build-release']
  let mounted
  try {
    const port = process.env.VISION_TOOLKIT_PROBE_PORT
    if (!port || !/^\d+$/.test(port)) throw new Error('Vision Toolkit probe requires an allocated loopback port.')
    mounted = await profileModule.runProfile({ profile: 'web', patchFiles: [], args: ['--host', '127.0.0.1', '--port', port], environment })
    const settings = mounted.ctx.get('settings')
    const attachments = mounted.ctx.get('attachments')
    const tools = mounted.ctx.get('tools')
    const presets = mounted.ctx.get('agentPresets')
    const agentLoop = mounted.ctx.get('agentLoop')
    if (!settings) throw new Error('Vision Toolkit Web settings service did not mount.')
    if (!attachments || typeof attachments.validateImage !== 'function') throw new Error('DSH image attachment admission service did not mount.')
    if (!tools || !presets || !agentLoop) throw new Error('Required DSH services did not mount.')
    if (!tools.schemas().some((schema) => schema.name === 'vision_toolkit_activate')) throw new Error('Vision Toolkit activation tool did not mount.')

    await attachments.validateImage({ data: ONE_PIXEL_PNG, mediaType: 'image/png', name: 'vision-toolkit-probe.png' })

    const targets = includePresets ? presetIds : ['code']
    const activated = []
    for (const presetId of targets) {
      let handle
      try {
        handle = await agentLoop.createAgent(mounted.ctx, {
          sessionId: randomUUID(),
          meta: { cwd: process.cwd(), agentPreset: presetId },
          setup: async (agentCtx) => { await presets.mount(agentCtx, presetId) },
        })
        const result = await tools.execute({
          callId: `vision-toolkit-probe-${presetId}`,
          name: 'run_code',
          arguments: {
            code: 'return await tools.vision_toolkit_activate({})',
            description: 'Activate the Vision Toolkit tools for this local compatibility probe.',
          },
          agent: handle.agent,
          signal: new AbortController().signal,
        })
        if (result.isError) throw new Error(`Vision Toolkit activation failed for ${presetId}: ${JSON.stringify(result)}`)
        const names = result.value?.tools ?? result.value?.result?.tools
        const expected = new Set(EXPECTED_VISION_TOOLS)
        if (!Array.isArray(names) || names.length !== expected.size || new Set(names).size !== expected.size || names.some((name) => !expected.has(name))) {
          throw new Error(`Vision Toolkit tools for ${presetId} were incomplete: ${JSON.stringify(names)}`)
        }
        activated.push({ presetId, tools: names })
      } finally {
        if (handle) await handle.dispose()
      }
    }
    return { ok: true, valid: true, settingsReady: true, attachmentAdmissionReady: true, tools: activated[0]?.tools ?? [], activated }
  } finally {
    if (mounted) await mounted.shutdown.shutdown(0)
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    console.log(JSON.stringify(await runVisionToolkitProfileProbe()))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
