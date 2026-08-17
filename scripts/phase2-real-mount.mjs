import { pathToFileURL } from 'node:url';

const profileModule = await import(pathToFileURL(process.env.PROFILE_FILE).href);
const environmentModule = await import(pathToFileURL(process.env.ENVIRONMENT_MODULE).href);
const environment = environmentModule.createLaunchEnvironmentSnapshot([{
  source: 'process',
  values: Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && key !== 'DEEPSEEK_API_KEY' && key !== 'DSH_API_KEY'))
}]);
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
  if (preset.id !== 'rpgmaker') throw new Error(`unexpected preset ${preset.id}`);
  await presets.standingKeyFor('rpgmaker');
  const tools = mounted.ctx.get('tools');
  const schemas = tools?.schemas?.() ?? [];
  const mcpTools = schemas.filter((schema) => schema.name?.startsWith('mcp__rpgmaker_mv__'));
  if (mcpTools.length < 41) throw new Error(`official DSH registered only ${mcpTools.length} RPG Maker tools`);

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
  const unwrap = (value) => {
    const text = value?.content?.find((block) => block?.type === 'text')?.text;
    if (typeof text !== 'string') return value;
    try { return JSON.parse(text); } catch { return text; }
  };
  const validation = unwrap(await call('validate_project', {}));
  if (validation?.ok !== true) throw new Error(`startup project validation failed: ${JSON.stringify(validation)}`);
  const initial = unwrap(await call('get_record', { type: 'actors', id: 1 }));
  if (initial?.name !== 'Hero') throw new Error('unexpected initial actor state');
  await call('update_record', { type: 'actors', id: 1, data: { name: 'Updated Hero' }, merge: true });
  const reread = unwrap(await call('get_record', { type: 'actors', id: 1 }));
  if (reread?.name !== 'Updated Hero') throw new Error('database reread did not reflect mutation');
  const validationAfterDatabase = unwrap(await call('validate_project', {}));
  if (validationAfterDatabase?.ok !== true) throw new Error('database mutation validation failed');
  await call('add_dialogue', { mapId: 1, eventId: 1, lines: ['Welcome, hero.'], pageIndex: 0 });
  await call('get_event', { mapId: 1, eventId: 1 });
  await call('update_map', { mapId: 1, data: { displayName: 'Opening' } });
  await call('get_map', { mapId: 1 });
  await call('configure_plugin', { name: 'TestPlugin', status: false });
  await call('list_plugins', {});
  const backups = unwrap(await call('list_backups', {}));
  if (!Array.isArray(backups) || backups.length === 0) throw new Error('official DSH MCP did not create a backup');
  await call('restore_backup', { session: backups[0].session });
  const restored = unwrap(await call('get_record', { type: 'actors', id: 1 }));
  if (restored?.name !== 'Hero') throw new Error('restore reread did not restore the actor record');
  const finalValidation = unwrap(await call('validate_project', {}));
  if (finalValidation?.ok !== true) throw new Error('restore validation failed');
  console.log(JSON.stringify({ ok: true, preset: preset.id, mcpTools: mcpTools.length, calls: callNumber, mutation: reread.name, restored: restored.name }));
} finally {
  if (mounted) await mounted.shutdown.shutdown(0);
}
