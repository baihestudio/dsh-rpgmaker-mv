import { cp, mkdir, readFile, realpath, rename as fsRename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { findDshExecutable } from './bootstrap';
import { resolveHarnessPaths, type PathOptions } from './config';
import { resolveExecutable } from './executable';
import { commandFailure, prepareProcessInvocation, redactSensitive, runCommand, terminateProcessTree, withoutCredentials, type CommandRunner } from './process';
import { assertValidMvProject, pathExists } from './project';
import { withHarnessOperationLock } from './lock';
import { launchProject, pickProjectDirectory, type LaunchOptions, type LaunchResult } from './launcher';
import { backupIgnoreGuidance, type BackupIgnoreGuidance } from './mcp-loop';

export const RPGMAKER_MCP_PACKAGE = '@xerolo44/rpgmaker-mv-mcp';
export const RPGMAKER_MCP_VERSION = '0.1.0';
export const RPGMAKER_MCP_SERVER_NAME = 'rpgmaker_mv';
export const RPGMAKER_PRESET_ID = 'rpgmaker';
export const RPGMAKER_DSH_PROFILE = 'web';
const PRESET_OWNERSHIP_FILE = '.dsh-rpgmaker-owned.json';

const REQUIRED_MCP_TOOLS = [
  'get_project_info',
  'list_records',
  'get_record',
  'update_record',
  'create_record',
  'create_event',
  'get_event',
  'update_event',
  'add_dialogue',
  'update_map',
  'get_map',
  'configure_plugin',
  'list_plugins',
  'validate_project',
  'list_backups',
  'restore_backup'
] as const;

export interface McpToolDefinition {
  name: string;
  inputSchema?: unknown;
}

export interface McpSchemaProbeRequest {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  platform: string;
}

export interface McpSchemaProbeResult {
  tools: McpToolDefinition[];
}

export type McpSchemaProbe = (request: McpSchemaProbeRequest) => Promise<McpSchemaProbeResult>;

export interface RpgMakerDeploymentOptions extends PathOptions {
  projectPath: string;
  sourceRoot?: string;
  mcpRuntimeDir?: string;
  dshExecutable?: string;
  bunExecutable?: string;
  jsExecutable?: string;
  commandRunner?: CommandRunner;
  schemaProbe?: McpSchemaProbe;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
}

export interface RpgMakerDeployment {
  mcpRuntimeDir: string;
  mcpExecutable: string;
  mcpScript: string;
  mcpArgs: string[];
  mcpPackageVersion: string;
  presetRoot: string;
  presetDir: string;
  codePresetPath: string;
  compositionPath: string;
  toolNames: string[];
  backupGuidance: BackupIgnoreGuidance;
}

export type RpgMakerLaunchOptions = LaunchOptions & Omit<RpgMakerDeploymentOptions, 'projectPath' | 'dshHome' | 'runtimeDir' | 'platform' | 'env' | 'commandRunner' | 'lockTimeoutMs' | 'lockRetryMs'> & {
  sourceRoot?: string;
  mcpRuntimeDir?: string;
  schemaProbe?: McpSchemaProbe;
};

export interface McpVerification {
  valid: boolean;
  errors: string[];
  packageVersion?: string;
  executable?: string;
}

export class RpgMakerStartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RpgMakerStartupError';
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return asRecord(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    return undefined;
  }
}

