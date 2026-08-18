export declare const name: string;
export declare const inject: readonly string[];
export declare function apply(ctx: { tools: { register: (definition: unknown) => () => void }; logger?: { info?: (...args: unknown[]) => void } }): Promise<() => void>;
export { createImageInspectTool, createImageResizePixelTool, createImageTrimPadTool, createImageSheetSliceTool, createImageSheetAssembleTool, createImageAtlasPackTool, createImageOptimizePngTool, IMAGE_WORKSHOP_TOOL_NAMES } from './tools.js';
export { resolveWorkspacePath, validateRelativePath, ImageWorkshopWorkspaceError } from './workspace.js';
export { invokeImageOperation, setWorkshopRunner, clearWorkshopRunner, workshopEnvironment } from './workshop-client.js';
