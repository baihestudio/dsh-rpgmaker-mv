import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { resolveHarnessPaths, type PathOptions } from './config';
import { runCommand, withoutCredentials, type CommandRunner } from './process';

export const FORGEJO_MCP_RUNTIME_RELATIVE = 'tools/forgejo-mcp';
export const FORGEJO_MCP_EXECUTABLE_NAME = 'forgejo-mcp.exe';
export const FORGEJO_MCP_MANIFEST_NAME = 'forgejo-mcp.manifest.json';
export const FORGEJO_MCP_LICENSE_NAME = 'LICENSE';
export const FORGEJO_MCP_VERSION = '2.34.1';
export const FORGEJO_MCP_SHA256 = 'b41b377740e9722a1058a1cf878289089389e05053ece6102841f96ad44c61a1';
export const FORGEJO_MCP_LICENSE_SHA256 = 'e1f9fdc9130b8fb716d2d9c57f0475646ec17e25bf17c7ee5ef513d5b8be4224';
export const FORGEJO_MCP_SOURCE_COMMIT = '223874f344d34c8922a6b299c83ec368b902e1a0';
export const FORGEJO_MCP_GO_VERSION = 'go1.26.5';

export interface ForgejoMcpRuntimeOptions extends PathOptions {
  platform?: string;
  env?: Record<string, string | undefined>;
  programRoot?: string;
  commandRunner?: CommandRunner;
  probeVersion?: boolean;
}

export interface ForgejoMcpRuntimeVerification {
  valid: boolean;
  errors: string[];
  executablePath: string;
  manifestPath: string;
  licensePath: string;
  sha256?: string;
  licenseSha256?: string;
  versionOutput?: string;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function isExpected(value: unknown, expected: string | number | boolean): boolean {
  return value === expected;
}

async function regularFile(path: string): Promise<boolean> {
  const info = await lstat(path).catch(() => undefined);
  return Boolean(info?.isFile() && !info.isSymbolicLink());
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function manifestErrors(value: unknown): string[] {
  const manifest = asRecord(value);
  if (!manifest) return ['Forgejo MCP manifest is not a JSON object.'];
  const source = asRecord(manifest.source);
  const build = asRecord(manifest.build);
  const errors: string[] = [];
  if (!isExpected(manifest.format, 1)) errors.push('Forgejo MCP manifest format is unsupported.');
  if (!isExpected(manifest.name, 'forgejo-mcp')) errors.push('Forgejo MCP manifest has an unexpected name.');
  if (!isExpected(manifest.version, FORGEJO_MCP_VERSION)) errors.push(`Forgejo MCP manifest version is not ${FORGEJO_MCP_VERSION}.`);
  if (!isExpected(manifest.executable, FORGEJO_MCP_EXECUTABLE_NAME)) errors.push('Forgejo MCP manifest has an unexpected executable name.');
  if (!isExpected(manifest.sha256, FORGEJO_MCP_SHA256)) errors.push('Forgejo MCP manifest SHA-256 does not match the pinned release.');
  if (!isExpected(manifest.license, 'GPL-3.0-or-later')) errors.push('Forgejo MCP manifest has an unexpected license.');
  if (!source || !isExpected(source.commit, FORGEJO_MCP_SOURCE_COMMIT)) errors.push('Forgejo MCP manifest source commit does not match the pinned release.');
  if (!build || !isExpected(build.goVersion, FORGEJO_MCP_GO_VERSION)) errors.push('Forgejo MCP manifest Go version does not match the pinned release.');
  if (!build || !isExpected(build.goos, 'windows') || !isExpected(build.goarch, 'amd64') || !isExpected(build.cgoEnabled, false)) {
    errors.push('Forgejo MCP manifest target does not match the supported Windows amd64 release.');
  }
  return errors;
}

export function forgejoMcpRuntimeDirectory(programRoot: string): string {
  return join(resolve(programRoot), FORGEJO_MCP_RUNTIME_RELATIVE);
}

export function forgejoMcpExecutablePath(programRoot: string): string {
  return join(forgejoMcpRuntimeDirectory(programRoot), FORGEJO_MCP_EXECUTABLE_NAME);
}

export function forgejoMcpManifestPath(programRoot: string): string {
  return join(forgejoMcpRuntimeDirectory(programRoot), FORGEJO_MCP_MANIFEST_NAME);
}

export function forgejoMcpLicensePath(programRoot: string): string {
  return join(forgejoMcpRuntimeDirectory(programRoot), FORGEJO_MCP_LICENSE_NAME);
}

export async function verifyForgejoMcpRuntime(options: ForgejoMcpRuntimeOptions = {}): Promise<ForgejoMcpRuntimeVerification> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const programRoot = resolve(options.programRoot ?? resolveHarnessPaths(options).programRoot);
  const executablePath = forgejoMcpExecutablePath(programRoot);
  const manifestPath = forgejoMcpManifestPath(programRoot);
  const licensePath = forgejoMcpLicensePath(programRoot);
  const errors: string[] = [];

  if (!(await regularFile(manifestPath))) errors.push(`Forgejo MCP manifest is not a regular app-owned file: ${manifestPath}.`);
  if (!(await regularFile(executablePath))) errors.push(`Forgejo MCP executable is not a regular app-owned file: ${executablePath}.`);
  if (!(await regularFile(licensePath))) errors.push(`Forgejo MCP license is not a regular app-owned file: ${licensePath}.`);
  if (errors.length > 0) return { valid: false, errors, executablePath, manifestPath, licensePath };

  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    return { valid: false, errors: ['Forgejo MCP manifest could not be read.'], executablePath, manifestPath, licensePath };
  }
  errors.push(...manifestErrors(manifest));
  const sha256 = await sha256File(executablePath);
  const licenseSha256 = await sha256File(licensePath);
  if (sha256 !== FORGEJO_MCP_SHA256) errors.push(`Forgejo MCP executable checksum does not match the pinned release at ${executablePath}.`);
  if (licenseSha256 !== FORGEJO_MCP_LICENSE_SHA256) errors.push(`Forgejo MCP license checksum does not match the pinned release at ${licensePath}.`);
  if (errors.length > 0) return { valid: false, errors, executablePath, manifestPath, licensePath, sha256, licenseSha256 };

  const probeVersion = options.probeVersion ?? platform === 'win32';
  if (!probeVersion) return { valid: true, errors, executablePath, manifestPath, licensePath, sha256, licenseSha256 };
  const runner = options.commandRunner ?? runCommand;
  const version = await runner(executablePath, ['--version'], {
    platform,
    env: withoutCredentials(env),
    timeoutMs: 30_000
  });
  if (version.exitCode !== 0) errors.push(`Forgejo MCP version probe failed with exit code ${version.exitCode}.`);
  if (!version.stdout.includes(FORGEJO_MCP_VERSION)) errors.push(`Forgejo MCP version probe did not report ${FORGEJO_MCP_VERSION}.`);
  return {
    valid: errors.length === 0,
    errors,
    executablePath,
    manifestPath,
    licensePath,
    sha256,
    licenseSha256,
    versionOutput: version.stdout.trim()
  };
}
