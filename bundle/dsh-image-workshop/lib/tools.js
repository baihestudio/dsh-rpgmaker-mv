/**
 * Agent-scoped image tool definitions (Ticket 03 surface).
 *
 * Each tool follows the standard DSH tool contract shape produced by
 * `defineTool` and is registered through `ctx.tools.register`. Every path is
 * fenced to the owning Agent's workspace; every operation delegates to the
 * existing Image Workshop implementation through the harness CLI and returns
 * canonical JSON plus a concise text render. Array inputs (sheet assembly,
 * atlas packing) are real schema arrays and travel to the CLI as one JSON
 * argv element, never as shell-encoded text.
 */
import { stat } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import { resolveWorkspacePath } from './workspace.js'
import { invokeImageOperation } from './workshop-client.js'

const GRAVITIES = ['center', 'north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest']
export const IMAGE_INSPECT_TIMEOUT_MS = 30_000
export const IMAGE_MUTATION_TIMEOUT_MS = 180_000

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

/**
 * DSH rc.7 invokes `output.render(args, value)`: a pure projection of the
 * validated canonical `value` (never the arguments) into model-facing content.
 * The model-facing summary must use project-relative paths only.
 */
function renderSummary(args, value) {
  const result = value
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

function toWorkspaceRelative(workspace, abs) {
  const rel = relative(workspace, abs)
  if (rel === '' || rel.startsWith('..') || rel.startsWith('\\')) {
    throw new Error(`image workspace: result path escaped the workspace: ${abs}`)
  }
  return rel.split('\\').join('/')
}

function agentWorkspace(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  if (!cwd) throw new Error('image workspace: an Agent session with a workspace cwd is required.')
  return String(cwd)
}

function expectedOutputTargets(workspace, paths) {
  return paths.map((path) => ({ path, projectPath: toWorkspaceRelative(workspace, path) }))
}

/**
 * Project the canonical operation manifest into the model-facing tool result:
 * operation name, project-relative non-JSON output paths, the project-relative
 * manifest path, and the full canonical manifest (absolute paths inside).
 */
function operationResult(workspace, manifest, manifestPath) {
  const outputPaths = (Array.isArray(manifest.outputs) ? manifest.outputs : [])
    .filter((artifact) => artifact && typeof artifact === 'object' && artifact.kind !== 'json' && typeof artifact.path === 'string')
    .map((artifact) => toWorkspaceRelative(workspace, artifact.path))
  return {
    operation: typeof manifest.operation === 'string' ? manifest.operation : undefined,
    outputPaths,
    manifestPath: toWorkspaceRelative(workspace, manifestPath),
    manifest
  }
}

export function createImageInspectTool() {
  return {
    name: 'image_inspect',
    timeoutMs: IMAGE_INSPECT_TIMEOUT_MS,
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
      const value = await invokeImageOperation('inspect', ['--input', input], undefined, exec?.signal)
      if (value !== null && typeof value === 'object' && typeof value.path === 'string') {
        return { ...value, path: toWorkspaceRelative(workspace, value.path) }
      }
      return value
    },
    presentCall: (args) => ({ card: 'generic', title: `Inspect ${args.input}`, kind: 'execute', locations: [{ path: args.input }] })
  }
}

export function createImageResizePixelTool() {
  return {
    name: 'image_resize_pixel',
    timeoutMs: IMAGE_MUTATION_TIMEOUT_MS,
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
      const manifest = await invokeImageOperation('resize-pixel', cliArgs, undefined, exec?.signal, expectedOutputTargets(workspace, [output, `${output}.manifest.json`]))
      return operationResult(workspace, manifest, `${output}.manifest.json`)
    },
    presentCall: (args) => ({ card: 'generic', title: `Pixel-resize ${args.input}`, kind: 'execute', locations: [{ path: args.input }] })
  }
}

