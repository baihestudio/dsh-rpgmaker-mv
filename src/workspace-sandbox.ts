import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join, parse as parsePath, resolve, win32 } from 'node:path';

import { redactSensitive, withoutCredentials, type CommandResult, type CommandRunner } from './process';

export interface WorkspaceSandboxCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  path?: string;
}

export interface WorkspaceSandboxOptions {
  workspace: string;
  sandboxProbe?: boolean;
  platform: string;
  env: Record<string, string | undefined>;
  runtimeDir: string;
  pwshExecutable?: string;
  nodeExecutable?: string;
  commandRunner: CommandRunner;
}

interface WorkspaceFacts {
  workspace: string;
  user: string;
  owner: string;
  ownerMatchesUser: boolean;
  integrity: 'low' | 'medium' | 'high' | 'system' | 'unknown';
  elevated: boolean;
  fileSystem: string;
  driveType: number;
  isReparsePoint: boolean;
}

function check(id: string, label: string, ok: boolean, detail: string, path?: string): WorkspaceSandboxCheck {
  return { id, label, ok, detail, ...(path ? { path } : {}) };
}

function encodedPowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function encodedUtf8(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function displayOutput(result: CommandResult, env: Record<string, string | undefined>): string {
  const text = redactSensitive((result.stderr || result.stdout).trim(), env).replace(/\s+/g, ' ');
  return text.length > 600 ? `${text.slice(0, 597)}...` : text;
}

function diagnosticScript(workspace: string): string {
  const encodedWorkspace = encodedUtf8(workspace);
  return [
    "$ErrorActionPreference = 'Stop'",
    `$workspace = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedWorkspace}'))`,
    '$item = Get-Item -Force -LiteralPath $workspace',
    'if (-not $item.PSIsContainer) { throw "Workspace is not a directory: $workspace" }',
    '$acl = Get-Acl -LiteralPath $workspace',
    '$identity = [Security.Principal.WindowsIdentity]::GetCurrent()',
    '$principal = [Security.Principal.WindowsPrincipal]::new($identity)',
    "$groups = (& whoami.exe /groups 2>$null | Out-String)",
    "$integrity = if ($groups -match 'S-1-16-16384') { 'system' } elseif ($groups -match 'S-1-16-12288') { 'high' } elseif ($groups -match 'S-1-16-8192') { 'medium' } elseif ($groups -match 'S-1-16-4096') { 'low' } else { 'unknown' }",
    "$drive = [IO.Path]::GetPathRoot($workspace).TrimEnd('\\')",
    "$disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter \"DeviceID='$drive'\" -ErrorAction SilentlyContinue",
    '$isReparsePoint = [bool](($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)',
    '[pscustomobject]@{',
    '  workspace = [string]$item.FullName',
    '  user = [string]$identity.Name',
    '  owner = [string]$acl.Owner',
    '  ownerMatchesUser = [String]::Equals([string]$acl.Owner, [string]$identity.Name, [StringComparison]::OrdinalIgnoreCase)',
    '  integrity = $integrity',
    '  elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
    "  fileSystem = if ($null -eq $disk) { '' } else { [string]$disk.FileSystem }",
    '  driveType = if ($null -eq $disk) { 0 } else { [int]$disk.DriveType }',
    '  isReparsePoint = $isReparsePoint',
    '} | ConvertTo-Json -Compress'
  ].join('\n');
}

function probeScript(probe: string): string {
  const encodedProbe = encodedUtf8(probe);
  return [
    "$ErrorActionPreference = 'Stop'",
    `$probe = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedProbe}'))`,
    "$nested = Join-Path $probe 'nested'",
    "$before = Join-Path $nested 'before.txt'",
    "$after = Join-Path $nested 'after.txt'",
    'if (Test-Path -LiteralPath $probe) { throw "Refusing to use an existing probe path: $probe" }',
    'try {',
    '  New-Item -ItemType Directory -Path $probe -ErrorAction Stop | Out-Null',
    '  New-Item -ItemType Directory -Path $nested -ErrorAction Stop | Out-Null',
    "  Set-Content -LiteralPath $before -Value 'alpha' -NoNewline -ErrorAction Stop",
    "  Add-Content -LiteralPath $before -Value '-beta' -NoNewline -ErrorAction Stop",
    '  Move-Item -LiteralPath $before -Destination $after -ErrorAction Stop',
    '  $content = Get-Content -LiteralPath $after -Raw -ErrorAction Stop',
    "  if ($content -ne 'alpha-beta') { throw \"Unexpected probe content: $content\" }",
    '  $hash = (Get-FileHash -LiteralPath $after -Algorithm SHA256 -ErrorAction Stop).Hash',
    '  [pscustomobject]@{ success = $true; content = $content; sha256 = $hash } | ConvertTo-Json -Compress',
    '} finally {',
    '  if (Test-Path -LiteralPath $probe) { Remove-Item -LiteralPath $probe -Recurse -Force -ErrorAction Stop }',
    '  if (Test-Path -LiteralPath $probe) { throw "Sandbox probe cleanup failed: $probe" }',
    '}'
  ].join('\n');
}

function parseFacts(output: string): WorkspaceFacts | undefined {
  try {
    const value = JSON.parse(output) as Partial<WorkspaceFacts>;
    if (
      typeof value.workspace !== 'string'
      || typeof value.user !== 'string'
      || typeof value.owner !== 'string'
      || typeof value.ownerMatchesUser !== 'boolean'
      || !['low', 'medium', 'high', 'system', 'unknown'].includes(String(value.integrity))
      || typeof value.elevated !== 'boolean'
      || typeof value.fileSystem !== 'string'
      || typeof value.driveType !== 'number'
      || typeof value.isReparsePoint !== 'boolean'
    ) return undefined;
    return value as WorkspaceFacts;
  } catch {
    return undefined;
  }
}

function parseProbe(output: string): { success: boolean; content: string; sha256: string } | undefined {
  for (const line of output.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).reverse()) {
    try {
      const value = JSON.parse(line) as Partial<{ success: boolean; content: string; sha256: string }>;
      if (value.success === true && value.content === 'alpha-beta' && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(value.sha256)) {
        return value as { success: boolean; content: string; sha256: string };
      }
    } catch {
      // The runner may write its own non-JSON diagnostics before the probe result.
    }
  }
  return undefined;
}

