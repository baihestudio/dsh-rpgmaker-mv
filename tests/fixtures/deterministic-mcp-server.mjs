/**
 * Deterministic stdio MCP server owned by the Ticket 01 tests. It proves the
 * narrow MCPorter Host pattern against a fixed tool list: explicit argv/cwd/
 * neutralized-env observation, process pooling, cancellation, and MCP error
 * results. Every write lands in the TEST-OWNED --context directory; nothing
 * here touches live state.
 *
 * Usage: <runner> deterministic-mcp-server.mjs --context <dir> [--with-unsupported] [--with-extra] [--with-duplicate] [--subset <n>]
 */
import { appendFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { join } from 'node:path'

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo the supplied message back.',
    inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] }
  },
  {
    name: 'shared_state',
    description: 'Increment an in-memory counter and return it; proves one pooled process across calls.',
    inputSchema: { type: 'object' }
  },
  {
    name: 'error_tool',
    description: 'Return an MCP error result.',
    inputSchema: { type: 'object' }
  },
  {
    name: 'slow_tool',
    description: 'Sleep for the requested milliseconds before returning.',
    inputSchema: { type: 'object', properties: { ms: { type: 'integer', minimum: 1 } }, required: ['ms'] }
  },
  {
    name: 'dump_context',
    description: 'Write argv, cwd, and selected environment facts to the context directory.',
    inputSchema: { type: 'object' }
  },
  {
    name: 'update_record',
    description: 'Set a named key to a value; shared across calls like a pooled server would.',
    inputSchema: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key'] }
  }
]

function parseArgs(argv) {
  const values = { context: undefined, subset: undefined }
  const flags = new Set()
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--context' || arg === '--subset') {
      values[arg.slice(2)] = argv[index + 1]
      index += 1
    } else if (arg.startsWith('--')) {
      flags.add(arg)
    }
  }
  return { ...values, flags }
}

const args = parseArgs(process.argv)
const contextDir = args.context
if (!contextDir) {
  console.error('deterministic-mcp-server: --context <dir> is required')
  process.exit(2)
}

let tools = [...TOOLS]
if (args.flags.has('--with-unsupported')) {
  tools = [...tools, { name: 'unsupported_schema_tool', description: 'Schema DSH rejects', inputSchema: { type: ['string', 'number'] } }]
}
if (args.flags.has('--with-extra')) {
  tools = [...tools, { name: 'not_in_contract', description: 'Unknown tool name', inputSchema: { type: 'object' } }]
}
if (args.flags.has('--with-duplicate')) {
  tools = [...tools, { name: 'echo', description: 'Duplicate name', inputSchema: { type: 'object' } }]
}
if (args.subset !== undefined) {
  const count = Number(args.subset)
  if (!Number.isInteger(count) || count < 0) {
    console.error('deterministic-mcp-server: --subset must be a non-negative integer')
    process.exit(2)
  }
  tools = tools.slice(0, count)
}

const startedPath = join(contextDir, 'started.jsonl')
await appendFile(startedPath, `${JSON.stringify({ at: Date.now(), pid: process.pid, argv: process.argv })}\n`)

let counter = 0
const store = new Map()

async function handleCall(toolName, params) {
  if (toolName === 'echo') {
    return { content: [{ type: 'text', text: String(params.message ?? '') }] }
  }
  if (toolName === 'shared_state') {
    counter += 1
    return { content: [{ type: 'text', text: JSON.stringify({ count: counter, pid: process.pid }) }] }
  }
  if (toolName === 'error_tool') {
    return { content: [{ type: 'text', text: 'boom' }], isError: true }
  }
  if (toolName === 'slow_tool') {
    const ms = Number(params.ms ?? 1000)
    await new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
    return { content: [{ type: 'text', text: JSON.stringify({ slept: ms }) }] }
  }
  if (toolName === 'dump_context') {
    const env = Object.fromEntries(
      Object.entries(process.env)
        .filter(([key]) => ['PATH', 'HOME', 'TMPDIR', 'DEEPSEEK_API_KEY', 'NPM_TOKEN', 'DSH_HOME', 'DSH_RPGMAKER_PROGRAM_ROOT', 'DSH_RPGMAKER_MCPORTER_RUNTIME'].includes(key))
    )
    await writeFile(join(contextDir, 'context.json'), `${JSON.stringify({ argv: process.argv, cwd: process.cwd(), env }, null, 2)}\n`)
    return { content: [{ type: 'text', text: JSON.stringify({ dumped: true }) }] }
  }
  if (toolName === 'update_record') {
    store.set(String(params.key), String(params.value))
    return { content: [{ type: 'text', text: JSON.stringify({ key: String(params.key), value: String(params.value) }) }] }
  }
  throw new Error(`unknown tool ${toolName}`)
}

const readline = createInterface({ input: process.stdin, crlfDelay: Infinity })
readline.on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (message.method === 'initialize') {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'deterministic-mcp-server', version: '0.1.0' } }
    })}\n`)
    return
  }
  if (message.method === 'notifications/initialized') return
  if (message.method === 'tools/list') {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools } })}\n`)
    return
  }
  if (message.method === 'tools/call') {
    void handleCall(message.params?.name, message.params?.arguments ?? {})
      .then((result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`))
      .catch((error) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true } })}\n`))
    return
  }
})
