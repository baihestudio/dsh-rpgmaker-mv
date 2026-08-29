#!/usr/bin/env bun
/**
 * Regenerate the pinned Xerolo manifest for the workspace MCP bundle.
 *
 * The manifest is machine-generated from the exact-pinned package's own
 * `tools/list` response (the same JSON MCP clients observe), never hand-edited.
 * It is tied mechanically to the package pin: the generator imports
 * RPGMAKER_MV_MCP_PACKAGE / RPGMAKER_MV_MCP_VERSION from src/rpgmaker.ts, installs
 * that exact version into a disposable directory, asks the real server for its
 * tool list, and then:
 *
 *   1. writes bundle/dsh-workspace-mcp/lib/xerolo-manifest.js,
 *   2. recomputes and patches XEROLO_MANIFEST_SHA256 in the bundle contract,
 *   3. machine-validates the regenerated manifest through the bundle's own
 *      verifyManifest() and validateDiscoveredTools(),
 *
 * Run `bun run scripts/generate-xerolo-manifest.ts` only when the pinned Xerolo
 * version changes or a verified upstream tool contract update must be absorbed.
 * It uses a disposable project and temporary install directory and touches no
 * live DSH state.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { spawn } from 'node:child_process';

import { redactSensitive, withoutCredentials } from '../src/process';
import { RPGMAKER_MV_MCP_PACKAGE, RPGMAKER_MV_MCP_VERSION } from '../src/rpgmaker';

const BUNDLE_LIB = join(import.meta.dir, '..', 'bundle', 'dsh-workspace-mcp', 'lib');
const MANIFEST_MODULE = join(BUNDLE_LIB, 'xerolo-manifest.js');
const CONTRACT_MODULE = join(BUNDLE_LIB, 'contract.js');
const EXPECTED_TOOL_COUNT = 41;

interface XeroloTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

function diagnosticText(error: unknown): string {
  return redactSensitive(error instanceof Error ? error.message : String(error), process.env);
}

function fail(message: string): never {
  console.error(`generate-xerolo-manifest: ${diagnosticText(message)}`);
  process.exit(1);
}

/** Ambient env minus model credentials; subprocesses must never inherit them. */
function scrubbedEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(withoutCredentials(process.env)).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}

async function runBun(args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env: scrubbedEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', (error) => reject(new Error(diagnosticText(error))));
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const output = [stderr, stdout].filter(Boolean).join('\n').trim();
      reject(new Error(diagnosticText(`bun ${args.join(' ')} exited with ${signal ? `signal ${signal}` : `code ${code}`}${output ? `: ${output}` : ''}`)));
    });
  });
}

/** Ask the pinned server for its complete tools/list over stdio. */
async function discoverTools(entry: string, projectRoot: string): Promise<XeroloTool[]> {
  const child = spawn(process.execPath, [entry, '--project', projectRoot], {
    env: scrubbedEnv(),
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let buffer = '';
  let stderr = '';
  let requestId = 0;
  let closed = false;
  const pending = new Map<string, { resolve: (message: unknown) => void; reject: (error: Error) => void }>();
  const exited = new Promise<void>((resolve) => child.once('close', () => resolve()));
  const exitError = (code: number | null, signal: NodeJS.Signals | null): Error => {
    const output = stderr.trim();
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    return new Error(diagnosticText(`pinned Xerolo server exited with ${reason}${output ? `: ${output}` : ''}`));
  };
  const rejectPending = (error: Error): void => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    let newline: number;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message: { id?: unknown };
      try {
        message = JSON.parse(line) as { id?: unknown };
      } catch {
        continue;
      }
      if (message.id !== undefined) {
        const request = pending.get(String(message.id));
        if (request) {
          pending.delete(String(message.id));
          request.resolve(message);
        }
      }
    }
  });
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  child.once('error', (error) => {
    closed = true;
    rejectPending(new Error(diagnosticText(error)));
  });
  child.once('close', (code, signal) => {
    closed = true;
    if (pending.size > 0) rejectPending(exitError(code, signal));
  });
  const send = (method: string, params: Record<string, unknown>): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(exitError(child.exitCode, child.signalCode));
        return;
      }
      const id = String(++requestId);
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, (error) => {
        if (error) {
          pending.delete(id);
          reject(new Error(diagnosticText(error)));
        }
      });
    });
  try {
    await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'dsh-workspace-mcp-generator', version: '0.0.0' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const list = (await send('tools/list', {})) as { result?: { tools?: XeroloTool[] } };
    const tools = list.result?.tools;
    if (!Array.isArray(tools)) fail('tools/list returned no tool array');
    return tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  } catch (error) {
    throw new Error(diagnosticText(`Xerolo tools/list failed: ${diagnosticText(error)}${stderr.trim() ? `: ${diagnosticText(stderr.trim())}` : ''}`));
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  }
}

