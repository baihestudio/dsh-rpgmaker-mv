/**
 * Agent-scoped image tool definitions (Ticket 02 surface).
 *
 * Each tool follows the standard DSH tool contract shape produced by
 * `defineTool` and is registered through `ctx.tools.register`. Every path is
 * fenced to the owning Agent's workspace; every operation delegates to the
 * existing Image Workshop implementation through the harness CLI and returns
 * canonical JSON plus a concise text render.
 */
import { stat } from 'node:fs/promises'
import { resolveWorkspacePath } from './workspace.js'
import { invokeImageOperation } from './workshop-client.js'

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function renderJson(value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

function renderSummary(result) {
  if (result === null || typeof result !== 'object') return renderJson(result)
  if (result.operation !== undefined) {
    const outputs = Array.isArray(result.outputPaths) && result.outputPaths.length > 0
      ? result.outputPaths.join(', ')
      : (result.outputPaths !== undefined ? String(result.outputPaths) : '')
    const manifest = result.manifestPath !== undefined ? `; manifest ${result.manifestPath}` : ''
    return [{ type: 'text', text: `${result.operation} succeeded: wrote ${outputs}${manifest}` }]
  }
  if (result.width !== undefined) {
    return [{
      type: 'text',
      text: `${result.path}: ${result.width}x${result.height} ${result.format} (${result.channels}, alpha=${result.hasAlpha ? 'yes' : 'no'}, ${result.bytes} bytes, sha256 ${result.sha256})`
    }]
  }
  return renderJson(result)
}

function agentWorkspace(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  if (!cwd) throw new Error('image workspace: an Agent session with a workspace cwd is required.')
  return String(cwd)
}

export function createImageInspectTool() {
  return {
    name: 'image_inspect',
    description: 'Inspect an image inside the current workspace and return its decoded metadata (dimensions, format, channels, alpha, bytes, SHA-256). The path is project-relative to the workspace.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        input: { type: 'string', description: 'Project-relative path of the image to inspect.' }
      },
      required: ['input']
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: renderSummary
    },
    async execute(args, exec) {
      const workspace = agentWorkspace(exec)
      const input = await resolveWorkspacePath(workspace, args.input, { label: 'Input', forOutput: false })
      if (!(await pathExists(input))) throw new Error(`image_inspect input does not exist in the workspace: ${args.input}`)
      return await invokeImageOperation('inspect', ['--input', input])
    },
    presentCall: (args) => ({ card: 'generic', title: `Inspect ${args.input}`, kind: 'execute', locations: [{ path: args.input }] })
  }
}

export function createImageResizePixelTool() {
  return {
    name: 'image_resize_pixel',
    description: 'Pixel-safe integer nearest-neighbour scaling of an image inside the current workspace. Provide scale, or both width and height that match one integer scale. The source is never overwritten and the output must not already exist. Paths are project-relative to the workspace.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        input: { type: 'string', description: 'Project-relative path of the source image.' },
        output: { type: 'string', description: 'Project-relative path of the new output image; must not exist.' },
        scale: { type: 'integer', minimum: 1, description: 'Integer nearest-neighbour scale factor.' },
        width: { type: 'integer', minimum: 2, description: 'Exact output width; requires height and must match an integer scale.' },
        height: { type: 'integer', minimum: 2, description: 'Exact output height; requires width and must match an integer scale.' }
      },
      required: ['input', 'output']
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: renderSummary
    },
    async execute(args, exec) {
      const workspace = agentWorkspace(exec)
      const input = await resolveWorkspacePath(workspace, args.input, { label: 'Input', forOutput: false })
      const output = await resolveWorkspacePath(workspace, args.output, { label: 'Output', forOutput: true })
      if (!(await pathExists(input))) throw new Error(`image_resize_pixel input does not exist in the workspace: ${args.input}`)
      const hasScale = Number.isInteger(args.scale)
      const hasDimensions = Number.isInteger(args.width) && Number.isInteger(args.height)
      if (!hasScale && !hasDimensions) throw new Error('image_resize_pixel requires scale or both width and height.')
      if (hasScale && hasDimensions) throw new Error('image_resize_pixel accepts scale or width/height, not both.')
      if (await pathExists(output)) {
        throw new Error(`image_resize_pixel output already exists: ${args.output}. Choose a new path; the source is never overwritten.`)
      }
      const cliArgs = ['--input', input, '--output', output]
      if (hasScale) cliArgs.push('--scale', String(args.scale))
      else cliArgs.push('--width', String(args.width), '--height', String(args.height))
      const manifest = await invokeImageOperation('resize-pixel', cliArgs)
      const outputPaths = (Array.isArray(manifest.outputs) ? manifest.outputs : [])
        .filter((artifact) => artifact && typeof artifact === 'object' && artifact.kind !== 'json' && typeof artifact.path === 'string')
        .map((artifact) => artifact.path)
      return {
        operation: manifest.operation,
        outputPaths,
        manifestPath: `${output}.manifest.json`,
        manifest
      }
    },
    presentCall: (args) => ({ card: 'generic', title: `Pixel-resize ${args.input}`, kind: 'execute', locations: [{ path: args.input }] })
  }
}

export const IMAGE_WORKSHOP_TOOL_NAMES = ['image_inspect', 'image_resize_pixel']
