import type { Host, HostState } from './mcport-host.js';

type Disposer = () => void | Promise<void>;
type EffectSetup = () => void | Disposer | Promise<void | Disposer>;

export declare const name: string;
export declare const inject: readonly [];
export declare function apply(ctx: {
  root: object;
  effect: (setup: EffectSetup, label?: string) => Disposer;
}): void;
export declare function hostForRoot(root: object): Host | undefined;
export declare function hostState(ctx: { root: object }): HostState;
export type { Host, HostState, AcquiredWorkspaceServer } from './mcport-host.js';
export {
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
