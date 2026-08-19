/**
 * Fixed Xerolo tool contract, driven by the machine-generated pinned manifest
 * (./xerolo-manifest.js). The manifest is the single source of truth for the
 * exact-pinned server's 41 raw tool names, descriptions, and supported input
 * schemas: it is regenerated from the pinned package's own tools/list response
 * and its content digest is verified like a runtime lock fact before any tool
 * executes. The Host fails closed on manifest digest drift, missing, duplicate,
 * or unknown live names, on live schemas that drift from the manifest, and on
 * schemas outside the DSH schema vocabulary the existing integration ships
 * (single type strings only, no nullable, no $ref, supported types, and a
 * valid recursive oneOf/properties/items shape).
 */
import { createHash } from 'node:crypto'

import { XEROLO_MANIFEST } from './xerolo-manifest.js'
export { XEROLO_MANIFEST }

export const XEROLO_PACKAGE = '@xerolo44/rpgmaker-mv-mcp'
export const XEROLO_VERSION = '0.1.0'
/** Content digest over JSON.stringify(XEROLO_MANIFEST); patched by the generator. */
export const XEROLO_MANIFEST_SHA256 = '09313bebb48af8274c8ce7b3c7c0dff1e2b769a51ae5f7928f4e6f26a3a5be79'

export const XEROLO_TOOL_NAMES = XEROLO_MANIFEST.tools.map((tool) => tool.name)
export const XEROLO_TOOL_SET = new Set(XEROLO_TOOL_NAMES)
const XEROLO_TOOL_BY_NAME = new Map(XEROLO_MANIFEST.tools.map((tool) => [tool.name, tool]))

/**
 * The critical raw-tool subset the product contract requires regardless of
 * manifest pin drift: targeted editing, validation, backup/restore, and the
 * Playtest lifecycle. The generated 41-tool manifest remains the schema SSOT;
 * this small guard is not a second manifest and never supplies schemas.
 */
export const CRITICAL_XEROLO_TOOLS = [
  'create_record',
  'update_record',
  'update_event',
  'validate_project',
  'list_backups',
  'restore_backup',
  'playtest_start',
  'playtest_status',
  'playtest_log',
  'playtest_stop'
]

/** Critical contract tools absent from a tool-name list, if any. */
export function missingCriticalTools(names) {
  return CRITICAL_XEROLO_TOOLS.filter((name) => !names.includes(name))
}
export const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/
export const TOOL_NAME_PREFIX = 'rpgmaker_'
export const RESERVED_DSH_TOOL_NAME = 'run_code'

const SUPPORTED_SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])

/** First unsupported-schema problem, or undefined when the node is supported. */
export function schemaProblem(schema, at) {
  const object = schema !== null && typeof schema === 'object' && !Array.isArray(schema) ? schema : undefined
  if (!object) return `${at} has no inputSchema object`
  if (Array.isArray(object.type)) return `${at} uses a type array unsupported by DSH`
  if (object.nullable === true) return `${at} uses nullable unsupported by DSH`
  if ('$ref' in object) return `${at} uses $ref unsupported by DSH`
  if (object.type !== undefined && !SUPPORTED_SCHEMA_TYPES.has(String(object.type))) {
    return `${at} uses unsupported type ${String(object.type)}`
  }
  if (object.oneOf !== undefined) {
    if (!Array.isArray(object.oneOf) || object.oneOf.length < 2) return `${at} has an invalid oneOf`
    for (const [index, branch] of object.oneOf.entries()) {
      const problem = schemaProblem(branch, `${at}.oneOf[${index}]`)
      if (problem) return problem
    }
  }
  if (object.properties !== undefined && object.properties !== null && typeof object.properties === 'object') {
    for (const [name, property] of Object.entries(object.properties)) {
      const problem = schemaProblem(property, `${at}.properties.${name}`)
      if (problem) return problem
    }
  }
  if (object.items !== undefined) {
    const problem = schemaProblem(object.items, `${at}.items`)
    if (problem) return problem
  }
  return undefined
}

/** Order-insensitive canonical schema serialization for drift comparison. */
function canonicalSchema(value) {
  const canonicalize = (input) => {
    if (Array.isArray(input)) return input.map(canonicalize)
    if (input !== null && typeof input === 'object') {
      const record = {}
      for (const key of Object.keys(input).sort()) record[key] = canonicalize(input[key])
      return record
    }
    return input
  }
  return JSON.stringify(canonicalize(value))
}

