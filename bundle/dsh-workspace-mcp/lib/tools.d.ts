import type { DiscoveredTool } from './contract.js';
import type { RuntimePaths } from './env.js';

export interface McpContentBlock {
  type: string;
  text: string;
}
export interface McpToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output: { schema: Record<string, unknown>; render: (args: Record<string, unknown>, value: unknown) => McpContentBlock[] };
  timeoutMs: number;
  execute: (args: Record<string, unknown>, exec: { signal?: AbortSignal }) => Promise<unknown>;
  presentCall: (args: Record<string, unknown>) => Record<string, unknown>;
}
export declare function toModelName(rawName: string): string;
export declare function createMcpTool(
  rawTool: DiscoveredTool,
  workspace: { init: Promise<{ canonical: string; paths: RuntimePaths }> }
): McpToolDefinition;
