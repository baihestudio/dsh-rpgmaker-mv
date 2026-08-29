import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import type { HarnessPaths } from './config';

export const WORKSPACE_MCP_PACKAGE = '@baihestudio/dsh-workspace-mcp';
export const WORKSPACE_MCP_VERSION = '0.1.0';
export const WORKSPACE_MCP_LICENSE = 'MIT';
export const WORKSPACE_MCP_AGENT_ENTRYPOINT = 'lib/agent.js';
export const WORKSPACE_MCP_BUNDLE_PATCH = './cordis.patch.yml';
export const WORKSPACE_MCP_ROW_ID = 'workspace-mcp';
export const WORKSPACE_MCP_AGENT_ROW_ID = 'workspace-mcp-agent';
/** Deterministic digest over the shipped prebuilt bundle; see scripts/release notes. */
export const WORKSPACE_MCP_SHA256 = 'd790562f419914fc68ecff50376bf66ea789f4e9b069fedb010dadfabe8f8000';
export const WORKSPACE_MCP_BUNDLE_RELATIVE = join('bundle', 'dsh-workspace-mcp');
export const WORKSPACE_MCP_DATA_BUNDLE_RELATIVE = join('rpgmaker-mv', 'bundle', 'dsh-workspace-mcp');
/** Archive entries always use POSIX separators, including on Windows. */
export const WORKSPACE_MCP_BUNDLE_ARCHIVE_RELATIVE = 'bundle/dsh-workspace-mcp';

/** Host env contract consumed by the prebuilt workspace bundle. */
export const MCPORTER_RUNTIME_ENV = 'DSH_RPGMAKER_MCPORTER_RUNTIME';
export const XEROLO_RUNTIME_ENV = 'DSH_RPGMAKER_XEROLO_RUNTIME';
/** Generic name for the shared runtime containing both MV and MZ packages. */
export const RPGMAKER_MCP_RUNTIME_ENV = 'DSH_RPGMAKER_MCP_RUNTIME';
/** Short alias used by the prebuilt bundle's generic engine contract. */
export const RPGMAKER_RUNTIME_ENV = RPGMAKER_MCP_RUNTIME_ENV;
export const JS_RUNNER_ENV = 'DSH_RPGMAKER_JS_RUNNER';

export function workspaceMcpBundleDirFor(paths: Pick<HarnessPaths, 'dshHome'>): string {
  return join(paths.dshHome, WORKSPACE_MCP_DATA_BUNDLE_RELATIVE);
}

/** Deterministic digest over the bundle directory (sorted files, LF, slash paths). */
export async function workspaceMcpBundleDigest(bundleDir: string): Promise<string> {
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const abs = join(directory, entry.name);
      if (entry.isDirectory()) await walk(abs);
      else if (entry.isFile()) files.push(relative(bundleDir, abs).split(sep).join('/'));
      else throw new Error('workspace MCP bundle contains a symbolic link or non-regular file');
    }
  };
  await walk(bundleDir);
  files.sort();
  const digest = createHash('sha256');
  for (const rel of files) {
    const filePath = join(bundleDir, ...rel.split('/'));
    const content = await readFile(filePath);
    digest.update(rel);
    digest.update('\0');
    digest.update(content.toString('hex'));
    digest.update('\0');
  }
  return digest.digest('hex');
}
