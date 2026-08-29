export interface MzManifestTool { name: string; description: string; inputSchema: Record<string, unknown>; }
export interface MzManifest { package: string; version: string; tools: MzManifestTool[]; }
/** Machine-generated manifest for rpgmaker-mz-mcp@1.3.0. */
export declare const MZ_MANIFEST: MzManifest;
