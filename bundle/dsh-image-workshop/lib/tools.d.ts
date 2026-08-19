export interface ImageWorkshopContentBlock {
  type: string;
  text: string;
}

export interface ImageWorkshopToolDefinition {
  name: string;
  timeoutMs?: number;
  description: string;
  parameters: Record<string, unknown>;
  output: { schema: Record<string, unknown>; render: (args: Record<string, unknown>, value: Record<string, unknown>) => ImageWorkshopContentBlock[] };
  execute: (args: Record<string, unknown>, exec: { agent?: { session?: { header?: { cwd?: string } } }; signal?: AbortSignal }) => Promise<Record<string, unknown>>;
  presentCall: (args: Record<string, unknown>) => Record<string, unknown>;
}
export declare const IMAGE_INSPECT_TIMEOUT_MS: 30000;
export declare const IMAGE_MUTATION_TIMEOUT_MS: 180000;
export declare const IMAGE_WORKSHOP_TOOL_NAMES: readonly ['image_inspect', 'image_resize_pixel', 'image_trim_pad', 'image_sheet_slice', 'image_sheet_assemble', 'image_atlas_pack', 'image_optimize_png'];
export declare function createImageInspectTool(): ImageWorkshopToolDefinition;
export declare function createImageResizePixelTool(): ImageWorkshopToolDefinition;
export declare function createImageTrimPadTool(): ImageWorkshopToolDefinition;
export declare function createImageSheetSliceTool(): ImageWorkshopToolDefinition;
export declare function createImageSheetAssembleTool(): ImageWorkshopToolDefinition;
export declare function createImageAtlasPackTool(): ImageWorkshopToolDefinition;
export declare function createImageOptimizePngTool(): ImageWorkshopToolDefinition;
