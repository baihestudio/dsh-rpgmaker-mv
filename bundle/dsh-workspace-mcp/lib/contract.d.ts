import type { XeroloManifest, XeroloManifestTool } from './xerolo-manifest.js';
import type { MzManifest } from './mz-manifest.js';

export interface DiscoveredTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}
export type { XeroloManifest, XeroloManifestTool };
export type { MzManifest };
export declare const XEROLO_PACKAGE: string;
export declare const XEROLO_VERSION: string;
export declare const MZ_PACKAGE: string;
export declare const MZ_VERSION: string;
export declare const XEROLO_MANIFEST: XeroloManifest;
export declare const MZ_MANIFEST: MzManifest;
export declare const RPGMAKER_MV_MANIFEST: XeroloManifest;
export declare const RPGMAKER_MZ_MANIFEST: MzManifest;
export declare const XEROLO_MANIFEST_SHA256: string;
export declare const MZ_MANIFEST_SHA256: string;
export declare const XEROLO_TOOL_NAMES: readonly string[];
export declare const MZ_TOOL_NAMES: readonly string[];
export declare const CRITICAL_XEROLO_TOOLS: readonly string[];
export declare const CRITICAL_MZ_TOOLS: readonly string[];
export declare const ENGINE_CONTRACTS: Record<string, { id: string; label: string; package: string; version: string; manifest: XeroloManifest | MzManifest; digest: string }>;
export declare function missingCriticalTools(names: readonly string[]): string[];
export declare function missingCriticalTools(names: readonly string[], engine: 'mv' | 'mz' | XeroloManifest | MzManifest): string[];
export declare const TOOL_NAME_PREFIX: string;
export declare const RESERVED_DSH_TOOL_NAME: string;
export declare function schemaProblem(schema: unknown, at: string): string | undefined;
export declare function manifestFor(engine?: 'mv' | 'mz'): XeroloManifest | MzManifest;
export declare function contractFor(engine?: 'mv' | 'mz'): { id: string; label: string; package: string; version: string; manifest: XeroloManifest | MzManifest; digest: string };
export declare function manifestDigest(manifest?: XeroloManifest | MzManifest): string;
export declare function verifyManifest(manifestOrEngine?: 'mv' | 'mz' | XeroloManifest | MzManifest): { errors: string[] };
export declare function validateDiscoveredTools(tools: DiscoveredTool[], engine?: 'mv' | 'mz' | XeroloManifest | MzManifest): { errors: string[] };
export declare function validateModelNames(names: string[]): { errors: string[] };