function isRootDirectory(path: string, platform: string): boolean {
  if (platform === 'win32') {
    const normalized = path.replaceAll('/', '\\').replace(/\\+$/, '\\').toLowerCase();
    return normalized === win32.parse(normalized).root.toLowerCase();
  }
  return path === parsePath(path).root;
}

function powershellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function repairCommand(workspace: string, user: string): string {
  return `icacls ${powershellQuote(workspace)} /setowner ${powershellQuote(user)}`;
}

async function workspacePathCheck(workspace: string, platform: string): Promise<WorkspaceSandboxCheck> {
  if (isRootDirectory(workspace, platform)) {
    return check('workspace-path', 'Workspace path safety', false, 'Refusing to inspect a filesystem root. Supply the exact project directory instead.', workspace);
  }
  try {
    const info = await lstat(workspace);
    if (!info.isDirectory()) return check('workspace-path', 'Workspace path safety', false, 'The supplied workspace is not a directory.', workspace);
    if (info.isSymbolicLink()) return check('workspace-path', 'Workspace path safety', false, 'The supplied workspace is a symbolic link or junction. Use its direct local NTFS target instead.', workspace);
    return check('workspace-path', 'Workspace path safety', true, 'Workspace is a direct directory.', workspace);
  } catch {
    return check('workspace-path', 'Workspace path safety', false, 'The supplied workspace does not exist or cannot be inspected.', workspace);
  }
}

