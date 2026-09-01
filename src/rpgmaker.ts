import { cp, mkdir, mkdtemp, readFile, realpath, rename as fsRename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bootstrapRuntime, resolveDshEntrypoint, type BootstrapOptions, type BootstrapResult } from './bootstrap';
import { WINDOWS_DSH_HOST, WINDOWS_DSH_PORT, type PathOptions } from './config';
import { resolveExecutable } from './executable';
import { commandFailure, redactSensitive, runCommand, withoutCredentials, type CommandRunner } from './process';
import { pathExists } from './project';
import { addFixedWebBinding, ensureLaunchPort, launchProject, type LaunchOptions, type LaunchResult } from './launcher';
import { prepareMcporterRuntime, mcporterRuntimeDirFor, type McporterRuntimeOptions, type McporterRuntimeVerification } from './mcport';
import {
  JS_RUNNER_ENV,
  MCPORTER_RUNTIME_ENV,
  RPGMAKER_MCP_RUNTIME_ENV,
  WORKSPACE_MCP_AGENT_ROW_ID
} from './workspace-mcp';
import { ensureManagedWebProfile, type ManagedWebProfileOptions, type ManagedWebProfileResult } from './managed-web-profile';
import { resolveReceiptBackedHarnessPaths } from './installation-root';

export const RPGMAKER_MV_MCP_PACKAGE = '@xerolo44/rpgmaker-mv-mcp';
export const RPGMAKER_MV_MCP_VERSION = '0.1.0';
export const RPGMAKER_MZ_MCP_PACKAGE = 'rpgmaker-mz-mcp';
export const RPGMAKER_MZ_MCP_VERSION = '1.3.0';
export const RPGMAKER_MZ_MCP_INTEGRITY = 'sha512-m4JIWdOi3WC5oodfAzPWpgXDUN9MBEl9AcJxoNBtCAD/gMhEM1ju1XD3WjLQkoylIDspSoqVxaGyRsNfQVupJw==';
export const RPGMAKER_MV_MCP_INTEGRITY = 'sha512-oXdkSGKGiYAtexcoZBXhyUQub6zoYQ4tMU2aKTjAcqeKhUpQ4BypjuS0EYJ78/7zmOq3TwFNBkEaZyb8q+SGuA==';
export const RPGMAKER_MCP_MANIFEST_RELATIVE = join('runtime-manifests', 'rpgmaker-mcp');
export const RPGMAKER_PRESET_ID = 'rpgmaker';
export const RPGMAKER_DSH_PROFILE = 'web';
export const DEEPSEEK_VISION_MODEL = 'deepseek-v4-flash-vision-exp';
export const DSH_TOOL_TIMEOUT_POLICY_PACKAGE = '@deepseek-ai/dsh-tool-call-timeout-policy';
export const DSH_TOOL_TIMEOUT_POLICY_ROW_ID = 'timeout-policy';
export const FORGEJO_MCP_CLIENT_ROW_ID = 'forgejo-mcp-client';
export const CUSTOM_AGENT_PRESET_IDS = [RPGMAKER_PRESET_ID] as const;
const REMOVED_PRESET_IDS = ['game-design', 'asset-workshop', 'build-release'] as const;
const PRESET_OWNERSHIP_FILE = '.dsh-rpgmaker-owned.json';
const MCP_LOCK_BIN = 'dist/index.js';

export type RpgMakerLaunchOptions = LaunchOptions & {
  /** Generic spelling for the shared MV/MZ runtime; the on-disk path is unchanged. */
  rpgmakerRuntimeDir?: string;
  mcporterRuntimeDir?: string;
  dshExecutable?: string;
  jsExecutable?: string;
  agentPreset?: string;
  sourceRoot?: string;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
  npmExecutable?: string;
  pnpmExecutable?: string;
  pnpmRuntimeDir?: string;
  dshRuntimePreparer?: (options: BootstrapOptions) => Promise<BootstrapResult>;
  mcporterRuntimePreparer?: (options: McporterRuntimeOptions, runtimeDir: string) => Promise<McporterRuntimeVerification>;
  mcpRuntimePreparer?: typeof prepareRpgMakerMcpRuntime;
  managedWebProfilePreparer?: (options: ManagedWebProfileOptions) => Promise<ManagedWebProfileResult>;
  openWebBrowser?: boolean;
};

export interface RpgMakerLaunchPreparation {
  dshExecutable: string;
  mcporterRuntimeDir: string;
  rpgmakerRuntimeDir: string;
  rpgmakerScripts: RpgMakerScripts;
  jsRunner: string;
  presetRoot: string;
  presetDir: string;
  codePresetPath: string;
  compositionPath: string;
  agentPreset: string;
  managedWebProfile: ManagedWebProfileResult;
}

export interface RpgMakerScripts {
  mv: string;
  mz: string;
}

export interface RpgMakerPresetDeploymentOptions extends PathOptions {
  platform?: string;
  env?: Record<string, string | undefined>;
  dshExecutable: string;
  sourceRoot?: string;
  agentPreset?: string;
  commandRunner?: CommandRunner;
}

