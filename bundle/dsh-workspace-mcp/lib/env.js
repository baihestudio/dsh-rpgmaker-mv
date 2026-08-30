/**
 * Owned-runtime environment contract and neutralization for the workspace MCP
 * Host plugin. The harness (never the Agent shell) resolves and pins the
 * app-owned runtimes and the JavaScript runner; this module only reads those
 * fixed paths and neutralizes ambient credentials and DSH variables before an
 * MV or MZ child is spawned.
 *
 * mcporter merges a server definition's env over its own ambient process.env
 * and cannot delete inherited keys, so strict key removal is impossible without
 * an isolated broker process. Instead every credential key covered by the
 * harness policy and every ambient DSH_* key that is present is overridden with
 * one constant non-empty non-secret marker: the merge then can never carry the
 * original value into the deterministic child. The DSH Host env itself keeps
 * its keys (DSH may need DEEPSEEK_API_KEY); only the child definition changes.
 */

export const MCPORTER_RUNTIME_ENV = 'DSH_RPGMAKER_MCPORTER_RUNTIME'
/** Shared app-owned runtime containing both the MV and MZ server packages. */
export const RPGMAKER_MCP_RUNTIME_ENV = 'DSH_RPGMAKER_MCP_RUNTIME'
export const JS_RUNNER_ENV = 'DSH_RPGMAKER_JS_RUNNER'

/** Constant non-empty non-secret value that replaces every neutralized key. */
export const SECRET_MARKER = 'dsh-workspace-mcp:redacted'

const CREDENTIAL_KEYS = [
  'DEEPSEEK_API_KEY',
  'DSH_API_KEY',
  'DSH_FORGEJO_ACCESS_TOKEN',
  'FORGEJO_ACCESS_TOKEN',
  'NPM_TOKEN',
  'NODE_AUTH_TOKEN',
  'GITHUB_TOKEN',
  'GITLAB_TOKEN',
  'npm_config__auth',
  'npm_config_//registry.npmjs.org/:_authToken'
]

function isNeutralizedKey(key) {
  const normalized = key.toLowerCase()
  return CREDENTIAL_KEYS.some((candidate) => candidate.toLowerCase() === normalized)
    || normalized.startsWith('dsh_')
}

/** Resolve the fixed owned runtime paths the harness pinned for this Host. */
export function resolveRuntimePaths(env = process.env) {
  const mcporterRuntime = env[MCPORTER_RUNTIME_ENV]
  const rpgmakerRuntime = env[RPGMAKER_MCP_RUNTIME_ENV]
  const runner = env[JS_RUNNER_ENV]
  const missing = []
  if (!mcporterRuntime) missing.push(MCPORTER_RUNTIME_ENV)
  if (!rpgmakerRuntime) missing.push(RPGMAKER_MCP_RUNTIME_ENV)
  if (!runner) missing.push(JS_RUNNER_ENV)
  if (missing.length > 0) {
    throw new Error(`dsh-workspace-mcp: the app-owned runtime environment is incomplete; missing ${missing.join(', ')}`)
  }
  return { mcporterRuntime, rpgmakerRuntime, runner }
}

/**
 * The full server definition env: every ambient key, with each present
 * credential/DSH key overridden by the constant marker. Because this object
 * covers every inherited key, mcporter's {...process.env, ...overrides} merge
 * cannot leak an original secret value into the child.
 */
export function neutralizedServerEnv(env = process.env) {
  const neutralized = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    neutralized[key] = isNeutralizedKey(key) ? SECRET_MARKER : value
  }
  return neutralized
}
