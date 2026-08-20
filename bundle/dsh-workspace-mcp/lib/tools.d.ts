import type { DiscoveredTool } from './contract.js';
import type { RuntimePaths } from './env.js';
import type { Host } from './mcport-host.js';

export interface McpContentBlock {
  type: string;
  text: string;
}
/** The only live Agent data this capability needs from DSH. */
export interface AgentBinding {
  readonly id: string;
  readonly session: { readonly header: { readonly cwd?: string } };
}
export interface AgentCapability {
  readonly host: Host;
  readonly canonical: string;
  readonly paths: RuntimePaths;
}
export interface AgentInitializer {
  readonly init: (agent: AgentBinding) => Promise<AgentCapability>;
}
/** rc.7's per-assembly context; `agent` is absent for agentless diagnostics. */
export interface AgentAssemblyContext {
  readonly scope?: object;
  readonly agent?: AgentBinding;
  readonly signal?: AbortSignal;
}
export interface McpToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output: { schema: Record<string, unknown>; render: (args: Record<string, unknown>, value: unknown) => McpContentBlock[] };
  execute: (args: Record<string, unknown>, exec: { readonly agent?: AgentBinding; readonly signal: AbortSignal }) => Promise<unknown>;
  presentCall: (args: Record<string, unknown>) => Record<string, unknown>;
}
export declare function toModelName(rawName: string): string;
export declare function createMcpTool(
  rawTool: DiscoveredTool,
  capability: AgentInitializer
): McpToolDefinition;
