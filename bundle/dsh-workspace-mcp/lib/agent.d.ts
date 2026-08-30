import type { AgentAssemblyContext, McpToolDefinition } from './tools.js';

type Disposer = () => void | Promise<void>;

export declare const name: string;
export declare const inject: readonly ['tools'];
export declare function apply(ctx: {
  root: object;
  tools: { register: (definition: McpToolDefinition) => Disposer };
  on: (event: 'system-prompt/assemble', listener: (assembly: unknown, context: AgentAssemblyContext, next: () => Promise<unknown>) => unknown) => Disposer;
  logger?: { info?: (...args: unknown[]) => void };
}): void;
export {
  XEROLO_MANIFEST,
  MZ_MANIFEST,
  XEROLO_TOOL_NAMES,
  MZ_TOOL_NAMES,
  XEROLO_MANIFEST_SHA256,
  MZ_MANIFEST_SHA256,
  TOOL_NAME_PREFIX,
  RESERVED_DSH_TOOL_NAME,
  schemaProblem,
  manifestFor,
  contractFor,
  missingCriticalTools,
  manifestDigest,
  verifyManifest,
  validateDiscoveredTools,
  validateModelNames
} from './contract.js';
export {
  resolveRuntimePaths,
  neutralizedServerEnv,
  SECRET_MARKER,
  MCPORTER_RUNTIME_ENV,
  RPGMAKER_MCP_RUNTIME_ENV,
  JS_RUNNER_ENV
} from './env.js';
export {
  ENGINE_IDS,
  RPGMAKER_ENGINES,
  canonicalWorkspace,
  classifyWorkspace,
  privateServerName,
  resolveEngineEntry,
  buildWorkspaceDefinition,
  MV_PROJECT_MARKER,
  MV_REQUIRED_DIRECTORIES,
  MZ_PROJECT_MARKER,
  MZ_REQUIRED_DIRECTORIES,
  MCPORTER_CALL_TIMEOUT_MS
} from './workspace.js';
export { toModelName, createMcpTool } from './tools.js';
export type { AgentAssemblyContext, AgentBinding, AgentCapability, AgentInitializer, McpToolDefinition } from './tools.js';
export type { HostState } from './mcport-host.js';