async function main(): Promise<void> {
  const pin = { package: RPGMAKER_MV_MCP_PACKAGE, version: RPGMAKER_MV_MCP_VERSION };
  console.log(`generate-xerolo-manifest: pin ${pin.package}@${pin.version}`);
  if (pin.package !== '@xerolo44/rpgmaker-mv-mcp') fail(`unexpected pin package ${pin.package}`);

  const root = await mkdtemp(join(tmpdir(), 'xerolo-manifest-'));
  try {
    const project = join(root, 'project');
    await mkdir(join(project, 'data'), { recursive: true });
    await mkdir(join(project, 'js'), { recursive: true });
    await writeFile(join(project, 'Game.rpgproject'), '{}\n');

    await writeFile(join(root, 'package.json'), `${JSON.stringify({ name: 'xerolo-manifest-generator', private: true, dependencies: { [pin.package]: pin.version } }, null, 2)}\n`);
    await runBun(['add', '--exact', '--ignore-scripts', `${pin.package}@${pin.version}`], root);

    const entry = join(root, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp', 'dist', 'index.js');
    const tools = await discoverTools(entry, project);

    const names = tools.map((tool) => tool.name);
    const unique = new Set(names);
    if (names.length !== EXPECTED_TOOL_COUNT) {
      fail(`pinned ${pin.package}@${pin.version} advertises ${names.length} tools, expected ${EXPECTED_TOOL_COUNT}; update the pin and this generator deliberately`);
    }
    if (unique.size !== names.length) {
      fail(`tools/list returned duplicate tool names: ${names.filter((name, index) => names.indexOf(name) !== index).join(', ')}`);
    }
    for (const tool of tools) {
      if (typeof tool.name !== 'string' || tool.name.length === 0) fail('tools/list returned a tool without a name');
      if (typeof tool.description !== 'string') fail(`tool ${tool.name} has no description`);
    }

    const manifest = { package: pin.package, version: pin.version, tools };
    const digest = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');

    const generated = [
      '/**',
      ' * GENERATED FILE — do not edit by hand.',
      ` * Machine-generated from tools/list of ${pin.package}@${pin.version}.`,
      ' * Regenerate with: bun run scripts/generate-xerolo-manifest.ts',
      ' */',
      `export const XEROLO_MANIFEST = ${JSON.stringify(manifest, null, 2)}`,
      ''
    ].join('\n');
    await writeFile(MANIFEST_MODULE, generated);

    // Patch the content-digest pin inside the bundle contract. An idempotent
    // re-run (same package pin, same manifest) leaves the pin unchanged.
    const contractSource = await readFile(CONTRACT_MODULE, 'utf8');
    const patchedContract = contractSource.replace(
      /export const XEROLO_MANIFEST_SHA256 = '[0-9a-f]{64}'/,
      `export const XEROLO_MANIFEST_SHA256 = '${digest}'`
    );
    if (patchedContract === contractSource && !contractSource.includes(`export const XEROLO_MANIFEST_SHA256 = '${digest}'`)) {
      fail('could not locate XEROLO_MANIFEST_SHA256 pin in the bundle contract');
    }
    if (patchedContract !== contractSource) await writeFile(CONTRACT_MODULE, patchedContract);

    // Machine-validate through the bundle's own verification surface.
    const contract = await import(pathToFileURL(CONTRACT_MODULE).href);
    const verified = contract.verifyManifest();
    if (verified.errors.length > 0) fail(`regenerated manifest failed bundle verification: ${verified.errors.join('; ')}`);
    const contractTools = contract.XEROLO_MANIFEST.tools.map((tool: XeroloTool) => ({ name: tool.name, inputSchema: tool.inputSchema }));
    const discovered = contract.validateDiscoveredTools(contractTools);
    if (discovered.errors.length > 0) fail(`regenerated manifest failed live-contract validation: ${discovered.errors.join('; ')}`);

    console.log(`generate-xerolo-manifest: wrote ${MANIFEST_MODULE}`);
    console.log(`generate-xerolo-manifest: XEROLO_MANIFEST_SHA256=${digest}`);
    console.log('generate-xerolo-manifest: machine validation passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
