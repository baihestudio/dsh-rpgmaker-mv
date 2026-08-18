/**
 * Workspace path fencing for the app-owned image tools.
 *
 * Model-facing paths are project-relative and must stay inside the Agent's
 * immutable workspace directory. Absolute paths, traversal escapes, symlink or
 * junction escapes, missing inputs, and outputs outside the workspace are
 * rejected before any subprocess starts.
 */
import { realpath } from 'node:fs/promises'
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'

export class ImageWorkshopWorkspaceError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ImageWorkshopWorkspaceError'
  }
}

const WINDOWS_DRIVE = /^[a-zA-Z]:/

/** Pure path-shape validation; no filesystem access. Returns the normalized slash-path parts. */
export function validateRelativePath(raw, label = 'Path') {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new ImageWorkshopWorkspaceError(`${label} must be a non-empty project-relative path.`)
  }
  const trimmed = raw.trim()
  if (isAbsolute(trimmed) || WINDOWS_DRIVE.test(trimmed) || /^(\/|\\)/.test(trimmed)) {
    throw new ImageWorkshopWorkspaceError(`${label} must be project-relative; absolute paths are not allowed.`)
  }
  const parts = normalize(trimmed).split(/[\\/]+/).filter((part) => part !== '' && part !== '.')
  if (parts.some((part) => part === '..')) {
    throw new ImageWorkshopWorkspaceError(`${label} escapes the workspace; '..' traversal is not allowed.`)
  }
  if (parts.length === 0) {
    throw new ImageWorkshopWorkspaceError(`${label} must not resolve to the workspace root.`)
  }
  return parts.join('/')
}

function within(candidate, root, platform) {
  const lower = (value) => (platform === 'win32' ? value.toLowerCase() : value)
  return lower(candidate) === lower(root) || lower(candidate).startsWith(`${lower(root)}${sep}`)
}

async function pathExists(path) {
  try {
    await realpath(path)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve a project-relative path beneath `workspace` and reject any escape.
 * For output paths (forOutput), the nearest existing ancestor is canonicalized
 * so a symlinked/junctioned output parent cannot point outside the workspace.
 */
export async function resolveWorkspacePath(workspace, raw, options = {}) {
  const platform = options.platform ?? process.platform
  const label = options.label ?? 'Path'
  const forOutput = options.forOutput === true
  const workspaceAbs = resolve(String(workspace))
  const rel = validateRelativePath(raw, label)
  const candidate = join(workspaceAbs, ...rel.split('/'))
  const relCheck = relative(workspaceAbs, candidate)
  if (relCheck === '' || relCheck === '.' || isAbsolute(relCheck) || relCheck.split(sep).includes('..')) {
    throw new ImageWorkshopWorkspaceError(`${label} resolves outside the workspace.`)
  }
  const workspaceReal = await realpath(workspaceAbs).catch(() => workspaceAbs)
  if (forOutput) {
    let existing = candidate
    while (!(await pathExists(existing))) {
      const up = resolve(existing, '..')
      if (up === existing) break
      existing = up
    }
    const existingReal = await realpath(existing).catch(() => existing)
    if (!within(existingReal, workspaceReal, platform)) {
      throw new ImageWorkshopWorkspaceError(`${label} escapes the workspace through a symlink or junction.`)
    }
  } else {
    const candidateReal = await realpath(candidate).catch(() => undefined)
    if (candidateReal !== undefined && !within(candidateReal, workspaceReal, platform)) {
      throw new ImageWorkshopWorkspaceError(`${label} escapes the workspace through a symlink or junction.`)
    }
  }
  return candidate
}
