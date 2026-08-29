/**
 * Canonical workspace resolution and fixed stdio definitions for the two
 * supported RPG Maker engines. The session header cwd is treated as the
 * COMPLETE project root. Parents and workspace-authored MCP configuration are
 * never searched.
 */
import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

import { neutralizedServerEnv } from './env.js'

export const MV_PROJECT_MARKER = 'Game.rpgproject'
export const MV_REQUIRED_DIRECTORIES = ['data', 'js']
export const MZ_PROJECT_MARKER = 'game.rmmzproject'
export const MZ_REQUIRED_DIRECTORIES = ['data', 'js']
export const XEROLO_PACKAGE = '@xerolo44/rpgmaker-mv-mcp'
export const XEROLO_VERSION = '0.1.0'
export const XEROLO_ENTRY = join('dist', 'index.js')
export const MZ_PACKAGE = 'rpgmaker-mz-mcp'
export const MZ_VERSION = '1.3.0'
export const MZ_ENTRY = join('dist', 'index.js')
export const ENGINE_IDS = ['mv', 'mz']
export const RPGMAKER_ENGINES = {
  mv: {
    id: 'mv', marker: MV_PROJECT_MARKER, requiredDirectories: MV_REQUIRED_DIRECTORIES,
    package: XEROLO_PACKAGE, version: XEROLO_VERSION, entry: XEROLO_ENTRY
  },
  mz: {
    id: 'mz', marker: MZ_PROJECT_MARKER, requiredDirectories: MZ_REQUIRED_DIRECTORIES,
    package: MZ_PACKAGE, version: MZ_VERSION, entry: MZ_ENTRY
  }
}
/** Fixed timeout passed to every MCPorter runtime.callTool invocation. */
export const MCPORTER_CALL_TIMEOUT_MS = 60_000

function asRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

async function exists(path, expected) {
  try {
    const info = await stat(path)
    return expected === 'file' ? info.isFile() : info.isDirectory()
  } catch {
    return false
  }
}

/** Canonicalize the Agent session cwd; rejects missing or unreadable roots. */
export async function canonicalWorkspace(cwd) {
  const requested = String(cwd ?? '').trim()
  if (!requested) throw new Error('dsh-workspace-mcp: the Agent session carries no workspace cwd')
  const normalized = resolve(requested)
  let canonical
  try {
    canonical = await realpath(normalized)
  } catch (error) {
    throw new Error(`dsh-workspace-mcp: RPG Maker workspace could not be canonicalized (${normalized})`)
  }
  return canonical
}

/**
 * Classify a canonical workspace from direct children only. A marker is an
 * engine claim; both markers are deliberately ambiguous even if the rest of
 * the layout happens to be valid. Missing directories are reported for the
 * selected marker, or for both expected markers when no marker exists.
 */
export async function classifyWorkspace(canonical) {
  const markerPresence = await Promise.all(ENGINE_IDS.map(async (id) => [id, await exists(join(canonical, RPGMAKER_ENGINES[id].marker), 'file')]))
  const present = markerPresence.filter(([, value]) => value).map(([id]) => id)
  if (present.length > 1) {
    return {
      valid: false, projectPath: canonical, engine: undefined, missing: [], markers: present.map((id) => RPGMAKER_ENGINES[id].marker), ambiguous: true
    }
  }
  if (present.length === 0) {
    return {
      valid: false, projectPath: canonical, engine: undefined, missing: [MV_PROJECT_MARKER, MZ_PROJECT_MARKER, ...new Set([...MV_REQUIRED_DIRECTORIES, ...MZ_REQUIRED_DIRECTORIES])], markers: [], ambiguous: false
    }
  }
  const engine = present[0]
  const record = RPGMAKER_ENGINES[engine]
  const missing = []
  for (const directory of record.requiredDirectories) {
    if (!(await exists(join(canonical, directory), 'directory'))) missing.push(directory)
  }
  return { valid: missing.length === 0, projectPath: canonical, engine, missing, markers: [record.marker], ambiguous: false }
}

/** Deterministic internal server name; an engine/workspace identity, never a tool name. */
export function privateServerName(engine, canonical) {
  if (!ENGINE_IDS.includes(engine)) throw new Error(`dsh-workspace-mcp: unknown RPG Maker engine ${String(engine)}`)
  if (typeof canonical !== 'string' || canonical.length === 0) throw new Error('dsh-workspace-mcp: canonical workspace is required')
  const digest = createHash('sha256').update(canonical).digest('hex')
  return `rpgmaker-${engine}-ws-${digest.slice(0, 12)}`
}

/** Resolve one pinned engine JavaScript entry inside the owned runtime. */
export async function resolveEngineEntry(engine, runtime) {
  const record = RPGMAKER_ENGINES[engine]
  if (!record) throw new Error(`dsh-workspace-mcp: unknown RPG Maker engine ${String(engine)}`)
  const packageDir = join(runtime, 'node_modules', ...record.package.split('/'))
  const manifest = await readFile(join(packageDir, 'package.json'), 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => undefined)
  const bins = asRecord(manifest?.bin)
  const binName = engine === 'mv' ? 'rpgmaker-mv-mcp' : 'rpgmaker-mz-mcp'
  const entry = typeof manifest?.bin === 'string' ? manifest.bin : bins?.[binName]
  if (typeof entry !== 'string' || !/\.(?:c?m?js)$/i.test(entry)) {
    throw new Error(`dsh-workspace-mcp: the pinned ${record.package} package has no JavaScript entry`)
  }
  const candidate = resolve(packageDir, entry)
  if (!(await exists(candidate, 'file'))) {
    throw new Error(`dsh-workspace-mcp: the pinned ${engine.toUpperCase()} entry does not exist: ${candidate}`)
  }
  let runtimeReal = runtime
  let entryReal = candidate
  try {
    runtimeReal = await realpath(runtime)
    entryReal = await realpath(candidate)
  } catch {
    // The direct checks above already established existence; a realpath
    // failure here means an odd filesystem, so keep the lexical paths.
  }
  const remainder = relative(runtimeReal, entryReal)
  if (isAbsolute(remainder) || remainder === '..' || remainder.startsWith(`..${sep}`)) {
    throw new Error(`dsh-workspace-mcp: the pinned ${engine.toUpperCase()} entry escapes the app-owned runtime`)
  }
  return candidate
}

/** The fixed stdio definition for one engine/workspace pair; nothing is model-supplied. */
export async function buildWorkspaceDefinition(engine, canonical, paths, env = process.env) {
  const record = RPGMAKER_ENGINES[engine]
  if (!record) throw new Error(`dsh-workspace-mcp: unknown RPG Maker engine ${String(engine)}`)
  const entry = await resolveEngineEntry(engine, paths.rpgmakerRuntime)
  const command = engine === 'mv'
    ? { kind: 'stdio', command: paths.runner, args: [entry, '--project', canonical], cwd: canonical }
    : { kind: 'stdio', command: paths.runner, args: [entry], cwd: canonical }
  const childEnv = neutralizedServerEnv(env)
  if (engine === 'mz') childEnv.RPGMAKER_PROJECT_PATH = canonical
  return {
    name: privateServerName(engine, canonical),
    command,
    env: childEnv
  }
}