export function createImageTrimPadTool() {
  return {
    name: 'image_trim_pad',
    timeoutMs: IMAGE_MUTATION_TIMEOUT_MS,
    description: 'Trim fully transparent borders and/or pad a transparent canvas around an image inside the current workspace. With trim true (default), fully transparent margins are removed. Supplying width and height (together) pads onto a transparent canvas of that exact size. The source is never overwritten and the output must not already exist. Paths are project-relative to the workspace.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        input: { type: 'string', description: 'Project-relative path of the source image.' },
        output: { type: 'string', description: 'Project-relative path of the new output image; must not exist.' },
        trim: { type: 'boolean', default: true, description: 'Whether to remove fully transparent margins (default true).' },
        width: { type: 'integer', minimum: 1, description: 'Exact padded canvas width; must be supplied together with height.' },
        height: { type: 'integer', minimum: 1, description: 'Exact padded canvas height; must be supplied together with width.' },
        gravity: { type: 'string', enum: GRAVITIES, description: 'Placement of the trimmed image on the padded canvas (default center).' }
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
      if (!(await pathExists(input))) throw new Error(`image_trim_pad input does not exist in the workspace: ${args.input}`)
      if ((args.width === undefined) !== (args.height === undefined)) throw new Error('image_trim_pad requires width and height together when padding a canvas.')
      if (args.gravity !== undefined && (args.width === undefined || args.height === undefined)) {
        throw new Error('image_trim_pad gravity requires width and height to place the trimmed image on a padded canvas.')
      }
      if (args.gravity !== undefined && !GRAVITIES.includes(args.gravity)) throw new Error(`image_trim_pad gravity must be one of: ${GRAVITIES.join(', ')}.`)
      if (await pathExists(output)) {
        throw new Error(`image_trim_pad output already exists: ${args.output}. Choose a new path; the source is never overwritten.`)
      }
      const cliArgs = ['--input', input, '--output', output]
      if (args.trim === false) cliArgs.push('--no-trim')
      if (args.width !== undefined) cliArgs.push('--width', String(args.width), '--height', String(args.height))
      if (args.gravity !== undefined) cliArgs.push('--gravity', args.gravity)
      const manifest = await invokeImageOperation('trim-pad', cliArgs, undefined, exec?.signal, expectedOutputTargets(workspace, [output, `${output}.manifest.json`]))
      return operationResult(workspace, manifest, `${output}.manifest.json`)
    },
    presentCall: (args) => ({ card: 'generic', title: `Trim/pad ${args.input}`, kind: 'execute', locations: [{ path: args.input }] })
  }
}

export function createImageSheetSliceTool() {
  return {
    name: 'image_sheet_slice',
    timeoutMs: IMAGE_MUTATION_TIMEOUT_MS,
    description: 'Slice a sprite sheet inside the current workspace into equal cell frames using a fixed cell width and height. The sheet dimensions must be divisible by the cell size. Writes frame-0000.png… (zero-based) and manifest.json into a new output directory. The source is never overwritten and the output directory must not already exist. Paths are project-relative to the workspace.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        input: { type: 'string', description: 'Project-relative path of the sprite sheet.' },
        outputDir: { type: 'string', description: 'Project-relative path of the new output directory; must not exist.' },
        cellWidth: { type: 'integer', minimum: 1, description: 'Frame width in pixels.' },
        cellHeight: { type: 'integer', minimum: 1, description: 'Frame height in pixels.' }
      },
      required: ['input', 'outputDir', 'cellWidth', 'cellHeight']
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: renderSummary
    },
    async execute(args, exec) {
      const workspace = agentWorkspace(exec)
      const input = await resolveWorkspacePath(workspace, args.input, { label: 'Input', forOutput: false })
      const outputDir = await resolveWorkspacePath(workspace, args.outputDir, { label: 'Output directory', forOutput: true })
      if (!(await pathExists(input))) throw new Error(`image_sheet_slice input does not exist in the workspace: ${args.input}`)
      if (!Number.isInteger(args.cellWidth) || args.cellWidth < 1 || !Number.isInteger(args.cellHeight) || args.cellHeight < 1) {
        throw new Error('image_sheet_slice requires positive integer cellWidth and cellHeight.')
      }
      if (await pathExists(outputDir)) {
        throw new Error(`image_sheet_slice output directory already exists: ${args.outputDir}. Choose a new directory; the source is never overwritten.`)
      }
      const manifest = await invokeImageOperation('sheet-slice', ['--input', input, '--output-dir', outputDir, '--cell-width', String(args.cellWidth), '--cell-height', String(args.cellHeight)], undefined, exec?.signal, expectedOutputTargets(workspace, [outputDir, join(outputDir, 'manifest.json')]))
      return operationResult(workspace, manifest, join(outputDir, 'manifest.json'))
    },
    presentCall: (args) => ({ card: 'generic', title: `Slice sheet ${args.input}`, kind: 'execute', locations: [{ path: args.input }] })
  }
}

