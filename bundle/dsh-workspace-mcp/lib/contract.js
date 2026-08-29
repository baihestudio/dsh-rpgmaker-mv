/**
 * Fixed, generated contracts for both supported RPG Maker engines. Each
 * manifest is derived from the exact package's `tools/list` response and is
 * verified before a workspace child is acquired or a tool can execute.
 */
import { createHash } from 'node:crypto'

import { MZ_MANIFEST } from './mz-manifest.js'
import { XEROLO_MANIFEST } from './xerolo-manifest.js'
export { XEROLO_MANIFEST, MZ_MANIFEST }

export const XEROLO_PACKAGE = '@xerolo44/rpgmaker-mv-mcp'
export const XEROLO_VERSION = '0.1.0'
export const MZ_PACKAGE = 'rpgmaker-mz-mcp'
export const MZ_VERSION = '1.3.0'
/** Content digests over JSON.stringify of each generated manifest. */
export const XEROLO_MANIFEST_SHA256 = '09313bebb48af8274c8ce7b3c7c0dff1e2b769a51ae5f7928f4e6f26a3a5be79'
export const MZ_MANIFEST_SHA256 = 'd3409ee3f4181875042020b593a488a6b5f102e9e6c50f3ef4f05b4299e83658'

export const ENGINE_CONTRACTS = Object.freeze({
  mv: Object.freeze({ id: 'mv', label: 'MV', package: XEROLO_PACKAGE, version: XEROLO_VERSION, manifest: XEROLO_MANIFEST, digest: XEROLO_MANIFEST_SHA256 }),
  mz: Object.freeze({ id: 'mz', label: 'MZ', package: MZ_PACKAGE, version: MZ_VERSION, manifest: MZ_MANIFEST, digest: MZ_MANIFEST_SHA256 })
})

export const XEROLO_TOOL_NAMES = XEROLO_MANIFEST.tools.map((tool) => tool.name)
export const MZ_TOOL_NAMES = MZ_MANIFEST.tools.map((tool) => tool.name)

/** Critical contract tools for MV, including its existing Playtest lifecycle. */
export const CRITICAL_XEROLO_TOOLS = [
  'create_record', 'update_record', 'update_event', 'validate_project',
  'list_backups', 'restore_backup', 'playtest_start', 'playtest_status',
  'playtest_log', 'playtest_stop'
]

/** Critical MZ editing/validation capabilities; Playtest is intentionally absent. */
export const CRITICAL_MZ_TOOLS = [
  'get_project', 'set_project', 'update_actor', 'get_map', 'update_map_event',
  'set_map_tile', 'validate_project', 'validate_references'
]

function engineContract(engine) {
  if (engine !== 'mv' && engine !== 'mz') throw new Error(`unsupported RPG Maker engine ${String(engine)}; expected "mv" or "mz"`)
  return ENGINE_CONTRACTS[engine]
}

export function missingCriticalTools(names, engine) {
  engineContract(engine)
  const required = engine === 'mz' ? CRITICAL_MZ_TOOLS : CRITICAL_XEROLO_TOOLS
  return required.filter((name) => !names.includes(name))
}

export const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/
export const TOOL_NAME_PREFIX = 'rpgmaker_'
export const RESERVED_DSH_TOOL_NAME = 'run_code'
const SUPPORTED_SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])

export function manifestFor(engine) {
  return engineContract(engine).manifest
}

export function contractFor(engine) {
  return engineContract(engine)
}

/** First unsupported-schema problem, or undefined when the node is supported. */
export function schemaProblem(schema, at) {
  const object = schema !== null && typeof schema === 'object' && !Array.isArray(schema) ? schema : undefined
  if (!object) return `${at} has no inputSchema object`
  if (Array.isArray(object.type)) return `${at} uses a type array unsupported by DSH`
  if (object.nullable === true) return `${at} uses nullable unsupported by DSH`
  if ('$ref' in object) return `${at} uses $ref unsupported by DSH`
  if (object.type !== undefined && !SUPPORTED_SCHEMA_TYPES.has(String(object.type))) return `${at} uses unsupported type ${String(object.type)}`
  for (const keyword of ['oneOf', 'anyOf']) {
    if (object[keyword] === undefined) continue
    if (!Array.isArray(object[keyword]) || object[keyword].length < 2) return `${at} has an invalid ${keyword}`
    for (const [index, branch] of object[keyword].entries()) {
      const problem = schemaProblem(branch, `${at}.${keyword}[${index}]`)
      if (problem) return problem
    }
  }
  if (object.allOf !== undefined) {
    if (!Array.isArray(object.allOf) || object.allOf.length < 1) return `${at} has an invalid allOf`
    for (const [index, branch] of object.allOf.entries()) {
      const problem = schemaProblem(branch, `${at}.allOf[${index}]`)
      if (problem) return problem
    }
  }
  for (const key of ['properties', 'patternProperties']) {
    if (object[key] === undefined || object[key] === null || typeof object[key] !== 'object') continue
    for (const [name, property] of Object.entries(object[key])) {
      const problem = schemaProblem(property, `${at}.${key}.${name}`)
      if (problem) return problem
    }
  }
  if (object.items !== undefined) {
    const problem = schemaProblem(object.items, `${at}.items`)
    if (problem) return problem
  }
  return undefined
}

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

