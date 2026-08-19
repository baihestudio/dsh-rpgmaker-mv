/**
 * The generated `rpgmaker_<raw Xerolo name>` tool factory. One capability-local
 * registration factory copies each pinned-manifest description and input schema
 * and forwards execution to MCPorter by raw tool name; nothing here is a
 * hand-written per-tool wrapper. Execution first awaits the Agent's workspace
 * initialization (validation + live manifest parity), so no call can run
 * before the pinned contract is proven. The DSH tool deliberately declares no
 * timeout policy; the fixed transport timeout is owned by MCPorter.
 */
import { TOOL_NAME_PREFIX } from './contract.js'
import { callWorkspaceTool, canonicalMcpValue } from './mcport-host.js'

const EMPTY_OBJECT_SCHEMA = { type: 'object', properties: {}, additionalProperties: false }

function normalizeSchema(schema) {
  if (schema !== null && typeof schema === 'object' && !Array.isArray(schema)) return schema
  return EMPTY_OBJECT_SCHEMA
}

function renderResult(_args, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return [{ type: 'text', text }]
}

/** Stable model-facing name: `rpgmaker_` plus the raw Xerolo tool name. */
export function toModelName(rawName) {
  return `${TOOL_NAME_PREFIX}${rawName}`
}

/** One generated tool bound to a workspace's pooled server. */
export function createMcpTool(rawTool, workspace) {
  const name = toModelName(rawTool.name)
  return {
    name,
    description: typeof rawTool.description === 'string' ? rawTool.description : `RPG Maker MV ${rawTool.name}`,
    parameters: normalizeSchema(rawTool.inputSchema),
    output: { schema: {}, render: renderResult },
    execute: async (args, exec) => {
      const { host, canonical, paths } = await workspace.init
      const result = await host.callWorkspaceTool(paths, canonical, rawTool.name, args ?? {}, {
        signal: exec?.signal
      })
      return canonicalMcpValue(result)
    },
    presentCall: (args) => ({ card: 'generic', title: `RPG Maker ${rawTool.name}`, kind: 'execute' })
  }
}