function packageDirectory(runtimeDir: string): string {
  return join(runtimeDir, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp');
}

async function findMcpScript(runtimeDir: string): Promise<string | undefined> {
  const packageDir = packageDirectory(runtimeDir);
  const packageJson = await readJson(join(packageDir, 'package.json'));
  const bin = packageJson?.bin;
  const bins = asRecord(bin);
  const entry = typeof bin === 'string' ? bin : bins?.['rpgmaker-mv-mcp'] ?? Object.values(bins ?? {}).find((value): value is string => typeof value === 'string');
  if (typeof entry !== 'string' || !/\.(?:c?m?js)$/i.test(entry)) return undefined;
  const candidate = resolve(packageDir, entry);
  if (!(await pathExists(candidate))) return undefined;
  let runtimeRoot: string;
  try {
    runtimeRoot = await realpath(runtimeDir);
    const target = await realpath(candidate);
    const pathFromRoot = relative(runtimeRoot, target);
    if (isAbsolute(pathFromRoot) || pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === '..') return undefined;
  } catch {
    return undefined;
  }
  return candidate;
}


export async function verifyMcpRuntime(runtimeDirInput: string, platform: string = process.platform): Promise<McpVerification> {
  const runtimeDir = resolve(runtimeDirInput);
  const errors: string[] = [];
  const rootPackage = await readJson(join(runtimeDir, 'package.json'));
  const dependencies = asRecord(rootPackage?.dependencies);
  if (dependencies?.[RPGMAKER_MCP_PACKAGE] !== RPGMAKER_MCP_VERSION) errors.push(`MCP dependency ${RPGMAKER_MCP_PACKAGE}@${RPGMAKER_MCP_VERSION} is not pinned`);
  const packageJson = await readJson(join(packageDirectory(runtimeDir), 'package.json'));
  const packageVersion = typeof packageJson?.version === 'string' ? packageJson.version : undefined;
  if (packageVersion !== RPGMAKER_MCP_VERSION) errors.push(`installed MCP version is ${packageVersion ?? 'missing'}, expected ${RPGMAKER_MCP_VERSION}`);
  const executable = await findMcpScript(runtimeDir);
  if (!executable) errors.push('installed RPG Maker MCP JavaScript entry was not found inside the app-owned runtime');
  return { valid: errors.length === 0, errors, packageVersion, executable };
}

async function runRequired(
  runner: CommandRunner,
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string | undefined>,
  label: string
): Promise<void> {
  let result;
  try {
    result = await runner(command, args, { cwd, env, timeoutMs: 15 * 60_000 });
  } catch (error) {
    throw new RpgMakerStartupError(`${label} could not start: ${redactSensitive(error instanceof Error ? error.message : String(error), env)}`);
  }
  if (result.exitCode !== 0) throw new RpgMakerStartupError(commandFailure(command, args, result, env).message);
}

async function installMcpRuntime(options: RpgMakerDeploymentOptions, runtimeDir: string): Promise<McpVerification> {
  const platform = options.platform ?? process.platform;
  const env = withoutCredentials(options.env ?? process.env);
  const runner = options.commandRunner ?? runCommand;
  const bun = options.bunExecutable ?? (options.env ?? process.env).BUN_EXECUTABLE ?? 'bun';
  const current = await verifyMcpRuntime(runtimeDir, platform);
  if (current.valid) return current;

  const parent = dirname(runtimeDir);
  await mkdir(parent, { recursive: true });
  const staging = join(parent, `.${basename(runtimeDir)}.staging-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(staging, { recursive: true });
  await writeFile(join(staging, 'package.json'), `${JSON.stringify({
    name: 'dsh-rpgmaker-mcp-runtime',
    private: true,
    dependencies: { [RPGMAKER_MCP_PACKAGE]: RPGMAKER_MCP_VERSION }
  }, null, 2)}\n`);
  try {
    await runRequired(runner, bun, ['add', '--exact', `${RPGMAKER_MCP_PACKAGE}@${RPGMAKER_MCP_VERSION}`], staging, env, 'RPG Maker MCP installation');
    const staged = await verifyMcpRuntime(staging, platform);
    if (!staged.valid) throw new RpgMakerStartupError(`RPG Maker MCP verification failed: ${staged.errors.join('; ')}`);
    if (await pathExists(runtimeDir)) {
      const rollback = `${runtimeDir}.rollback-${Date.now()}`;
      await fsRename(runtimeDir, rollback);
      try {
        await fsRename(staging, runtimeDir);
      } catch (error) {
        await fsRename(rollback, runtimeDir);
        throw new RpgMakerStartupError(`RPG Maker MCP swap failed; prior runtime restored: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      await fsRename(staging, runtimeDir);
    }
    return await verifyMcpRuntime(runtimeDir, platform);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (error instanceof RpgMakerStartupError) throw error;
    throw new RpgMakerStartupError(`RPG Maker MCP installation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function defaultSourceRoot(): string {
  return fileURLToPath(new URL('../presets/rpgmaker/', import.meta.url));
}

async function findCodeComposition(runtimeDir: string): Promise<string> {
  const candidates = [
    join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets', 'code', 'agent.cordis.yml'),
    join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'apps', 'cli', 'config', 'agent-presets', 'code', 'agent.cordis.yml'),
    join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'config', 'agent-presets', 'code', 'agent.cordis.yml')
  ];
  for (const candidate of candidates) if (await pathExists(candidate)) return candidate;
  throw new RpgMakerStartupError('Pinned DSH Code preset composition was not found; refusing to start a tool-less RPG Maker session.');
}

function yamlSingle(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function renderMcpPatch(mcpRunner: string, mcpScript: string, presetRoot: string): string {
  return `# Generated by dsh-rpgmaker-mv. Paths only; no credentials are stored here.\n- insert:\n    - id: mcp-rpgmaker-mv\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: ${RPGMAKER_MCP_SERVER_NAME}\n        transport: stdio\n        command: ${yamlSingle(mcpRunner)}\n        args: [${yamlSingle(mcpScript)}, '--project', !!js process.cwd()]\n        cwd: !!js process.cwd()\n        toolCallTimeoutMs: 60000\n        failOnStartupError: true\n\n- patch:\n    id: agent-presets\n    config:\n      default: ${RPGMAKER_PRESET_ID}\n      roots:\n        - path: ${yamlSingle(presetRoot)}\n          trust: system\n      includeUserRoot: true\n`;
}


function topLevelIds(composition: string): string[] {
  return [...composition.matchAll(/^- id:\s*([^\s#]+)/gm)].map((match) => match[1]);
}

async function installPreset(sourceRoot: string, dshHome: string, codePresetPath: string): Promise<{ presetRoot: string; presetDir: string }> {
  const source = resolve(sourceRoot);
  const sourceComposition = join(source, 'agent.cordis.yml');
  const metadata = join(source, 'preset.yml');
  if (!(await pathExists(sourceComposition)) || !(await pathExists(metadata))) throw new RpgMakerStartupError(`RPG Maker preset source is incomplete: ${source}`);
  const code = await readFile(codePresetPath, 'utf8');
  const skillFilesystem = "- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'";
  if (!code.includes(skillFilesystem)) throw new RpgMakerStartupError('Pinned DSH Code preset has no skill-filesystem row; refusing to mount an unverified RPG Maker skill.');
  const codeWithSkill = code.includes('customSkillDirs')
    ? code
    : code.replace(skillFilesystem, `${skillFilesystem}\n  config:\n    customSkillDirs:\n      - !!js \"process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))\"`);
  const overlay = await readFile(sourceComposition, 'utf8');
  const overlayRows = overlay.trim();
  const overlayIsEmpty = overlayRows.split(/\r?\n/).filter((line) => !line.trim().startsWith('#')).join('').trim() === '[]';
  const composed = overlayIsEmpty ? `${codeWithSkill.trimEnd()}\n` : `${codeWithSkill.trimEnd()}\n\n${overlayRows}\n`;
  const ids = topLevelIds(composed);
  if (new Set(ids).size !== ids.length) throw new RpgMakerStartupError('RPG Maker preset derived from Code contains duplicate top-level row ids.');
  const presetRoot = join(dshHome, '.agent-presets');
  const presetDir = join(presetRoot, RPGMAKER_PRESET_ID);
  const ownershipPath = join(presetDir, PRESET_OWNERSHIP_FILE);
  await mkdir(presetRoot, { recursive: true });
  if (await pathExists(presetDir)) {
    const ownership = await readJson(ownershipPath);
    if (ownership?.owner !== 'dsh-rpgmaker-mv' || ownership.presetId !== RPGMAKER_PRESET_ID) {
      throw new RpgMakerStartupError(`Refusing to replace unowned preset directory ${presetDir}; move it aside or remove it with user consent.`);
    }
    await rm(presetDir, { recursive: true, force: true });
  }
  await cp(source, presetDir, { recursive: true, force: true });
  await writeFile(join(presetDir, 'agent.cordis.yml'), composed);
  await writeFile(join(presetDir, PRESET_OWNERSHIP_FILE), `${JSON.stringify({ owner: 'dsh-rpgmaker-mv', presetId: RPGMAKER_PRESET_ID, format: 1 })}\n`);
  return { presetRoot, presetDir };
}

function schemaProblem(schema: unknown, at: string): string | undefined {
  const object = asRecord(schema);
  if (!object) return `${at} has no inputSchema object`;
  if (Array.isArray(object.type)) return `${at} uses a type array unsupported by DSH`;
  if (object.nullable === true) return `${at} uses nullable unsupported by DSH`;
  if ('$ref' in object) return `${at} uses $ref unsupported by DSH`;
  if (object.type !== undefined && !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(String(object.type))) return `${at} uses unsupported type ${String(object.type)}`;
  if (object.oneOf !== undefined) {
    if (!Array.isArray(object.oneOf) || object.oneOf.length < 2) return `${at} has an invalid oneOf`;
    for (const [index, branch] of object.oneOf.entries()) {
      const problem = schemaProblem(branch, `${at}.oneOf[${index}]`);
      if (problem) return problem;
    }
  }
  const properties = asRecord(object.properties);
  if (properties) {
    for (const [name, property] of Object.entries(properties)) {
      const problem = schemaProblem(property, `${at}.properties.${name}`);
      if (problem) return problem;
    }
  }
  if (object.items !== undefined) return schemaProblem(object.items, `${at}.items`);
  return undefined;
}

function validateToolSet(tools: McpToolDefinition[]): string[] {
  if (!Array.isArray(tools) || tools.length === 0) return ['tools/list returned no tools'];
  const names = tools.map((tool) => tool?.name).filter((name): name is string => typeof name === 'string' && name.length > 0);
  if (names.length !== tools.length) return ['tools/list returned a tool without a name'];
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicates.length > 0) return [`tools/list returned duplicate tool names: ${[...new Set(duplicates)].join(', ')}`];
  for (const tool of tools) {
    const problem = schemaProblem(tool.inputSchema, `tool ${tool.name}`);
    if (problem) return [problem];
  }
  const missing = REQUIRED_MCP_TOOLS.filter((name) => !names.includes(name));
  return missing.length > 0 ? [`tools/list is missing required RPG Maker tools: ${missing.join(', ')}`] : [];
}

async function defaultSchemaProbe(request: McpSchemaProbeRequest): Promise<McpSchemaProbeResult> {
  const invocation = prepareProcessInvocation(request.command, request.args, request.platform, request.env);
  const child = spawn(invocation.command, invocation.args, {
    cwd: request.cwd,
    env: Object.fromEntries(Object.entries(request.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stderr = '';
  let buffer = '';
  let resolved = false;
  let discoveredTools: McpToolDefinition[] | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const response = new Promise<McpSchemaProbeResult>((resolveResponse, rejectResponse) => {
    const finish = (error?: Error, value?: McpSchemaProbeResult): void => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      error ? rejectResponse(error) : resolveResponse(value!);
    };
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          try {
            const message = JSON.parse(line) as { id?: number; result?: { tools?: McpToolDefinition[]; content?: unknown[] }; error?: { message?: string } };
            if (message.id === 2) {
              if (message.error) finish(new RpgMakerStartupError(`RPG Maker MCP schema discovery failed: ${message.error.message ?? 'unknown MCP error'}`));
              else {
                discoveredTools = message.result?.tools ?? [];
                child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'validate_project', arguments: {} } })}\n`);
              }
            }
            if (message.id === 3) {
              if (message.error) finish(new RpgMakerStartupError(`RPG Maker MCP project validation failed: ${message.error.message ?? 'unknown MCP error'}`));
              else {
                if ((message.result as { isError?: unknown } | undefined)?.isError === true) {
                  finish(new RpgMakerStartupError('RPG Maker MCP project validation returned isError=true'));
                }
                const content = message.result?.content ?? [];
                const text = content.find((block: unknown) => (block as { type?: unknown })?.type === 'text') as { text?: unknown } | undefined;
                let validation: unknown = message.result;
                if (typeof text?.text === 'string') {
                  try { validation = JSON.parse(text.text); } catch { validation = undefined; }
                }
                if (!validation || (validation as { ok?: unknown }).ok !== true) finish(new RpgMakerStartupError(`RPG Maker MCP project validation failed: ${JSON.stringify(validation)}`));
                else finish(undefined, { tools: discoveredTools ?? [] });
              }
            }
          } catch {
            // MCP servers may write human diagnostics to stdout; only JSON-RPC responses matter.
          }
        }
        newline = buffer.indexOf('\n');
      }
    });
    child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', (error) => finish(new RpgMakerStartupError(`RPG Maker MCP failed to start: ${error.message}`)));
    child.once('close', (code) => {
      if (!resolved) finish(new RpgMakerStartupError(`RPG Maker MCP exited during schema discovery with code ${code ?? 1}${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
    });
    timer = setTimeout(() => finish(new RpgMakerStartupError('RPG Maker MCP schema discovery timed out after 10 seconds.')), 10_000);
    child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'dsh-rpgmaker-mv', version: '0.1.0' } } })}\n`);
    child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
    child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
  });
  try {
    return await response;
  } finally {
    child.stdin?.end();
    if (child.exitCode === null && child.signalCode === null) {
      await terminateProcessTree(child, { cwd: request.cwd, env: request.env, platform: request.platform });
    }
  }
}

async function resolveMcpRunner(options: RpgMakerDeploymentOptions, platform: string, env: Record<string, string | undefined>): Promise<string> {
  const candidate = options.jsExecutable ?? options.bunExecutable ?? env.BUN_EXECUTABLE;
  if (candidate && !/\.(?:cmd|bat|ps1)$/i.test(candidate)) {
    return await resolveExecutable(candidate, { platform, env }) ?? candidate;
  }
  return await resolveExecutable('bun', { platform, env }) ?? await resolveExecutable('node', { platform, env }) ?? 'bun';
}

async function prepareUnlocked(options: RpgMakerDeploymentOptions, projectPath: string): Promise<RpgMakerDeployment> {
  const paths = resolveHarnessPaths(options);
  const platform = options.platform ?? process.platform;
  const mcpRuntimeDir = resolve(options.mcpRuntimeDir ?? join(paths.dshHome, 'rpgmaker-mv', 'mcp-runtime'));
  const mcp = await installMcpRuntime(options, mcpRuntimeDir);
  if (!mcp.valid || !mcp.executable || !mcp.packageVersion) throw new RpgMakerStartupError(`RPG Maker MCP is not usable: ${mcp.errors.join('; ')}`);
  const env = withoutCredentials(options.env ?? process.env);
  const mcpRunner = await resolveMcpRunner(options, platform, env);
  const mcpArgs = [mcp.executable!, '--project', projectPath];
  const probe = options.schemaProbe ?? defaultSchemaProbe;
  let discovered: McpSchemaProbeResult;
  try {
    discovered = await probe({ command: mcpRunner, args: mcpArgs, cwd: projectPath, env, platform });
  } catch (error) {
    throw error instanceof RpgMakerStartupError ? error : new RpgMakerStartupError(`RPG Maker MCP schema discovery failed: ${redactSensitive(error instanceof Error ? error.message : String(error), options.env ?? process.env)}`);
  }
  const schemaErrors = validateToolSet(discovered.tools);
  if (schemaErrors.length > 0) throw new RpgMakerStartupError(schemaErrors.join('; '));
  const codePresetPath = await findCodeComposition(paths.runtimeDir);
  const sourceRoot = options.sourceRoot ?? defaultSourceRoot();
  const installed = await installPreset(sourceRoot, paths.dshHome, codePresetPath);
  const backupGuidance = await backupIgnoreGuidance(projectPath);
  const compositionPath = join(paths.dshHome, 'rpgmaker-mv', 'cordis.patch.yml');
  await mkdir(dirname(compositionPath), { recursive: true });
  await writeFile(compositionPath, renderMcpPatch(mcpRunner, mcp.executable, installed.presetRoot));
  const dshExecutable = options.dshExecutable ?? await findDshExecutable(paths.runtimeDir, platform);
  if (!dshExecutable) throw new RpgMakerStartupError('Pinned DSH executable was not found; refusing to launch an unvalidated RPG Maker composition.');
  const dshRunner = options.commandRunner ?? runCommand;
  let compositionCheck;
  try {
    compositionCheck = await dshRunner(dshExecutable, ['--profile', RPGMAKER_DSH_PROFILE, '--patch', compositionPath, '--dump-config'], { cwd: projectPath, env, platform, timeoutMs: 60_000 });
  } catch (error) {
    throw new RpgMakerStartupError(`DSH composition validation could not start: ${redactSensitive(error instanceof Error ? error.message : String(error), options.env ?? process.env)}`);
  }
  if (compositionCheck.exitCode !== 0) throw new RpgMakerStartupError(`DSH composition validation failed: ${redactSensitive(compositionCheck.stderr || compositionCheck.stdout, options.env ?? process.env)}`);
  const dumpedIds = topLevelIds(compositionCheck.stdout);
  if (!dumpedIds.includes('mcp-rpgmaker-mv') || dumpedIds.filter((id) => id === 'mcp-rpgmaker-mv').length !== 1) throw new RpgMakerStartupError('DSH composition validation did not contain exactly one RPG Maker MCP host row.');
  if (!/id: agent-presets/.test(compositionCheck.stdout)) throw new RpgMakerStartupError('DSH composition validation did not expose the agent-presets row.');
  return {
    mcpRuntimeDir,
    mcpExecutable: mcpRunner,
    mcpScript: mcp.executable,
    mcpArgs,
    mcpPackageVersion: mcp.packageVersion,
    presetRoot: installed.presetRoot,
    presetDir: installed.presetDir,
    codePresetPath,
    compositionPath,
    toolNames: discovered.tools.map((tool) => tool.name),
    backupGuidance
  };
}

export async function prepareRpgMakerDeployment(options: RpgMakerDeploymentOptions): Promise<RpgMakerDeployment> {
  const validation = await assertValidMvProject(options.projectPath);
  const paths = resolveHarnessPaths(options);
  return withHarnessOperationLock(paths.lockDir, paths.sessionLeaseDir, () => prepareUnlocked(options, validation.projectPath), {
    timeoutMs: options.lockTimeoutMs,
    retryMs: options.lockRetryMs
  });
}

export interface RpgMakerLaunchResult extends LaunchResult {
  deployment: RpgMakerDeployment;
}

export async function launchRpgmakerProject(options: RpgMakerLaunchOptions): Promise<RpgMakerLaunchResult> {
  const projectPath = options.projectPath ? resolve(options.projectPath) : await pickProjectDirectory({ platform: options.platform, env: options.env, commandRunner: options.commandRunner });
  const deployment = await prepareRpgMakerDeployment({
    ...options,
    projectPath,
    sourceRoot: options.sourceRoot,
    mcpRuntimeDir: options.mcpRuntimeDir,
    schemaProbe: options.schemaProbe
  });
  if (options.notify) options.notify(`${deployment.backupGuidance.message}\n`);
  const result = await launchProject({
    ...options,
    projectPath,
    dshArgs: ['--profile', RPGMAKER_DSH_PROFILE, ...(options.dshArgs ?? []), '--patch', deployment.compositionPath]
  });
  return { ...result, deployment };
}

export { REQUIRED_MCP_TOOLS, defaultSchemaProbe, renderMcpPatch, validateToolSet };
