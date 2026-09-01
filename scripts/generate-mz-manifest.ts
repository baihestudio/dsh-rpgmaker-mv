#!/usr/bin/env bun
/**
 * Regenerate the pinned Redseb MZ manifest from the exact package's live
 * tools/list response. This is an explicit maintainer operation; Agent
 * startup never installs packages or fetches a manifest.
 */
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { redactSensitive, runCommand, withoutCredentials } from '../src/process';
import { RPGMAKER_MZ_MCP_INTEGRITY, RPGMAKER_MZ_MCP_PACKAGE, RPGMAKER_MZ_MCP_VERSION } from '../src/rpgmaker';

const repo = join(import.meta.dir, '..');
const lib = join(repo, 'bundle', 'dsh-workspace-mcp', 'lib');
const manifestPath = join(lib, 'mz-manifest.js');
const contractPath = join(lib, 'contract.js');
const runtimeManifestRoot = join(repo, 'runtime-manifests', 'rpgmaker-mcp');
const expectedToolCount = 119;
const nodeExecutable = process.env.NODE_EXECUTABLE ?? 'node';
const npmExecutable = process.env.NPM_EXECUTABLE ?? (process.platform === 'win32' ? 'npm.cmd' : 'npm');

interface Tool { name: string; description?: string; inputSchema?: unknown; }

function env(): Record<string, string> {
  return Object.fromEntries(Object.entries(withoutCredentials(process.env)).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

async function run(command: string, args: string[], cwd: string): Promise<void> {
  const result = await runCommand(command, args, { cwd, env: env(), platform: process.platform, timeoutMs: 120_000 });
  if (result.exitCode !== 0) {
    throw new Error(redactSensitive(`${command} ${args.join(' ')} exited with code ${result.exitCode}: ${result.stderr || result.stdout}`));
  }
}

async function discover(entry: string, project: string): Promise<Tool[]> {
  const child = spawn(nodeExecutable, [entry], {
    cwd: project,
    env: { ...env(), RPGMAKER_PROJECT_PATH: project },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let buffer = '';
  let stderr = '';
  let nextId = 0;
  let closed = false;
  const pending = new Map<string, (value: unknown) => void>();
  const failures = new Map<string, (error: Error) => void>();
  const exit = new Promise<void>((resolve) => child.once('close', () => resolve()));
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n');
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line) as { id?: unknown };
        if (message.id === undefined) continue;
        const id = String(message.id);
        const resolve = pending.get(id);
        const reject = failures.get(id);
        pending.delete(id);
        failures.delete(id);
        if (resolve) resolve(message);
        else if (reject) reject(new Error(`unexpected response id ${id}`));
      } catch {
        // Servers occasionally write harmless non-JSON diagnostics; stderr is
        // retained for a useful failure if the protocol request never returns.
      }
    }
  });
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  child.once('error', (error) => {
    closed = true;
    for (const reject of failures.values()) reject(error instanceof Error ? error : new Error(String(error)));
    pending.clear();
    failures.clear();
  });
  child.once('close', (code, signal) => {
    closed = true;
    const error = new Error(redactSensitive(`pinned MZ MCP exited with ${signal ? `signal ${signal}` : `code ${code}`}${stderr ? `: ${stderr}` : ''}`));
    for (const reject of failures.values()) reject(error);
    pending.clear();
    failures.clear();
  });
  const send = (method: string, params: Record<string, unknown>): Promise<unknown> => new Promise((resolve, reject) => {
    if (closed) return reject(new Error('pinned MZ MCP closed before tools/list'));
    const id = String(++nextId);
    pending.set(id, resolve);
    failures.set(id, reject);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, (error) => {
      if (!error) return;
      pending.delete(id);
      failures.delete(id);
      reject(error);
    });
  });
  try {
    await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'dsh-workspace-mcp-generator', version: '0.0.0' } });
    child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    const response = await send('tools/list', {}) as { result?: { tools?: Tool[] } };
    if (!Array.isArray(response.result?.tools)) throw new Error('tools/list returned no tool array');
    return response.result.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exit;
  }
}

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'rpgmaker-mz-manifest-'));
  try {
    const project = join(root, 'project');
    await mkdir(join(project, 'data'), { recursive: true });
    await mkdir(join(project, 'js'), { recursive: true });
    await writeFile(join(project, 'game.rmmzproject'), '{}\n');
    await writeFile(join(project, 'data', 'System.json'), '{"gameTitle":"manifest fixture"}\n');
    await cp(join(runtimeManifestRoot, 'package.json'), join(root, 'package.json'));
    await cp(join(runtimeManifestRoot, 'package-lock.json'), join(root, 'package-lock.json'));
    console.log(`generate-mz-manifest: installing the release-owned ${RPGMAKER_MZ_MCP_PACKAGE}@${RPGMAKER_MZ_MCP_VERSION} lock`);
    await run(npmExecutable, ['ci', '--ignore-scripts'], root);
    const entry = join(root, 'node_modules', RPGMAKER_MZ_MCP_PACKAGE, 'dist', 'index.js');
    const tools = await discover(entry, project);
    if (tools.length !== expectedToolCount) throw new Error(`pinned MZ package advertises ${tools.length} tools, expected ${expectedToolCount}`);
    const names = tools.map((tool) => tool.name);
    if (new Set(names).size !== names.length) throw new Error('tools/list returned duplicate MZ tool names');
    if (tools.some((tool) => typeof tool.name !== 'string' || !tool.description)) throw new Error('tools/list returned an MZ tool without a name or description');
    const manifest = { package: RPGMAKER_MZ_MCP_PACKAGE, version: RPGMAKER_MZ_MCP_VERSION, tools };
    const digest = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
    await writeFile(manifestPath, `/**\n * GENERATED FILE — do not edit by hand.\n * Machine-generated from tools/list of ${RPGMAKER_MZ_MCP_PACKAGE}@${RPGMAKER_MZ_MCP_VERSION}.\n * Regenerate with: bun run scripts/generate-mz-manifest.ts\n */\nexport const MZ_MANIFEST = ${JSON.stringify(manifest, null, 2)}\n`);
    const contract = await readFile(contractPath, 'utf8');
    const patchedContract = contract.replace(/export const MZ_MANIFEST_SHA256 = '[0-9a-f]{64}'/, `export const MZ_MANIFEST_SHA256 = '${digest}'`);
    if (patchedContract === contract && !contract.includes(`export const MZ_MANIFEST_SHA256 = '${digest}'`)) throw new Error('could not locate MZ manifest digest pin');
    if (patchedContract !== contract) await writeFile(contractPath, patchedContract);
    const loaded = await import(`${pathToFileURL(contractPath).href}?generated=${Date.now()}`);
    const verification = loaded.verifyManifest('mz');
    if (verification.errors.length > 0) throw new Error(`generated MZ manifest failed verification: ${verification.errors.join('; ')}`);
    console.log(`generate-mz-manifest: MZ_MANIFEST_SHA256=${digest}`);
    console.log(`generate-mz-manifest: npm integrity=${RPGMAKER_MZ_MCP_INTEGRITY}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
