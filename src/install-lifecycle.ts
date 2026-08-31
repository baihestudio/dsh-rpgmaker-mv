import { join, resolve } from 'node:path';
import { lstat, readFile } from 'node:fs/promises';
import { stdin as processStdin, stdout as processStdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

import { PROGRAM_OWNER, PROGRAM_OWNERSHIP_FILE, PRODUCT_NAME } from './config';
import { resolveWindowsPwsh } from './executable';
import { runCommand, withoutCredentials, type CommandRunner } from './process';

/** A process record returned by the Windows CIM inventory seam. */
export interface OwnedProcessRecord {
  pid: number;
  parentPid: number;
  image?: string;
  executablePath?: string;
  commandLine?: string;
}

export interface OwnedInstallation {
  programRoot: string;
  processes: OwnedProcessRecord[];
  /** Top-level owned PIDs; each taskkill call owns its descendants. */
  rootPids: number[];
}

export type OwnedProcessLister = (programRoot: string, options?: OwnedProcessInventoryOptions) => Promise<OwnedProcessRecord[]>;
export type OwnedProcessTreeStopper = (pid: number, options?: OwnedProcessStopOptions) => Promise<void>;
export type OwnedAgentConsent = (installation: OwnedInstallation) => Promise<boolean> | boolean;

export interface OwnedProcessInventoryOptions {
  platform?: string;
  env?: Record<string, string | undefined>;
  commandRunner?: CommandRunner;
  pwshExecutable?: string;
}

export interface OwnedProcessStopOptions extends OwnedProcessInventoryOptions {}

export interface OwnedUpgradeOptions extends OwnedProcessInventoryOptions {
  /** Test-owned process table; avoids touching the host process list. */
  processRecords?: OwnedProcessRecord[];
  listProcesses?: OwnedProcessLister;
  stopProcessTree?: OwnedProcessTreeStopper;
  consent?: OwnedAgentConsent;
}

export class RunningAgentCloseDeclinedError extends Error {
  readonly installation: OwnedInstallation;

  constructor(installation: OwnedInstallation) {
    super('The installed RPG Maker Agent is running; the upgrade was cancelled and no installation state was changed.');
    this.name = 'RunningAgentCloseDeclinedError';
    this.installation = installation;
  }
}

const WINDOWS_PROCESS_QUERY = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; $ErrorActionPreference='Stop'; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function numeric(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function parseProcessRecord(value: unknown): OwnedProcessRecord | undefined {
  const item = asRecord(value);
  if (!item) return undefined;
  const pid = numeric(item.ProcessId ?? item.pid);
  const parentPid = numeric(item.ParentProcessId ?? item.parentPid) ?? 0;
  if (!pid) return undefined;
  return {
    pid,
    parentPid,
    image: typeof (item.Name ?? item.image) === 'string' ? String(item.Name ?? item.image) : undefined,
    executablePath: typeof (item.ExecutablePath ?? item.executablePath) === 'string' ? String(item.ExecutablePath ?? item.executablePath) : undefined,
    commandLine: typeof (item.CommandLine ?? item.commandLine) === 'string' ? String(item.CommandLine ?? item.commandLine) : undefined
  };
}

/** Parse the stable JSON shape emitted by Win32_Process/CIM. */
export function parseWindowsProcessTable(text: string): OwnedProcessRecord[] {
  if (!text.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('Windows process inventory returned invalid JSON.');
  }
  const values = Array.isArray(parsed) ? parsed : [parsed];
  return values.map(parseProcessRecord).filter((value): value is OwnedProcessRecord => value !== undefined);
}

function slashPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/{2,}/g, '/');
}

