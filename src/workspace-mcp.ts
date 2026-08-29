import { join } from 'node:path';

import type { HarnessPaths } from './config';

export const WORKSPACE_MCP_PACKAGE = '@baihestudio/dsh-workspace-mcp';
export const WORKSPACE_MCP_VERSION = '0.1.0';
export const WORKSPACE_MCP_LICENSE = 'MIT';
export const WORKSPACE_MCP_AGENT_ENTRYPOINT = 'lib/agent.js';
export const WORKSPACE_MCP_BUNDLE_PATCH = './cordis.patch.yml';
export const WORKSPACE_MCP_ROW_ID = 'workspace-mcp';
export const WORKSPACE_MCP_AGENT_ROW_ID = 'workspace-mcp-agent';
export const WORKSPACE_MCP_BUNDLE_RELATIVE = join('bundle', 'dsh-workspace-mcp');
export const WORKSPACE_MCP_DATA_BUNDLE_RELATIVE = join('rpgmaker-mv', 'bundle', 'dsh-workspace-mcp');
/** Archive entries always use POSIX separators, including on Windows. */
export const WORKSPACE_MCP_BUNDLE_ARCHIVE_RELATIVE = 'bundle/dsh-workspace-mcp';

/** Host env contract consumed by the prebuilt workspace bundle. */
export const MCPORTER_RUNTIME_ENV = 'DSH_RPGMAKER_MCPORTER_RUNTIME';
/** Generic name for the shared runtime containing both MV and MZ packages. */
export const RPGMAKER_MCP_RUNTIME_ENV = 'DSH_RPGMAKER_MCP_RUNTIME';
export const JS_RUNNER_ENV = 'DSH_RPGMAKER_JS_RUNNER';

export function workspaceMcpBundleDirFor(paths: Pick<HarnessPaths, 'dshHome'>): string {
  return join(paths.dshHome, WORKSPACE_MCP_DATA_BUNDLE_RELATIVE);
}
