import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import { MCPORTER_NPM_INTEGRITY, MCPORTER_PACKAGE, MCPORTER_VERSION, verifyMcporterRuntime } from '../src/mcport';
import {
  JS_RUNNER_ENV,
  MCPORTER_RUNTIME_ENV,
  RPGMAKER_MCP_RUNTIME_ENV
} from '../src/workspace-mcp';
import { RPGMAKER_MV_MCP_PACKAGE, RPGMAKER_MV_MCP_VERSION } from '../src/rpgmaker';
import { redactSensitive, withoutCredentials } from '../src/process';
import { HarnessScope, createHarnessAgent, type HarnessAgent } from './fixtures/dsh-agent-harness';

describe('credential environment scrubbing', () => {
  test('filters and redacts credential keys case-insensitively', () => {
    const env = {
      forgejo_access_token: 'synthetic-forgejo-secret',
      DsH_FoRgEjO_AcCeSs_ToKeN: 'synthetic-dsh-forgejo-secret',
      dsh_api_key: 'synthetic-dsh-secret',
      npm_token: 'synthetic-npm-secret',
      NoDe_AuTh_ToKeN: 'synthetic-node-auth-secret',
      github_token: 'synthetic-github-secret',
      GITLAB_TOKEN: 'synthetic-gitlab-secret',
      npm_config__auth: 'synthetic-npm-config-secret',
      'npm_config_//registry.npmjs.org/:_authToken': 'synthetic-registry-secret',
      SAFE_VALUE: 'safe'
    };
    expect(withoutCredentials(env)).toEqual({ SAFE_VALUE: 'safe' });
    const redacted = redactSensitive('forgejo_access_token=synthetic-forgejo-secret DSH_API_KEY: synthetic-dsh-secret NPM_TOKEN=synthetic-npm-secret npm_config_//registry.npmjs.org/:_authToken=synthetic-registry-secret', env);
    expect(redacted).not.toContain('synthetic-forgejo-secret');
    expect(redacted).not.toContain('synthetic-dsh-secret');
    expect(redacted).not.toContain('synthetic-npm-secret');
    expect(redacted).not.toContain('synthetic-registry-secret');
    expect(redacted).toContain('forgejo_access_token=[redacted]');
    expect(redacted).toContain('DSH_API_KEY: [redacted]');
    expect(redacted).toContain('NPM_TOKEN=[redacted]');
    expect(redacted).toContain('npm_config_//registry.npmjs.org/:_authToken=[redacted]');
  });
});

async function temp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

async function countLines(path: string): Promise<number> {
  try {
    const content = await readFile(path, 'utf8');
    return content.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
  } catch {
    return 0;
  }
}

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await readFile(path);
      return;
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
    }
  }
  throw new Error(`Timed out waiting for test fixture file ${path}`);
}

function harnessPaths(root: string) {
  return {
    dshHome: join(root, 'home'),
    programRoot: join(root, 'program'),
    runtimeDir: join(root, 'program', 'runtime', 'dsh')
  };
}

const BUNDLE_LIB = join(process.cwd(), 'bundle', 'dsh-workspace-mcp', 'lib');
const FIXTURE_SERVER = join(process.cwd(), 'tests', 'fixtures', 'deterministic-mcp-server.mjs');
const FAKE_MCPORTER = join(process.cwd(), 'tests', 'fixtures', 'fake-mcporter.mjs');
const RPGMAKER_SERVER_TEMPLATE = join(process.cwd(), 'tests', 'fixtures', 'xerolo-fixture-server.mjs');
const RPGMAKER_MV_PACKAGE_DIR = join('node_modules', RPGMAKER_MV_MCP_PACKAGE);

/**
 * Install the test-owned fake MCPorter runtime in the exact pinned shape
 * (package.json + package-lock.json integrity + app-owned entry), so the fixture is
 * indistinguishable from a verified install and no external package is ever
 * downloaded by an ordinary test.
 */
async function writeFixtureMcporterRuntime(runtimeDir: string): Promise<void> {
  const packageDir = join(runtimeDir, 'node_modules', MCPORTER_PACKAGE);
  await mkdir(join(packageDir, 'dist'), { recursive: true });
  await writeFile(join(runtimeDir, 'package.json'), JSON.stringify({ private: true, dependencies: { [MCPORTER_PACKAGE]: MCPORTER_VERSION } }));
  await writeFile(join(runtimeDir, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { [MCPORTER_PACKAGE]: MCPORTER_VERSION } },
      [`node_modules/${MCPORTER_PACKAGE}`]: { version: MCPORTER_VERSION, integrity: MCPORTER_NPM_INTEGRITY }
    }
  }));
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({ version: MCPORTER_VERSION, main: 'dist/index.js' }));
  await writeFile(join(packageDir, 'dist', 'index.js'), await readFile(FAKE_MCPORTER, 'utf8'));
}

/**
 * Install a deterministic Xerolo fixture runtime seeded from the pinned bundle
 * manifest (the schema SSOT), so live tools/list matches the contract without
 * an external install. The server template is a generated test double, not a
 * second manifest.
 */
async function writeFixtureRpgMakerRuntime(runtimeDir: string, manifest: unknown): Promise<void> {
  const packageDir = join(runtimeDir, RPGMAKER_MV_PACKAGE_DIR);
  await mkdir(join(packageDir, 'dist'), { recursive: true });
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({
    name: RPGMAKER_MV_MCP_PACKAGE,
    version: RPGMAKER_MV_MCP_VERSION,
    bin: { 'rpgmaker-mv-mcp': 'dist/index.js' }
  }));
  const template = await readFile(RPGMAKER_SERVER_TEMPLATE, 'utf8');
  await writeFile(
    join(packageDir, 'dist', 'index.js'),
    template.replace(
      'const XEROLO_MANIFEST = __XEROLO_MANIFEST__',
      `const XEROLO_MANIFEST = ${JSON.stringify(manifest)}`
    )
  );
}

/** Lazy test-owned fixture runtimes shared by the probe and the Agent seam. */
let sharedFixturesPromise: Promise<{ root: string; mcporter: string; rpgmakerRuntime: string }> | undefined;
let sharedRootForCleanup: string | undefined;

function sharedFixtureRuntimes(): Promise<{ root: string; mcporter: string; rpgmakerRuntime: string }> {
  sharedFixturesPromise ??= (async () => {
    const root = await temp('ws-mcp-fixture');
    sharedRootForCleanup = root;
    const paths = harnessPaths(root);
    const mcporter = join(paths.programRoot, 'runtime', 'mcporter');
    await writeFixtureMcporterRuntime(mcporter);
    const rpgmakerRuntime = join(paths.programRoot, 'runtime', 'mcp');
    const contract = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/contract.js')>('contract.js');
    await writeFixtureRpgMakerRuntime(rpgmakerRuntime, contract.XEROLO_MANIFEST);
    return { root, mcporter, rpgmakerRuntime };
  })();
  return sharedFixturesPromise;
}

afterAll(async () => {
  if (sharedRootForCleanup) await rm(sharedRootForCleanup, { recursive: true, force: true });
});

async function makeMvProject(root: string, title = 'Probe Game', folder = '选择 project with spaces'): Promise<string> {
  const project = join(root, folder);
  await mkdir(join(project, 'data'), { recursive: true });
  await mkdir(join(project, 'js'), { recursive: true });
  await writeFile(join(project, 'Game.rpgproject'), '{}\n');
  await writeFile(join(project, 'data', 'System.json'), JSON.stringify({ gameTitle: title }));
  await writeFile(join(project, 'data', 'MapInfos.json'), '[]\n');
  await writeFile(join(project, 'data', 'Actors.json'), '[null]\n');
  await writeFile(join(project, 'js', 'plugins.js'), '[]\n');
  return project;
}

