import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const profileModule = await import(pathToFileURL(process.env.PROFILE_FILE).href);
const environmentModule = await import(pathToFileURL(process.env.ENVIRONMENT_MODULE).href);
const environment = environmentModule.createLaunchEnvironmentSnapshot([{
  source: 'process',
  values: Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && key !== 'DEEPSEEK_API_KEY' && key !== 'DSH_API_KEY'))
}]);

function unwrap(value) {
  const text = value?.content?.find?.((block) => block?.type === 'text')?.text;
  if (typeof text !== 'string') return value;
  try { return JSON.parse(text); } catch { return text; }
}

function assertValidation(label, validation) {
  if (validation?.ok !== true || !Array.isArray(validation.errors) || validation.errors.length > 0) {
    throw new Error(`${label} project validation failed: ${JSON.stringify(validation)}`);
  }
}

let mounted;
try {
  mounted = await profileModule.runProfile({
    profile: 'web',
    patchFiles: [process.env.COMPOSITION_FILE],
    args: [],
    environment,
  });
  const presets = mounted.ctx.get('agentPresets');
  if (!presets) throw new Error('official DSH agent preset service did not mount');
  const preset = await presets.resolve('rpgmaker');
  const debugPreset = await presets.resolve('playtest-debug');
  if (preset.id !== 'rpgmaker' || debugPreset.id !== 'playtest-debug') throw new Error(`unexpected presets ${preset.id}, ${debugPreset.id}`);
  if (preset.name !== 'RPG Maker MV Agent' || debugPreset.name !== 'Playtest Debug Agent') throw new Error(`unexpected preset display metadata: ${preset.name}, ${debugPreset.name}`);
  await presets.standingKeyFor('rpgmaker');
  const debugKey = await presets.standingKeyFor('playtest-debug');
  const tools = mounted.ctx.get('tools');
  const schemas = tools?.schemas?.() ?? [];
  const debugSchemas = tools?.schemas?.(debugKey) ?? [];
  const mcpTools = schemas.filter((schema) => schema.name?.startsWith('mcp__rpgmaker_mv__'));
  const debugMcpTools = debugSchemas.filter((schema) => schema.name?.startsWith('mcp__rpgmaker_mv__'));
  const requiredPlaytestTools = ['playtest_start', 'playtest_status', 'playtest_log', 'playtest_stop'];
  if (new Set(schemas.map((schema) => schema.name)).size !== schemas.length) throw new Error('rc.7 mounted duplicate tool schemas');
  if (mcpTools.length < 41 || debugMcpTools.length < 41) throw new Error(`official DSH registered only ${mcpTools.length}/${debugMcpTools.length} RPG Maker tools`);
  if (requiredPlaytestTools.some((name) => !mcpTools.some((schema) => schema.name === `mcp__rpgmaker_mv__${name}`) || !debugMcpTools.some((schema) => schema.name === `mcp__rpgmaker_mv__${name}`))) {
    throw new Error(`official DSH did not register every RPG Maker Playtest tool: ${requiredPlaytestTools.join(', ')}`);
  }
  if (schemas.some((schema) => schema.name === 'playtest_debug') || debugSchemas.some((schema) => schema.name === 'playtest_debug')) {
    throw new Error('playtest-debug mounted an unexpected custom workflow tool');
  }

  const agentLoop = mounted.ctx.get('agentLoop');
  if (!agentLoop) throw new Error('official DSH agent-loop service did not mount');
  let rpgmakerHandle;
  try {
    rpgmakerHandle = await agentLoop.createAgent(mounted.ctx, {
      sessionId: randomUUID(),
      meta: { cwd: process.cwd(), agentPreset: 'rpgmaker' },
      setup: async (agentCtx) => { await presets.mount(agentCtx, 'rpgmaker'); }
    });
  } finally {
    if (rpgmakerHandle) await rpgmakerHandle.dispose();
  }
  let debugHandle;
  try {
    debugHandle = await agentLoop.createAgent(mounted.ctx, {
      sessionId: randomUUID(),
      meta: { cwd: process.cwd(), agentPreset: 'playtest-debug' },
      setup: async (agentCtx) => { await presets.mount(agentCtx, 'playtest-debug'); }
    });
  } finally {
    if (debugHandle) await debugHandle.dispose();
  }

  let callNumber = 0;
  const call = async (name, args) => {
    const result = await tools.execute({
      callId: `phase2-real-${++callNumber}`,
      name: `mcp__rpgmaker_mv__${name}`,
      arguments: args,
      signal: new AbortController().signal,
    });
    if (result.isError) throw new Error(`official DSH MCP ${name} returned an error: ${JSON.stringify(result)}`);
    return result.value ?? result;
  };

  const playtestStatus = unwrap(await call('playtest_status', {}));
  if (playtestStatus?.running !== false || (playtestStatus?.pid !== null && playtestStatus?.pid !== undefined)) {
    throw new Error(`real MCP Playtest was not idle at mount acceptance: ${JSON.stringify(playtestStatus)}`);
  }
  const validation = unwrap(await call('validate_project', {}));
  assertValidation('startup', validation);
  const initial = unwrap(await call('get_record', { type: 'actors', id: 1 }));
  if (initial?.name !== 'Hero') throw new Error('unexpected initial actor state');
  await call('update_record', { type: 'actors', id: 1, data: { name: 'Updated Hero' }, merge: true });
  const reread = unwrap(await call('get_record', { type: 'actors', id: 1 }));
  if (reread?.name !== 'Updated Hero') throw new Error('database reread did not reflect mutation');
  const validationAfterDatabase = unwrap(await call('validate_project', {}));
  assertValidation('database mutation', validationAfterDatabase);
  await call('add_dialogue', { mapId: 1, eventId: 1, lines: ['Welcome, hero.'], pageIndex: 0 });
  const eventAfterDialogue = unwrap(await call('get_event', { mapId: 1, eventId: 1 }));
  const dialogueAdded = eventAfterDialogue?.pages?.[0]?.list?.some((command) => command?.code === 401 && command?.parameters?.[0] === 'Welcome, hero.');
  if (!dialogueAdded) throw new Error('event reread did not reflect dialogue mutation');
  const validationAfterDialogue = unwrap(await call('validate_project', {}));
  assertValidation('dialogue mutation', validationAfterDialogue);
  await call('update_map', { mapId: 1, data: { displayName: 'Opening' } });
  const mapAfterUpdate = unwrap(await call('get_map', { mapId: 1 }));
  if (mapAfterUpdate?.displayName !== 'Opening') throw new Error('map reread did not reflect metadata mutation');
  const validationAfterMap = unwrap(await call('validate_project', {}));
  assertValidation('map mutation', validationAfterMap);
  await call('configure_plugin', { name: 'TestPlugin', status: false });
  const pluginsAfterUpdate = unwrap(await call('list_plugins', {}));
  const plugin = Array.isArray(pluginsAfterUpdate) ? pluginsAfterUpdate.find((entry) => entry?.name === 'TestPlugin') : undefined;
  if (plugin?.status !== false) throw new Error('plugin reread did not reflect configuration mutation');
  const validationAfterPlugin = unwrap(await call('validate_project', {}));
  assertValidation('plugin mutation', validationAfterPlugin);
  const backups = unwrap(await call('list_backups', {}));
  if (!Array.isArray(backups) || backups.length === 0) throw new Error('official DSH MCP did not create a backup');
  await call('restore_backup', { session: backups[0].session });
  const restored = unwrap(await call('get_record', { type: 'actors', id: 1 }));
  if (restored?.name !== 'Hero') throw new Error('restore reread did not restore the actor record');
  const finalValidation = unwrap(await call('validate_project', {}));
  assertValidation('restore', finalValidation);
  console.log(JSON.stringify({ ok: true, preset: preset.id, selectedDebugPreset: debugPreset.id, playtestStatus, mcpTools: mcpTools.length, calls: callNumber, mutation: reread.name, restored: restored.name }));
} finally {
  if (mounted) await mounted.shutdown.shutdown(0);
}
