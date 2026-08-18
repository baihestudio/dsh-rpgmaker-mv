import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const profileModule = await import(pathToFileURL(process.env.PROFILE_FILE).href);
const environmentModule = await import(pathToFileURL(process.env.ENVIRONMENT_MODULE).href);
const environment = environmentModule.createLaunchEnvironmentSnapshot([{
  source: 'process',
  values: Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined))
}]);
const expectedVisionTools = [
  'vision_glance',
  'vision_ground',
  'vision_detect',
  'vision_trace',
  'vision_crop',
  'vision_pixel_diff',
  'vision_long_screenshot_ocr',
  'vision_extract_foreground',
  'vision_dominant_colors',
  'vision_html_screenshot'
];
const presetIds = ['rpgmaker', 'playtest-debug', 'asset-workshop', 'build-release'];
let mounted;
try {
  mounted = await profileModule.runProfile({ profile: 'web', patchFiles: [], args: [], environment });
  if (!mounted.ctx.get('settings')) throw new Error('Vision Toolkit Web settings service did not mount.');
  const tools = mounted.ctx.get('tools');
  const presets = mounted.ctx.get('agentPresets');
  const agentLoop = mounted.ctx.get('agentLoop');
  if (!tools || !presets || !agentLoop) throw new Error('Required DSH services did not mount.');
  if (!tools.schemas().some((schema) => schema.name === 'vision_toolkit_activate')) throw new Error('Vision Toolkit activation tool did not mount.');

  const activated = [];
  for (const presetId of presetIds) {
    let handle;
    try {
      handle = await agentLoop.createAgent(mounted.ctx, {
        sessionId: randomUUID(),
        meta: { cwd: process.cwd(), agentPreset: presetId },
        setup: async (agentCtx) => { await presets.mount(agentCtx, presetId); }
      });
      const result = await tools.execute({
        callId: `phase8-real-${presetId}`,
        name: 'run_code',
        arguments: {
          code: 'return await tools.vision_toolkit_activate({})',
          description: 'Activate the Vision Toolkit tools for this acceptance probe.'
        },
        agent: handle.agent,
        signal: new AbortController().signal
      });
      if (result.isError) throw new Error(`Vision Toolkit activation failed for ${presetId}: ${JSON.stringify(result)}`);
      const names = result.value?.result?.tools;
      if (!Array.isArray(names) || names.join(',') !== expectedVisionTools.join(',')) {
        throw new Error(`Vision Toolkit tools for ${presetId} were incomplete: ${JSON.stringify(names)}`);
      }
      activated.push({ presetId, tools: names });
    } finally {
      if (handle) await handle.dispose();
    }
  }
  console.log(JSON.stringify({ ok: true, settings: true, activated }));
} finally {
  if (mounted) await mounted.shutdown.shutdown(0);
}
