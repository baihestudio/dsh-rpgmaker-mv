/**
 * @baihestudio/dsh-image-workshop — app-owned, Agent-scoped DSH tool plugin.
 *
 * Mounted only inside the asset-workshop preset composition, so the tools it
 * registers are visible only to 游戏图片素材助手 Agents. All four presets keep
 * the shared Vision Toolkit; the other three presets never resolve the image
 * tools because this plugin is absent from their compositions.
 */
import { createImageInspectTool, createImageResizePixelTool } from './tools.js'

export const name = '@baihestudio/dsh-image-workshop'
// Only `tools` is a required scoped service. `logger` is used opportunistically
// (and is absent from the injected `ctx` in some DSH hosts); it must not be
// declared as an injection requirement or preset recompose fails to resolve it.
export const inject = ['tools']

/** Plugin entry: register the Agent-scoped tools synchronously. */
export async function apply(ctx) {
  const definitions = [createImageInspectTool(), createImageResizePixelTool()]
  const disposers = definitions.map((definition) => ctx.tools.register(definition))
  ctx.logger?.info?.('dsh-image-workshop registered %d image tools', definitions.length)
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}

export { createImageInspectTool, createImageResizePixelTool, IMAGE_WORKSHOP_TOOL_NAMES } from './tools.js'
export { resolveWorkspacePath, validateRelativePath, ImageWorkshopWorkspaceError } from './workspace.js'
export { invokeImageOperation, setWorkshopRunner, clearWorkshopRunner, workshopEnvironment } from './workshop-client.js'