async function withBundleEnv(env: Record<string, string>, fn: () => Promise<void>): Promise<void> {
  const saved: Array<[string, string | undefined]> = [];
  for (const [key, value] of Object.entries(env)) {
    saved.push([key, process.env[key]]);
    process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function bundleModule<T = Record<string, unknown>>(name: string): Promise<T> {
  return import(pathToFileURL(join(BUNDLE_LIB, name)).href) as Promise<T>;
}

function createComposedAgent(
  agentBundle: { apply: (ctx: HarnessScope) => void },
  id: string,
  header: { cwd?: string; agentPreset?: string },
  root: object,
  logger?: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void }
) {
  const agent = createHarnessAgent(id, header, root, logger);
  agentBundle.apply(agent.ctx);
  return agent;
}

async function executeAgentTool(agent: HarnessAgent, name: string, args: Record<string, unknown>): Promise<unknown> {
  const definition = agent.ctx.tools.get(name);
  if (!definition) throw new Error(`harness tool ${name} is not registered for Agent ${agent.id}`);
  return definition.execute(args, { agent, signal: new AbortController().signal });
}

describe('app-owned MCPorter runtime verification', () => {
  test('accepts an installed exact-pinned runtime and rejects a tampered lock', async () => {
    const root = await temp('mcport-verify');
    try {
      const runtime = join(root, 'runtime');
      await mkdir(join(runtime, 'node_modules', 'mcporter', 'dist'), { recursive: true });
      await writeFile(join(runtime, 'package.json'), JSON.stringify({ private: true, dependencies: { [MCPORTER_PACKAGE]: MCPORTER_VERSION } }));
      await writeFile(join(runtime, 'package-lock.json'), JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { dependencies: { [MCPORTER_PACKAGE]: MCPORTER_VERSION } },
          [`node_modules/${MCPORTER_PACKAGE}`]: { version: MCPORTER_VERSION, integrity: MCPORTER_NPM_INTEGRITY }
        }
      }));
      await writeFile(join(runtime, 'node_modules', 'mcporter', 'package.json'), JSON.stringify({ version: MCPORTER_VERSION }));
      await writeFile(join(runtime, 'node_modules', 'mcporter', 'dist', 'index.js'), 'export {}');

      const valid = await verifyMcporterRuntime(runtime, 'win32');
      expect(valid.valid).toBe(true);
      expect(valid.packageVersion).toBe(MCPORTER_VERSION);
      expect(valid.packageDir).toBe(join(runtime, 'node_modules', 'mcporter'));
      expect(valid.entrypoint).toBe(join(runtime, 'node_modules', 'mcporter', 'dist', 'index.js'));

      const lockPath = join(runtime, 'package-lock.json');
      const lock = await readFile(lockPath, 'utf8');
      await writeFile(lockPath, lock.replace(MCPORTER_NPM_INTEGRITY, 'sha512-tampered'));
      const tampered = await verifyMcporterRuntime(runtime, 'win32');
      expect(tampered.valid).toBe(false);
      expect(tampered.errors.join(' ')).toContain('npm integrity');

      await rm(lockPath);
      const missing = await verifyMcporterRuntime(runtime, 'win32');
      expect(missing.valid).toBe(false);
      expect(missing.errors.join(' ')).toContain('package-lock.json');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects an entry that escapes the app-owned runtime and a wrong version', async () => {
    const root = await temp('mcport-escape');
    try {
      const runtime = join(root, 'runtime');
      await mkdir(join(runtime, 'node_modules', 'mcporter'), { recursive: true });
      await writeFile(join(runtime, 'package.json'), JSON.stringify({ private: true, dependencies: { [MCPORTER_PACKAGE]: MCPORTER_VERSION } }));
      await writeFile(join(runtime, 'package-lock.json'), JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { dependencies: { [MCPORTER_PACKAGE]: MCPORTER_VERSION } },
          [`node_modules/${MCPORTER_PACKAGE}`]: { version: MCPORTER_VERSION, integrity: MCPORTER_NPM_INTEGRITY }
        }
      }));
      const escape = join(root, 'escape', 'index.js');
      await mkdir(dirnameOf(escape), { recursive: true });
      await writeFile(escape, 'export {}');
      await writeFile(join(runtime, 'node_modules', 'mcporter', 'package.json'), JSON.stringify({ version: MCPORTER_VERSION, main: '../../../../escape/index.js' }));

      const result = await verifyMcporterRuntime(runtime, 'win32');
      expect(result.valid).toBe(false);
      expect(result.errors.join(' ')).toContain('entry was not found');

      await writeFile(join(runtime, 'node_modules', 'mcporter', 'package.json'), JSON.stringify({ version: '0.1.0' }));
      const wrong = await verifyMcporterRuntime(runtime, 'win32');
      expect(wrong.valid).toBe(false);
      expect(wrong.errors.join(' ')).toContain('installed MCPorter version');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function dirnameOf(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')));
}

class TrackedAbortSignal {
  aborted = false;
  addCalls = 0;
  removeCalls = 0;
  private listener: (() => void) | undefined;

  addEventListener(_type: string, listener: unknown): void {
    this.addCalls += 1;
    this.listener = listener as () => void;
  }

  removeEventListener(_type: string, listener: unknown): void {
    if (this.listener === listener) this.listener = undefined;
    this.removeCalls += 1;
  }

  abort(): void {
    this.aborted = true;
    this.listener?.();
  }
}

describe('Xerolo tool contract fail-closed', () => {
  test('requires an explicit engine and never infers MV or MZ from a manifest argument', async () => {
    const contract = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/contract.js')>('contract.js');
    const tools = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/tools.js')>('tools.js');
    const rawTool = contract.XEROLO_MANIFEST.tools[0];
    const capability = { init: async () => { throw new Error('not executed'); } };
    expect(() => Reflect.apply(contract.manifestFor, undefined, [])).toThrow(/unsupported RPG Maker engine/);
    expect(() => Reflect.apply(contract.manifestFor, undefined, [contract.MZ_MANIFEST])).toThrow(/unsupported RPG Maker engine/);
    expect(() => Reflect.apply(contract.contractFor, undefined, [])).toThrow(/unsupported RPG Maker engine/);
    expect(() => Reflect.apply(contract.missingCriticalTools, undefined, [contract.XEROLO_TOOL_NAMES])).toThrow(/unsupported RPG Maker engine/);
    expect(() => Reflect.apply(contract.verifyManifest, undefined, [])).toThrow(/unsupported RPG Maker engine/);
    expect(() => Reflect.apply(contract.verifyManifest, undefined, [contract.XEROLO_MANIFEST])).toThrow(/unsupported RPG Maker engine/);
    expect(() => Reflect.apply(contract.validateDiscoveredTools, undefined, [rawTool ? [rawTool] : []])).toThrow(/unsupported RPG Maker engine/);
    expect(() => Reflect.apply(tools.createMcpTool, undefined, [rawTool, capability])).toThrow(/unsupported RPG Maker engine/);
  });

  test('accepts the complete fixed set and rejects missing, unknown, and duplicate names', async () => {
    const contract = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/contract.js')>('contract.js');
    expect(contract.XEROLO_MANIFEST.tools.length).toBe(41);
    const full = contract.XEROLO_MANIFEST.tools.map((tool) => ({ name: tool.name, inputSchema: tool.inputSchema }));
    expect(contract.validateDiscoveredTools(full, 'mv').errors).toEqual([]);
    expect(contract.validateDiscoveredTools([], 'mv').errors.join(' ')).toContain('no tools');
    expect(contract.validateDiscoveredTools([{ name: '', inputSchema: {} }], 'mv').errors.join(' ')).toContain('without a name');
    expect(contract.validateDiscoveredTools([{ name: 'echo' }, { name: 'echo' }], 'mv').errors.join(' ')).toContain('duplicate');
    const withUnknown = [...full.slice(0, 10), { name: 'not_in_contract', inputSchema: { type: 'object' } }];
    expect(contract.validateDiscoveredTools(withUnknown, 'mv').errors.join(' ')).toContain('outside the fixed Xerolo contract');
    const missingOne = full.slice(1);
    expect(contract.validateDiscoveredTools(missingOne, 'mv').errors.join(' ')).toContain('missing required RPG Maker tools');
  });

  test('verifies the pinned manifest digest and rejects tampering and live schema drift', async () => {
    const contract = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/contract.js')>('contract.js');
    expect(contract.manifestDigest()).toBe(contract.XEROLO_MANIFEST_SHA256);
    expect(contract.verifyManifest('mv').errors).toEqual([]);

    const tampered = {
      ...contract.XEROLO_MANIFEST,
      tools: [{ ...contract.XEROLO_MANIFEST.tools[0], description: 'edited by hand' }, ...contract.XEROLO_MANIFEST.tools.slice(1)]
    };
    expect(contract.verifyManifest('mv', tampered).errors.join(' ')).toContain('digest mismatch');

    const noTools = { ...contract.XEROLO_MANIFEST, tools: [] };
    expect(contract.verifyManifest('mv', noTools).errors.join(' ')).toContain('no tools');

    // A live set with the right names but unsupported schemas drifts from the
    // pinned manifest and must fail closed before any execution.
    const drifted = contract.XEROLO_MANIFEST.tools.map((tool) => ({ name: tool.name, inputSchema: { type: 'object', properties: {} } }));
    expect(contract.validateDiscoveredTools(drifted, 'mv').errors.join(' ')).toContain('drifted');
  });

  test('rejects schemas outside the DSH vocabulary and invalid generated names', async () => {
    const contract = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/contract.js')>('contract.js');
    const base = (inputSchema: unknown) => ({ name: 'validate_project', inputSchema });
    expect(contract.schemaProblem(base({ type: ['string', 'number'] }).inputSchema, 't')).toContain('type array');
    expect(contract.schemaProblem(base({ type: 'object', nullable: true }).inputSchema, 't')).toContain('nullable');
    expect(contract.schemaProblem(base({ $ref: '#/x' }).inputSchema, 't')).toContain('$ref');
    expect(contract.schemaProblem(base({ type: 'file' }).inputSchema, 't')).toContain('unsupported type');
    expect(contract.schemaProblem(base({ oneOf: [{ type: 'string' }] }).inputSchema, 't')).toContain('invalid oneOf');
    expect(contract.schemaProblem(base({ type: 'object', properties: { a: { type: ['x'] } } }).inputSchema, 't')).toContain('type array');
    expect(contract.schemaProblem(undefined, 't')).toContain('no inputSchema');
    expect(contract.schemaProblem({ type: 'object', properties: { a: { type: 'string' } } }, 't')).toBeUndefined();

    expect(contract.validateModelNames(['rpgmaker_validate_project']).errors).toEqual([]);
    expect(contract.validateModelNames(['rpgmaker_x', 'rpgmaker_x']).errors.join(' ')).toContain('not unique');
    expect(contract.validateModelNames(['run_code']).errors.join(' ')).toContain('reserved');
    expect(contract.validateModelNames(['rpgmaker-9x']).errors.join(' ')).toContain('invalid');
  });

  test('requires the critical editing, validation, backup/restore, and Playtest subset in the manifest and live set', async () => {
    const contract = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/contract.js')>('contract.js');
    // The pinned manifest itself carries every critical contract tool.
    expect(contract.missingCriticalTools(contract.XEROLO_TOOL_NAMES, 'mv')).toEqual([]);
    expect(contract.validateDiscoveredTools(contract.XEROLO_MANIFEST.tools.map((tool) => ({ name: tool.name, inputSchema: tool.inputSchema })), 'mv').errors).toEqual([]);

    // Removing any critical tool fails the live set before execution.
    const withoutPlaytestStop = contract.XEROLO_MANIFEST.tools
      .filter((tool) => tool.name !== 'playtest_stop')
      .map((tool) => ({ name: tool.name, inputSchema: tool.inputSchema }));
    expect(contract.missingCriticalTools(withoutPlaytestStop.map((tool) => tool.name), 'mv')).toEqual(['playtest_stop']);
    const liveErrors = contract.validateDiscoveredTools(withoutPlaytestStop, 'mv').errors.join(' ');
    expect(liveErrors).toContain('missing critical RPG Maker tools');
    expect(liveErrors).toContain('playtest_stop');

    // A regenerated manifest missing a critical tool is rejected too: digest
    // drift is reported, and the contract guard names the exact gap.
    const regressed = {
      ...contract.XEROLO_MANIFEST,
      tools: contract.XEROLO_MANIFEST.tools.filter((tool) => tool.name !== 'restore_backup')
    };
    const manifestErrors = contract.verifyManifest('mv', regressed).errors.join(' ');
    expect(manifestErrors).toContain('missing critical RPG Maker tools');
    expect(manifestErrors).toContain('restore_backup');
  });
});


describe('disposable MCPorter probe', () => {
  test('proves single-flight runtime, dynamic stdio registration, listing, pooling, containment, per-server and final close', async () => {
    const shared = await sharedFixtureRuntimes();
    const root = await temp('ws-mcp-probe');
    try {
      const hostModule = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/mcport-host.js')>('mcport-host.js');
      const host = hostModule.createHost();
      const env = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/env.js')>('env.js');
      const paths = { mcporterRuntime: shared.mcporter };

      const contextDir = join(root, 'server-context');
      const serverCwd = join(root, 'server-cwd');
      await mkdir(contextDir, { recursive: true });
      await mkdir(serverCwd, { recursive: true });

      // A fully synthetic environment drives the neutralization seam: every
      // credential and DSH key is a test-owned value that must never reach the
      // spawned child. Ambient DEEPSEEK_API_KEY/DSH_API_KEY are never read or
      // mutated, so the probe cannot touch live process credentials.
      const syntheticEnv: Record<string, string> = {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        HOME: join(root, 'synthetic-home'),
        TMPDIR: process.env.TMPDIR ?? tmpdir(),
        DEEPSEEK_API_KEY: 'synthetic-secret-never-shared',
        DSH_API_KEY: 'synthetic-dsh-secret-never-shared',
        NPM_TOKEN: 'synthetic-npm-token-never-shared',
        DSH_HOME: join(root, 'synthetic-dsh-home'),
        DSH_RPGMAKER_PROGRAM_ROOT: join(root, 'synthetic-program'),
        DSH_RPGMAKER_MCPORTER_RUNTIME: join(root, 'synthetic-runtime')
      };

      host.resetHostState();
      try {
        // One single-flight Runtime: concurrent creation returns one object.
        const [runtimeA, runtimeB] = await Promise.all([host.getHostRuntime(paths), host.getHostRuntime(paths)]);
        expect(runtimeA).toBe(runtimeB);
        const runtime = runtimeA as { listServers: () => string[] };
        expect(runtime.listServers()).toEqual([]);

        // Dynamic stdio registration with explicit argv/cwd/neutralized env.
        const canonical = resolve(join(root, 'workspace-probe'));
        const definition = {
          name: 'rpgmaker-ws-probe',
          command: { kind: 'stdio', command: process.execPath, args: [FIXTURE_SERVER, '--context', contextDir], cwd: serverCwd },
          env: env.neutralizedServerEnv(syntheticEnv) as Record<string, string>
        };
        // The definition env covers every synthetic key, so mcporter's
        // {...process.env, ...overrides} merge cannot carry an original value;
        // every present credential/DSH key is overridden with the marker.
        for (const key of Object.keys(syntheticEnv)) {
          expect(Object.prototype.hasOwnProperty.call(definition.env, key)).toBe(true);
        }
        for (const key of Object.keys(syntheticEnv).filter((candidate) => candidate.startsWith('DSH_'))) {
          expect(definition.env[key]).toBe(env.SECRET_MARKER);
        }
        for (const key of ['DEEPSEEK_API_KEY', 'DSH_API_KEY', 'NPM_TOKEN']) {
          expect(definition.env[key]).toBe(env.SECRET_MARKER);
          expect(definition.env[key]).not.toBe(syntheticEnv[key]);
        }

        // Single-flight per-workspace acquisition: registration + listing once.
        const [acquiredA, acquiredB] = await Promise.all([
          host.acquireWorkspaceServer(paths, 'mv', canonical, definition),
          host.acquireWorkspaceServer(paths, 'mv', canonical, definition)
        ]);
        expect(acquiredA).toBe(acquiredB);
        expect(runtime.listServers()).toEqual(['rpgmaker-ws-probe']);
        expect(acquiredA.tools.map((tool) => tool.name)).toEqual([
          'echo', 'shared_state', 'error_tool', 'slow_tool', 'dump_context', 'update_record'
        ]);
        const echoSchema = acquiredA.tools.find((tool) => tool.name === 'echo')?.inputSchema as { properties?: Record<string, unknown> };
        expect(echoSchema.properties?.message).toBeDefined();
        expect(await countLines(join(contextDir, 'started.jsonl'))).toBe(1);

        // Pooled calls share one process.
        const call1 = host.canonicalMcpValue(await host.callWorkspaceTool(paths, 'mv', canonical, 'shared_state', {})) as { count: number; pid: number };
        const call2 = host.canonicalMcpValue(await host.callWorkspaceTool(paths, 'mv', canonical, 'shared_state', {})) as { count: number; pid: number };
        expect(call1.count).toBe(1);
        expect(call2.count).toBe(2);
        expect(call2.pid).toBe(call1.pid);
        expect(await countLines(join(contextDir, 'started.jsonl'))).toBe(1);

        // The spawned child observed the exact argv, cwd, and neutralized env.
        await host.callWorkspaceTool(paths, 'mv', canonical, 'dump_context', {});
        const dumped = JSON.parse(await readFile(join(contextDir, 'context.json'), 'utf8')) as { argv: string[]; cwd: string; env: Record<string, string> };
        expect(dumped.argv.slice(1)).toEqual([FIXTURE_SERVER, '--context', contextDir]);
        expect(dumped.cwd).toBe(await realpath(serverCwd));
        // The fixture runtime mirrors mcporter's `{ ...process.env,
        // ...definition.env }` stdio merge, so strict key absence is impossible
        // without a separate broker process. The marker override instead proves
        // no original synthetic (or ambient) secret bytes reach the child: the
        // deterministic dump shows the marker for every credential/DSH key.
        for (const key of ['DEEPSEEK_API_KEY', 'DSH_API_KEY', 'NPM_TOKEN', 'DSH_HOME', 'DSH_RPGMAKER_PROGRAM_ROOT', 'DSH_RPGMAKER_MCPORTER_RUNTIME']) {
          expect(dumped.env[key]).toBe(env.SECRET_MARKER);
          expect(dumped.env[key]).not.toBe(syntheticEnv[key]);
        }
        expect(dumped.env.PATH).toBe(syntheticEnv.PATH);

        // Result normalization and MCP errors as failures.
        const echo = await host.callWorkspaceTool(paths, 'mv', canonical, 'echo', { message: 'hi' });
        expect(echo).toEqual({ content: [{ type: 'text', text: 'hi' }] });
        expect(host.normalizeMcpResult(echo)).toEqual({ text: 'hi', content: [{ type: 'text', text: 'hi' }], structuredContent: null });
        expect(host.canonicalMcpValue(echo)).toBe('hi');
        // MCP error results surface as failures through the normalization layer
        // the tool factory uses, while the raw pooled call resolves with them.
        const errorRaw = await host.callWorkspaceTool(paths, 'mv', canonical, 'error_tool', {});
        expect(() => host.normalizeMcpResult(errorRaw)).toThrow(/boom/);

        // Cancellation containment closes that server (killing its child); the
        // next call reconnects without restarting the Host runtime.
        const controller = new AbortController();
        const slow = host.callWorkspaceTool(paths, 'mv', canonical, 'slow_tool', { ms: 10_000 }, { signal: controller.signal });
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
        controller.abort();
        await expect(slow).rejects.toThrow(/cancelled/);
        const reconnected = await host.callWorkspaceTool(paths, 'mv', canonical, 'echo', { message: 'again' });
        expect(host.canonicalMcpValue(reconnected)).toBe('again');
        expect(await countLines(join(contextDir, 'started.jsonl'))).toBe(2);

        // Per-server close keeps the definition registered; the next call reconnects.
        await host.closeWorkspaceServer(paths, 'mv', canonical);
        expect(runtime.listServers()).toEqual(['rpgmaker-ws-probe']);
        const afterClose = await host.callWorkspaceTool(paths, 'mv', canonical, 'echo', { message: 'x' });
        expect(host.canonicalMcpValue(afterClose)).toBe('x');
        expect(await countLines(join(contextDir, 'started.jsonl'))).toBe(3);

        // Final close: one Runtime and every pooled child are closed.
        await host.closeHost();
        expect(host.hostState().closed).toBe(true);
        expect(host.hostState().workspaces).toEqual([]);
        await expect(host.getHostRuntime(paths)).rejects.toThrow(/closed/);
      } finally {
        await host.closeHost().catch(() => undefined);
        host.resetHostState();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('waits for per-server close before cancelling, removes its listener, and ignores late completion', async () => {
    const shared = await sharedFixtureRuntimes();
    const root = await temp('ws-mcp-cancel-close');
    try {
      const hostModule = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/mcport-host.js')>('mcport-host.js');
      const host = hostModule.createHost();
      const workspace = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/workspace.js')>('workspace.js');
      const paths = { mcporterRuntime: shared.mcporter };
      const affectedContext = join(root, 'affected-context');
      const unaffectedContext = join(root, 'unaffected-context');
      const affectedCwd = join(root, 'affected-cwd');
      const unaffectedCwd = join(root, 'unaffected-cwd');
      const closeGate = join(root, 'close.release');
      const closeTrace = join(root, 'runtime-closes.jsonl');
      const callTrace = join(root, 'calls.jsonl');
      const completeTrace = join(root, 'completed.jsonl');
      await mkdir(affectedContext, { recursive: true });
      await mkdir(unaffectedContext, { recursive: true });
      await mkdir(affectedCwd, { recursive: true });
      await mkdir(unaffectedCwd, { recursive: true });

      const affected = {
        name: 'rpgmaker-cancel-boundary',
        command: { kind: 'stdio' as const, command: process.execPath, args: [FIXTURE_SERVER, '--context', affectedContext], cwd: affectedCwd },
        env: {
          FIXTURE_CLOSE_GATE: closeGate,
          FIXTURE_RUNTIME_CLOSE_TRACE: closeTrace,
          FIXTURE_CALL_TRACE: callTrace,
          FIXTURE_CALL_COMPLETE_TRACE: completeTrace
        }
      };
      const unaffected = {
        name: 'rpgmaker-unaffected-boundary',
        command: { kind: 'stdio' as const, command: process.execPath, args: [FIXTURE_SERVER, '--context', unaffectedContext], cwd: unaffectedCwd },
        env: { FIXTURE_CALL_TRACE: callTrace }
      };

      host.resetHostState();
      try {
        await host.registerServer(paths, affected);
        await host.registerServer(paths, unaffected);
        const signal = new TrackedAbortSignal();
        let settlements = 0;
        const call = host.callServerTool(paths, affected.name, 'slow_tool', { ms: 25 }, { signal: signal as unknown as AbortSignal });
        void call.then(() => { settlements += 1; }, () => { settlements += 1; });
        await waitForFile(callTrace);

        // Abort twice while close is gated. The late tool result may complete,
        // but the cancellation promise must remain pending until close does.
        signal.abort();
        signal.abort();
        await waitForFile(`${closeGate}.entered`);
        expect(settlements).toBe(0);
        await waitForFile(completeTrace);
        expect(settlements).toBe(0);

        // Closing A must not make B unavailable while A's quiescence is pending.
        const unaffectedResult = await host.callServerTool(paths, unaffected.name, 'echo', { message: 'still alive' });
        expect(host.canonicalMcpValue(unaffectedResult)).toBe('still alive');
        const callEvents = (await readFile(callTrace, 'utf8')).trim().split(/\r?\n/).filter(Boolean)
          .map((line) => JSON.parse(line) as { name: string; timeoutMs: number });
        expect(workspace.MCPORTER_CALL_TIMEOUT_MS).toBe(60_000);
        expect(callEvents.find((event) => event.name === affected.name)?.timeoutMs).toBe(workspace.MCPORTER_CALL_TIMEOUT_MS);

        await writeFile(closeGate, 'release\n');
        await expect(call).rejects.toThrow(/^MCP call cancelled$/);
        expect(settlements).toBe(1);
        expect(signal.addCalls).toBe(1);
        expect(signal.removeCalls).toBe(1);
        await waitForFile(closeTrace);
        const closes = (await readFile(closeTrace, 'utf8')).trim().split(/\r?\n/).filter(Boolean)
          .map((line) => JSON.parse(line) as { name: string });
        expect(closes).toEqual([{ name: affected.name }]);
      } finally {
        await host.closeHost().catch(() => undefined);
        host.resetHostState();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('returns cleanup-unconfirmed when cancellation close exceeds its grace', async () => {
    const shared = await sharedFixtureRuntimes();
    const root = await temp('ws-mcp-cancel-timeout');
    try {
      const hostModule = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/mcport-host.js')>('mcport-host.js');
      const host = hostModule.createHost();
      const paths = { mcporterRuntime: shared.mcporter };
      const contextDir = join(root, 'context');
      const serverCwd = join(root, 'cwd');
      const closeGate = join(root, 'close.release');
      const closeTrace = join(root, 'runtime-closes.jsonl');
      const callTrace = join(root, 'calls.jsonl');
      await mkdir(contextDir, { recursive: true });
      await mkdir(serverCwd, { recursive: true });
      const definition = {
        name: 'rpgmaker-cancel-timeout',
        command: { kind: 'stdio' as const, command: process.execPath, args: [FIXTURE_SERVER, '--context', contextDir], cwd: serverCwd },
        env: { FIXTURE_CLOSE_GATE: closeGate, FIXTURE_RUNTIME_CLOSE_TRACE: closeTrace, FIXTURE_CALL_TRACE: callTrace }
      };

      host.resetHostState();
      try {
        await host.registerServer(paths, definition);
        const signal = new TrackedAbortSignal();
        const call = host.callServerTool(paths, definition.name, 'slow_tool', { ms: 10_000 }, { signal: signal as unknown as AbortSignal });
        await waitForFile(callTrace);
        signal.abort();
        await waitForFile(`${closeGate}.entered`);
        await expect(call).rejects.toThrow(/cleanup-unconfirmed.*quiescence/i);
        expect(signal.addCalls).toBe(1);
        expect(signal.removeCalls).toBe(1);

        // The bounded result is already returned, but the later close promise
        // is still contained and can finish without a second settlement.
        await writeFile(closeGate, 'release\n');
        await waitForFile(closeTrace);
        await host.closeHost();
      } finally {
        await writeFile(closeGate, 'release\n').catch(() => undefined);
        await host.closeHost().catch(() => undefined);
        host.resetHostState();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('returns cleanup-unconfirmed when MCPorter close rejects', async () => {
    const shared = await sharedFixtureRuntimes();
    const root = await temp('ws-mcp-cancel-failure');
    try {
      const hostModule = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/mcport-host.js')>('mcport-host.js');
      const host = hostModule.createHost();
      const paths = { mcporterRuntime: shared.mcporter };
      const contextDir = join(root, 'context');
      const serverCwd = join(root, 'cwd');
      const closeTrace = join(root, 'runtime-closes.jsonl');
      const callTrace = join(root, 'calls.jsonl');
      await mkdir(contextDir, { recursive: true });
      await mkdir(serverCwd, { recursive: true });
      const definition = {
        name: 'rpgmaker-cancel-failure',
        command: { kind: 'stdio' as const, command: process.execPath, args: [FIXTURE_SERVER, '--context', contextDir], cwd: serverCwd },
        env: { FIXTURE_CLOSE_FAILURE: '1', FIXTURE_RUNTIME_CLOSE_TRACE: closeTrace, FIXTURE_CALL_TRACE: callTrace }
      };

      host.resetHostState();
      try {
        await host.registerServer(paths, definition);
        const preAborted = new TrackedAbortSignal();
        preAborted.abort();
        const beforeDispatch = host.callServerTool(paths, definition.name, 'echo', { message: 'never sent' }, { signal: preAborted as unknown as AbortSignal });
        await expect(beforeDispatch).rejects.toThrow(/cleanup-unconfirmed.*fixture close failed/i);
        expect(preAborted.addCalls).toBe(0);

        const signal = new TrackedAbortSignal();
        const call = host.callServerTool(paths, definition.name, 'slow_tool', { ms: 10_000 }, { signal: signal as unknown as AbortSignal });
        await waitForFile(callTrace);
        signal.abort();
        await expect(call).rejects.toThrow(/cleanup-unconfirmed.*fixture close failed/i);
        expect(signal.addCalls).toBe(1);
        expect(signal.removeCalls).toBe(1);
        await waitForFile(closeTrace);
        await host.closeHost();
      } finally {
        await host.closeHost().catch(() => undefined);
        host.resetHostState();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('closes a child created after Host shutdown starts', async () => {
    const shared = await sharedFixtureRuntimes();
    const root = await temp('ws-mcp-shutdown-race');
    try {
      const hostModule = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/mcport-host.js')>('mcport-host.js');
      const host = hostModule.createHost();
      const contextDir = join(root, 'server-context');
      const serverCwd = join(root, 'server-cwd');
      const gate = join(root, 'list-tools.release');
      const closeTrace = join(root, 'runtime-closes.jsonl');
      const stopTrace = join(root, 'stopped.jsonl');
      await mkdir(contextDir, { recursive: true });
      await mkdir(serverCwd, { recursive: true });

      const paths = { mcporterRuntime: shared.mcporter };
      const canonical = resolve(join(root, 'workspace-race'));
      const definition = {
        name: 'rpgmaker-ws-shutdown-race',
        command: { kind: 'stdio', command: process.execPath, args: [FIXTURE_SERVER, '--context', contextDir], cwd: serverCwd },
        env: {
          FIXTURE_LIST_TOOLS_GATE: gate,
          FIXTURE_RUNTIME_CLOSE_TRACE: closeTrace,
          FIXTURE_STOP_TRACE: stopTrace
        }
      };

      host.resetHostState();
      let shutdown: Promise<void> | undefined;
      const acquisition = host.acquireWorkspaceServer(paths, 'mv', canonical, definition);
      try {
        // Hold the fixture immediately before it establishes its child, then
        // prove Host shutdown's first Runtime close has already happened.
        await waitForFile(`${gate}.entered`);
        shutdown = host.closeHost();
        await waitForFile(closeTrace);

        // The gated fixture now establishes a child after Runtime.close(). The
        // acquisition boundary must close that late capability before Host
        // shutdown resolves rather than relying on Runtime.close() to block it.
        await writeFile(gate, 'release\n');
        await expect(acquisition).rejects.toThrow(/closed during workspace server acquisition/);
        await shutdown;

        expect(await countLines(join(contextDir, 'started.jsonl'))).toBe(1);
        expect(await countLines(stopTrace)).toBe(1);
        expect(await countLines(closeTrace)).toBe(2);
        expect(host.hostState().closed).toBe(true);
        expect(host.hostState().workspaces).toEqual([]);
      } finally {
        await writeFile(gate, 'release\n').catch(() => undefined);
        if (shutdown) await shutdown.catch(() => undefined);
        await acquisition.catch(() => undefined);
        host.resetHostState();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('real DSH Agent seam', () => {
  test('does not close Host state during plugin apply before the first Agent initializes', async () => {
    const shared = await sharedFixtureRuntimes();
    const root = await temp('ws-mcp-apply-lifecycle');
    try {
      const project = await makeMvProject(root);
      const hostBundle = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/index.js')>('index.js');
      const agentBundle = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/agent.js')>('agent.js');
      await withBundleEnv(
        { [MCPORTER_RUNTIME_ENV]: shared.mcporter, [RPGMAKER_MCP_RUNTIME_ENV]: shared.rpgmakerRuntime, [JS_RUNNER_ENV]: process.execPath },
        async () => {
          const hostCtx = new HarnessScope('host-apply-lifecycle');
          hostBundle.apply(hostCtx);
          try {
            expect(hostCtx.tools.schemas()).toEqual([]);
            const agent = createComposedAgent(agentBundle, 'apply-lifecycle', { cwd: project, agentPreset: 'rpgmaker' }, hostCtx.root);
            await expect(agent.ctx.assemble()).resolves.toMatchObject({ tools: expect.any(Array) });
          } finally {
            await hostCtx.dispose();
          }
        }
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('isolates Host generations and makes duplicate shutdown ownership idempotent', async () => {
    const shared = await sharedFixtureRuntimes();
    const root = await temp('ws-mcp-host-generations');
    try {
      const project = await makeMvProject(root, 'Host generations');
      const canonical = await realpath(project);
      const tracePath = join(root, 'xerolo-starts.jsonl');
      await writeFile(tracePath, '');
      const hostBundle = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/index.js')>('index.js');
      const agentBundle = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/agent.js')>('agent.js');
      await withBundleEnv(
        {
          [MCPORTER_RUNTIME_ENV]: shared.mcporter,
          [RPGMAKER_MCP_RUNTIME_ENV]: shared.rpgmakerRuntime,
          [JS_RUNNER_ENV]: process.execPath,
          XEROLO_FIXTURE_TRACE: tracePath
        },
        async () => {
          const oldRoot = {};
          const newRoot = {};
          const oldCtx = new HarnessScope('host-generation-old', undefined, oldRoot);
          const newCtx = new HarnessScope('host-generation-new', undefined, newRoot);
          try {
            hostBundle.apply(oldCtx);
            const oldAgent = createComposedAgent(agentBundle, 'host-generation-old-agent', { cwd: project, agentPreset: 'rpgmaker' }, oldRoot);
            await oldAgent.ctx.assemble();

            hostBundle.apply(newCtx);
            const newAgent = createComposedAgent(agentBundle, 'host-generation-new-agent', { cwd: project, agentPreset: 'rpgmaker' }, newRoot);
            await newAgent.ctx.assemble();

            const starts = (await readFile(tracePath, 'utf8')).trim().split(/\r?\n/).filter(Boolean)
              .map((line) => JSON.parse(line) as { projectRoot: string; pid: number });
            expect(starts).toHaveLength(2);
            expect(starts.map((entry) => entry.projectRoot)).toEqual([canonical, canonical]);
            expect(new Set(starts.map((entry) => entry.pid)).size).toBe(2);
            expect(hostBundle.hostState(oldCtx).closed).toBe(false);
            expect(hostBundle.hostState(newCtx).closed).toBe(false);

            const oldDisposal = oldCtx.dispose();
            const duplicateOldDisposal = oldCtx.dispose();
            await Promise.all([oldDisposal, duplicateOldDisposal]);
            expect(hostBundle.hostState(oldCtx).closed).toBe(true);
            expect(hostBundle.hostState(newCtx).closed).toBe(false);
            const info = await executeAgentTool(newAgent, 'rpgmaker_get_project_info', {}) as { gameTitle: string };
            expect(info.gameTitle).toBe('Host generations');

            const newDisposal = newCtx.dispose();
            const duplicateNewDisposal = newCtx.dispose();
            await Promise.all([newDisposal, duplicateNewDisposal]);
            expect(hostBundle.hostState(newCtx).closed).toBe(true);
          } finally {
            await Promise.resolve(oldCtx.dispose()).catch(() => undefined);
            await Promise.resolve(newCtx.dispose()).catch(() => undefined);
          }
        }
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('first prompt assembly waits for discovery, exposes stable rpgmaker_* tools, shares one server, and fails closed', async () => {
    const shared = await sharedFixtureRuntimes();
    const root = await temp('ws-mcp-seam');
    try {
      const project = await makeMvProject(root);
      const canonicalProject = await realpath(project);
      const hostBundle = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/index.js')>('index.js');
      const agentBundle = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/agent.js')>('agent.js');
      const contract = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/contract.js')>('contract.js');
      const expectedNames = contract.XEROLO_TOOL_NAMES.map((name) => `rpgmaker_${name}`).sort();

      await withBundleEnv(
        { [MCPORTER_RUNTIME_ENV]: shared.mcporter, [RPGMAKER_MCP_RUNTIME_ENV]: shared.rpgmakerRuntime, [JS_RUNNER_ENV]: process.execPath },
        async () => {
          const hostCtx = new HarnessScope('host');
          hostBundle.apply(hostCtx);
          try {
            // One valid RPG Maker Agent: its first assembly carries every
            // generated stable tool synchronously (the manifest was registered
            // at the preset composition mount, before DSH's pre-waterfall schema collection)
            // and waits for discovery + live manifest parity, with no workspace
            // hash, session id, or MCP prefix in any name.
            const agentA = createComposedAgent(agentBundle, 'agent-a', { cwd: project, agentPreset: 'rpgmaker' }, hostCtx.root);
            // The row is applied to a preset composition context, not Agent.ctx;
            // the actual Agent arrives later through assembly/tool execution.
            expect((agentA.ctx as unknown as { agent?: unknown }).agent).toBeUndefined();
            const assemblyPromise = agentA.ctx.assemble();
            const infoDefinition = agentA.ctx.tools.get('rpgmaker_get_project_info');
            expect(infoDefinition).toBeDefined();
            expect('timeoutMs' in infoDefinition!).toBe(false);
            // Assembly and the first tool call share one Agent-keyed
            // initialization promise; neither can outrun discovery.
            const [assemblyA, info] = await Promise.all([
              assemblyPromise,
              infoDefinition!.execute({}, { agent: agentA, signal: new AbortController().signal })
            ]) as [Awaited<typeof assemblyPromise>, { gameTitle: string }];
            const namesA = assemblyA.tools.map((tool) => tool.name).sort();
            expect(namesA).toEqual(expectedNames);
            expect(namesA.every((name) => /^rpgmaker_[a-z][a-z0-9_]*$/.test(name))).toBe(true);
            expect(namesA.some((name) => name.includes('-'))).toBe(false);
            expect(namesA.some((name) => /[0-9a-f]{8,}/.test(name))).toBe(false);
            const updateRecord = assemblyA.tools.find((tool) => tool.name === 'rpgmaker_update_record');
            expect(updateRecord?.parameters).toMatchObject({ type: 'object', properties: { type: { type: 'string' } } });
            // Code mode (DSH rc.8 shipped preset): the complete stable tool set
            // must also be carried in the assembly's tools:sdk section, which
            // is the surface the model actually sees before the first request.
            const sdkText = (assemblyA.sections.find((section) => (section as { name?: string })?.name === 'tools:sdk') as { text?: string } | undefined)?.text ?? '';
            expect(expectedNames.every((name) => sdkText.includes(name))).toBe(true);

            expect(info.gameTitle).toBe('Probe Game');

            // A second Agent in the same workspace reuses one pooled server and
            // receives identical stable names; calls share state.
            const agentB = createComposedAgent(agentBundle, 'agent-b', { cwd: project, agentPreset: 'rpgmaker' }, hostCtx.root);
            const assemblyB = await agentB.ctx.assemble();
            expect(assemblyB.tools.map((tool) => tool.name).sort()).toEqual(expectedNames);
            expect(hostBundle.hostState(hostCtx).workspaces).toEqual([canonicalProject]);
            await executeAgentTool(agentA, 'rpgmaker_create_record', { type: 'actors', data: { name: 'Hero' } });
            const records = await executeAgentTool(agentB, 'rpgmaker_list_records', { type: 'actors' }) as Array<{ name: string }>;
            expect(records.some((record) => record.name === 'Hero')).toBe(true);

            // Disposing one Agent removes only its registrations; the pooled
            // server stays warm for the other Agent.
            agentA.ctx.dispose();
            expect(agentA.ctx.tools.schemas()).toEqual([]);
            expect(agentA.ctx.listeners.has('system-prompt/assemble')).toBe(false);
            const stillWarm = await executeAgentTool(agentB, 'rpgmaker_get_project_info', {}) as { gameTitle: string };
            expect(stillWarm.gameTitle).toBe('Probe Game');
            expect(hostBundle.hostState(hostCtx).workspaces).toEqual([canonicalProject]);

            // A non-RPG preset registers neither a server nor RPG Maker tools.
            const agentCode = createHarnessAgent('agent-code', { cwd: project, agentPreset: 'code' }, hostCtx.root);
            const assemblyCode = await agentCode.ctx.assemble();
            expect(assemblyCode.tools.filter((tool) => tool.name.startsWith('rpgmaker_'))).toEqual([]);
            expect(hostBundle.hostState(hostCtx).workspaces).toEqual([canonicalProject]);

            // An invalid workspace registers no server and fails its first
            // request naming the missing project markers, even though its
            // manifest tools were collected synchronously by the access row.
            const emptyWorkspace = join(root, 'empty-workspace');
            await mkdir(emptyWorkspace, { recursive: true });
            const agentInvalid = createComposedAgent(agentBundle, 'agent-invalid', { cwd: emptyWorkspace, agentPreset: 'rpgmaker' }, hostCtx.root);
            expect(agentInvalid.ctx.tools.schemas().map((tool) => tool.name).sort()).toEqual(expectedNames);
            await expect(agentInvalid.ctx.assemble()).rejects.toThrow(/Game\.rpgproject/);
            expect(hostBundle.hostState(hostCtx).workspaces).toEqual([canonicalProject]);

            const partialWorkspace = join(root, 'partial-workspace');
            await mkdir(join(partialWorkspace, 'data'), { recursive: true });
            await writeFile(join(partialWorkspace, 'Game.rpgproject'), '{}\n');
            const agentPartial = createComposedAgent(agentBundle, 'agent-partial', { cwd: partialWorkspace, agentPreset: 'rpgmaker' }, hostCtx.root);
            await expect(agentPartial.ctx.assemble()).rejects.toThrow(/js/);
            expect(hostBundle.hostState(hostCtx).workspaces).toEqual([canonicalProject]);

            // A missing session cwd fails closed before any server is touched.
            const agentNoCwd = createComposedAgent(agentBundle, 'agent-nocwd', { agentPreset: 'rpgmaker' }, hostCtx.root);
            await expect(agentNoCwd.ctx.assemble()).rejects.toThrow(/no workspace cwd/);
            expect(hostBundle.hostState(hostCtx).workspaces).toEqual([canonicalProject]);

            // Host shutdown closes the one MCPorter Runtime and every child.
            await hostCtx.dispose();
            expect(hostBundle.hostState(hostCtx).closed).toBe(true);
          } finally {
            await Promise.resolve(hostCtx.dispose()).catch(() => undefined);
          }
        }
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('isolates two canonical workspaces while all RPG Maker presets share warm servers', async () => {
    const shared = await sharedFixtureRuntimes();
    const root = await temp('ws-mcp-isolation');
    try {
      const projectA = await makeMvProject(root, 'Workspace A', 'workspace-a');
      const projectB = await makeMvProject(root, 'Workspace B', 'workspace-b');
      const canonicalA = await realpath(projectA);
      const canonicalB = await realpath(projectB);
      const tracePath = join(root, 'xerolo-starts.jsonl');
      await writeFile(tracePath, '');
      const hostBundle = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/index.js')>('index.js');
      const agentBundle = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/agent.js')>('agent.js');
      const contract = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/contract.js')>('contract.js');
      const expectedNames = contract.XEROLO_TOOL_NAMES.map((name) => `rpgmaker_${name}`).sort();

      await withBundleEnv(
        {
          [MCPORTER_RUNTIME_ENV]: shared.mcporter,
          [RPGMAKER_MCP_RUNTIME_ENV]: shared.rpgmakerRuntime,
          [JS_RUNNER_ENV]: process.execPath,
          XEROLO_FIXTURE_TRACE: tracePath
        },
        async () => {
          const hostCtx = new HarnessScope('host-isolation');
          hostBundle.apply(hostCtx);
          try {
            // Two RPG Maker Agent sessions intentionally share the same canonical
            // workspace server.
            const agentsA = [0, 1].map((index) => createComposedAgent(agentBundle, `workspace-a-${index}`, {
              cwd: projectA,
              agentPreset: 'rpgmaker'
            }, hostCtx.root));
            const agentB = createComposedAgent(agentBundle, 'workspace-b', { cwd: projectB, agentPreset: 'rpgmaker' }, hostCtx.root);

            const [assembliesA, assemblyB] = await Promise.all([
              Promise.all(agentsA.map((agent) => agent.ctx.assemble())),
              agentB.ctx.assemble()
            ]);
            for (const assembly of assembliesA) expect(assembly.tools.map((tool) => tool.name).sort()).toEqual(expectedNames);
            expect(assemblyB.tools.map((tool) => tool.name).sort()).toEqual(expectedNames);
            expect(hostBundle.hostState(hostCtx).workspaces.sort()).toEqual([canonicalA, canonicalB].sort());

            // The trace is a child-process observation at the real Agent seam:
            // concurrent Agents in A start one pooled child, and B starts one
            // different child with its own project root.
            const starts = (await readFile(tracePath, 'utf8')).trim().split(/\r?\n/).filter(Boolean)
              .map((line) => JSON.parse(line) as { projectRoot: string; pid: number });
            expect(starts).toHaveLength(2);
            expect(starts.map((entry) => entry.projectRoot).sort()).toEqual([canonicalA, canonicalB].sort());
            expect(new Set(starts.map((entry) => entry.pid)).size).toBe(2);

            // Calls through different Agents in A share state, while B's
            // separate process has no access to A's in-memory state or files.
            await executeAgentTool(agentsA[0], 'rpgmaker_create_record', { type: 'actors', data: { name: 'Hero A' } });
            const recordsA = await executeAgentTool(agentsA[1], 'rpgmaker_list_records', { type: 'actors' }) as Array<{ name: string }>;
            const recordsB = await executeAgentTool(agentB, 'rpgmaker_list_records', { type: 'actors' }) as Array<{ name: string }>;
            expect(recordsA.some((record) => record.name === 'Hero A')).toBe(true);
            expect(recordsB).toEqual([]);

            await executeAgentTool(agentsA[1], 'rpgmaker_update_system', { data: { gameTitle: 'Workspace A changed' } });
            const infoA = await executeAgentTool(agentsA[1], 'rpgmaker_get_project_info', {}) as { gameTitle: string };
            const infoB = await executeAgentTool(agentB, 'rpgmaker_get_project_info', {}) as { gameTitle: string };
            expect(infoA.gameTitle).toBe('Workspace A changed');
            expect(infoB.gameTitle).toBe('Workspace B');

            // Agent disposal removes only that Agent's registrations. The A
            // server stays warm even after A's last Agent leaves, and B stays
            // independently usable throughout.
            agentsA[0].ctx.dispose();
            expect(agentsA[0].ctx.tools.schemas()).toEqual([]);
            const warmA = await executeAgentTool(agentsA[1], 'rpgmaker_get_project_info', {}) as { gameTitle: string };
            expect(warmA.gameTitle).toBe('Workspace A changed');
            for (const agent of agentsA.slice(1)) agent.ctx.dispose();
            expect(hostBundle.hostState(hostCtx).workspaces.sort()).toEqual([canonicalA, canonicalB].sort());
            const agentAAfterLast = createComposedAgent(agentBundle, 'workspace-a-after-last', { cwd: join(projectA, '.'), agentPreset: 'rpgmaker' }, hostCtx.root);
            const assemblyAAfterLast = await agentAAfterLast.ctx.assemble();
            expect(assemblyAAfterLast.tools.map((tool) => tool.name).sort()).toEqual(expectedNames);
            const warmAfterLast = await executeAgentTool(agentAAfterLast, 'rpgmaker_get_project_info', {}) as { gameTitle: string };
            expect(warmAfterLast.gameTitle).toBe('Workspace A changed');
            const startsAfterLast = (await readFile(tracePath, 'utf8')).trim().split(/\r?\n/).filter(Boolean);
            expect(startsAfterLast).toHaveLength(2);
            agentAAfterLast.ctx.dispose();
            const warmB = await executeAgentTool(agentB, 'rpgmaker_get_project_info', {}) as { gameTitle: string };
            expect(warmB.gameTitle).toBe('Workspace B');

            await hostCtx.dispose();
            expect(hostBundle.hostState(hostCtx).closed).toBe(true);
            expect(hostBundle.hostState(hostCtx).workspaces).toEqual([]);
          } finally {
            await Promise.resolve(hostCtx.dispose()).catch(() => undefined);
          }
        }
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('contains one pooled workspace failure without affecting another workspace or restarting it', async () => {
    const shared = await sharedFixtureRuntimes();
    const root = await temp('ws-mcp-failure-containment');
    try {
      const failedProject = await makeMvProject(root, 'Failed workspace', 'failed-workspace');
      const healthyProject = await makeMvProject(root, 'Healthy workspace', 'healthy-workspace');
      const canonicalFailed = await realpath(failedProject);
      const canonicalHealthy = await realpath(healthyProject);
      const tracePath = join(root, 'xerolo-starts.jsonl');
      await writeFile(tracePath, '');
      const hostBundle = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/index.js')>('index.js');
      const agentBundle = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/agent.js')>('agent.js');
      const contract = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/contract.js')>('contract.js');
      const expectedNames = contract.XEROLO_TOOL_NAMES.map((name) => `rpgmaker_${name}`).sort();

      await withBundleEnv(
        {
          [MCPORTER_RUNTIME_ENV]: shared.mcporter,
          [RPGMAKER_MCP_RUNTIME_ENV]: shared.rpgmakerRuntime,
          [JS_RUNNER_ENV]: process.execPath,
          XEROLO_FIXTURE_TRACE: tracePath,
          XEROLO_FIXTURE_FAIL_PROJECT: canonicalFailed
        },
        async () => {
          const hostCtx = new HarnessScope('host-failure-containment');
          hostBundle.apply(hostCtx);
          try {
            const failedAgent = createComposedAgent(agentBundle, 'failed-agent', { cwd: failedProject, agentPreset: 'rpgmaker' }, hostCtx.root);
            const healthyAgent = createComposedAgent(agentBundle, 'healthy-agent', { cwd: healthyProject, agentPreset: 'rpgmaker' }, hostCtx.root);

            // Manifest tools remain synchronously present for the failed Agent,
            // but its first request fails closed when the live server drifts.
            expect(failedAgent.ctx.tools.schemas().map((tool) => tool.name).sort()).toEqual(expectedNames);
            const failedExpectation = expect(failedAgent.ctx.assemble()).rejects.toThrow(/tools\/list returned no tools/);
            const healthyAssembly = await healthyAgent.ctx.assemble();
            await failedExpectation;
            expect(healthyAssembly.tools.map((tool) => tool.name).sort()).toEqual(expectedNames);
            expect(hostBundle.hostState(hostCtx).workspaces.sort()).toEqual([canonicalFailed, canonicalHealthy].sort());

            const healthyInfo = await executeAgentTool(healthyAgent, 'rpgmaker_get_project_info', {}) as { gameTitle: string };
            expect(healthyInfo.gameTitle).toBe('Healthy workspace');

            // A failed acquisition is cached for this Host generation: a later
            // Agent observes the same failure, with no automatic Xerolo restart.
            const retryAgent = createComposedAgent(agentBundle, 'failed-retry', { cwd: failedProject, agentPreset: 'rpgmaker' }, hostCtx.root);
            expect(retryAgent.ctx.tools.schemas().map((tool) => tool.name).sort()).toEqual(expectedNames);
            await expect(retryAgent.ctx.assemble()).rejects.toThrow(/tools\/list returned no tools/);
            const starts = (await readFile(tracePath, 'utf8')).trim().split(/\r?\n/).filter(Boolean)
              .map((line) => JSON.parse(line) as { projectRoot: string; pid: number });
            expect(starts).toHaveLength(2);
            expect(starts.map((entry) => entry.projectRoot).sort()).toEqual([canonicalFailed, canonicalHealthy].sort());

            failedAgent.ctx.dispose();
            retryAgent.ctx.dispose();
            const stillHealthy = await executeAgentTool(healthyAgent, 'rpgmaker_get_project_info', {}) as { gameTitle: string };
            expect(stillHealthy.gameTitle).toBe('Healthy workspace');

            await hostCtx.dispose();
            expect(hostBundle.hostState(hostCtx).closed).toBe(true);
          } finally {
            await Promise.resolve(hostCtx.dispose()).catch(() => undefined);
          }
        }
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('activates without logger and emits optional lifecycle logs when logger is present', async () => {
    const shared = await sharedFixtureRuntimes();
    const root = await temp('ws-mcp-optional-logger');
    try {
      const project = await makeMvProject(root);
      const hostBundle = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/index.js')>('index.js');
      const agentBundle = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/agent.js')>('agent.js');
      const contract = await bundleModule<typeof import('../bundle/dsh-workspace-mcp/lib/contract.js')>('contract.js');
      const expectedNames = contract.XEROLO_TOOL_NAMES.map((name) => `rpgmaker_${name}`).sort();

      expect(hostBundle.inject).toEqual([]);
      expect(agentBundle.inject).toEqual(['tools']);
      await withBundleEnv(
        { [MCPORTER_RUNTIME_ENV]: shared.mcporter, [RPGMAKER_MCP_RUNTIME_ENV]: shared.rpgmakerRuntime, [JS_RUNNER_ENV]: process.execPath },
        async () => {
          const noLoggerScope = new HarnessScope('host-without-logger');
          try {
            hostBundle.apply(noLoggerScope);
            const noLoggerAgent = createHarnessAgent('without-logger', { cwd: project, agentPreset: 'rpgmaker' }, noLoggerScope.root);
            const noLoggerCtx = {
              root: noLoggerScope.root,
              agent: noLoggerAgent,
              tools: noLoggerAgent.ctx.tools,
              on: noLoggerAgent.ctx.on.bind(noLoggerAgent.ctx)
            };
            agentBundle.apply(noLoggerCtx);
            const noLoggerAssembly = await noLoggerAgent.ctx.assemble();
            expect(noLoggerAssembly.tools.map((tool) => tool.name).sort()).toEqual(expectedNames);
            noLoggerAgent.ctx.dispose();
          } finally {
            await noLoggerScope.dispose();
          }

          const logs: unknown[][] = [];
          const loggerScope = new HarnessScope('host-with-logger', {
            info: (...args) => logs.push(args),
            error: (...args) => logs.push(['error', ...args])
          });
          try {
            hostBundle.apply(loggerScope);
            const loggerAgent = createHarnessAgent(
              'with-logger',
              { cwd: project, agentPreset: 'rpgmaker' },
              loggerScope.root,
              {
                info: (...args) => logs.push(args),
                error: (...args) => logs.push(['error', ...args])
              }
            );
            agentBundle.apply(loggerAgent.ctx);
            const loggerAssembly = await loggerAgent.ctx.assemble();
            expect(loggerAssembly.tools.map((tool) => tool.name).sort()).toEqual(expectedNames);
            expect(logs).toContainEqual([
              'dsh-workspace-mcp synchronously registered %d manifest tools',
              expectedNames.length
            ]);
            expect(logs.some((args) => (
              args[0] === 'dsh-workspace-mcp initialized workspace server %s (%d tools matched the pinned manifest)'
              && args[2] === expectedNames.length
            ))).toBe(true);
            loggerAgent.ctx.dispose();
          } finally {
            await loggerScope.dispose();
          }
        }
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
