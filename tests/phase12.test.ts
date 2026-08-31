import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertObjectJsonSchema, renderToolsSdk } from '@deepseek-ai/dsh-tools';

import {
  MCPORTER_NPM_INTEGRITY,
  MCPORTER_PACKAGE,
  MCPORTER_VERSION
} from '../src/mcport';
import {
  JS_RUNNER_ENV,
  MCPORTER_RUNTIME_ENV,
  RPGMAKER_MCP_RUNTIME_ENV
} from '../src/workspace-mcp';
import {
  MCP_ENGINE_RECORDS,
  RPGMAKER_MZ_MCP_INTEGRITY,
  RPGMAKER_MZ_MCP_PACKAGE,
  RPGMAKER_MZ_MCP_VERSION,
  RPGMAKER_MV_MCP_INTEGRITY,
  RPGMAKER_MV_MCP_PACKAGE,
  RPGMAKER_MV_MCP_VERSION,
  verifyRpgMakerMcpRuntime
} from '../src/rpgmaker';
import { validateRpgMakerWorkspace } from '../src/project';
import { HarnessScope, createHarnessAgent } from './fixtures/dsh-agent-harness';

const contract = await import('../bundle/dsh-workspace-mcp/lib/contract.js');
const workspaceBundle = await import('../bundle/dsh-workspace-mcp/lib/workspace.js');
const environment = await import('../bundle/dsh-workspace-mcp/lib/env.js');
const toolsBundle = await import('../bundle/dsh-workspace-mcp/lib/tools.js');

async function temp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

async function writeEnginePackage(
  runtime: string,
  record: (typeof MCP_ENGINE_RECORDS)[keyof typeof MCP_ENGINE_RECORDS],
  packageEntry: string = record.entry
): Promise<void> {
  const packageDir = join(runtime, 'node_modules', ...record.package.split('/'));
  await mkdir(join(packageDir, 'dist'), { recursive: true });
  await writeFile(join(packageDir, 'package.json'), `${JSON.stringify({
    name: record.package,
    version: record.version,
    bin: { [record.bin]: packageEntry }
  })}\n`);
  await writeFile(join(packageDir, record.entry), 'export {};\n');
}

async function writeDualRuntime(root: string): Promise<string> {
  const runtime = join(root, 'runtime');
  await mkdir(runtime, { recursive: true });
  await Promise.all(Object.values(MCP_ENGINE_RECORDS).map((record) => writeEnginePackage(runtime, record)));
  await writeFile(join(runtime, 'package.json'), `${JSON.stringify({
    name: 'dsh-rpgmaker-mcp-runtime',
    private: true,
    dependencies: {
      [RPGMAKER_MV_MCP_PACKAGE]: RPGMAKER_MV_MCP_VERSION,
      [RPGMAKER_MZ_MCP_PACKAGE]: RPGMAKER_MZ_MCP_VERSION
    }
  })}\n`);
  await writeFile(join(runtime, 'bun.lock'), `${JSON.stringify({
    lockfileVersion: 1,
    workspaces: {
      '': {
        dependencies: {
          [RPGMAKER_MV_MCP_PACKAGE]: RPGMAKER_MV_MCP_VERSION,
          [RPGMAKER_MZ_MCP_PACKAGE]: RPGMAKER_MZ_MCP_VERSION
        }
      }
    },
    packages: {
      [RPGMAKER_MV_MCP_PACKAGE]: [`${RPGMAKER_MV_MCP_PACKAGE}@${RPGMAKER_MV_MCP_VERSION}`, '', { bin: { 'rpgmaker-mv-mcp': 'dist/index.js' } }, RPGMAKER_MV_MCP_INTEGRITY],
      [RPGMAKER_MZ_MCP_PACKAGE]: [`${RPGMAKER_MZ_MCP_PACKAGE}@${RPGMAKER_MZ_MCP_VERSION}`, '', { bin: { 'rpgmaker-mz-mcp': 'dist/index.js' } }, RPGMAKER_MZ_MCP_INTEGRITY]
    }
  })}\n`);
  return runtime;
}

