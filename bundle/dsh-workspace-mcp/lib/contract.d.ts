import type { XeroloManifest, XeroloManifestTool } from './xerolo-manifest.js';

export interface DiscoveredTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}
export type { XeroloManifest, XeroloManifestTool };
export declare const XEROLO_PACKAGE: string;
export declare const XEROLO_VERSION: string;
export declare const XEROLO_MANIFEST: XeroloManifest;
export declare const XEROLO_MANIFEST_SHA256: string;
export declare const XEROLO_TOOL_NAMES: readonly string[];
export declare const TOOL_NAME_PREFIX: string;
export declare const RESERVED_DSH_TOOL_NAME: string;
export declare function schemaProblem(schema: unknown, at: string): string | undefined;
export declare function manifestDigest(manifest?: XeroloManifest): string;
export declare function verifyManifest(manifest?: XeroloManifest): { errors: string[] };
export declare function validateDiscoveredTools(tools: DiscoveredTool[]): { errors: string[] };
export declare function validateModelNames(names: string[]): { errors: string[] };
