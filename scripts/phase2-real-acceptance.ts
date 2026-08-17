import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { strict as assert } from 'node:assert';

import { findDshExecutable } from '../src/bootstrap';
import { prepareRpgMakerDeployment } from '../src/rpgmaker';
import { createRpgMakerEditingLoop } from '../src/mcp-loop';
import { prepareProcessInvocation, terminateProcessTree, runCommand } from '../src/process';

const DATABASE_TYPES = ['Actors', 'Classes', 'Skills', 'Items', 'Weapons', 'Armors', 'Enemies', 'Troops', 'States', 'Animations', 'Tilesets', 'CommonEvents'];

function json(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

async function makeFixture(root: string): Promise<string> {
  const project = join(root, '选择 project with spaces');
  await mkdir(join(project, 'data'), { recursive: true });
  await mkdir(join(project, 'js', 'plugins'), { recursive: true });
  await writeFile(join(project, 'Game.rpgproject'), '{}\n');
  await writeFile(join(project, 'data', 'System.json'), json({ gameTitle: 'Real Phase 2 Probe', startMapId: 1, switches: [null], variables: [null] }));
  for (const type of DATABASE_TYPES) await writeFile(join(project, 'data', `${type}.json`), type === 'Actors' ? json([null, { id: 1, name: 'Hero' }]) : '[null]\n');
  await writeFile(join(project, 'data', 'MapInfos.json'), json([null, { id: 1, name: 'Start', parentId: 0, order: 1, expanded: false }]));
  await writeFile(join(project, 'data', 'Map001.json'), json({ displayName: 'Start', width: 17, height: 13, data: new Array(17 * 13 * 6).fill(0), events: [null, { id: 1, name: 'Guide', x: 1, y: 1, pages: [{ list: [{ code: 0, indent: 0, parameters: [] }] }] }] }));
  await writeFile(join(project, 'js', 'plugins.js'), 'var $plugins =\n[{"name":"TestPlugin","status":true,"description":"","parameters":{}}\n];\n');
  await writeFile(join(project, 'js', 'plugins', 'TestPlugin.js'), '// phase2 real probe\n');
  return project;
}

class StdioMcpClient {
  private nextId = 1;
  private buffer = '';
  private readonly pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();

  constructor(readonly child: ChildProcess) {
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      this.buffer += chunk;
      let newline = this.buffer.indexOf('\n');
      while (newline >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (line) {
          try {
            const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
            if (message.id !== undefined) {
              const waiter = this.pending.get(message.id);
              if (waiter) {
                this.pending.delete(message.id);
                if (message.error) waiter.reject(new Error(message.error.message ?? 'MCP error'));
                else waiter.resolve(message.result);
              }
            }
          } catch {
            // Ignore non-JSON diagnostics on stdout; the response IDs remain authoritative.
          }
        }
        newline = this.buffer.indexOf('\n');
      }
    });
    child.once('error', (error) => {
      for (const waiter of this.pending.values()) waiter.reject(error);
      this.pending.clear();
    });
  }

  send(message: Record<string, unknown>): void {
    this.child.stdin?.write(`${JSON.stringify(message)}\n`);
  }

  request(method: string, params: Record<string, unknown>): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  async close(platform: string, cwd: string): Promise<void> {
    this.child.stdin?.end();
    if (this.child.exitCode === null && this.child.signalCode === null) await terminateProcessTree(this.child, { cwd, platform });
  }
}

function mcpText(result: any): any {
  const text = result?.content?.find((block: any) => block?.type === 'text')?.text;
  if (typeof text !== 'string') return result;
  try { return JSON.parse(text); } catch { return text; }
}

const root = await mkdtemp(join(tmpdir(), 'dsh-rpgmaker-phase2-real-'));
const safeEnv = { ...process.env };
delete safeEnv.DEEPSEEK_API_KEY;
delete safeEnv.DSH_API_KEY;
try {
  const project = await makeFixture(root);
  const runtime = join(root, 'runtime');
  await mkdir(runtime, { recursive: true });
  const install = await runCommand('bun', ['init', '-y'], { cwd: runtime, env: safeEnv, timeoutMs: 60_000 });
  if (install.exitCode !== 0) throw new Error(install.stderr);
  const add = await runCommand('bun', ['add', '--exact', '@deepseek-ai/dsh@0.1.0-rc.6', '@xerolo44/rpgmaker-mv-mcp@0.1.0'], { cwd: runtime, env: safeEnv, timeoutMs: 15 * 60_000 });
  if (add.exitCode !== 0) throw new Error(add.stderr || add.stdout);
  const trust = await runCommand('bun', ['pm', 'trust', '--all'], { cwd: runtime, env: safeEnv, timeoutMs: 15 * 60_000 });
  if (trust.exitCode !== 0) throw new Error(trust.stderr || trust.stdout);
  const platform = process.platform;
  const dsh = await findDshExecutable(runtime, platform);
  if (!dsh) throw new Error('real DSH executable not found after Bun install');
  const deployment = await prepareRpgMakerDeployment({
    platform,
    dshHome: join(root, 'dsh-home'),
    runtimeDir: runtime,
    mcpRuntimeDir: runtime,
    dshExecutable: dsh,
    env: safeEnv,
    projectPath: project,
    sourceRoot: join(process.cwd(), 'presets', 'rpgmaker')
  });
  assert.equal(deployment.mcpPackageVersion, '0.1.0');
  assert.equal(deployment.toolNames.length, 41);

  const invocation = prepareProcessInvocation(deployment.mcpExecutable, ['--project', project], platform, {});
  const child = spawn(invocation.command, invocation.args, { cwd: project, env: safeEnv, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const client = new StdioMcpClient(child);
  await client.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'phase2-real-probe', version: '1.0.0' } });
  client.send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  const listed = await client.request('tools/list', {});
  assert.equal(listed.tools.length, 41);
  const loop = await createRpgMakerEditingLoop(project, async (tool, args) => client.request('tools/call', { name: tool, arguments: args }));
  const mutation = await loop.updateDatabaseRecord('actors', 1, { name: 'Updated Hero' });
  const reread = mcpText(mutation.reread);
  assert.equal(reread.name, 'Updated Hero');
  const backups = mcpText(await loop.listBackups());
  assert.ok(Array.isArray(backups) && backups.length > 0, 'real MCP did not create a backup');
  await loop.restoreBackup(backups[0].session);
  const restored = mcpText(await loop.getDatabaseRecord('actors', 1));
  assert.equal(restored.name, 'Hero');
  await client.close(platform, project);
  console.log(JSON.stringify({ ok: true, tools: listed.tools.length, mutation: reread.name, restored: restored.name, composition: deployment.compositionPath }));
} finally {
  await rm(root, { recursive: true, force: true });
}