async function writeFixtureMcporter(runtime: string): Promise<void> {
  const packageDir = join(runtime, 'node_modules', MCPORTER_PACKAGE);
  await mkdir(join(packageDir, 'dist'), { recursive: true });
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ private: true, dependencies: { [MCPORTER_PACKAGE]: MCPORTER_VERSION } }));
  await writeFile(join(runtime, 'bun.lock'), JSON.stringify({
    lockfileVersion: 1,
    workspaces: { '': { dependencies: { [MCPORTER_PACKAGE]: MCPORTER_VERSION } } },
    packages: { [MCPORTER_PACKAGE]: [`${MCPORTER_PACKAGE}@${MCPORTER_VERSION}`, '', {}, MCPORTER_NPM_INTEGRITY] }
  }));
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({ version: MCPORTER_VERSION, main: 'dist/index.js' }));
  await writeFile(join(packageDir, 'dist', 'index.js'), await readFile(join(process.cwd(), 'tests', 'fixtures', 'fake-mcporter.mjs'), 'utf8'));
}

async function writeMZFixture(runtime: string, manifest: unknown): Promise<void> {
  const packageDir = join(runtime, 'node_modules', RPGMAKER_MZ_MCP_PACKAGE);
  await mkdir(join(packageDir, 'dist'), { recursive: true });
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({
    name: RPGMAKER_MZ_MCP_PACKAGE,
    version: RPGMAKER_MZ_MCP_VERSION,
    bin: { 'rpgmaker-mz-mcp': 'dist/index.js' }
  }));
  let source = await readFile(join(process.cwd(), 'tests', 'fixtures', 'xerolo-fixture-server.mjs'), 'utf8');
  source = source.replace('const XEROLO_MANIFEST = __XEROLO_MANIFEST__', `const XEROLO_MANIFEST = ${JSON.stringify(manifest)}`);
  source = source.replace('JSON.stringify({ projectRoot, pid: process.pid })', 'JSON.stringify({ projectRoot, pid: process.pid, argv: process.argv, cwd: process.cwd() })');
  await writeFile(join(packageDir, 'dist', 'index.js'), source);
}

async function writeMVFixture(runtime: string, manifest: unknown): Promise<void> {
  const packageDir = join(runtime, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp');
  await mkdir(join(packageDir, 'dist'), { recursive: true });
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({
    name: RPGMAKER_MV_MCP_PACKAGE,
    version: RPGMAKER_MV_MCP_VERSION,
    bin: { 'rpgmaker-mv-mcp': 'dist/index.js' }
  }));
  let source = await readFile(join(process.cwd(), 'tests', 'fixtures', 'xerolo-fixture-server.mjs'), 'utf8');
  source = source.replace('const XEROLO_MANIFEST = __XEROLO_MANIFEST__', `const XEROLO_MANIFEST = ${JSON.stringify(manifest)}`);
  await writeFile(join(packageDir, 'dist', 'index.js'), source);
}