export function createImageSheetAssembleTool() {
  return {
    name: 'image_sheet_assemble',
    timeoutMs: IMAGE_MUTATION_TIMEOUT_MS,
    description: 'Assemble equally sized images inside the current workspace into one sprite sheet. All inputs must share identical dimensions and alpha mode; the input count must be divisible by columns. The source images are never overwritten and the output must not already exist. Paths are project-relative to the workspace.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        inputs: { type: 'array', items: { type: 'string', description: 'Project-relative path of one equal-sized cell image.' }, minItems: 1, description: 'Project-relative paths of the equal-sized cell images, in row-major order.' },
        output: { type: 'string', description: 'Project-relative path of the new sprite sheet; must not exist.' },
        columns: { type: 'integer', minimum: 1, description: 'Number of columns; the input count must be divisible by it.' }
      },
      required: ['inputs', 'output', 'columns']
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: renderSummary
    },
    async execute(args, exec) {
      const workspace = agentWorkspace(exec)
      if (!Array.isArray(args.inputs) || args.inputs.length === 0 || args.inputs.some((value) => typeof value !== 'string')) {
        throw new Error('image_sheet_assemble requires a non-empty array of project-relative input paths.')
      }
      if (!Number.isInteger(args.columns) || args.columns < 1) throw new Error('image_sheet_assemble requires a positive integer columns.')
      const inputPaths = []
      for (const raw of args.inputs) {
        const path = await resolveWorkspacePath(workspace, raw, { label: 'Input', forOutput: false })
        if (!(await pathExists(path))) throw new Error(`image_sheet_assemble input does not exist in the workspace: ${raw}`)
        inputPaths.push(path)
      }
      const output = await resolveWorkspacePath(workspace, args.output, { label: 'Output', forOutput: true })
      if (await pathExists(output)) {
        throw new Error(`image_sheet_assemble output already exists: ${args.output}. Choose a new path; the sources are never overwritten.`)
      }
      const manifest = await invokeImageOperation('sheet-assemble', ['--inputs-json', JSON.stringify(inputPaths), '--output', output, '--columns', String(args.columns)], undefined, exec?.signal, expectedOutputTargets(workspace, [output, `${output}.manifest.json`]))
      return operationResult(workspace, manifest, `${output}.manifest.json`)
    },
    presentCall: (args) => ({ card: 'generic', title: `Assemble sheet (${Array.isArray(args.inputs) ? args.inputs.length : 0} cells)`, kind: 'execute', locations: (Array.isArray(args.inputs) ? args.inputs : []).map((path) => ({ path })) })
  }
}