/** Content digest over the pinned manifest's canonical serialization. */
export function manifestDigest(manifest = XEROLO_MANIFEST) {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
}

/**
 * Fail-closed verification of the pinned manifest itself: the content digest,
 * the exact package/version identity, and a structurally sound tool set. Runs
 * before any workspace server is acquired or any tool may execute.
 */
export function verifyManifest(manifest = XEROLO_MANIFEST) {
  const errors = []
  const digest = manifestDigest(manifest)
  if (digest !== XEROLO_MANIFEST_SHA256) {
    errors.push(`pinned Xerolo manifest digest mismatch (got ${digest.slice(0, 12)}, expected ${XEROLO_MANIFEST_SHA256.slice(0, 12)})`)
  }
  if (manifest?.package !== XEROLO_PACKAGE || manifest?.version !== XEROLO_VERSION) {
    errors.push(`pinned Xerolo manifest does not name ${XEROLO_PACKAGE}@${XEROLO_VERSION}`)
  }
  const tools = manifest?.tools
  if (!Array.isArray(tools) || tools.length === 0) {
    errors.push('pinned Xerolo manifest has no tools')
    return { errors }
  }
  if (new Set(tools.map((tool) => tool?.name)).size !== tools.length) {
    errors.push('pinned Xerolo manifest contains duplicate tool names')
  }
  const critical = missingCriticalTools(tools.map((tool) => tool?.name))
  if (critical.length > 0) {
    errors.push(`pinned Xerolo manifest is missing critical RPG Maker tools: ${critical.join(', ')}`)
  }
  for (const tool of tools) {
    const problem = schemaProblem(tool?.inputSchema, `manifest tool ${tool?.name ?? '?'}`)
    if (problem) errors.push(problem)
  }
  return { errors }
}

/**
 * Fail-closed validation of the complete discovered Xerolo tool set against
 * the pinned manifest: live names must be exactly the manifest set and each
 * live input schema must match the manifest's supported schema.
 */
export function validateDiscoveredTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) {
    return { errors: ['tools/list returned no tools'] }
  }
  const names = tools
    .map((tool) => tool?.name)
    .filter((name) => typeof name === 'string' && name.length > 0)
  if (names.length !== tools.length) {
    return { errors: ['tools/list returned a tool without a name'] }
  }
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index)
  if (duplicates.length > 0) {
    return { errors: [`tools/list returned duplicate tool names: ${[...new Set(duplicates)].join(', ')}`] }
  }
  const unknown = names.filter((name) => !XEROLO_TOOL_SET.has(name))
  if (unknown.length > 0) {
    return { errors: [`tools/list returned tools outside the fixed Xerolo contract: ${unknown.join(', ')}`] }
  }
  const critical = missingCriticalTools(names)
  if (critical.length > 0) {
    return { errors: [`tools/list is missing critical RPG Maker tools: ${critical.join(', ')}`] }
  }
  const missing = XEROLO_TOOL_NAMES.filter((name) => !names.includes(name))
  if (missing.length > 0) {
    return { errors: [`tools/list is missing required RPG Maker tools: ${missing.join(', ')}`] }
  }
  for (const tool of tools) {
    const manifestTool = XEROLO_TOOL_BY_NAME.get(tool.name)
    if (!manifestTool || canonicalSchema(tool.inputSchema) !== canonicalSchema(manifestTool.inputSchema)) {
      return { errors: [`tool ${tool.name} input schema drifted from the pinned Xerolo manifest`] }
    }
  }
  return { errors: [] }
}

/** Fail-closed validation of the generated `rpgmaker_<raw>` model-facing names. */
export function validateModelNames(names) {
  const errors = []
  for (const name of names) {
    if (typeof name !== 'string' || !TOOL_NAME_PATTERN.test(name)) {
      errors.push(`generated tool name ${String(name)} is invalid`)
    }
  }
  if (new Set(names).size !== names.length) errors.push('generated tool names are not unique')
  if (names.includes(RESERVED_DSH_TOOL_NAME)) {
    errors.push(`generated tool names collide with the reserved DSH tool ${RESERVED_DSH_TOOL_NAME}`)
  }
  return { errors }
}
