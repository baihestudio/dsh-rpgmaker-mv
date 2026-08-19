import { cp, mkdir, readFile, realpath, rename as fsRename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { bootstrapRuntime, findDshExecutable, type BootstrapOptions, type BootstrapResult } from './bootstrap';
import { resolveHarnessPaths, WINDOWS_DSH_HOST, WINDOWS_DSH_PORT, type PathOptions } from './config';
import { resolveExecutable } from './executable';
import { commandFailure, prepareProcessInvocation, redactSensitive, runCommand, terminateProcessTree, withoutCredentials, type CommandRunner } from './process';
import { assertValidMvProject, backupIgnoreGuidance, type BackupIgnoreGuidance, pathExists } from './project';
import { withHarnessOperationLock } from './lock';
import { addFixedWebBinding, ensureLaunchPort, launchProject, type LaunchOptions, type LaunchResult } from './launcher';
import {
  ASSET_WORKSHOP_PRESET_ID,
  prepareImageToolchain,
  resolveImageToolchain,
  type ImageArchiveDownloader,
  type ImageArchiveExtractor,
  type ImageToolRenamePath,
  type ImageToolchain,
  type ImageToolchainPreparationOptions
} from './image-workshop';
import { IMAGE_WORKSHOP_PLUGIN_ROW_ID } from './image-plugin';
import { prepareMcporterRuntime, mcporterRuntimeDirFor, type McporterRuntimeOptions, type McporterRuntimeVerification } from './mcport';
import {
  JS_RUNNER_ENV,
  MCPORTER_RUNTIME_ENV,
  XEROLO_RUNTIME_ENV,
  prepareWorkspaceMcpBundle,
  type WorkspaceMcpBundleOptions,
  type WorkspaceMcpBundleVerification
} from './workspace-mcp';

export const RPGMAKER_MCP_PACKAGE = '@xerolo44/rpgmaker-mv-mcp';
export const RPGMAKER_MCP_VERSION = '0.1.0';
export const RPGMAKER_MCP_SERVER_NAME = 'rpgmaker_mv';
export const RPGMAKER_PRESET_ID = 'rpgmaker';
export const PLAYTEST_DEBUG_PRESET_ID = 'playtest-debug';
export const BUILD_RELEASE_PRESET_ID = 'build-release';
export const RPGMAKER_DSH_PROFILE = 'web';
const PRESET_OWNERSHIP_FILE = '.dsh-rpgmaker-owned.json';
const MCP_LOCK_INTEGRITY = 'sha512-oXdkSGKGiYAtexcoZBXhyUQub6zoYQ4tMU2aKTjAcqeKhUpQ4BypjuS0EYJ78/7zmOq3TwFNBkEaZyb8q+SGuA==';
const MCP_LOCK_BIN = 'dist/index.js';

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
  'restore_backup',
  'playtest_start',
  'playtest_status',
  'playtest_log',
  'playtest_stop'
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
  mcporterRuntimeDir?: string;
  dshExecutable?: string;
  bunExecutable?: string;
  jsExecutable?: string;
  agentPreset?: string;
  imageMagickExecutable?: string;
  imageMagickSha256?: string;
  imageMagickUrl?: string;
  imageMagickRelease?: ImageToolchainPreparationOptions['imageMagickRelease'];
  imageToolchainRoot?: string;
  imageHelperRuntimeDir?: string;
  oxipngExecutable?: string;
  oxipngSha256?: string;
  oxipngUrl?: string;
  oxipngRelease?: ImageToolchainPreparationOptions['oxipngRelease'];
  installOxipng?: boolean;
  downloadArchive?: ImageArchiveDownloader;
  extractArchive?: ImageArchiveExtractor;
  archiveExtractorExecutable?: string;
  renamePath?: ImageToolRenamePath;
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
  agentPreset: string;
  imageToolchain?: ImageToolchain;
}