export function createImageAtlasPackTool() {
  return {
    name: 'image_atlas_pack',
    timeoutMs: IMAGE_MUTATION_TIMEOUT_MS,
    description: 'Pack differently sized images inside the current workspace into one PNG texture atlas plus a JSON frame map. Requires unique source file names and a maximum atlas size; padding and extrusion are optional and bounded. Writes into a new output directory that must not already exist. The source images are never overwritten. Paths are project-relative to the workspace.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        inputs: { type: 'array', items: { type: 'string', description: 'Project-relative path of one source image.' }, minItems: 1, description: 'Project-relative paths of the images to pack; file names must be unique.' },
        output: { type: 'string', description: 'Project-relative path of the new output directory; must not exist.' },
        maxSize: { type: 'integer', minimum: 1, description: 'Maximum atlas width/height in pixels (bounded by the workspace resource policy).' },
        padding: { type: 'integer', minimum: 0, maximum: 64, description: 'Spacing in pixels between packed frames (default 0).' },
        extrusion: { type: 'integer', minimum: 0, maximum: 64, description: 'Edge extrusion in pixels (default 0).' },
        fixedGrid: { type: 'boolean', default: false, description: 'Require unrotated, untrimmed, complete-source frames in a fixed grid.' }
      },
      required: ['inputs', 'output', 'maxSize']
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: renderSummary
    },
    async execute(args, exec) {
      const workspace = agentWorkspace(exec)
      if (!Array.isArray(args.inputs) || args.inputs.length === 0 || args.inputs.some((value) => typeof value !== 'string')) {
        throw new Error('image_atlas_pack requires a non-empty array of project-relative input paths.')
      }
      if (!Number.isInteger(args.maxSize) || args.maxSize < 1) throw new Error('image_atlas_pack requires a positive integer maxSize.')
      if (args.padding !== undefined && (!Number.isInteger(args.padding) || args.padding < 0 || args.padding > 64)) throw new Error('image_atlas_pack padding must be an integer between 0 and 64.')
      if (args.extrusion !== undefined && (!Number.isInteger(args.extrusion) || args.extrusion < 0 || args.extrusion > 64)) throw new Error('image_atlas_pack extrusion must be an integer between 0 and 64.')
      const inputPaths = []
      for (const raw of args.inputs) {
        const path = await resolveWorkspacePath(workspace, raw, { label: 'Input', forOutput: false })
        if (!(await pathExists(path))) throw new Error(`image_atlas_pack input does not exist in the workspace: ${raw}`)
        inputPaths.push(path)
      }
      const outputDir = await resolveWorkspacePath(workspace, args.output, { label: 'Output directory', forOutput: true })
      if (await pathExists(outputDir)) {
        throw new Error(`image_atlas_pack output directory already exists: ${args.output}. Choose a new directory; the sources are never overwritten.`)
      }
      const cliArgs = ['--inputs-json', JSON.stringify(inputPaths), '--output', outputDir, '--max-size', String(args.maxSize)]
      if (args.padding !== undefined) cliArgs.push('--padding', String(args.padding))
      if (args.extrusion !== undefined) cliArgs.push('--extrusion', String(args.extrusion))
      if (args.fixedGrid === true) cliArgs.push('--fixed-grid')
      const textureName = basename(outputDir).replace(/\.png$/i, '') || 'atlas'
      const outputTexture = join(outputDir, `${textureName}.png`)
      const outputFrames = join(outputDir, `${textureName}.json`)
      const manifest = await invokeImageOperation('atlas-pack', cliArgs, undefined, exec?.signal, expectedOutputTargets(workspace, [outputDir, outputTexture, outputFrames, join(outputDir, 'manifest.json')]))
      return operationResult(workspace, manifest, join(outputDir, 'manifest.json'))
    },
    presentCall: (args) => ({ card: 'generic', title: `Pack atlas (${Array.isArray(args.inputs) ? args.inputs.length : 0} inputs)`, kind: 'execute', locations: (Array.isArray(args.inputs) ? args.inputs : []).map((path) => ({ path })) })
  }
}

export function createImageOptimizePngTool() {
  return {
    name: 'image_optimize_png',
    timeoutMs: IMAGE_MUTATION_TIMEOUT_MS,
    description: 'Losslessly optimize a PNG inside the current workspace with oxipng, preserving decoded pixels, dimensions, and alpha. The source is never overwritten and the output must not already exist. Paths are project-relative to the workspace.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        input: { type: 'string', description: 'Project-relative path of the source PNG.' },
        output: { type: 'string', description: 'Project-relative path of the new optimized PNG; must not exist and must end in .png.' },
        level: { type: 'integer', minimum: 0, maximum: 6, description: 'oxipng optimization level 0-6 (default 4).' }
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
      if (!(await pathExists(input))) throw new Error(`image_optimize_png input does not exist in the workspace: ${args.input}`)
      if (!/\.png$/i.test(args.input) || !/\.png$/i.test(args.output)) throw new Error('image_optimize_png requires PNG input and output paths.')
      if (args.level !== undefined && (!Number.isInteger(args.level) || args.level < 0 || args.level > 6)) throw new Error('image_optimize_png level must be an integer between 0 and 6.')
      if (await pathExists(output)) {
        throw new Error(`image_optimize_png output already exists: ${args.output}. Choose a new path; the source is never overwritten.`)
      }
      const level = args.level === undefined ? 4 : args.level
      const manifest = await invokeImageOperation('optimize-png', ['--input', input, '--output', output, '--level', String(level)], undefined, exec?.signal, expectedOutputTargets(workspace, [output, `${output}.manifest.json`]))
      return operationResult(workspace, manifest, `${output}.manifest.json`)
    },
    presentCall: (args) => ({ card: 'generic', title: `Optimize PNG ${args.input}`, kind: 'execute', locations: [{ path: args.input }] })
  }
}

export const IMAGE_WORKSHOP_TOOL_NAMES = [
  'image_inspect',
  'image_resize_pixel',
  'image_trim_pad',
  'image_sheet_slice',
  'image_sheet_assemble',
  'image_atlas_pack',
  'image_optimize_png'
]
