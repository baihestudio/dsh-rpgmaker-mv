export interface ImageWorkshopToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output: { schema: Record<string, unknown>; render: (value: unknown) => Array<{ type: string; text: string }> };
  execute: (args: Record<string, unknown>, exec: { agent?: { session?: { header?: { cwd?: string } } } }) => Promise<Record<string, unknown>>;
  presentCall: (args: Record<string, unknown>) => Record<string, unknown>;
}
export declare const IMAGE_WORKSHOP_TOOL_NAMES: readonly ['image_inspect', 'image_resize_pixel'];
export declare function createImageInspectTool(): ImageWorkshopToolDefinition;
export declare function createImageResizePixelTool(): ImageWorkshopToolDefinition;