export type RpgMakerLaunchOptions = LaunchOptions & Omit<RpgMakerDeploymentOptions, 'projectPath' | 'dshHome' | 'runtimeDir' | 'platform' | 'env' | 'commandRunner' | 'lockTimeoutMs' | 'lockRetryMs'> & {
  npmExecutable?: string;
  pnpmExecutable?: string;
  pnpmRuntimeDir?: string;
  dshRuntimePreparer?: (options: BootstrapOptions) => Promise<BootstrapResult>;
  mcporterRuntimePreparer?: (options: McporterRuntimeOptions, runtimeDir: string) => Promise<McporterRuntimeVerification>;
  mcpRuntimePreparer?: typeof prepareRpgMakerMcpRuntime;
  workspaceMcpBundlePreparer?: (options: WorkspaceMcpBundleOptions) => Promise<WorkspaceMcpBundleVerification>;
};

export interface RpgMakerLaunchPreparation {
  dshExecutable: string;
  mcporterRuntimeDir: string;
  xeroloRuntimeDir: string;
  xeroloScript: string;
  jsRunner: string;
  presetRoot: string;
  presetDir: string;
  codePresetPath: string;
  compositionPath: string;
  agentPreset: string;
  workspaceMcpBundle: WorkspaceMcpBundleVerification;
}

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

async function readBunLock(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const content = await readFile(path, 'utf8');
    try {
      return asRecord(JSON.parse(content));
    } catch {
      return asRecord(JSON.parse(content.replace(/,\s*([}\]])/g, '$1')));
    }
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
  const lock = await readBunLock(join(runtimeDir, 'bun.lock'));
  const workspace = asRecord(asRecord(lock?.workspaces)?.['']);
  const lockedDependencies = asRecord(workspace?.dependencies);
  const lockedPackage = asRecord(lock?.packages)?.[RPGMAKER_MCP_PACKAGE];
  const lockMetadata = Array.isArray(lockedPackage) ? asRecord(lockedPackage[2]) : undefined;
  const lockBin = asRecord(lockMetadata?.bin);
  if (!lock) errors.push('MCP bun.lock is missing or invalid');
  else if (lockedDependencies?.[RPGMAKER_MCP_PACKAGE] !== RPGMAKER_MCP_VERSION
    || !Array.isArray(lockedPackage)
    || lockedPackage[0] !== `${RPGMAKER_MCP_PACKAGE}@${RPGMAKER_MCP_VERSION}`
    || lockBin?.['rpgmaker-mv-mcp'] !== MCP_LOCK_BIN
    || lockedPackage[3] !== MCP_LOCK_INTEGRITY) errors.push('MCP bun.lock does not match the pinned package version, bin, and npm integrity');
  const packageJson = await readJson(join(packageDirectory(runtimeDir), 'package.json'));
  const packageVersion = typeof packageJson?.version === 'string' ? packageJson.version : undefined;
  const packageBins = asRecord(packageJson?.bin);
  const packageBin = typeof packageJson?.bin === 'string' ? packageJson.bin : packageBins?.['rpgmaker-mv-mcp'];
  if (packageVersion !== RPGMAKER_MCP_VERSION) errors.push(`installed MCP version is ${packageVersion ?? 'missing'}, expected ${RPGMAKER_MCP_VERSION}`);
  if (packageBin !== MCP_LOCK_BIN) errors.push(`installed MCP bin metadata is ${String(packageBin ?? 'missing')}, expected ${MCP_LOCK_BIN}`);
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

