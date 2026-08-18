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
export interface NormalizedMcpResult {
  text: string;
  content: unknown[];
  structuredContent: unknown | null;
}
export declare function hostState(): HostState;
export declare function resetHostState(): void;
export declare function getHostRuntime(paths: { mcporterRuntime: string }): Promise<unknown>;
export declare function registerServer(
  paths: { mcporterRuntime: string },
  definition: Record<string, unknown>
): Promise<string>;
export declare function acquireWorkspaceServer(
  paths: { mcporterRuntime: string },
  canonical: string,
  definition: Record<string, unknown>
): Promise<AcquiredWorkspaceServer>;
export declare function listWorkspaceTools(
  paths: { mcporterRuntime: string },
  canonical: string
): Promise<DiscoveredTool[]>;
export declare function callWorkspaceTool(
  paths: { mcporterRuntime: string },
  canonical: string,
  toolName: string,
  args: Record<string, unknown>,
  options?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<unknown>;
export declare function callServerTool(
  paths: { mcporterRuntime: string },
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
  options?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<unknown>;
export declare function closeWorkspaceServer(paths: { mcporterRuntime: string }, canonical: string): Promise<void>;
export declare function closeServer(paths: { mcporterRuntime: string }, serverName: string): Promise<void>;
export declare function closeHost(): Promise<void>;
export declare function normalizeMcpResult(result: unknown): NormalizedMcpResult | unknown;
export declare function canonicalMcpValue(result: unknown): unknown;
