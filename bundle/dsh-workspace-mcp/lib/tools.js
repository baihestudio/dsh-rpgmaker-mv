/**
 * The generated `rpgmaker_<raw Xerolo name>` tool factory. One capability-local
 * registration factory copies each pinned-manifest description and input schema
 * and forwards execution to MCPorter by raw tool name; nothing here is a
 * hand-written per-tool wrapper. Execution first awaits the Agent's workspace
 * initialization (validation + live manifest parity), so no call can run
 * before the pinned contract is proven. The DSH tool deliberately declares no
 * timeout policy; the fixed transport timeout is owned by MCPorter.
 */
import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { TOOL_NAME_PREFIX } from './contract.js'
import { callWorkspaceTool, canonicalMcpValue } from './mcport-host.js'
import { canonicalWorkspace } from './workspace.js'

const EMPTY_OBJECT_SCHEMA = { type: 'object', properties: {}, additionalProperties: false }
const SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])
const ANNOTATION_KEYS = ['description', 'title', 'default', 'examples']

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isJsonValue(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0)
  if (Array.isArray(value)) {
    if (seen.has(value)) return false
    seen.add(value)
    const valid = value.every((entry) => isJsonValue(entry, seen))
    seen.delete(value)
    return valid
  }
  if (!isRecord(value) || seen.has(value)) return false
  seen.add(value)
  const valid = Object.values(value).every((entry) => isJsonValue(entry, seen))
  seen.delete(value)
  return valid
}

function scalarMatches(type, value) {
  if (type === 'string') return typeof value === 'string'
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value) && !Object.is(value, -0)
  if (type === 'boolean') return typeof value === 'boolean'
  return type === 'null' && value === null
}

function copyAnnotations(source, target) {
  for (const key of ANNOTATION_KEYS) {
    const value = source[key]
    if (key === 'description' || key === 'title') {
      if (typeof value === 'string') target[key] = value
    } else if (Object.hasOwn(source, key) && isJsonValue(value)) {
      target[key] = value
    }
  }
}

/**
 * Project the upstream JSON Schema vocabulary onto DSH's object-rooted,
 * lossless subset. Unsupported constraints are intentionally dropped because
 * the MCP server remains the source of truth for runtime validation; object
 * shape, required fields, scalar enums/consts, arrays, and annotations remain
 * available to model registration and Code Mode type generation.
 */
function projectSchemaNode(schema) {
  if (!isRecord(schema)) return {}
  const projected = {}
  copyAnnotations(schema, projected)

  if (Array.isArray(schema.oneOf)) {
    const branches = schema.oneOf.map((branch) => projectSchemaNode(branch))
    if (branches.length >= 2) {
      projected.oneOf = branches
      return projected
    }
  }

  let type = schema.type
  if (Array.isArray(type)) {
    const supported = type.filter((entry) => typeof entry === 'string' && SCHEMA_TYPES.has(entry))
    if (supported.length > 1) {
      projected.oneOf = supported.map((branchType) => projectSchemaNode({ ...schema, type: branchType }))
      return projected
    }
    type = supported[0]
  }
  if (typeof type !== 'string' || !SCHEMA_TYPES.has(type)) {
    if (isRecord(schema.properties) || Object.hasOwn(schema, 'propertyNames') || Object.hasOwn(schema, 'additionalProperties')) type = 'object'
    else if (Object.hasOwn(schema, 'items')) type = 'array'
    else return projected
  }

  projected.type = type
  if (type === 'object') {
    if (isRecord(schema.properties)) {
      projected.properties = {}
      for (const [name, property] of Object.entries(schema.properties)) projected.properties[name] = projectSchemaNode(property)
    }
    if (Array.isArray(schema.required)) {
      const required = schema.required.filter((name) => typeof name === 'string' && Object.hasOwn(projected.properties ?? {}, name))
      if (required.length > 0) projected.required = required
    }
    if (typeof schema.additionalProperties === 'boolean') projected.additionalProperties = schema.additionalProperties
    else if (Object.hasOwn(schema, 'additionalProperties') || Object.hasOwn(schema, 'propertyNames')) projected.additionalProperties = true
  } else if (type === 'array') {
    if (Object.hasOwn(schema, 'items')) projected.items = projectSchemaNode(schema.items)
  } else {
    if (Array.isArray(schema.enum) && schema.enum.length > 0 && schema.enum.every((value) => scalarMatches(type, value))) projected.enum = [...schema.enum]
    if (Object.hasOwn(schema, 'const') && scalarMatches(type, schema.const) && (!projected.enum || projected.enum.includes(schema.const))) projected.const = schema.const
  }
  return projected
}

/** Return one official-DHS-valid object-root schema for model-facing tools. */
export function projectDshObjectJsonSchema(schema) {
  const projected = projectSchemaNode(schema)
  const objectBranch = projected.type === 'object'
    ? projected
    : projected.oneOf?.find((branch) => branch?.type === 'object')
  const result = objectBranch ?? { ...EMPTY_OBJECT_SCHEMA, ...Object.fromEntries(ANNOTATION_KEYS.filter((key) => Object.hasOwn(projected, key)).map((key) => [key, projected[key]])) }
  try {
    assertObjectJsonSchema(result)
    return result
  } catch {
    assertObjectJsonSchema(EMPTY_OBJECT_SCHEMA)
    return EMPTY_OBJECT_SCHEMA
  }
}

function renderResult(_args, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return [{ type: 'text', text }]
}

/** Stable model-facing name: `rpgmaker_` plus the raw Xerolo tool name. */
export function toModelName(rawName) {
  return `${TOOL_NAME_PREFIX}${rawName}`
}

/** One generated tool bound to a capability-local Agent initializer. */
export function createMcpTool(rawTool, capability, engine = 'mv') {
  const name = toModelName(rawTool.name)
  return {
    name,
    description: typeof rawTool.description === 'string' ? rawTool.description : `RPG Maker ${String(engine).toUpperCase()} ${rawTool.name}`,
    parameters: projectDshObjectJsonSchema(rawTool.inputSchema),
    output: { schema: {}, render: renderResult },
    execute: async (args, exec) => {
      const agent = exec?.agent
      if (!agent) throw new Error(`dsh-workspace-mcp: ${name} execution supplied no Agent`)
      const { host, engine, canonical, paths } = await capability.init(agent)
      if (engine === 'mz' && rawTool.name === 'set_project') {
        let requested
        try {
          requested = await canonicalWorkspace(args?.path)
        } catch (error) {
          throw new Error(`dsh-workspace-mcp: ${name} requires a canonicalizable project path (${error instanceof Error ? error.message : String(error)})`)
        }
        if (requested !== canonical) throw new Error(`dsh-workspace-mcp: ${name} cannot retarget the acquired MZ workspace; requested ${requested}, bound to ${canonical}`)
        args = { ...(args ?? {}), path: canonical }
      }
      const result = await host.callWorkspaceTool(paths, engine, canonical, rawTool.name, args ?? {}, {
        signal: exec.signal
      })
      return canonicalMcpValue(result)
    },
    presentCall: (args) => ({ card: 'generic', title: `RPG Maker ${rawTool.name}`, kind: 'execute' })
  }
}