function normalizePath(value: string): string {
  const slash = slashPath(value).replace(/^\/\/\?\//, '');
  const absolute = /^[a-z]:\//i.test(slash) || slash.startsWith('/');
  const resolved = absolute ? slash : resolve(slash);
  return resolved.replace(/\/$/, '').toLowerCase();
}

function pathInside(root: string, candidate: string): boolean {
  const rootKey = normalizePath(root);
  const candidateKey = normalizePath(candidate);
  return candidateKey === rootKey || candidateKey.startsWith(`${rootKey}/`);
}

/** Match a command-line path only at a path boundary, not `root-copy`. */
function commandLineMentionsRoot(commandLine: string | undefined, root: string): boolean {
  if (!commandLine) return false;
  const command = slashPath(commandLine).toLowerCase();
  const target = normalizePath(root);
  let offset = command.indexOf(target);
  while (offset >= 0) {
    const before = offset === 0 ? '' : command[offset - 1]!;
    const after = command[offset + target.length] ?? '';
    const beforeBoundary = before === '' || !/[a-z0-9_.-]/i.test(before);
    const afterBoundary = after === '' || after === '/' || after === '\\' || /[\s"'=]/.test(after);
    if (beforeBoundary && afterBoundary) return true;
    offset = command.indexOf(target, offset + 1);
  }
  return false;
}

function processBelongsToRoot(record: OwnedProcessRecord, root: string): boolean {
  return (record.executablePath !== undefined && pathInside(root, record.executablePath))
    || commandLineMentionsRoot(record.commandLine, root);
}

async function markerOwned(programRoot: string): Promise<boolean> {
  try {
    const marker = asRecord(JSON.parse(await readFile(join(programRoot, PROGRAM_OWNERSHIP_FILE), 'utf8')));
    return marker?.owner === PROGRAM_OWNER && marker.product === PRODUCT_NAME && marker.format === 1;
  } catch {
    return false;
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    return metadata.isDirectory() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Inventory only an installation carrying our ownership marker.  A process
 * name is never sufficient: executable path or command-line path must resolve
 * beneath the owned program root.
 */
export async function findOwnedAgent(
  programRootInput: string,
  options: OwnedUpgradeOptions = {},
): Promise<OwnedInstallation | undefined> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') return undefined;
  const programRoot = resolve(programRootInput);
  if (!(await directoryExists(programRoot)) || !(await markerOwned(programRoot))) return undefined;

  let records: OwnedProcessRecord[];
  if (options.processRecords) {
    records = options.processRecords;
  } else {
    // Unit tests can request a Windows seam from a non-Windows runner by
    // supplying a lister. The default inventory is deliberately not attempted
    // there because it would not be a Windows process table.
    if (!options.listProcesses && process.platform !== 'win32') return undefined;
    const list = options.listProcesses ?? listWindowsProcesses;
    records = await list(programRoot, options);
  }
  const processes = records.filter((record) => processBelongsToRoot(record, programRoot));
  if (processes.length === 0) return undefined;
  const pids = new Set(processes.map((record) => record.pid));
  const rootPids = processes
    .filter((record) => !pids.has(record.parentPid))
    .map((record) => record.pid)
    .filter((pid, index, all) => all.indexOf(pid) === index)
    .sort((left, right) => left - right);
  return { programRoot, processes, rootPids: rootPids.length > 0 ? rootPids : [...pids].sort((left, right) => left - right) };
}

export async function listWindowsProcesses(
  _programRoot?: string,
  options: OwnedProcessInventoryOptions = {},
): Promise<OwnedProcessRecord[]> {
  if ((options.platform ?? process.platform) !== 'win32') return [];
  const env = options.env ?? process.env;
  const runner = options.commandRunner ?? runCommand;
  const pwsh = options.pwshExecutable ?? env.PWSH_EXECUTABLE ?? await resolveWindowsPwsh({ platform: 'win32', env }) ?? 'powershell.exe';
  const result = await runner(pwsh, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_PROCESS_QUERY], {
    env: withoutCredentials(env),
    platform: 'win32',
    timeoutMs: 30_000
  });
  if (result.exitCode !== 0) throw new Error(`Windows process inventory failed with exit code ${result.exitCode}.`);
  return parseWindowsProcessTable(result.stdout);
}

export async function stopWindowsProcessTree(pid: number, options: OwnedProcessStopOptions = {}): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Cannot stop an invalid owned process id: ${pid}.`);
  if ((options.platform ?? process.platform) !== 'win32') throw new Error('Owned process-tree termination is supported on Windows only.');
  const env = options.env ?? process.env;
  const runner = options.commandRunner ?? runCommand;
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT;
  const taskkill = systemRoot ? join(systemRoot, 'System32', 'taskkill.exe') : 'taskkill.exe';
  const result = await runner(taskkill, ['/PID', String(pid), '/T', '/F'], {
    env: withoutCredentials(env),
    platform: 'win32',
    timeoutMs: 30_000
  });
  if (result.exitCode !== 0) throw new Error(`Could not stop the owned RPG Maker Agent process tree rooted at PID ${pid}.`);
}

async function defaultConsent(installation: OwnedInstallation): Promise<boolean> {
  if (!processStdin.isTTY || !processStdout.isTTY) return false;
  const readline = createInterface({ input: processStdin, output: processStdout });
  try {
    const answer = (await readline.question(
      `RPG Maker Agent is running from ${installation.programRoot} (PID${installation.rootPids.length === 1 ? '' : 's'} ${installation.rootPids.join(', ')}). Close it before upgrading? [Y/N] `
    )).trim();
    return /^(?:y|yes)$/i.test(answer);
  } finally {
    readline.close();
  }
}

/** Detect, ask once, and stop only an owned Agent process tree. */
export async function confirmAndStopOwnedAgent(options: OwnedUpgradeOptions & { programRoot: string }): Promise<OwnedInstallation | undefined> {
  const installation = await findOwnedAgent(options.programRoot, options);
  if (!installation) return undefined;
  const approved = await (options.consent ?? defaultConsent)(installation);
  if (!approved) throw new RunningAgentCloseDeclinedError(installation);
  const stop = options.stopProcessTree ?? stopWindowsProcessTree;
  for (const pid of installation.rootPids) await stop(pid, options);
  return installation;
}

export { processBelongsToRoot, pathInside };
