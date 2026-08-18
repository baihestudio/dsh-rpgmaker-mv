import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const profileModule = await import(pathToFileURL(process.env.PROFILE_FILE).href);
const environmentModule = await import(pathToFileURL(process.env.ENVIRONMENT_MODULE).href);
const environment = environmentModule.createLaunchEnvironmentSnapshot([{
  source: 'process',
  values: Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && key !== 'DEEPSEEK_API_KEY' && key !== 'DSH_API_KEY'))
}]);

let mounted;
try {
  if (!process.cwd().includes('选择') || !process.cwd().includes('spaces')) throw new Error(`special-path cwd was lost: ${process.cwd()}`);
  await readFile(process.env.SPECIAL_ASSET_PATH);
  mounted = await profileModule.runProfile({ profile: 'web', patchFiles: [process.env.COMPOSITION_FILE], args: [], environment });
  const presets = mounted.ctx.get('agentPresets');
  if (!presets) throw new Error('official DSH agent preset service did not mount');
  const preset = await presets.resolve('asset-workshop');
  if (preset.id !== 'asset-workshop' || preset.name !== '游戏图片素材助手' || preset.description !== '处理缩放、裁切、补边、切图、精灵表、图集与 PNG 优化，并验证像素、透明度和输出清单。') throw new Error(`unexpected mounted preset metadata ${preset.id}/${preset.name}`);
  const presetText = JSON.stringify(preset);
  const skillPath = join(dirname(preset.path), 'skills', 'asset-workshop', 'SKILL.md');
  const skillText = await readFile(skillPath, 'utf8');
  if (!presetText.includes('asset-workshop') || !skillText.includes('resize-pixel')) throw new Error('asset-workshop skill was not visible through the mounted preset');
  const standingKey = await presets.standingKeyFor('asset-workshop');
  const schemas = mounted.ctx.get('tools')?.schemas?.(standingKey) ?? [];
  if (schemas.some((schema) => String(schema.name ?? '').startsWith('mcp__'))) throw new Error('real asset-only mount unexpectedly added an MCP service');
  const agentLoop = mounted.ctx.get('agentLoop');
  if (!agentLoop) throw new Error('official DSH agent-loop service did not mount');
  let handle;
  try {
    handle = await agentLoop.createAgent(mounted.ctx, {
      sessionId: 'phase4-asset-workshop-real',
      meta: { cwd: process.cwd(), agentPreset: 'asset-workshop' },
      setup: async (agentCtx) => { await presets.mount(agentCtx, 'asset-workshop'); }
    });
  } finally {
    if (handle) await handle.dispose();
  }
  console.log(JSON.stringify({ ok: true, preset: preset.id, cwd: process.cwd(), assetPath: process.env.SPECIAL_ASSET_PATH, mcpTools: schemas.filter((schema) => String(schema.name ?? '').startsWith('mcp__')).length }));
} finally {
  if (mounted) await mounted.shutdown.shutdown(0);
}
