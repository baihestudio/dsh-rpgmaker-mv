import type { DiscoveredTool } from './contract.js';

export interface HostState {
  closed: boolean;
  runtimeDir?: string;
  workspaces: string[];
}
export interface AcquiredWorkspaceServer {
  name: string;
  canonical: string;
  tools: DiscoveredTool[];
}
export interface Host {
  hostState(): HostState;
  resetHostState(): void;
  getHostRuntime(paths: { mcporterRuntime: string }): Promise<unknown>;
  registerServer(
    paths: { mcporterRuntime: string },
    definition: Record<string, unknown>
  ): Promise<string>;
  acquireWorkspaceServer(
    paths: { mcporterRuntime: string },
    canonical: string,
    definition: Record<string, unknown>
  ): Promise<AcquiredWorkspaceServer>;
  listWorkspaceTools(
    paths: { mcporterRuntime: string },
    canonical: string
  ): Promise<DiscoveredTool[]>;
  callWorkspaceTool(
    paths: { mcporterRuntime: string },
    canonical: string,
    toolName: string,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ): Promise<unknown>;
  callServerTool(
    paths: { mcporterRuntime: string },
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ): Promise<unknown>;
  closeWorkspaceServer(paths: { mcporterRuntime: string }, canonical: string): Promise<void>;
  closeServer(paths: { mcporterRuntime: string }, serverName: string): Promise<void>;
  closeHost(): Promise<void>;
  normalizeMcpResult(result: unknown): NormalizedMcpResult | unknown;
  canonicalMcpValue(result: unknown): unknown;
}
export interface NormalizedMcpResult {
  text: string;
  content: unknown[];
  structuredContent: unknown | null;
}
export declare function createHost(): Host;
export declare function hostState(host: Host): HostState;
export declare function resetHostState(host: Host): void;
export declare function getHostRuntime(host: Host, paths: { mcporterRuntime: string }): Promise<unknown>;
export declare function registerServer(
  host: Host,
  paths: { mcporterRuntime: string },
  definition: Record<string, unknown>
): Promise<string>;
export declare function acquireWorkspaceServer(
  host: Host,
  paths: { mcporterRuntime: string },
  canonical: string,
  definition: Record<string, unknown>
): Promise<AcquiredWorkspaceServer>;
export declare function listWorkspaceTools(
  host: Host,
  paths: { mcporterRuntime: string },
  canonical: string
): Promise<DiscoveredTool[]>;
export declare function callWorkspaceTool(
  host: Host,
  paths: { mcporterRuntime: string },
  canonical: string,
  toolName: string,
  args: Record<string, unknown>,
  options?: { signal?: AbortSignal }
): Promise<unknown>;
export declare function callServerTool(
  host: Host,
  paths: { mcporterRuntime: string },
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
  options?: { signal?: AbortSignal }
): Promise<unknown>;
export declare function closeWorkspaceServer(host: Host, paths: { mcporterRuntime: string }, canonical: string): Promise<void>;
export declare function closeServer(host: Host, paths: { mcporterRuntime: string }, serverName: string): Promise<void>;
export declare function closeHost(host: Host): Promise<void>;
export declare const MCPORTER_CANCELLATION_CLEANUP_GRACE_MS: number;
export declare function normalizeMcpResult(result: unknown): NormalizedMcpResult | unknown;
export declare function canonicalMcpValue(result: unknown): unknown;