export function manifestDigest(manifest = XEROLO_MANIFEST) {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
}

function hasDryRunCapability(manifest) {
  return manifest.tools.some((tool) => {
    const properties = tool?.inputSchema?.properties
    return properties && Object.prototype.hasOwnProperty.call(properties, 'dryRun')
  })
}

/** Fail-closed verification of one pinned or explicitly supplied manifest. */
export function verifyManifest(engine, manifestOverride) {
  const contract = contractFor(engine)
  const manifest = manifestOverride === undefined ? contract.manifest : manifestOverride
  const errors = []
  const digest = manifestDigest(manifest)
  if (digest !== contract.digest) errors.push(`pinned ${contract.label} manifest digest mismatch (got ${digest.slice(0, 12)}, expected ${contract.digest.slice(0, 12)})`)
  if (manifest?.package !== contract.package || manifest?.version !== contract.version) errors.push(`pinned ${contract.label} manifest does not name ${contract.package}@${contract.version}`)
  const tools = manifest?.tools
  if (!Array.isArray(tools) || tools.length === 0) {
    errors.push(`pinned ${contract.label} manifest has no tools`)
    return { errors }
  }
  if (new Set(tools.map((tool) => tool?.name)).size !== tools.length) errors.push(`pinned ${contract.label} manifest contains duplicate tool names`)
  const critical = missingCriticalTools(tools.map((tool) => tool?.name), engine)
  if (critical.length > 0) errors.push(`pinned ${contract.label} manifest is missing critical RPG Maker tools: ${critical.join(', ')}`)
  if (engine === 'mz' && !hasDryRunCapability(manifest)) errors.push('pinned MZ manifest has no dryRun-capable mutating tool')
  for (const tool of tools) {
    if (typeof tool?.name !== 'string' || !TOOL_NAME_PATTERN.test(tool.name)) errors.push(`pinned ${contract.label} manifest has invalid raw tool name ${String(tool?.name)}`)
    if (typeof tool?.description !== 'string') errors.push(`pinned ${contract.label} manifest tool ${tool?.name ?? '?'} has no description`)
    const problem = schemaProblem(tool?.inputSchema, `manifest tool ${tool?.name ?? '?'}`)
    if (problem) errors.push(problem)
  }
  return { errors }
}

/** Validate complete live tools/list parity against the selected manifest. */
export function validateDiscoveredTools(tools, engine) {
  const contract = contractFor(engine)
  const manifest = contract.manifest
  const manifestTools = manifest.tools ?? []
  const expectedNames = manifestTools.map((tool) => tool.name)
  const expectedSet = new Set(expectedNames)
  const byName = new Map(manifestTools.map((tool) => [tool.name, tool]))
  if (!Array.isArray(tools) || tools.length === 0) return { errors: ['tools/list returned no tools'] }
  const names = tools.map((tool) => tool?.name).filter((name) => typeof name === 'string' && name.length > 0)
  if (names.length !== tools.length) return { errors: ['tools/list returned a tool without a name'] }
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index)
  if (duplicates.length > 0) return { errors: [`tools/list returned duplicate tool names: ${[...new Set(duplicates)].join(', ')}`] }
  const unknown = names.filter((name) => !expectedSet.has(name))
  if (unknown.length > 0) return { errors: [`tools/list returned tools outside the fixed ${engine === 'mv' ? 'Xerolo' : contract.label} contract: ${unknown.join(', ')}`] }
  const critical = missingCriticalTools(names, engine)
  if (critical.length > 0) return { errors: [`tools/list is missing critical RPG Maker tools: ${critical.join(', ')}`] }
  const missing = expectedNames.filter((name) => !names.includes(name))
  if (missing.length > 0) return { errors: [`tools/list is missing required RPG Maker tools: ${missing.join(', ')}`] }
  for (const tool of tools) {
    const manifestTool = byName.get(tool.name)
    if (!manifestTool || canonicalSchema(tool.inputSchema) !== canonicalSchema(manifestTool.inputSchema)) return { errors: [`tool ${tool.name} input schema drifted from the pinned ${contract.label} manifest`] }
    if ((engine === 'mz' && tool.description !== manifestTool.description)
      || (engine === 'mv' && tool.description !== undefined && tool.description !== manifestTool.description)) {
      return { errors: [`tool ${tool.name} description drifted from the pinned ${contract.label} manifest`] }
    }
  }
  return { errors: [] }
}

/** Validate generated stable model-facing names. */
export function validateModelNames(names) {
  const errors = []
  for (const name of names) {
    if (typeof name !== 'string' || !TOOL_NAME_PATTERN.test(name)) errors.push(`generated tool name ${String(name)} is invalid`)
  }
  if (new Set(names).size !== names.length) errors.push('generated tool names are not unique')
  if (names.includes(RESERVED_DSH_TOOL_NAME)) errors.push(`generated tool names collide with the reserved DSH tool ${RESERVED_DSH_TOOL_NAME}`)
  return { errors }
}
