export interface XeroloManifestTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
export interface XeroloManifest {
  package: string;
  version: string;
  tools: XeroloManifestTool[];
}
/** Machine-generated manifest for the exact-pinned Xerolo package. */
export declare const XEROLO_MANIFEST: XeroloManifest;
