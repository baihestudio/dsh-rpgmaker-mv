/**
 * Canonical workspace resolution and the fixed stdio server definition for one
 * RPG Maker MV workspace. The session header cwd is treated as the COMPLETE
 * project root: `Game.rpgproject`, `data`, and `js` must sit directly beneath
 * it. Parents are never searched and no path is accepted from workspace files.
 */
import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'

import { neutralizedServerEnv } from './env.js'

export const MV_PROJECT_MARKER = 'Game.rpgproject'
export const MV_REQUIRED_DIRECTORIES = ['data', 'js']
export const XEROLO_PACKAGE = '@xerolo44/rpgmaker-mv-mcp'
export const XEROLO_ENTRY = join('dist', 'index.js')
export const TOOL_CALL_TIMEOUT_MS = 60_000

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

/** Direct-children markers only; never searches parents. */
export async function validateWorkspace(canonical) {
  const missing = []
  if (!(await exists(join(canonical, MV_PROJECT_MARKER), 'file'))) missing.push(MV_PROJECT_MARKER)
  for (const directory of MV_REQUIRED_DIRECTORIES) {
    if (!(await exists(join(canonical, directory), 'directory'))) missing.push(directory)
  }
  return { valid: missing.length === 0, missing, projectPath: canonical }
}

/** Deterministic internal server name; a workspace identity, never a tool name. */
export function privateServerName(canonical) {
  const digest = createHash('sha256').update(canonical).digest('hex')
  return `rpgmaker-ws-${digest.slice(0, 12)}`
}

/** Resolve the pinned Xerolo JavaScript entry inside the owned runtime. */
export async function resolveXeroloEntry(xeroloRuntime) {
  const packageDir = join(xeroloRuntime, 'node_modules', XEROLO_PACKAGE)
  const manifest = await readFile(join(packageDir, 'package.json'), 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => undefined)
  const bins = asRecord(manifest?.bin)
  const entry = typeof manifest?.bin === 'string' ? manifest.bin : bins?.['rpgmaker-mv-mcp']
  if (typeof entry !== 'string' || !/\.(?:c?m?js)$/i.test(entry)) {
    throw new Error(`dsh-workspace-mcp: the pinned ${XEROLO_PACKAGE} package has no JavaScript entry`)
  }
  const candidate = resolve(packageDir, entry)
  if (!(await exists(candidate, 'file'))) {
    throw new Error(`dsh-workspace-mcp: the pinned Xerolo entry does not exist: ${candidate}`)
  }
  let runtimeReal = xeroloRuntime
  let entryReal = candidate
  try {
    runtimeReal = await realpath(xeroloRuntime)
    entryReal = await realpath(candidate)
  } catch {
    // The direct checks above already established existence; a realpath
    // failure here means an odd filesystem, so keep the lexical paths.
  }
  const remainder = relative(runtimeReal, entryReal)
  if (remainder === '..' || remainder.startsWith(`..${sep}`)) {
    throw new Error('dsh-workspace-mcp: the pinned Xerolo entry escapes the app-owned runtime')
  }
  return candidate
}

/** The fixed stdio definition for one workspace; nothing is model-supplied. */
export async function buildWorkspaceDefinition(canonical, paths, env = process.env) {
  const entry = await resolveXeroloEntry(paths.xeroloRuntime)
  return {
    name: privateServerName(canonical),
    command: {
      kind: 'stdio',
      command: paths.runner,
      args: [entry, '--project', canonical],
      cwd: canonical
    },
    env: neutralizedServerEnv(env)
  }
}