export interface RpgMakerPresetDeployment {
  presetRoot: string;
  presetDir: string;
  codePresetPath: string;
  compositionPath: string;
  agentPreset: string;
}

export interface McpVerification {
  valid: boolean;
  errors: string[];
  engines: RpgMakerEngineVerificationMap;
}

export interface RpgMakerEngineVerificationMap {
  mv: EngineMcpVerification;
  mz: EngineMcpVerification;
}

export interface EngineMcpVerification {
  engine: 'mv' | 'mz';
  package: string;
  version: string;
  integrity: string;
  bin: string;
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

interface OwnedRpgMakerProfileSnapshotEntry {
  source: string;
  backup: string;
  existed: boolean;
}

interface OwnedRpgMakerProfileSnapshot {
  root: string;
  entries: OwnedRpgMakerProfileSnapshotEntry[];
}

/** Snapshot the shipped presets, retired app-owned overlays, and shared Host patch. */
async function snapshotOwnedRpgMakerProfile(dshHome: string): Promise<OwnedRpgMakerProfileSnapshot> {
  const root = await mkdtemp(join(dshHome, '.rpgmaker-profile-rollback-'));
  const presetRoot = join(dshHome, '.agent-presets');
  const sources = [
    ...[...CUSTOM_AGENT_PRESET_IDS, ...REMOVED_PRESET_IDS].map((presetId) => join(presetRoot, presetId)),
    join(dshHome, 'rpgmaker-mv', 'cordis.patch.yml')
  ];
  const entries: OwnedRpgMakerProfileSnapshotEntry[] = [];
  try {
    for (const [index, source] of sources.entries()) {
      const existed = await pathExists(source);
      const backup = join(root, String(index));
      if (existed) await cp(source, backup, { recursive: true, force: false, errorOnExist: true });
      entries.push({ source, backup, existed });
    }
    return { root, entries };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

async function restoreOwnedRpgMakerProfile(snapshot: OwnedRpgMakerProfileSnapshot): Promise<void> {
  for (const entry of snapshot.entries) {
    await rm(entry.source, { recursive: true, force: true });
    if (entry.existed) {
      await mkdir(dirname(entry.source), { recursive: true });
      await cp(entry.backup, entry.source, { recursive: true, force: false, errorOnExist: true });
    }
  }
}

async function withOwnedRpgMakerProfileRepair<T>(dshHome: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(dshHome, { recursive: true });
  const snapshot = await snapshotOwnedRpgMakerProfile(dshHome);
  try {
    return await operation();
  } catch (error) {
    const original = error instanceof Error ? error : new Error(String(error));
    try {
      await restoreOwnedRpgMakerProfile(snapshot);
    } catch (restoreError) {
      throw new Error(`${original.message}; RPG Maker profile rollback failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
    }
    throw original;
  } finally {
    await rm(snapshot.root, { recursive: true, force: true });
  }
}

async function readNpmLock(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const content = await readFile(path, 'utf8');
    return asRecord(JSON.parse(content));
  } catch {
    return undefined;
  }
}

function packageDirectory(runtimeDir: string, packageName: string): string {
  return join(runtimeDir, 'node_modules', ...packageName.split('/'));
}

async function findMcpScript(runtimeDir: string, packageName: string, binName: string): Promise<string | undefined> {
  const packageDir = packageDirectory(runtimeDir, packageName);
  const packageJson = await readJson(join(packageDir, 'package.json'));
  const bin = packageJson?.bin;
  const bins = asRecord(bin);
  const entry = typeof bin === 'string' ? bin : bins?.[binName] ?? Object.values(bins ?? {}).find((value): value is string => typeof value === 'string');
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

export const MCP_ENGINE_RECORDS = {
  mv: { engine: 'mv' as const, package: RPGMAKER_MV_MCP_PACKAGE, version: RPGMAKER_MV_MCP_VERSION, integrity: RPGMAKER_MV_MCP_INTEGRITY, bin: 'rpgmaker-mv-mcp', entry: MCP_LOCK_BIN },
  mz: { engine: 'mz' as const, package: RPGMAKER_MZ_MCP_PACKAGE, version: RPGMAKER_MZ_MCP_VERSION, integrity: RPGMAKER_MZ_MCP_INTEGRITY, bin: 'rpgmaker-mz-mcp', entry: MCP_LOCK_BIN }
} as const;

export async function verifyEngineMcpRuntime(runtimeDirInput: string, engine: 'mv' | 'mz', _platform: string = process.platform): Promise<EngineMcpVerification> {
  const runtimeDir = resolve(runtimeDirInput);
  const record = MCP_ENGINE_RECORDS[engine];
  const errors: string[] = [];
  const rootPackage = await readJson(join(runtimeDir, 'package.json'));
  const dependencies = asRecord(rootPackage?.dependencies);
  if (dependencies?.[record.package] !== record.version) errors.push(`${record.engine.toUpperCase()} MCP dependency ${record.package}@${record.version} is not pinned`);
  const lock = await readNpmLock(join(runtimeDir, 'package-lock.json'));
  const lockRoot = asRecord(asRecord(lock?.packages)?.['']);
  const lockedPackage = asRecord(asRecord(lock?.packages)?.[`node_modules/${record.package}`]);
  const lockedDependency = asRecord(lockRoot?.dependencies)?.[record.package];
  if (!lock) errors.push('RPG Maker MCP package-lock.json is missing or invalid');
  else if (lockedDependency !== record.version
    || lockedPackage?.version !== record.version
    || lockedPackage?.integrity !== record.integrity) errors.push(`${record.engine.toUpperCase()} MCP package-lock.json does not match the pinned package version and npm integrity`);
  const packageJson = await readJson(join(packageDirectory(runtimeDir, record.package), 'package.json'));
  const packageName = typeof packageJson?.name === 'string' ? packageJson.name : undefined;
  const packageVersion = typeof packageJson?.version === 'string' ? packageJson.version : undefined;
  const packageBins = asRecord(packageJson?.bin);
  const packageBin = typeof packageJson?.bin === 'string' ? packageJson.bin : packageBins?.[record.bin];
  if (packageName !== record.package) errors.push(`installed ${record.engine.toUpperCase()} MCP package identity is ${packageName ?? 'missing'}, expected ${record.package}`);
  if (packageVersion !== record.version) errors.push(`installed ${record.engine.toUpperCase()} MCP version is ${packageVersion ?? 'missing'}, expected ${record.version}`);
  if (packageBin !== record.entry && packageBin !== `./${record.entry}`) errors.push(`installed ${record.engine.toUpperCase()} MCP bin metadata is ${String(packageBin ?? 'missing')}, expected ${record.entry}`);
  const executable = await findMcpScript(runtimeDir, record.package, record.bin);
  if (!executable) errors.push(`installed RPG Maker ${record.engine.toUpperCase()} MCP JavaScript entry was not found inside the app-owned runtime`);
  return { ...record, valid: errors.length === 0, errors, packageVersion, executable };
}

/** Strict dual-engine verification used by install/repair, launch, and Doctor. */
export async function verifyRpgMakerMcpRuntime(runtimeDirInput: string, platform: string = process.platform): Promise<McpVerification> {
  const [mv, mz] = await Promise.all([
    verifyEngineMcpRuntime(runtimeDirInput, 'mv', platform),
    verifyEngineMcpRuntime(runtimeDirInput, 'mz', platform)
  ]);
  const errors = [...mv.errors, ...mz.errors];
  return { valid: errors.length === 0, errors, engines: { mv, mz } };
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
  options: { platform?: string; env?: Record<string, string | undefined>; nodeExecutable?: string; npmExecutable?: string; manifestRoot?: string; commandRunner?: CommandRunner },
  runtimeDir: string
): Promise<McpVerification> {
  const platform = options.platform ?? process.platform;
  const env = withoutCredentials(options.env ?? process.env);
  const runner = options.commandRunner ?? runCommand;
  const npm = options.npmExecutable ?? (options.env ?? process.env).NPM_EXECUTABLE ?? 'npm';
  const manifestRoot = resolve(options.manifestRoot ?? join(dirname(dirname(runtimeDir)), RPGMAKER_MCP_MANIFEST_RELATIVE));
  const current = await verifyRpgMakerMcpRuntime(runtimeDir, platform);
  if (current.valid) return current;

  const parent = dirname(runtimeDir);
  await mkdir(parent, { recursive: true });
  const staging = join(parent, `.${basename(runtimeDir)}.staging-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(staging, { recursive: true });
  try {
    for (const filename of ['package.json', 'package-lock.json']) {
      const source = join(manifestRoot, filename);
      if (!(await pathExists(source))) throw new RpgMakerStartupError(`Release-owned RPG Maker MCP runtime ${filename} is missing at ${source}; refusing to resolve a target lock from the registry.`);
      await cp(source, join(staging, filename), { force: false, errorOnExist: true });
    }
    await runRequired(runner, npm, ['ci', '--legacy-peer-deps', '--no-audit', '--no-fund'], staging, env, 'RPG Maker MCP installation');
    const staged = await verifyRpgMakerMcpRuntime(staging, platform);
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
    return await verifyRpgMakerMcpRuntime(runtimeDir, platform);
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
    join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'config', 'agent-presets', 'code', 'agent.cordis.yml'),
    join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh-agent-presets', 'presets', 'standard', 'agent.cordis.yml')
  ];
  for (const candidate of candidates) if (await pathExists(candidate)) return candidate;
  throw new RpgMakerStartupError('Pinned DSH Code preset composition was not found; refusing to start a tool-less RPG Maker session.');
}

function yamlSingle(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function renderVisionModelPatch(): string {
  return `- id: agent-default-model\n  config:\n    provider: deepseek-official\n    model: ${DEEPSEEK_VISION_MODEL}\n\n- id: llm-deepseek\n  config:\n    models:\n      - id: deepseek-v4-flash\n        name: DeepSeek-V4-Flash\n        contextWindow: 1000000\n      - id: deepseek-v4-pro\n        name: DeepSeek-V4-Pro\n        contextWindow: 1000000\n      - id: ${DEEPSEEK_VISION_MODEL}\n        name: DeepSeek-V4-Flash-Vision-Exp\n        inputModalities: [text, image]\n`;
}

export function renderPresetOnlyPatch(presetRoot: string, presetId: string): string {
  return `# Generated by dsh-rpgmaker-mv. Paths only; no credentials are stored here. The pinned DSH web profile owns the shared timeout policy.\n${renderVisionModelPatch()}\n- id: agent-presets\n  config:\n    default: ${presetId}\n    roots:\n      - path: ${yamlSingle(presetRoot)}\n        trust: system\n    includeUserRoot: true\n`;
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

function timeoutPolicyRows(composition: string): string[] {
  return [...composition.matchAll(/^    - id:\s*([^\s#]+)\s*$/gm)].map((match) => match[1]);
}

function effectiveTimeoutPolicyRows(composition: string): TopLevelCompositionRow[] {
  return topLevelRows(composition).filter((row) => row.id === DSH_TOOL_TIMEOUT_POLICY_ROW_ID);
}

function officialTimeoutPolicyPattern(flags = ''): RegExp {
  return new RegExp(`name:\\s*['"]?${DSH_TOOL_TIMEOUT_POLICY_PACKAGE}['"]?(?=\\s|$)`, flags);
}

function isOfficialTimeoutPolicyRow(row: TopLevelCompositionRow): boolean {
  return officialTimeoutPolicyPattern().test(row.text);
}

export interface TimeoutPolicyCompositionVerification {
  valid: boolean;
  errors: string[];
  hostCompositionPath: string;
  coveredPresets: string[];
}

export async function verifyTimeoutPolicyComposition(
  dshHome: string,
  presetRoot = join(dshHome, '.agent-presets')
): Promise<TimeoutPolicyCompositionVerification> {
  const hostCompositionPath = join(dshHome, 'rpgmaker-mv', 'cordis.patch.yml');
  const errors: string[] = [];
  let hostComposition = '';
  try {
    hostComposition = await readFile(hostCompositionPath, 'utf8');
  } catch {
    errors.push(`shared Host composition was not found: ${hostCompositionPath}`);
  }
  const policyRows = timeoutPolicyRows(hostComposition).filter((id) => id === DSH_TOOL_TIMEOUT_POLICY_ROW_ID);
  if (policyRows.length !== 0) errors.push(`shared Host composition must not define ${DSH_TOOL_TIMEOUT_POLICY_ROW_ID}; the pinned DSH web profile supplies the official Host row (found ${policyRows.length}).`);
  const policyNames = (hostComposition.match(officialTimeoutPolicyPattern('g')) ?? []).length;
  if (policyNames !== 0) errors.push(`shared Host composition must not define ${DSH_TOOL_TIMEOUT_POLICY_PACKAGE}; the pinned DSH web profile supplies the official Host row (found ${policyNames}).`);

  const coveredPresets: string[] = [];
  for (const presetId of CUSTOM_AGENT_PRESET_IDS) {
    const compositionPath = join(presetRoot, presetId, 'agent.cordis.yml');
    try {
      const composition = await readFile(compositionPath, 'utf8');
      if (composition.includes(DSH_TOOL_TIMEOUT_POLICY_PACKAGE) || composition.includes(`id: ${DSH_TOOL_TIMEOUT_POLICY_ROW_ID}`)) {
        errors.push(`preset ${presetId} must receive the timeout policy from the shared Host composition, not its Agent composition.`);
      } else {
        coveredPresets.push(presetId);
      }
    } catch {
      errors.push(`custom Agent preset composition was not found: ${compositionPath}`);
    }
  }
  return { valid: errors.length === 0, errors, hostCompositionPath, coveredPresets };
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
  const workspaceRows = overlayRows.filter((row) => row.id === WORKSPACE_MCP_AGENT_ROW_ID);
  const forgejoRows = overlayRows.filter((row) => row.id === FORGEJO_MCP_CLIENT_ROW_ID);
  const requiresWorkspaceMcp = presetId === RPGMAKER_PRESET_ID;
  if (personaRows.length !== 1) {
    throw new RpgMakerStartupError(`RPG Maker preset ${presetId} must provide exactly one persona row; found ${personaRows.length}.`);
  }
  if (forgejoRows.length !== 1) {
    throw new RpgMakerStartupError(`RPG Maker preset ${presetId} must provide exactly one ${FORGEJO_MCP_CLIENT_ROW_ID} row; found ${forgejoRows.length}.`);
  }
  if (requiresWorkspaceMcp && workspaceRows.length !== 1) {
    throw new RpgMakerStartupError(`RPG Maker preset ${presetId} must provide exactly one ${WORKSPACE_MCP_AGENT_ROW_ID} row; found ${workspaceRows.length}.`);
  }
  if (!requiresWorkspaceMcp && workspaceRows.length !== 0) {
    throw new RpgMakerStartupError(`Non-RPG-Maker preset ${presetId} must not provide a ${WORKSPACE_MCP_AGENT_ROW_ID} row; found ${workspaceRows.length}.`);
  }
  const otherRows = overlayRows.filter((row) => row.id !== 'persona' && row.id !== WORKSPACE_MCP_AGENT_ROW_ID && row.id !== FORGEJO_MCP_CLIENT_ROW_ID);
  if (otherRows.length > 0) {
    throw new RpgMakerStartupError(`RPG Maker preset ${presetId} must define no composition rows beyond persona, ${FORGEJO_MCP_CLIENT_ROW_ID}, and ${requiresWorkspaceMcp ? WORKSPACE_MCP_AGENT_ROW_ID : 'no workspace MCP row'}.`);
  }
  let composed = replaceTopLevelRow(code, 'persona', personaRows[0].text, `RPG Maker preset ${presetId}`);
  if (requiresWorkspaceMcp) composed = insertTopLevelRowAfter(composed, 'persona', workspaceRows[0].text.trim(), `RPG Maker preset ${presetId}`);
  composed = insertTopLevelRowAfter(composed, 'persona', forgejoRows[0].text.trim(), `RPG Maker preset ${presetId}`);
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
  const sharedSkillsRoot = join(dirname(source), 'shared', 'skills');
  const sharedForgejoSkills = ['forgejo-agent-issue-report', 'forgejo-user-feedback-report'];
  const sharedForgejoProtocol = join(sharedSkillsRoot, 'forgejo-issue-reporting-protocol.md');
  const sharedForgejoCredentialWrapper = join(dirname(source), 'shared', 'forgejo-mcp-credential-wrapper.mjs');
  if (!(await pathExists(sourceComposition)) || !(await pathExists(metadata))) throw new RpgMakerStartupError(`RPG Maker preset source is incomplete: ${source}`);
  for (const skillName of sharedForgejoSkills) {
    const skillPath = join(sharedSkillsRoot, skillName, 'SKILL.md');
    if (!(await pathExists(skillPath))) throw new RpgMakerStartupError(`RPG Maker preset shared Forgejo skill is missing: ${skillPath}`);
  }
  if (!(await pathExists(sharedForgejoProtocol))) throw new RpgMakerStartupError(`RPG Maker preset shared Forgejo reporting protocol is missing: ${sharedForgejoProtocol}`);
  if (!(await pathExists(sharedForgejoCredentialWrapper))) throw new RpgMakerStartupError(`RPG Maker preset Forgejo credential wrapper is missing: ${sharedForgejoCredentialWrapper}`);
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
  const installedSkillsRoot = join(presetDir, 'skills');
  await mkdir(installedSkillsRoot, { recursive: true });
  await Promise.all([
    ...sharedForgejoSkills.map((skillName) => cp(
      join(sharedSkillsRoot, skillName),
      join(installedSkillsRoot, skillName),
      { recursive: true, force: true }
    )),
    cp(sharedForgejoProtocol, join(installedSkillsRoot, 'forgejo-issue-reporting-protocol.md'), { force: true }),
    cp(sharedForgejoCredentialWrapper, join(presetDir, 'forgejo-mcp-credential-wrapper.mjs'), { force: true })
  ]);
  await writeFile(join(presetDir, 'agent.cordis.yml'), composed);
  await writeFile(join(presetDir, PRESET_OWNERSHIP_FILE), `${JSON.stringify({ owner: 'dsh-rpgmaker-mv', presetId, format: 1 })}\n`);
  return { presetRoot, presetDir };
}

/** Remove an app-owned preset directory that this release no longer ships. */
async function removeOwnedPreset(presetRoot: string, presetId: string): Promise<void> {
  const presetDir = join(presetRoot, presetId);
  if (!(await pathExists(presetDir))) return;
  const ownership = await readJson(join(presetDir, PRESET_OWNERSHIP_FILE));
  if (ownership?.owner !== 'dsh-rpgmaker-mv' || ownership.presetId !== presetId) return;
  await rm(presetDir, { recursive: true, force: true });
}

export async function resolveMcpRunner(options: { jsExecutable?: string; nodeExecutable?: string; projectPath?: string }, platform: string, env: Record<string, string | undefined>): Promise<string> {
  const candidate = options.jsExecutable ?? options.nodeExecutable ?? env.NODE_EXECUTABLE;
  const direct = candidate ? await resolveExecutable(candidate, { platform, env }) : undefined;
  const expectedBasename = (value: string | undefined): value is string => {
    if (!value) return false;
    const name = basename(value).toLowerCase();
    return platform === 'win32' ? name === 'node.exe' : name === 'node';
  };
  if (expectedBasename(direct)) return direct;
  if (platform === 'win32') {
    const nodeExe = await resolveExecutable('node.exe', { platform, env });
    if (expectedBasename(nodeExe)) return nodeExe;
    throw new RpgMakerStartupError('Windows MCP startup requires a resolved direct node.exe; cmd.exe, command.com, and package-manager shims are not valid JavaScript runners.');
  }
  const node = await resolveExecutable('node', { platform, env });
  if (expectedBasename(node)) return node;
  throw new RpgMakerStartupError('MCP startup requires a resolved direct node executable; shell command shims are not valid JavaScript runners.');
}

async function dumpPresetComposition(
  dshExecutable: string,
  compositionPath: string,
  cwd: string,
  platform: string,
  env: Record<string, string | undefined>,
  commandRunner: CommandRunner
): Promise<string> {
  const node = /\.(?:c?m?js)$/i.test(extname(dshExecutable))
    ? env.NODE_EXECUTABLE ?? await resolveExecutable('node', { platform, env })
    : undefined;
  const command = node ?? dshExecutable;
  const commandArgs = node ? [dshExecutable, '--profile', RPGMAKER_DSH_PROFILE, '--patch', compositionPath, '--dump-config'] : ['--profile', RPGMAKER_DSH_PROFILE, '--patch', compositionPath, '--dump-config'];
  let result;
  try {
    if (!command) throw new Error('Node.js could not be resolved for the DSH JavaScript entrypoint.');
    result = await commandRunner(command, commandArgs, {
      cwd,
      env: withoutCredentials(env),
      platform,
      timeoutMs: 60_000
    });
  } catch (error) {
    throw new RpgMakerStartupError(`DSH composition validation could not start: ${redactSensitive(error instanceof Error ? error.message : String(error), env)}`);
  }
  if (result.exitCode !== 0) throw new RpgMakerStartupError(`DSH composition validation failed: ${redactSensitive(result.stderr || result.stdout, env)}`);
  return result.stdout;
}

function validateEffectiveTimeoutPolicyDump(stdout: string): void {
  const effectiveTimeoutRows = effectiveTimeoutPolicyRows(stdout);
  if (effectiveTimeoutRows.length !== 1) {
    throw new RpgMakerStartupError(`DSH composition validation must contain exactly one effective ${DSH_TOOL_TIMEOUT_POLICY_ROW_ID} row; found ${effectiveTimeoutRows.length}.`);
  }
  if (!isOfficialTimeoutPolicyRow(effectiveTimeoutRows[0])) {
    throw new RpgMakerStartupError(`DSH composition validation did not contain the official ${DSH_TOOL_TIMEOUT_POLICY_PACKAGE} row.`);
  }
}

async function validateEffectiveTimeoutPolicyComposition(
  dshExecutable: string,
  compositionPath: string,
  cwd: string,
  platform: string,
  env: Record<string, string | undefined>,
  commandRunner: CommandRunner
): Promise<void> {
  const stdout = await dumpPresetComposition(dshExecutable, compositionPath, cwd, platform, env, commandRunner);
  validateEffectiveTimeoutPolicyDump(stdout);
}

async function validatePresetComposition(
  dshExecutable: string,
  compositionPath: string,
  cwd: string,
  platform: string,
  env: Record<string, string | undefined>,
  commandRunner: CommandRunner
): Promise<void> {
  try {
    await readFile(compositionPath, 'utf8');
  } catch {
    throw new RpgMakerStartupError(`DSH timeout policy Host composition could not be read: ${compositionPath}`);
  }
  const stdout = await dumpPresetComposition(dshExecutable, compositionPath, cwd, platform, env, commandRunner);
  validateEffectiveTimeoutPolicyDump(stdout);
  const dumpedIds = topLevelIds(stdout);
  if (!/id: agent-presets/.test(stdout) || dumpedIds.filter((id) => id === 'agent-presets').length !== 1) {
    throw new RpgMakerStartupError('DSH composition validation did not expose exactly one agent-presets row.');
  }
  if (dumpedIds.includes('mcp-rpgmaker-mv')) {
    throw new RpgMakerStartupError('DSH composition validation still contains the obsolete project-scoped RPG Maker MCP row.');
  }
}

export async function deployRpgMakerPresets(options: RpgMakerPresetDeploymentOptions): Promise<RpgMakerPresetDeployment> {
  const platform = options.platform ?? process.platform;
  const ambientEnv = options.env ?? process.env;
  const { paths } = await resolveReceiptBackedHarnessPaths({ ...options, platform, env: ambientEnv });
  const env = { ...ambientEnv, DSH_HOME: paths.dshHome };
  const agentPreset = options.agentPreset ?? RPGMAKER_PRESET_ID;
  if (!CUSTOM_AGENT_PRESET_IDS.includes(agentPreset as typeof CUSTOM_AGENT_PRESET_IDS[number])) {
    throw new RpgMakerStartupError(`Unknown RPG Maker agent preset: ${agentPreset}`);
  }
  if (!(await pathExists(options.dshExecutable))) {
    throw new RpgMakerStartupError(`DSH executable does not exist: ${options.dshExecutable}. Run bootstrap, then retry.`);
  }

  const codePresetPath = await findCodeComposition(paths.runtimeDir);
  const sourceRoot = options.sourceRoot ?? defaultSourceRoot(RPGMAKER_PRESET_ID);
  await mkdir(paths.neutralLandingDir, { recursive: true });
  return withOwnedRpgMakerProfileRepair(paths.dshHome, async () => {
    const installed = await installPreset(sourceRoot, paths.dshHome, codePresetPath, RPGMAKER_PRESET_ID);
    await removeOwnedPreset(join(paths.dshHome, '.agent-presets'), 'playtest-debug');
    await Promise.all(REMOVED_PRESET_IDS.map((presetId) => removeOwnedPreset(join(paths.dshHome, '.agent-presets'), presetId)));

    const compositionPath = join(paths.dshHome, 'rpgmaker-mv', 'cordis.patch.yml');
    await mkdir(dirname(compositionPath), { recursive: true });
    await writeFile(compositionPath, renderPresetOnlyPatch(installed.presetRoot, agentPreset));
    const timeoutPolicy = await verifyTimeoutPolicyComposition(paths.dshHome, installed.presetRoot);
    if (!timeoutPolicy.valid) throw new RpgMakerStartupError(`DSH timeout policy composition is not usable: ${timeoutPolicy.errors.join('; ')}`);
    await validatePresetComposition(options.dshExecutable, compositionPath, paths.neutralLandingDir, platform, env, options.commandRunner ?? runCommand);

    return {
      presetRoot: installed.presetRoot,
      presetDir: join(installed.presetRoot, agentPreset),
      codePresetPath,
      compositionPath,
      agentPreset
    };
  });
}

export async function prepareRpgMakerLaunch(options: RpgMakerLaunchOptions): Promise<RpgMakerLaunchPreparation> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') throw new RpgMakerStartupError('RPG Maker Agent is supported on Windows only.');
  const ambientEnv = options.env ?? process.env;
  const { paths } = await resolveReceiptBackedHarnessPaths({ ...options, platform, env: ambientEnv });
  const env = { ...ambientEnv, DSH_HOME: paths.dshHome };
  const agentPreset = options.agentPreset ?? RPGMAKER_PRESET_ID;
  if (!CUSTOM_AGENT_PRESET_IDS.includes(agentPreset as typeof CUSTOM_AGENT_PRESET_IDS[number])) {
    throw new RpgMakerStartupError(`Unknown RPG Maker agent preset: ${agentPreset}`);
  }

  const prepareDsh = options.dshRuntimePreparer ?? bootstrapRuntime;
  const dshBootstrap = await prepareDsh({
    platform,
    env,
    dshHome: paths.dshHome,
    mutableRoot: paths.mutableRoot,
    runtimeDir: paths.runtimeDir,
    nodeExecutable: options.jsExecutable ?? options.nodeExecutable,
    npmExecutable: options.npmExecutable,
    commandRunner: options.commandRunner,
    lockTimeoutMs: options.lockTimeoutMs,
    lockRetryMs: options.lockRetryMs
  });
  if (!dshBootstrap.verification.valid) {
    throw new RpgMakerStartupError(`Pinned DSH runtime is not usable: ${dshBootstrap.verification.errors.join('; ')}`);
  }
  const dshExecutable = options.dshExecutable ?? dshBootstrap.verification.dshExecutable ?? await resolveDshEntrypoint(paths.runtimeDir, platform);
  if (!dshExecutable) throw new RpgMakerStartupError('Pinned DSH executable was not found; refusing to launch an unverified project-neutral Host.');
  if (!(await pathExists(dshExecutable))) {
    throw new RpgMakerStartupError(`DSH executable does not exist: ${dshExecutable}. Run bootstrap, then retry.`);
  }

  const mcporterRuntimeDir = resolve(options.mcporterRuntimeDir ?? mcporterRuntimeDirFor(paths));
  const prepareMcporter = options.mcporterRuntimePreparer ?? prepareMcporterRuntime;
  const mcporter = await prepareMcporter({
    platform,
    env,
    dshHome: paths.dshHome,
    mutableRoot: paths.mutableRoot,
    runtimeDir: paths.runtimeDir,
    nodeExecutable: options.jsExecutable ?? options.nodeExecutable,
    npmExecutable: options.npmExecutable,
    commandRunner: options.commandRunner,
    lockTimeoutMs: options.lockTimeoutMs,
    lockRetryMs: options.lockRetryMs
  }, mcporterRuntimeDir);
  if (!mcporter.valid) throw new RpgMakerStartupError(`Pinned MCPorter runtime is not usable: ${mcporter.errors.join('; ')}`);

  const rpgmakerRuntimeDir = resolve(options.rpgmakerRuntimeDir ?? join(paths.programRoot, 'runtime', 'mcp'));
  const prepareMcp = options.mcpRuntimePreparer ?? prepareRpgMakerMcpRuntime;
  const mcp = await prepareMcp({
    platform,
    env,
    nodeExecutable: options.jsExecutable ?? options.nodeExecutable,
    npmExecutable: options.npmExecutable,
    commandRunner: options.commandRunner
  }, rpgmakerRuntimeDir);
  const mvScript = mcp.engines.mv.executable;
  const mzScript = mcp.engines.mz.executable;
  if (!mcp.valid || !mvScript || !mzScript) throw new RpgMakerStartupError(`Pinned RPG Maker MCP runtime is not usable: ${mcp.errors.join('; ')}`);
  const jsRunner = await resolveMcpRunner(options, platform, withoutCredentials(env));

  const managedWebProfileOptions: ManagedWebProfileOptions = {
    platform,
    env,
    dshHome: paths.dshHome,
    mutableRoot: paths.mutableRoot,
    runtimeDir: paths.runtimeDir,
    dshExecutable,
    npmExecutable: options.npmExecutable,
    pnpmExecutable: options.pnpmExecutable,
    pnpmRuntimeDir: options.pnpmRuntimeDir,
    nodeExecutable: options.jsExecutable ?? options.nodeExecutable,
    commandRunner: options.commandRunner,
    lockTimeoutMs: options.lockTimeoutMs,
    lockRetryMs: options.lockRetryMs
  };
  const managedWebProfile = options.managedWebProfilePreparer
    ? await options.managedWebProfilePreparer(managedWebProfileOptions)
    : await ensureManagedWebProfile(managedWebProfileOptions);
  if (!managedWebProfile.valid) throw new RpgMakerStartupError(`Managed Web profile is not usable: ${managedWebProfile.errors.join('; ')}`);

  const presets = await deployRpgMakerPresets({
    platform,
    env,
    dshHome: paths.dshHome,
    mutableRoot: paths.mutableRoot,
    runtimeDir: paths.runtimeDir,
    dshExecutable,
    sourceRoot: options.sourceRoot,
    agentPreset,
    commandRunner: options.commandRunner
  });

  return {
    dshExecutable,
    mcporterRuntimeDir,
    rpgmakerRuntimeDir,
    rpgmakerScripts: { mv: mvScript, mz: mzScript },
    jsRunner,
    ...presets,
    managedWebProfile
  };
}

export interface RpgMakerLaunchResult extends LaunchResult {
  deployment: RpgMakerLaunchPreparation;
}

export async function launchRpgmakerProject(options: RpgMakerLaunchOptions): Promise<RpgMakerLaunchResult> {
  if ((options.platform ?? process.platform) !== 'win32') throw new RpgMakerStartupError('RPG Maker Agent is supported on Windows only.');
  if (options.webHost !== undefined && options.webHost !== WINDOWS_DSH_HOST) throw new RpgMakerStartupError(`The DSH web binding is fixed at ${WINDOWS_DSH_HOST}:${WINDOWS_DSH_PORT}.`);
  if (options.webPort !== undefined && options.webPort !== WINDOWS_DSH_PORT) throw new RpgMakerStartupError(`The DSH web binding is fixed at ${WINDOWS_DSH_HOST}:${WINDOWS_DSH_PORT}.`);
  if (options.dshArgs?.some((argument) => argument === '--project' || argument.startsWith('--project='))) {
    throw new RpgMakerStartupError('The project-neutral launch does not accept --project; choose a workspace in DSH Web.');
  }
  if (options.dshArgs) addFixedWebBinding(options.dshArgs);
  await ensureLaunchPort({ ...options, bindWeb: true, webHost: WINDOWS_DSH_HOST, webPort: WINDOWS_DSH_PORT });
  const deployment = await prepareRpgMakerLaunch(options);
  const { paths } = await resolveReceiptBackedHarnessPaths(options);
  const env = { ...(options.env ?? process.env), DSH_HOME: paths.dshHome };
  const ownedEnvironment = {
    [MCPORTER_RUNTIME_ENV]: deployment.mcporterRuntimeDir,
    [RPGMAKER_MCP_RUNTIME_ENV]: deployment.rpgmakerRuntimeDir,
    [JS_RUNNER_ENV]: deployment.jsRunner
  };
  const result = await launchProject({
    ...options,
    env,
    nodeExecutable: deployment.jsRunner,
    dshExecutable: deployment.dshExecutable,
    bindWeb: true,
    portAlreadyChecked: true,
    webHost: WINDOWS_DSH_HOST,
    webPort: WINDOWS_DSH_PORT,
    extraEnv: { ...(options.extraEnv ?? {}), ...ownedEnvironment },
    dshArgs: [
      '--profile',
      RPGMAKER_DSH_PROFILE,
      ...(options.dshArgs ?? []),
      '--patch',
      deployment.compositionPath,
      // Desktop hosts own the WebView; explicitly suppress DSH's external
      // browser opener when the sidecar requests the embedded-only path.
      ...(options.openWebBrowser === false ? ['--no-open'] : [])
    ]
  });
  return { ...result, deployment };
}

export { validateEffectiveTimeoutPolicyComposition, validatePresetComposition };
