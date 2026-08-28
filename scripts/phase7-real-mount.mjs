import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const expectedPreset = process.env.EXPECTED_PRESET;
const profileModule = await import(pathToFileURL(process.env.PROFILE_FILE).href);
const environmentModule = await import(pathToFileURL(process.env.ENVIRONMENT_MODULE).href);
const environment = environmentModule.createLaunchEnvironmentSnapshot([{
  source: 'process',
  values: Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && key !== 'DEEPSEEK_API_KEY' && key !== 'DSH_API_KEY'))
}]);

let mounted;
try {
  const run = await profileModule.runProfile({ profile: 'web', patchFiles: [process.env.COMPOSITION_FILE], args: [], environment });
  mounted = run;
  const presets = run.ctx.get('agentPresets');
  if (!presets) throw new Error('official DSH agent preset service did not mount');
  const preset = await presets.resolve(expectedPreset);
  if (preset.id !== expectedPreset) throw new Error(`expected ${expectedPreset}, got ${preset.id}`);
  const skillPath = join(dirname(preset.path), 'skills', expectedPreset === 'rpgmaker' ? 'rpgmaker-mv' : expectedPreset, 'SKILL.md');
  const skillText = await readFile(skillPath, 'utf8');
  if (!skillText) throw new Error(`skill did not mount for ${expectedPreset}`);
  const standingKey = await presets.standingKeyFor(expectedPreset);
  const schemas = run.ctx.get('tools')?.schemas?.(standingKey) ?? [];
  const mcpTools = schemas.filter((schema) => String(schema.name ?? '').startsWith('mcp__'));
  const mcpNames = mcpTools.map((schema) => String(schema.name ?? ''));
  if (new Set(mcpNames).size !== mcpNames.length) throw new Error('duplicate MCP host tools were mounted');
  if (mcpTools.length < 41) throw new Error(`expected RPG Maker MCP tools, found ${mcpTools.length}`);
  const agentLoop = run.ctx.get('agentLoop');
  if (!agentLoop) throw new Error('official DSH agent-loop service did not mount');
  let handle;
  try {
    handle = await agentLoop.createAgent(run.ctx, {
      sessionId: `phase7-${expectedPreset}`,
      meta: { cwd: process.cwd(), agentPreset: expectedPreset },
      setup: async (agentCtx) => { await presets.mount(agentCtx, expectedPreset); }
    });
  } finally {
    if (handle) await handle.dispose();
  }
  console.log(JSON.stringify({ ok: true, preset: preset.id, mcpTools: mcpTools.length, cwd: process.cwd() }));
} finally {
  if (mounted) await mounted.shutdown.shutdown(0);
}
