/**
 * @baihestudio/dsh-image-workshop — app-owned, Agent-scoped DSH tool plugin.
 *
 * Mounted only inside the asset-workshop preset composition, so the tools it
 * registers are visible only to 游戏图片素材助手 Agents. All four presets keep
 * the shared Vision Toolkit; the other three presets never resolve the image
 * tools because this plugin is absent from their compositions.
 */
import {
  createImageInspectTool,
  createImageResizePixelTool,
  createImageTrimPadTool,
  createImageSheetSliceTool,
  createImageSheetAssembleTool,
  createImageAtlasPackTool,
  createImageOptimizePngTool
} from './tools.js'

export const name = '@baihestudio/dsh-image-workshop'
export const inject = ['tools']

/** Plugin entry: register the Agent-scoped tools synchronously. */
export async function apply(ctx) {
  const definitions = [
    createImageInspectTool(),
    createImageResizePixelTool(),
    createImageTrimPadTool(),
    createImageSheetSliceTool(),
    createImageSheetAssembleTool(),
    createImageAtlasPackTool(),
    createImageOptimizePngTool()
  ]
  const disposers = definitions.map((definition) => ctx.tools.register(definition))
  ctx.logger?.info?.('dsh-image-workshop registered %d image tools', definitions.length)
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}

export {
  createImageInspectTool,
  createImageResizePixelTool,
  createImageTrimPadTool,
  createImageSheetSliceTool,
  createImageSheetAssembleTool,
  createImageAtlasPackTool,
  createImageOptimizePngTool,
  IMAGE_INSPECT_TIMEOUT_MS,
  IMAGE_MUTATION_TIMEOUT_MS,
  IMAGE_WORKSHOP_TOOL_NAMES
} from './tools.js'
export { resolveWorkspacePath, validateRelativePath, ImageWorkshopWorkspaceError } from './workspace.js'
export { invokeImageOperation, setWorkshopRunner, clearWorkshopRunner, setChildSpawner, clearChildSpawner, setTreeTerminator, clearTreeTerminator, workshopEnvironment, IMAGE_OPERATION_CLEANUP_GRACE_MS } from './workshop-client.js'