/**
 * Inspect the selected workspace from the token running Doctor. The optional
 * probe invokes the pinned DSH ACL runner, so it deliberately materializes the
 * same standing workspace grant that a normal workspace-write session needs.
 */
export async function inspectWorkspaceSandbox(options: WorkspaceSandboxOptions): Promise<WorkspaceSandboxCheck[]> {
  if (!options.workspace.trim()) {
    return [check('workspace-path', 'Workspace path safety', false, 'Supply the exact workspace directory to inspect.', options.workspace)];
  }
  const workspace = resolve(options.workspace);
  if (options.platform !== 'win32') {
    return [check('workspace-sandbox-platform', 'Workspace sandbox diagnostics', false, 'Workspace sandbox diagnostics are available only on Windows.', workspace)];
  }

  const checks: WorkspaceSandboxCheck[] = [];
  const pathCheck = await workspacePathCheck(workspace, options.platform);
  checks.push(pathCheck);
  if (!pathCheck.ok) {
    if (options.sandboxProbe) checks.push(check('workspace-sandbox-probe', 'Workspace sandbox probe', false, 'Probe skipped because the workspace path is unsafe or unavailable.', workspace));
    return checks;
  }

  if (!options.pwshExecutable) {
    checks.push(check('workspace-token', 'Normal DSH token', false, 'PowerShell 7 is unavailable, so Doctor cannot inspect the current Windows token.', workspace));
    if (options.sandboxProbe) checks.push(check('workspace-sandbox-probe', 'Workspace sandbox probe', false, 'Probe skipped because PowerShell 7 is unavailable.', workspace));
    return checks;
  }

  let facts: WorkspaceFacts | undefined;
  try {
    const result = await options.commandRunner(options.pwshExecutable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedPowerShell(diagnosticScript(workspace))], {
      cwd: workspace,
      env: withoutCredentials(options.env),
      platform: 'win32',
      timeoutMs: 30_000
    });
    facts = result.exitCode === 0 ? parseFacts(result.stdout) : undefined;
    if (!facts) {
      checks.push(check('workspace-token', 'Normal DSH token', false, result.exitCode === 0
        ? 'Doctor could not parse the Windows workspace diagnostic result.'
        : `Doctor could not inspect the current Windows token (exit code ${result.exitCode}${displayOutput(result, options.env) ? `: ${displayOutput(result, options.env)}` : ''}).`, workspace));
      if (options.sandboxProbe) checks.push(check('workspace-sandbox-probe', 'Workspace sandbox probe', false, 'Probe skipped because the Windows token could not be inspected.', workspace));
      return checks;
    }
  } catch (error) {
    checks.push(check('workspace-token', 'Normal DSH token', false, `Doctor could not inspect the current Windows token: ${redactSensitive(error instanceof Error ? error.message : String(error), options.env)}`, workspace));
    if (options.sandboxProbe) checks.push(check('workspace-sandbox-probe', 'Workspace sandbox probe', false, 'Probe skipped because the Windows token could not be inspected.', workspace));
    return checks;
  }

  const tokenOk = facts.integrity === 'medium' && !facts.elevated;
  checks.push(check(
    'workspace-token',
    'Normal DSH token',
    tokenOk,
    tokenOk
      ? `Current token is medium integrity for ${facts.user}.`
      : facts.integrity === 'high' || facts.elevated
        ? 'Doctor is running with an elevated token. Close this administrator terminal and rerun Doctor normally so it matches DSH.'
        : `Expected a medium-integrity non-elevated token, but found ${facts.integrity} integrity for ${facts.user}.`,
    workspace
  ));

  const ownerOk = facts.ownerMatchesUser;
  checks.push(check(
    'workspace-owner',
    'Workspace owner',
    ownerOk,
    ownerOk
      ? `Workspace is owned by the current DSH user (${facts.user}).`
      : `Workspace owner is ${facts.owner}, not ${facts.user}. The Windows ACL sandbox needs the normal DSH user to modify the workspace root DACL. In an administrator PowerShell, run: ${repairCommand(workspace, facts.user)}`,
    workspace
  ));

  const volumeOk = facts.fileSystem.toUpperCase() === 'NTFS' && facts.driveType === 3 && !facts.isReparsePoint;
  checks.push(check(
    'workspace-volume',
    'Workspace volume',
    volumeOk,
    volumeOk
      ? 'Workspace is on a direct local NTFS volume.'
      : `Expected a direct local NTFS workspace, but found filesystem=${facts.fileSystem || 'unknown'}, driveType=${facts.driveType || 'unknown'}, reparsePoint=${facts.isReparsePoint}.`,
    workspace
  ));

  if (!options.sandboxProbe) return checks;

  if (!tokenOk || !ownerOk || !volumeOk) {
    checks.push(check('workspace-sandbox-probe', 'Workspace sandbox probe', false, 'Probe skipped until the normal token, workspace owner, and local NTFS checks pass.', workspace));
    return checks;
  }
  if (!options.nodeExecutable) {
    checks.push(check('workspace-sandbox-probe', 'Workspace sandbox probe', false, 'Node.js is unavailable, so Doctor cannot invoke the pinned DSH ACL runner.', workspace));
    return checks;
  }

  const runnerPath = join(options.runtimeDir, 'node_modules', '@deepseek-ai', 'dsh-sandbox-windows-acl', 'lib', 'runner.js');
  try {
    const runner = await lstat(runnerPath);
    if (!runner.isFile() || runner.isSymbolicLink()) {
      checks.push(check('workspace-sandbox-probe', 'Workspace sandbox probe', false, 'The pinned DSH Windows ACL runner is missing or unsafe; run installer.exe from the extracted Release to repair the runtime.', runnerPath));
      return checks;
    }
  } catch {
    checks.push(check('workspace-sandbox-probe', 'Workspace sandbox probe', false, 'The pinned DSH Windows ACL runner was not found; run installer.exe from the extracted Release to repair the runtime.', runnerPath));
    return checks;
  }

  const tempRoot = options.env.TEMP ?? options.env.TMP;
  if (!tempRoot) {
    checks.push(check('workspace-sandbox-probe', 'Workspace sandbox probe', false, 'Windows TEMP/TMP is unavailable, so Doctor cannot create the runner private temp directory.', workspace));
    return checks;
  }

  const probe = join(workspace, `.dsh-rpgmaker-sandbox-probe-${randomUUID()}`);
  try {
    const result = await options.commandRunner(options.nodeExecutable, [
      runnerPath,
      '--workspace', workspace,
      '--temp', tempRoot,
      '--mode', 'workspace-write',
      '--',
      options.pwshExecutable,
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      encodedPowerShell(probeScript(probe))
    ], {
      cwd: workspace,
      env: withoutCredentials(options.env),
      platform: 'win32',
      timeoutMs: 120_000
    });
    const probeResult = result.exitCode === 0 ? parseProbe(result.stdout) : undefined;
    checks.push(check(
      'workspace-sandbox-probe',
      'Workspace sandbox probe',
      Boolean(probeResult),
      probeResult
        ? `Pinned DSH workspace-write runner created, changed, verified, and removed its probe directory (SHA-256 ${probeResult.sha256}).`
        : `Pinned DSH workspace-write runner failed (exit code ${result.exitCode}${displayOutput(result, options.env) ? `: ${displayOutput(result, options.env)}` : ''}).`,
      workspace
    ));
  } catch (error) {
    checks.push(check('workspace-sandbox-probe', 'Workspace sandbox probe', false, `Pinned DSH workspace-write runner could not start: ${redactSensitive(error instanceof Error ? error.message : String(error), options.env)}`, workspace));
  }
  return checks;
}
