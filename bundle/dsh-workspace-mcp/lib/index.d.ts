import type { HostState } from './mcport-host.js';

type Disposer = () => void | Promise<void>;
type EffectSetup = () => void | Disposer | Promise<void | Disposer>;

export declare const name: string;
export declare const inject: readonly string[];
export declare const RPG_PRESETS: readonly ['rpgmaker', 'playtest-debug', 'asset-workshop', 'build-release'];
export declare function apply(ctx: {
  root?: object;
  on: (event: string, listener: (payload: any) => void) => void;
  effect: (setup: EffectSetup, label?: string) => Disposer;
  logger?: { info?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void };
}): void;
export declare function hostState(ctx: object): HostState;
export { resolveRuntimePaths, neutralizedServerEnv, SECRET_MARKER, MCPORTER_RUNTIME_ENV, XEROLO_RUNTIME_ENV, JS_RUNNER_ENV } from './env.js';
export {
  canonicalWorkspace,
  validateWorkspace,
  privateServerName,
  buildWorkspaceDefinition,
  MV_PROJECT_MARKER,
  MV_REQUIRED_DIRECTORIES,
  MCPORTER_CALL_TIMEOUT_MS
} from './workspace.js';
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
  Host,
  HostState,
  AcquiredWorkspaceServer,
  createHost,
  resetHostState,
  getHostRuntime,
  registerServer,
  acquireWorkspaceServer,
  listWorkspaceTools,
  callWorkspaceTool,
  callServerTool,
  closeWorkspaceServer,
  closeServer,
  closeHost,
  normalizeMcpResult,
  canonicalMcpValue,
  MCPORTER_CANCELLATION_CLEANUP_GRACE_MS
} from './mcport-host.js';
export { toModelName, createMcpTool } from './tools.js';