export async function prepareRpgMakerMcpRuntime(
  options: Pick<RpgMakerDeploymentOptions, 'platform' | 'env' | 'bunExecutable' | 'commandRunner'>,
  runtimeDir: string
): Promise<McpVerification> {
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
    await runRequired(runner, bun, ['add', '--exact', '--ignore-scripts', `${RPGMAKER_MCP_PACKAGE}@${RPGMAKER_MCP_VERSION}`], staging, env, 'RPG Maker MCP installation');
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

function defaultSourceRoot(presetId = RPGMAKER_PRESET_ID): string {
  return fileURLToPath(new URL(`../presets/${presetId}/`, import.meta.url));
}

export async function findCodeComposition(runtimeDir: string): Promise<string> {
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

export function renderPresetOnlyPatch(presetRoot: string, presetId: string): string {
  return `# Generated by dsh-rpgmaker-mv. Paths only; no credentials are stored here.\n- patch:\n    id: agent-presets\n    config:\n      default: ${presetId}\n      roots:\n        - path: ${yamlSingle(presetRoot)}\n          trust: system\n      includeUserRoot: true\n`;
}

function renderMcpPatch(mcpRunner: string, mcpScript: string, presetRoot: string, presetId: string): string {
  return `# Generated by dsh-rpgmaker-mv. Paths only; no credentials are stored here.\n- insert:\n    - id: mcp-rpgmaker-mv\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: ${RPGMAKER_MCP_SERVER_NAME}\n        transport: stdio\n        command: ${yamlSingle(mcpRunner)}\n        args: [${yamlSingle(mcpScript)}, '--project', !!js process.cwd()]\n        cwd: !!js process.cwd()\n        toolCallTimeoutMs: 60000\n        failOnStartupError: true\n\n- patch:\n    id: agent-presets\n    config:\n      default: ${presetId}\n      roots:\n        - path: ${yamlSingle(presetRoot)}\n          trust: system\n      includeUserRoot: true\n`;
}


function topLevelIds(composition: string): string[] {
  return [...composition.matchAll(/^- id:\s*([^\s#]+)/gm)].map((match) => match[1]);
}

type TopLevelCompositionRow = { id: string; start: number; end: number; text: string };

function topLevelRows(composition: string): TopLevelCompositionRow[] {
  const matches = [...composition.matchAll(/^- id:\s*([^\s#]+)/gm)];
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? composition.length;
    return { id: match[1], start, end, text: composition.slice(start, end).trim() };
  });
}

function replaceTopLevelRow(composition: string, id: string, replacement: string, sourceLabel: string): string {
  const matches = topLevelRows(composition).filter((row) => row.id === id);
  if (matches.length !== 1) throw new RpgMakerStartupError(`${sourceLabel} must contain exactly one ${id} row; found ${matches.length}.`);
  const row = matches[0];
  return `${composition.slice(0, row.start)}${replacement.trim()}\n${composition.slice(row.end)}`;
}

function composePresetComposition(code: string, overlay: string, presetId: string): string {
  const codeRows = topLevelRows(code);
  if (codeRows.filter((row) => row.id === 'persona').length !== 1) {
    throw new RpgMakerStartupError(`Pinned DSH Code preset must contain exactly one persona row for ${presetId}.`);
  }
  const overlayRows = topLevelRows(overlay);
  const personaRows = overlayRows.filter((row) => row.id === 'persona');
  const pluginRows = overlayRows.filter((row) => row.id === IMAGE_WORKSHOP_PLUGIN_ROW_ID);
  if (personaRows.length !== 1) {
    throw new RpgMakerStartupError(`RPG Maker preset ${presetId} must provide exactly one persona row; found ${personaRows.length}.`);
  }
  if (pluginRows.length > 1) {
    throw new RpgMakerStartupError(`RPG Maker preset ${presetId} must not duplicate the ${IMAGE_WORKSHOP_PLUGIN_ROW_ID} row.`);
  }
  const otherRows = overlayRows.filter((row) => row.id !== 'persona' && row.id !== IMAGE_WORKSHOP_PLUGIN_ROW_ID);
  if (otherRows.length > 0) {
    throw new RpgMakerStartupError(`RPG Maker preset ${presetId} must define no composition rows beyond persona${pluginRows.length === 1 ? ' and the app-owned image plugin row' : ''}.`);
  }
  if (pluginRows.length === 1 && presetId !== ASSET_WORKSHOP_PRESET_ID) {
    throw new RpgMakerStartupError(`RPG Maker preset ${presetId} must not mount the image tool plugin; only ${ASSET_WORKSHOP_PRESET_ID} may scope it.`);
  }
  let composed = replaceTopLevelRow(code, 'persona', personaRows[0].text, `RPG Maker preset ${presetId}`);
  if (pluginRows.length === 1) composed = insertTopLevelRowAfter(composed, 'persona', pluginRows[0].text.trim(), `RPG Maker preset ${presetId}`);
  const ids = topLevelIds(composed);
  if (new Set(ids).size !== ids.length) throw new RpgMakerStartupError(`RPG Maker preset ${presetId} derived from Code contains duplicate top-level row ids.`);
  return composed;
}

function insertTopLevelRowAfter(composition: string, afterId: string, rowText: string, sourceLabel: string): string {
  const anchor = topLevelRows(composition).find((row) => row.id === afterId);
  if (!anchor) throw new RpgMakerStartupError(`${sourceLabel} has no ${afterId} row to insert after.`);
  return `${composition.slice(0, anchor.end).replace(/\s+$/, '')}\n${rowText}\n${composition.slice(anchor.end)}`;
}

export async function installPreset(sourceRoot: string, dshHome: string, codePresetPath: string, presetId: string): Promise<{ presetRoot: string; presetDir: string }> {
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
  const composed = `${composePresetComposition(codeWithSkill, overlay, presetId).trimEnd()}\n`;
  const presetRoot = join(dshHome, '.agent-presets');
  const presetDir = join(presetRoot, presetId);
  const ownershipPath = join(presetDir, PRESET_OWNERSHIP_FILE);
  await mkdir(presetRoot, { recursive: true });
  if (await pathExists(presetDir)) {
    const ownership = await readJson(ownershipPath);
    if (ownership?.owner !== 'dsh-rpgmaker-mv' || ownership.presetId !== presetId) {
      throw new RpgMakerStartupError(`Refusing to replace unowned preset directory ${presetDir}; move it aside or remove it with user consent.`);
    }
    await rm(presetDir, { recursive: true, force: true });
  }
  await cp(source, presetDir, { recursive: true, force: true });
  await writeFile(join(presetDir, 'agent.cordis.yml'), composed);
  await writeFile(join(presetDir, PRESET_OWNERSHIP_FILE), `${JSON.stringify({ owner: 'dsh-rpgmaker-mv', presetId, format: 1 })}\n`);
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

export function isSuccessfulProjectValidation(result: unknown): boolean {
  const envelope = asRecord(result);
  if (!envelope || envelope.isError === true) return false;

  let validation: unknown = result;
  const content = envelope.content;
  if (Array.isArray(content)) {
    const text = content.find((block: unknown) => asRecord(block)?.type === 'text');
    if (typeof asRecord(text)?.text === 'string') {
      try {
        validation = JSON.parse(asRecord(text)?.text as string);
      } catch {
        return false;
      }
    }
  }

  const payload = asRecord(validation);
  if (!payload || payload.isError === true || payload.ok !== true) return false;
  const errors = payload.errors ?? envelope.errors;
  return errors === undefined || (Array.isArray(errors) && errors.length === 0);
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
              else if (!isSuccessfulProjectValidation(message.result)) {
                finish(new RpgMakerStartupError(`RPG Maker MCP project validation failed: ${JSON.stringify(message.result)}`));
              } else {
                finish(undefined, { tools: discoveredTools ?? [] });
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
    timer = setTimeout(() => finish(new RpgMakerStartupError('RPG Maker MCP schema discovery timed out after 30 seconds.')), 30_000);
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

export async function resolveMcpRunner(options: Pick<RpgMakerDeploymentOptions, 'jsExecutable' | 'bunExecutable'> & Partial<Pick<RpgMakerDeploymentOptions, 'projectPath'>>, platform: string, env: Record<string, string | undefined>): Promise<string> {
  const candidate = options.jsExecutable ?? options.bunExecutable ?? env.BUN_EXECUTABLE;
  const direct = candidate ? await resolveExecutable(candidate, { platform, env }) : undefined;
  const expectedBasename = (value: string | undefined): value is string => {
    if (!value) return false;
    const name = basename(value).toLowerCase();
    return platform === 'win32' ? name === 'bun.exe' || name === 'node.exe' : name === 'bun' || name === 'node';
  };
  if (expectedBasename(direct)) return direct;
  if (platform === 'win32') {
    const bunExe = await resolveExecutable('bun.exe', { platform, env });
    if (expectedBasename(bunExe)) return bunExe;
    const nodeExe = await resolveExecutable('node.exe', { platform, env });
    if (expectedBasename(nodeExe)) return nodeExe;
    throw new RpgMakerStartupError('Windows MCP startup requires a resolved bun.exe or node.exe; cmd.exe, command.com, and other command shims are not valid JavaScript runners.');
  }
  const bun = await resolveExecutable('bun', { platform, env });
  if (expectedBasename(bun)) return bun;
  const node = await resolveExecutable('node', { platform, env });
  if (expectedBasename(node)) return node;
  throw new RpgMakerStartupError('MCP startup requires a resolved direct bun or node executable; shell command shims are not valid JavaScript runners.');
}

async function prepareUnlocked(options: RpgMakerDeploymentOptions, projectPath: string): Promise<RpgMakerDeployment> {
  const paths = resolveHarnessPaths(options);
  const platform = options.platform ?? process.platform;
  const mcpRuntimeDir = resolve(options.mcpRuntimeDir ?? join(paths.programRoot, 'runtime', 'mcp'));
  const mcp = await prepareRpgMakerMcpRuntime(options, mcpRuntimeDir);
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
  const agentPreset = options.agentPreset ?? RPGMAKER_PRESET_ID;
  if (agentPreset !== RPGMAKER_PRESET_ID && agentPreset !== PLAYTEST_DEBUG_PRESET_ID && agentPreset !== ASSET_WORKSHOP_PRESET_ID && agentPreset !== BUILD_RELEASE_PRESET_ID) {
    throw new RpgMakerStartupError(`Unknown RPG Maker agent preset: ${agentPreset}`);
  }
  const rpgmakerSourceRoot = options.sourceRoot ?? defaultSourceRoot(RPGMAKER_PRESET_ID);
  const rpgmakerInstalled = await installPreset(rpgmakerSourceRoot, paths.dshHome, codePresetPath, RPGMAKER_PRESET_ID);
  await installPreset(defaultSourceRoot(PLAYTEST_DEBUG_PRESET_ID), paths.dshHome, codePresetPath, PLAYTEST_DEBUG_PRESET_ID);
  await installPreset(defaultSourceRoot(ASSET_WORKSHOP_PRESET_ID), paths.dshHome, codePresetPath, ASSET_WORKSHOP_PRESET_ID);
  await installPreset(defaultSourceRoot(BUILD_RELEASE_PRESET_ID), paths.dshHome, codePresetPath, BUILD_RELEASE_PRESET_ID);
  let imageToolchain: ImageToolchain | undefined;
  const installedImageManifest = join(options.imageToolchainRoot ?? join(paths.programRoot, 'tools', 'image-workshop'), 'toolchain.json');
  if (agentPreset === ASSET_WORKSHOP_PRESET_ID || await pathExists(installedImageManifest)) {
    try {
      const preparationOptions: ImageToolchainPreparationOptions = {
        platform,
        env: options.env,
        dshHome: paths.dshHome,
        toolchainRoot: options.imageToolchainRoot,
        helperRuntimeDir: options.imageHelperRuntimeDir,
        imageMagickExecutable: options.imageMagickExecutable,
        imageMagickSha256: options.imageMagickSha256,
        imageMagickUrl: options.imageMagickUrl,
        imageMagickRelease: options.imageMagickRelease,
        oxipngExecutable: options.oxipngExecutable,
        oxipngSha256: options.oxipngSha256,
        oxipngUrl: options.oxipngUrl,
        oxipngRelease: options.oxipngRelease,
        installOxipng: true,
        downloadArchive: options.downloadArchive,
        extractArchive: options.extractArchive,
        archiveExtractorExecutable: options.archiveExtractorExecutable,
        renamePath: options.renamePath,
        bunExecutable: options.bunExecutable,
        commandRunner: options.commandRunner
      };
      imageToolchain = (await prepareImageToolchain(preparationOptions)).toolchain;
    } catch (error) {
      throw new RpgMakerStartupError(`Asset Workshop toolchain is not ready: ${redactSensitive(error instanceof Error ? error.message : String(error), options.env ?? process.env)}`);
    }
  }
  const installed = agentPreset === RPGMAKER_PRESET_ID
    ? rpgmakerInstalled
    : { presetRoot: rpgmakerInstalled.presetRoot, presetDir: join(rpgmakerInstalled.presetRoot, agentPreset) };
  const backupGuidance = await backupIgnoreGuidance(projectPath);
  const compositionPath = join(paths.dshHome, 'rpgmaker-mv', 'cordis.patch.yml');
  await mkdir(dirname(compositionPath), { recursive: true });
  await writeFile(compositionPath, renderMcpPatch(mcpRunner, mcp.executable, installed.presetRoot, agentPreset));
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
    backupGuidance,
    agentPreset,
    ...(imageToolchain ? { imageToolchain } : {})
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

async function existingImageEnvironment(
  options: RpgMakerLaunchOptions,
  paths: ReturnType<typeof resolveHarnessPaths>,
  platform: string,
  env: Record<string, string | undefined>
): Promise<Record<string, string | undefined>> {
  const toolchainRoot = options.imageToolchainRoot ?? join(paths.programRoot, 'tools', 'image-workshop');
  if (!(await pathExists(join(toolchainRoot, 'toolchain.json')))) return {};
  try {
    const toolchain = await resolveImageToolchain({
      platform,
      env,
      dshHome: paths.dshHome,
      programRoot: paths.programRoot,
      mutableRoot: paths.mutableRoot,
      toolchainRoot,
      imageMagickExecutable: options.imageMagickExecutable,
      imageMagickSha256: options.imageMagickSha256,
      imageMagickUrl: options.imageMagickUrl,
      imageMagickRelease: options.imageMagickRelease,
      helperRoot: options.imageHelperRuntimeDir,
      oxipngExecutable: options.oxipngExecutable,
      oxipngSha256: options.oxipngSha256,
      oxipngUrl: options.oxipngUrl,
      oxipngRelease: options.oxipngRelease,
      installOxipng: true,
      commandRunner: options.commandRunner
    });
    return {
      DSH_IMAGE_WORKSHOP_ROOT: toolchain.toolchainRoot,
      DSH_IMAGE_WORKSHOP_MANIFEST: toolchain.manifestPath,
      DSH_IMAGE_MAGICK: toolchain.imageMagick,
      DSH_IMAGE_HELPER_ROOT: toolchain.helperRoot,
      ...(toolchain.oxipng ? { DSH_OXIPNG: toolchain.oxipng } : {})
    };
  } catch {
    // A normal launch must not turn an optional image dependency into a Host
    // startup requirement. The image command will report or prepare it when
    // the asset-workshop Agent actually requests an operation.
    return {};
  }
}

async function validatePresetComposition(
  dshExecutable: string,
  compositionPath: string,
  cwd: string,
  platform: string,
  env: Record<string, string | undefined>,
  commandRunner: CommandRunner
): Promise<void> {
  let result;
  try {
    result = await commandRunner(dshExecutable, ['--profile', RPGMAKER_DSH_PROFILE, '--patch', compositionPath, '--dump-config'], {
      cwd,
      env: withoutCredentials(env),
      platform,
      timeoutMs: 60_000
    });
  } catch (error) {
    throw new RpgMakerStartupError(`DSH composition validation could not start: ${redactSensitive(error instanceof Error ? error.message : String(error), env)}`);
  }
  if (result.exitCode !== 0) throw new RpgMakerStartupError(`DSH composition validation failed: ${redactSensitive(result.stderr || result.stdout, env)}`);
  const dumpedIds = topLevelIds(result.stdout);
  if (!/id: agent-presets/.test(result.stdout) || dumpedIds.filter((id) => id === 'agent-presets').length !== 1) {
    throw new RpgMakerStartupError('DSH composition validation did not expose exactly one agent-presets row.');
  }
  if (dumpedIds.includes('mcp-rpgmaker-mv')) {
    throw new RpgMakerStartupError('DSH composition validation still contains the obsolete project-scoped RPG Maker MCP row.');
  }
}

export async function prepareRpgMakerLaunch(options: RpgMakerLaunchOptions): Promise<RpgMakerLaunchPreparation> {
  const platform = options.platform ?? process.platform;
  const ambientEnv = options.env ?? process.env;
  const paths = resolveHarnessPaths({ ...options, platform, env: ambientEnv });
  const env = { ...ambientEnv, DSH_HOME: paths.dshHome };
  const agentPreset = options.agentPreset ?? RPGMAKER_PRESET_ID;
  if (![RPGMAKER_PRESET_ID, PLAYTEST_DEBUG_PRESET_ID, ASSET_WORKSHOP_PRESET_ID, BUILD_RELEASE_PRESET_ID].includes(agentPreset)) {
    throw new RpgMakerStartupError(`Unknown RPG Maker agent preset: ${agentPreset}`);
  }

  const prepareDsh = options.dshRuntimePreparer ?? bootstrapRuntime;
  const dshBootstrap = await prepareDsh({
    platform,
    env,
    dshHome: paths.dshHome,
    programRoot: paths.programRoot,
    mutableRoot: paths.mutableRoot,
    runtimeDir: paths.runtimeDir,
    bunExecutable: options.bunExecutable,
    commandRunner: options.commandRunner,
    lockTimeoutMs: options.lockTimeoutMs,
    lockRetryMs: options.lockRetryMs
  });
  if (!dshBootstrap.verification.valid) {
    throw new RpgMakerStartupError(`Pinned DSH runtime is not usable: ${dshBootstrap.verification.errors.join('; ')}`);
  }
  const dshExecutable = options.dshExecutable ?? dshBootstrap.verification.dshExecutable ?? await findDshExecutable(paths.runtimeDir, platform);
  if (!dshExecutable) throw new RpgMakerStartupError('Pinned DSH executable was not found; refusing to launch an unverified project-neutral Host.');
  if (!(await pathExists(dshExecutable))) throw new RpgMakerStartupError(`DSH executable does not exist: ${dshExecutable}. Run bootstrap, then retry.`);

  const mcporterRuntimeDir = resolve(options.mcporterRuntimeDir ?? mcporterRuntimeDirFor(paths));
  const prepareMcporter = options.mcporterRuntimePreparer ?? prepareMcporterRuntime;
  const mcporter = await prepareMcporter({
    platform,
    env,
    dshHome: paths.dshHome,
    programRoot: paths.programRoot,
    mutableRoot: paths.mutableRoot,
    runtimeDir: paths.runtimeDir,
    bunExecutable: options.bunExecutable,
    commandRunner: options.commandRunner,
    lockTimeoutMs: options.lockTimeoutMs,
    lockRetryMs: options.lockRetryMs
  }, mcporterRuntimeDir);
  if (!mcporter.valid) throw new RpgMakerStartupError(`Pinned MCPorter runtime is not usable: ${mcporter.errors.join('; ')}`);

  const xeroloRuntimeDir = resolve(options.mcpRuntimeDir ?? join(paths.programRoot, 'runtime', 'mcp'));
  const prepareMcp = options.mcpRuntimePreparer ?? prepareRpgMakerMcpRuntime;
  const mcp = await prepareMcp({
    platform,
    env,
    bunExecutable: options.bunExecutable,
    commandRunner: options.commandRunner
  }, xeroloRuntimeDir);
  if (!mcp.valid || !mcp.executable) throw new RpgMakerStartupError(`Pinned RPG Maker MCP runtime is not usable: ${mcp.errors.join('; ')}`);
  const jsRunner = await resolveMcpRunner(options, platform, withoutCredentials(env));

  const prepareBundle = options.workspaceMcpBundlePreparer ?? prepareWorkspaceMcpBundle;
  const workspaceMcpBundle = await prepareBundle({
    platform,
    env,
    dshHome: paths.dshHome,
    programRoot: paths.programRoot,
    mutableRoot: paths.mutableRoot,
    runtimeDir: paths.runtimeDir,
    dshExecutable,
    npmExecutable: options.npmExecutable,
    pnpmExecutable: options.pnpmExecutable,
    pnpmRuntimeDir: options.pnpmRuntimeDir,
    commandRunner: options.commandRunner
  });
  if (!workspaceMcpBundle.valid) throw new RpgMakerStartupError(`App-owned workspace MCP bundle is not usable: ${workspaceMcpBundle.errors.join('; ')}`);

  const codePresetPath = await findCodeComposition(paths.runtimeDir);
  const sourceRoot = options.sourceRoot ?? defaultSourceRoot(RPGMAKER_PRESET_ID);
  const installed = await installPreset(sourceRoot, paths.dshHome, codePresetPath, RPGMAKER_PRESET_ID);
  await installPreset(defaultSourceRoot(PLAYTEST_DEBUG_PRESET_ID), paths.dshHome, codePresetPath, PLAYTEST_DEBUG_PRESET_ID);
  await installPreset(defaultSourceRoot(ASSET_WORKSHOP_PRESET_ID), paths.dshHome, codePresetPath, ASSET_WORKSHOP_PRESET_ID);
  await installPreset(defaultSourceRoot(BUILD_RELEASE_PRESET_ID), paths.dshHome, codePresetPath, BUILD_RELEASE_PRESET_ID);

  await mkdir(paths.neutralLandingDir, { recursive: true });
  const compositionPath = join(paths.dshHome, 'rpgmaker-mv', 'cordis.patch.yml');
  await mkdir(dirname(compositionPath), { recursive: true });
  await writeFile(compositionPath, renderPresetOnlyPatch(installed.presetRoot, agentPreset));
  await validatePresetComposition(dshExecutable, compositionPath, paths.neutralLandingDir, platform, env, options.commandRunner ?? runCommand);

  return {
    dshExecutable,
    mcporterRuntimeDir,
    xeroloRuntimeDir,
    xeroloScript: mcp.executable,
    jsRunner,
    presetRoot: installed.presetRoot,
    presetDir: join(installed.presetRoot, agentPreset),
    codePresetPath,
    compositionPath,
    agentPreset,
    workspaceMcpBundle
  };
}

export interface RpgMakerLaunchResult extends LaunchResult {
  deployment: RpgMakerLaunchPreparation;
}

export async function launchRpgmakerProject(options: RpgMakerLaunchOptions): Promise<RpgMakerLaunchResult> {
  if (options.webHost !== undefined && options.webHost !== WINDOWS_DSH_HOST) throw new RpgMakerStartupError(`The DSH web binding is fixed at ${WINDOWS_DSH_HOST}:${WINDOWS_DSH_PORT}.`);
  if (options.webPort !== undefined && options.webPort !== WINDOWS_DSH_PORT) throw new RpgMakerStartupError(`The DSH web binding is fixed at ${WINDOWS_DSH_HOST}:${WINDOWS_DSH_PORT}.`);
  if (options.dshArgs?.some((argument) => argument === '--project' || argument.startsWith('--project='))) {
    throw new RpgMakerStartupError('The project-neutral launch does not accept --project; choose a workspace in DSH Web.');
  }
  if (options.dshArgs) addFixedWebBinding(options.dshArgs);
  await ensureLaunchPort({ ...options, bindWeb: true, webHost: WINDOWS_DSH_HOST, webPort: WINDOWS_DSH_PORT });
  const deployment = await prepareRpgMakerLaunch(options);
  const paths = resolveHarnessPaths(options);
  const env = { ...(options.env ?? process.env), DSH_HOME: paths.dshHome };
  const imageEnvironment = await existingImageEnvironment(options, paths, options.platform ?? process.platform, env);
  const releaseEnvironment = {
    DSH_RPGMAKER_RELEASE_CLI: fileURLToPath(new URL('./cli.ts', import.meta.url)),
    DSH_IMAGE_WORKSHOP_CLI: fileURLToPath(new URL('./cli.ts', import.meta.url))
  };
  const ownedEnvironment = {
    [MCPORTER_RUNTIME_ENV]: deployment.mcporterRuntimeDir,
    [XEROLO_RUNTIME_ENV]: deployment.xeroloRuntimeDir,
    [JS_RUNNER_ENV]: deployment.jsRunner
  };
  const result = await launchProject({
    ...options,
    env,
    dshExecutable: deployment.dshExecutable,
    bindWeb: true,
    portAlreadyChecked: true,
    webHost: WINDOWS_DSH_HOST,
    webPort: WINDOWS_DSH_PORT,
    extraEnv: { ...(options.extraEnv ?? {}), ...releaseEnvironment, ...imageEnvironment, ...ownedEnvironment },
    dshArgs: ['--profile', RPGMAKER_DSH_PROFILE, ...(options.dshArgs ?? []), '--patch', deployment.compositionPath]
  });
  return { ...result, deployment };
}

export { REQUIRED_MCP_TOOLS, defaultSchemaProbe, renderMcpPatch, validateToolSet };
