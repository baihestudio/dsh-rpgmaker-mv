export declare const name: string;
export declare const inject: readonly string[];
export declare function apply(ctx: { tools: { register: (definition: unknown) => () => void }; logger?: { info?: (...args: unknown[]) => void } }): Promise<() => void>;
export { createImageInspectTool, createImageResizePixelTool, createImageTrimPadTool, createImageSheetSliceTool, createImageSheetAssembleTool, createImageAtlasPackTool, createImageOptimizePngTool, IMAGE_INSPECT_TIMEOUT_MS, IMAGE_MUTATION_TIMEOUT_MS, IMAGE_WORKSHOP_TOOL_NAMES } from './tools.js';
export { resolveWorkspacePath, validateRelativePath, ImageWorkshopWorkspaceError } from './workspace.js';
export { invokeImageOperation, setWorkshopRunner, clearWorkshopRunner, setChildSpawner, clearChildSpawner, setTreeTerminator, clearTreeTerminator, workshopEnvironment, IMAGE_OPERATION_CLEANUP_GRACE_MS } from './workshop-client.js';
