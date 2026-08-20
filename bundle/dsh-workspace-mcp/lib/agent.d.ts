type Disposer = () => void | Promise<void>;

export declare const name: string;
export declare const inject: readonly ['tools'];
export declare function apply(ctx: {
  root: object;
  agent: { id: string; session: { header: { cwd?: string } } };
  tools: { register: (definition: any) => Disposer };
  on: (event: string, listener: (...args: any[]) => unknown) => Disposer;
  logger?: { info?: (...args: unknown[]) => void };
}): void;
export {
  XEROLO_MANIFEST,
  XEROLO_TOOL_NAMES,
  XEROLO_MANIFEST_SHA256,
  TOOL_NAME_PREFIX,
  RESERVED_DSH_TOOL_NAME,
  schemaProblem,
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
  XEROLO_RUNTIME_ENV,
  JS_RUNNER_ENV
} from './env.js';
export {
  canonicalWorkspace,
  validateWorkspace,
  privateServerName,
  buildWorkspaceDefinition,
  MV_PROJECT_MARKER,
  MV_REQUIRED_DIRECTORIES,
  MCPORTER_CALL_TIMEOUT_MS
} from './workspace.js';
export { toModelName, createMcpTool } from './tools.js';
export type { HostState } from './mcport-host.js';