async function withBundleEnv(values: Record<string, string>, run: () => Promise<void>): Promise<void> {
  const saved = Object.entries(values).map(([key]) => [key, process.env[key]] as const);
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  try {
    await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('dual-engine RPG Maker seams', () => {
  test('classifies direct-child MV/MZ markers and rejects missing or ambiguous roots', async () => {
    const root = await temp('dual-workspace');
    try {
      const mv = join(root, 'mv');
      await mkdir(join(mv, 'data'), { recursive: true });
      await mkdir(join(mv, 'js'), { recursive: true });
      await writeFile(join(mv, 'Game.rpgproject'), '{}\n');
      const mz = join(root, 'mz');
      await mkdir(join(mz, 'data'), { recursive: true });
      await mkdir(join(mz, 'js'), { recursive: true });
      await writeFile(join(mz, 'game.rmmzproject'), '{}\n');
      const ambiguous = join(root, 'ambiguous');
      await mkdir(join(ambiguous, 'data'), { recursive: true });
      await mkdir(join(ambiguous, 'js'), { recursive: true });
      await writeFile(join(ambiguous, 'Game.rpgproject'), '{}\n');
      await writeFile(join(ambiguous, 'game.rmmzproject'), '{}\n');
      const missing = join(root, 'missing');
      await mkdir(missing, { recursive: true });

      await expect(validateRpgMakerWorkspace(mv)).resolves.toMatchObject({ valid: true, engine: 'mv' });
      await expect(validateRpgMakerWorkspace(mz)).resolves.toMatchObject({ valid: true, engine: 'mz' });
      await expect(validateRpgMakerWorkspace(ambiguous)).resolves.toMatchObject({ valid: false, ambiguous: true });
      await expect(validateRpgMakerWorkspace(missing)).resolves.toMatchObject({ valid: false, missing: ['Game.rpgproject', 'game.rmmzproject', 'data', 'js'] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('keeps the pinned 119-tool MZ manifest and uses the fixed Redseb definition', async () => {
    expect(contract.MZ_TOOL_NAMES).toHaveLength(119);
    expect(contract.verifyManifest('mz').errors).toEqual([]);
    const root = await temp('dual-bundle');
    try {
      const runtime = await writeDualRuntime(root);
      const canonical = join(root, 'project');
      await mkdir(join(canonical, 'data'), { recursive: true });
      await mkdir(join(canonical, 'js'), { recursive: true });
      await writeFile(join(canonical, 'game.rmmzproject'), '{}\n');
      const definition = await workspaceBundle.buildWorkspaceDefinition('mz', canonical, { rpgmakerRuntime: runtime, runner: 'bun' }, {
        DSH_SECRET: 'must-be-removed',
        RPGMAKER_PROJECT_PATH: 'ambient-path'
      });
      expect(definition.command).toMatchObject({ command: 'bun', args: [definition.command.args[0]], cwd: canonical });
      expect(definition.command.args).not.toContain('--project');
      expect(definition.env?.RPGMAKER_PROJECT_PATH).toBe(canonical);
      expect(definition.env?.DSH_SECRET).toBe(environment.SECRET_MARKER);
      expect(definition.name).toMatch(/^rpgmaker-mz-ws-[0-9a-f]{12}$/);
      expect(environment.neutralizedServerEnv({ DSH_RPGMAKER_MCP_RUNTIME: runtime }).DSH_RPGMAKER_MCP_RUNTIME).toBe(environment.SECRET_MARKER);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('projects every MZ input schema onto the official DSH subset with typed nested arguments', () => {
    const projected = contract.MZ_MANIFEST.tools.map((rawTool) => ({
      rawTool,
      schema: toolsBundle.projectDshObjectJsonSchema(rawTool.inputSchema)
    }));
    for (const { schema } of projected) expect(() => assertObjectJsonSchema(schema)).not.toThrow();

    const selected = projected.filter(({ rawTool }) => ['update_actor', 'update_map_event', 'paint_tiles'].includes(rawTool.name));
    const sdkText = renderToolsSdk(selected.map(({ rawTool, schema }) => ({
      name: `rpgmaker_${rawTool.name}`,
      description: rawTool.description,
      parameters: schema,
      output: {}
    })));
    expect(sdkText).toContain('rpgmaker_update_actor: {');
    expect(sdkText).toContain('actorId: number;');
    expect(sdkText).toContain('updates: Record<string, JsonValue>;');
    expect(sdkText).toContain('dryRun?: boolean;');
    expect(sdkText).toContain('rpgmaker_update_map_event: {');
    expect(sdkText).toContain('eventId: number;');
    expect(sdkText).toContain('rpgmaker_paint_tiles: {');
    expect(sdkText).toContain('tiles: ({');
    expect(sdkText).not.toContain('rpgmaker_update_actor: unknown');
    expect(sdkText).not.toContain('rpgmaker_update_map_event: unknown');
    expect(sdkText).not.toContain('rpgmaker_paint_tiles: unknown');

    const registered = projected.map(({ rawTool }) => toolsBundle.createMcpTool(rawTool, { init: async () => { throw new Error('not executed'); } }, 'mz').parameters);
    expect(registered).toEqual(projected.map(({ schema }) => schema));
  });

  test('fails closed when a projected schema cannot satisfy the official DSH validator', () => {
    const hostileSchema = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}');
    expect(() => toolsBundle.projectDshObjectJsonSchema(hostileSchema)).toThrow(/unsupported JSON schema/);
    expect(() => toolsBundle.createMcpTool(
      { name: 'hostile_schema', inputSchema: hostileSchema },
      { init: async () => { throw new Error('not executed'); } },
      'mz'
    )).toThrow(/unsupported JSON schema/);
  });

  test('verifies both exact package identities and reports a tampered MZ lock independently', async () => {
    const root = await temp('dual-runtime');
    try {
      const runtime = await writeDualRuntime(root);
      const valid = await verifyRpgMakerMcpRuntime(runtime, 'linux');
      expect(valid.valid).toBe(true);
      expect(valid.engines.mv.valid).toBe(true);
      expect(valid.engines.mz.valid).toBe(true);
      const lockPath = join(runtime, 'bun.lock');
      const lock = JSON.parse(await readFile(lockPath, 'utf8')) as { packages: Record<string, unknown[]> };
      lock.packages[RPGMAKER_MZ_MCP_PACKAGE][3] = 'sha512-tampered';
      await writeFile(lockPath, `${JSON.stringify(lock)}\n`);
      const tampered = await verifyRpgMakerMcpRuntime(runtime, 'linux');
      expect(tampered.valid).toBe(false);
      expect(tampered.engines.mv.valid).toBe(true);
      expect(tampered.engines.mz.valid).toBe(false);
      expect(tampered.engines.mz.errors.join(' ')).toMatch(/MZ MCP bun\.lock/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('accepts the standard ./ prefix in installed MZ bin metadata', async () => {
    const root = await temp('mz-bin-prefix');
    try {
      const runtime = await writeDualRuntime(root);
      await writeEnginePackage(runtime, MCP_ENGINE_RECORDS.mz, './dist/index.js');
      await expect(verifyRpgMakerMcpRuntime(runtime, 'linux')).resolves.toMatchObject({
        valid: true,
        engines: { mz: { valid: true } }
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('mounts an MZ Agent with the pinned surface and routes a generated call', async () => {
    const root = await temp('dual-agent');
    const hostCtx = new HarnessScope('mz-agent-host');
    try {
      const mcporter = join(root, 'mcporter');
      const runtime = await writeDualRuntime(root);
      const projectRoot = join(root, 'MZ project');
      const trace = join(root, 'starts.jsonl');
      await mkdir(join(projectRoot, 'data'), { recursive: true });
      await mkdir(join(projectRoot, 'js'), { recursive: true });
      await writeFile(join(projectRoot, 'game.rmmzproject'), '{}\n');
      await writeFile(join(projectRoot, 'data', 'System.json'), '{"gameTitle":"MZ fixture"}\n');
      await writeFixtureMcporter(mcporter);
      await writeMZFixture(runtime, contract.MZ_MANIFEST);
      const hostBundle = await import('../bundle/dsh-workspace-mcp/lib/index.js');
      const agentBundle = await import('../bundle/dsh-workspace-mcp/lib/agent.js');
      hostBundle.apply(hostCtx);
      await withBundleEnv({
        [MCPORTER_RUNTIME_ENV]: mcporter,
        [RPGMAKER_MCP_RUNTIME_ENV]: runtime,
        [JS_RUNNER_ENV]: process.execPath,
        XEROLO_FIXTURE_TRACE: trace
      }, async () => {
        const agent = createHarnessAgent('mz-agent', { cwd: projectRoot, agentPreset: 'rpgmaker' }, hostCtx.root);
        agentBundle.apply(agent.ctx);
        const assembly = await agent.ctx.assemble();
        const names = assembly.tools.map((tool) => tool.name).sort();
        expect(names).toEqual(['run_code']);
        const sdkText = (assembly.sections.find((section) => (section as { name?: string })?.name === 'tools:sdk') as { text?: string } | undefined)?.text ?? '';
        expect(sdkText).toContain('interface ToolArgsMap');
        expect(sdkText).toContain('declare const tools');
        expect(sdkText).toContain('rpgmaker_update_game_title');
        expect(sdkText).toContain('rpgmaker_update_actor: {');
        expect(sdkText).toContain('actorId: number;');
        expect(sdkText).toContain('updates: Record<string, JsonValue>;');
        expect(sdkText).toContain('dryRun?: boolean;');
        expect(sdkText).toContain('rpgmaker_update_map_event: {');
        expect(sdkText).toContain('eventId: number;');
        expect(sdkText).toContain('rpgmaker_paint_tiles: {');
        expect(sdkText).toContain('tiles: ({');
        expect(sdkText).not.toContain('rpgmaker_update_actor: unknown');
        expect(sdkText).not.toContain('rpgmaker_update_map_event: unknown');
        expect(sdkText).not.toContain('rpgmaker_paint_tiles: unknown');
        expect(sdkText).not.toContain('rpgmaker_get_project_info');
        expect(names).not.toContain('rpgmaker_get_project_info');
        const getProject = agent.ctx.tools.get('rpgmaker_get_project');
        expect(getProject).toBeDefined();
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
        await expect(getProject!.execute({}, { agent, signal: new AbortController().signal })).resolves.toMatchObject({ projectRoot: expect.any(String), valid: true, gameTitle: 'MZ fixture' });
        const updateTitle = agent.ctx.tools.get('rpgmaker_update_game_title');
        expect(updateTitle).toBeDefined();
        await expect(updateTitle!.execute({ title: 'MZ edited', dryRun: true }, { agent, signal: new AbortController().signal })).resolves.toMatchObject({ dryRun: true, after: 'MZ edited' });
        await expect(updateTitle!.execute({ title: 'MZ edited' }, { agent, signal: new AbortController().signal })).resolves.toMatchObject({ gameTitle: 'MZ edited' });
        const reread = agent.ctx.tools.get('rpgmaker_get_game_title');
        expect(reread).toBeDefined();
        await expect(reread!.execute({}, { agent, signal: new AbortController().signal })).resolves.toMatchObject({ gameTitle: 'MZ edited' });
        for (const name of ['rpgmaker_validate_project', 'rpgmaker_validate_references']) {
          const validation = agent.ctx.tools.get(name);
          expect(validation).toBeDefined();
          await expect(validation!.execute({}, { agent, signal: new AbortController().signal })).resolves.toMatchObject({ ok: true, errors: [] });
        }
        const start = JSON.parse((await readFile(trace, 'utf8')).trim().split(/\r?\n/)[0]) as { projectRoot: string; cwd: string; argv: string[] };
        expect(start.projectRoot).toBe(await realpath(projectRoot));
        expect(start.cwd).toBe(start.projectRoot);
        expect(start.argv).not.toContain('--project');
        await agent.ctx.dispose();
      });
    } finally {
      await Promise.resolve(hostCtx.dispose()).catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  test('mounts concurrent MV and MZ Agents in one Host with isolated pair state and presentations', async () => {
    const root = await temp('dual-concurrent-agent');
    const hostCtx = new HarnessScope('dual-concurrent-host');
    try {
      const runtime = await writeDualRuntime(root);
      const mcporter = join(root, 'mcporter');
      await writeFixtureMcporter(mcporter);
      const contract = await import('../bundle/dsh-workspace-mcp/lib/contract.js');
      await writeMVFixture(runtime, contract.XEROLO_MANIFEST);
      await writeMZFixture(runtime, contract.MZ_MANIFEST);
      const mvProject = join(root, 'mv-project');
      const mzProject = join(root, 'mz-project');
      for (const [project, marker, title] of [[mvProject, 'Game.rpgproject', 'MV concurrent'], [mzProject, 'game.rmmzproject', 'MZ concurrent']] as const) {
        await mkdir(join(project, 'data'), { recursive: true });
        await mkdir(join(project, 'js'), { recursive: true });
        await writeFile(join(project, marker), '{}\n');
        await writeFile(join(project, 'data', 'System.json'), JSON.stringify({ gameTitle: title }));
        await writeFile(join(project, 'js', 'plugins.js'), '[]\n');
      }
      const hostBundle = await import('../bundle/dsh-workspace-mcp/lib/index.js');
      const agentBundle = await import('../bundle/dsh-workspace-mcp/lib/agent.js');
      hostBundle.apply(hostCtx);
      await withBundleEnv({ [MCPORTER_RUNTIME_ENV]: mcporter, [RPGMAKER_MCP_RUNTIME_ENV]: runtime, [JS_RUNNER_ENV]: process.execPath }, async () => {
        const mvAgent = createHarnessAgent('mv-concurrent', { cwd: mvProject, agentPreset: 'rpgmaker' }, hostCtx.root);
        const mzAgent = createHarnessAgent('mz-concurrent', { cwd: mzProject, agentPreset: 'rpgmaker' }, hostCtx.root);
        agentBundle.apply(mvAgent.ctx);
        agentBundle.apply(mzAgent.ctx);
        const [mvAssembly, mzAssembly] = await Promise.all([mvAgent.ctx.assemble(), mzAgent.ctx.assemble()]);
        expect(mvAssembly.tools.map((tool) => tool.name)).toContain('rpgmaker_get_project_info');
        expect(mvAssembly.tools.map((tool) => tool.name)).not.toContain('run_code');
        expect(mzAssembly.tools.map((tool) => tool.name)).toEqual(['run_code']);
        const mzSdk = (mzAssembly.sections.find((section) => (section as { name?: string })?.name === 'tools:sdk') as { text?: string } | undefined)?.text ?? '';
        expect(mzSdk).toContain('interface ToolArgsMap');
        expect(mzSdk).toContain('rpgmaker_update_game_title');
        expect(mzSdk).not.toContain('rpgmaker_get_project_info');
        const state = hostBundle.hostState(hostCtx);
        expect(state.workspacePairs).toEqual(expect.arrayContaining([
          expect.objectContaining({ engine: 'mv', canonical: await realpath(mvProject) }),
          expect.objectContaining({ engine: 'mz', canonical: await realpath(mzProject) })
        ]));
        const mvInfo = await mvAgent.ctx.tools.get('rpgmaker_get_project_info')!.execute({}, { agent: mvAgent, signal: new AbortController().signal });
        const mzInfo = await mzAgent.ctx.tools.get('rpgmaker_get_project')!.execute({}, { agent: mzAgent, signal: new AbortController().signal });
        expect(mvInfo).toMatchObject({ gameTitle: 'MV concurrent' });
        expect(mzInfo).toMatchObject({ gameTitle: 'MZ concurrent' });
        const mzAlias = join(root, 'mz-project-alias');
        await symlink(mzProject, mzAlias, process.platform === 'win32' ? 'junction' : 'dir');
        await expect(mzAgent.ctx.tools.get('rpgmaker_set_project')!.execute({ path: mzAlias }, { agent: mzAgent, signal: new AbortController().signal })).resolves.toMatchObject({ ok: true, tool: 'set_project', path: await realpath(mzProject) });
        await expect(mzAgent.ctx.tools.get('rpgmaker_set_project')!.execute({ path: mvProject }, { agent: mzAgent, signal: new AbortController().signal })).rejects.toThrow(/cannot retarget.*workspace/i);
        expect(hostBundle.hostState(hostCtx).workspacePairs).toHaveLength(2);
        await Promise.all([mvAgent.ctx.dispose(), mzAgent.ctx.dispose()]);
      });
    } finally {
      await Promise.resolve(hostCtx.dispose()).catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

});
