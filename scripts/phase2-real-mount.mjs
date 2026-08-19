import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const profileModule = await import(pathToFileURL(process.env.PROFILE_FILE).href);
const environmentModule = await import(pathToFileURL(process.env.ENVIRONMENT_MODULE).href);
const environment = environmentModule.createLaunchEnvironmentSnapshot([{
  source: 'process',
  values: Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && key !== 'DEEPSEEK_API_KEY' && key !== 'DSH_API_KEY'))
}]);
const { assembleContextFor } = await import(pathToFileURL(join(dirname(process.env.PROFILE_FILE), '..', '..', 'dsh-agent', 'lib', 'index.js')).href);

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
const agentHandles = new Map();
const agentAssemblies = new Map();
try {
  mounted = await profileModule.runProfile({
    profile: 'web',
    patchFiles: [process.env.COMPOSITION_FILE],
    args: [],
    environment,
  });
  const presets = mounted.ctx.get('agentPresets');
  if (!presets) throw new Error('official DSH agent preset service did not mount');
  const expectedPresets = [
    { id: 'rpgmaker', name: 'RPG Maker MV 开发助手', description: '检查和修改 RPG Maker MV 的数据库、事件、对话、地图与插件，并在变更后执行验证和备份检查。', promptFact: '默认入口和轻量协调者', skill: 'rpgmaker-mv', skillFact: 'validate_project' },
    { id: 'playtest-debug', name: '游戏测试与调试助手', description: '验证项目、启动和观察 Windows Playtest、分析日志并定位故障，不把成功启动误报为游戏行为正确。', promptFact: '静态验证、进程启动、状态与日志证据', skill: 'playtest-debug', skillFact: 'playtest_status' },
    { id: 'asset-workshop', name: '游戏图片素材助手', description: '处理缩放、裁切、补边、切图、精灵表、图集与 PNG 优化，并验证像素、透明度和输出清单。', promptFact: '确定性图片素材处理', skill: 'asset-workshop', skillFact: 'resize-pixel' },
    { id: 'build-release', name: '游戏构建与发布助手', description: '生成并检查 Windows 与 Web 构建，执行结构检查和冒烟测试，且不修改源项目。', promptFact: '可复现 Windows 和 Web 构建', skill: 'build-release', skillFact: 'rpgmpacker' }
  ];
  for (const expected of expectedPresets) {
    const resolved = await presets.resolve(expected.id);
    if (resolved.id !== expected.id || resolved.name !== expected.name || resolved.description !== expected.description) {
      throw new Error(`unexpected preset metadata for ${expected.id}: ${JSON.stringify(resolved)}`);
    }
    const skillText = await readFile(join(dirname(resolved.path), 'skills', expected.skill, 'SKILL.md'), 'utf8');
    if (!skillText.includes(expected.skillFact)) throw new Error(`mounted ${expected.id} preset did not expose its ${expected.skill} Skill`);
  }
  const roster = await presets.list();
  const rosterIds = roster.filter((entry) => expectedPresets.some((expected) => expected.id === entry.id)).map((entry) => entry.id);
  if (rosterIds.join(',') !== expectedPresets.map((expected) => expected.id).join(',')) throw new Error(`unexpected custom preset order: ${rosterIds.join(',')}`);
  const standingKeys = new Map();
  for (const expected of expectedPresets) standingKeys.set(expected.id, await presets.standingKeyFor(expected.id));
  const tools = mounted.ctx.get('tools');
  if (!tools) throw new Error('official DSH tools service did not mount');
  for (const expected of expectedPresets) {
    const presetSchemas = tools.schemas?.(standingKeys.get(expected.id)) ?? [];
    if (new Set(presetSchemas.map((schema) => schema.name)).size !== presetSchemas.length) throw new Error(`mounted ${expected.id} has duplicate tool schemas`);
    if (presetSchemas.filter((schema) => schema.name === 'run_code').length !== 1) throw new Error(`mounted ${expected.id} did not retain the PTC run_code tool`);
  }
  const hostSchemas = tools.schemas?.() ?? [];
  const debugStandingSchemas = tools.schemas?.(standingKeys.get('playtest-debug')) ?? [];
  if (new Set(hostSchemas.map((schema) => schema.name)).size !== hostSchemas.length) throw new Error('rc.7 mounted duplicate tool schemas');
  if (hostSchemas.some((schema) => schema.name === 'playtest_debug') || debugStandingSchemas.some((schema) => schema.name === 'playtest_debug')) {
    throw new Error('playtest-debug mounted an unexpected custom workflow tool');
  }
  const agentLoop = mounted.ctx.get('agentLoop');
  const systemPrompt = mounted.ctx.get('systemPrompt');
  if (!agentLoop || !systemPrompt) throw new Error('official DSH agent-loop or system-prompt service did not mount');
  for (const expected of expectedPresets) {
    const handle = await agentLoop.createAgent(mounted.ctx, {
      sessionId: randomUUID(),
      meta: { cwd: process.cwd(), agentPreset: expected.id },
      setup: async (agentCtx) => { await presets.mount(agentCtx, expected.id); }
    });
    agentHandles.set(expected.id, handle);
    const assembly = await systemPrompt.assemble(assembleContextFor(handle.agent));
    agentAssemblies.set(expected.id, assembly);
    const personaSections = assembly.sections.filter((section) => String(section.name ?? '').toLowerCase().includes('persona'));
    if (personaSections.length !== 1) throw new Error(`mounted ${expected.id} did not expose exactly one effective persona section`);
    const prompt = assembly.sections.map((section) => section.text).join('\n');
    if (!prompt.includes(expected.promptFact)) throw new Error(`mounted ${expected.id} persona omitted its domain fact`);
    if (!prompt.includes('使用用户当前使用的语言回复')) throw new Error(`mounted ${expected.id} persona omitted the language rule`);
    if (!prompt.includes('rpgmaker') || !prompt.includes('playtest-debug') || !prompt.includes('asset-workshop') || !prompt.includes('build-release')) {
      throw new Error(`mounted ${expected.id} persona omitted the specialist roster`);
    }
  }

  const rpgmakerSchemas = agentAssemblies.get('rpgmaker')?.tools ?? [];
  const debugSchemas = agentAssemblies.get('playtest-debug')?.tools ?? [];
  const rpgmakerTools = rpgmakerSchemas.filter((schema) => schema.name?.startsWith('rpgmaker_'));
  const debugRpgmakerTools = debugSchemas.filter((schema) => schema.name?.startsWith('rpgmaker_'));
  const requiredPlaytestTools = ['playtest_start', 'playtest_status', 'playtest_log', 'playtest_stop'];
  if (new Set(rpgmakerTools.map((schema) => schema.name)).size !== rpgmakerTools.length || new Set(debugRpgmakerTools.map((schema) => schema.name)).size !== debugRpgmakerTools.length) {
    throw new Error('workspace Agent registered duplicate stable RPG Maker tool schemas');
  }
  if (rpgmakerTools.length < 41 || debugRpgmakerTools.length < 41) throw new Error(`official DSH registered only ${rpgmakerTools.length}/${debugRpgmakerTools.length} stable RPG Maker tools`);
  if (requiredPlaytestTools.some((name) => !rpgmakerTools.some((schema) => schema.name === `rpgmaker_${name}`) || !debugRpgmakerTools.some((schema) => schema.name === `rpgmaker_${name}`))) {
    throw new Error(`official DSH did not register every stable RPG Maker Playtest tool: ${requiredPlaytestTools.join(', ')}`);
  }
  if (rpgmakerSchemas.some((schema) => schema.name === 'playtest_debug') || debugSchemas.some((schema) => schema.name === 'playtest_debug')) {
    throw new Error('playtest-debug mounted an unexpected custom workflow tool');
  }

  const rpgmakerHandle = agentHandles.get('rpgmaker');
  if (!rpgmakerHandle) throw new Error('rpgmaker workspace Agent was not created');
  let callNumber = 0;
  const call = async (name, args) => {
    const result = await tools.execute({
      callId: `phase2-real-${++callNumber}`,
      name: `rpgmaker_${name}`,
      arguments: args,
      agent: rpgmakerHandle.agent,
      signal: new AbortController().signal,
    });
    if (result.isError) throw new Error(`official DSH stable RPG Maker tool ${name} returned an error: ${JSON.stringify(result)}`);
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
  console.log(JSON.stringify({ ok: true, presets: expectedPresets.map((expected) => expected.id), defaultPreset: expectedPresets[0].id, playtestStatus, mcpTools: rpgmakerTools.length, calls: callNumber, mutation: reread.name, restored: restored.name }));
} finally {
  for (const handle of agentHandles.values()) await handle.dispose().catch(() => undefined);
  if (mounted) await mounted.shutdown.shutdown(0);
}
