/**
 * GENERATED TEST FIXTURE — do not edit by hand.
 *
 * Deterministic stand-in for the exact-pinned @xerolo44/rpgmaker-mv-mcp server.
 * phase10 seeds this template with the pinned bundle manifest (the schema
 * SSOT) at test setup and installs the result as the fixture runtime's
 * `node_modules/@xerolo44/rpgmaker-mv-mcp/dist/index.js`, so live `tools/list`
 * exactly matches `validateDiscoveredTools` without any external install. It
 * implements a small deterministic subset of call behaviors over a test-owned
 * in-memory store; nothing here touches live state.
 *
 * The __XEROLO_MANIFEST__ placeholder below is replaced with the manifest JSON.
 */
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { join } from 'node:path'

const XEROLO_MANIFEST = __XEROLO_MANIFEST__

function parseArgs(argv) {
  let project
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === '--project') {
      project = argv[index + 1]
      index += 1
    }
  }
  return project
}

const projectRoot = parseArgs(process.argv) ?? process.cwd()
const tracePath = process.env.XEROLO_FIXTURE_TRACE
if (tracePath) await appendFile(tracePath, `${JSON.stringify({ projectRoot, pid: process.pid })}\n`)
const tools = process.env.XEROLO_FIXTURE_FAIL_PROJECT === projectRoot ? [] : XEROLO_MANIFEST.tools
const store = new Map() // type -> records[]

async function handleCall(toolName, params) {
  if (toolName === 'get_project_info') {
    let gameTitle = 'Unknown Game'
    try {
      const system = JSON.parse(await readFile(join(projectRoot, 'data', 'System.json'), 'utf8'))
      if (system && typeof system.gameTitle === 'string') gameTitle = system.gameTitle
    } catch {
      // The disposable project may not exist yet; the fixture stays deterministic.
    }
    const value = { gameTitle }
    return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value }
  }
  if (toolName === 'update_system') {
    let system = {}
    try {
      system = JSON.parse(await readFile(join(projectRoot, 'data', 'System.json'), 'utf8'))
    } catch {
      // The disposable project fixture starts with a minimal System.json.
    }
    const data = params?.data && typeof params.data === 'object' && !Array.isArray(params.data) ? params.data : {}
    const value = { ...system, ...data }
    await writeFile(join(projectRoot, 'data', 'System.json'), `${JSON.stringify(value)}\n`)
    return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value }
  }
  if (toolName === 'create_record') {
    const type = String(params?.type ?? '')
    const data = params?.data ?? {}
    const records = store.get(type) ?? []
    records.push(data)
    store.set(type, records)
    const value = { created: true, type, data }
    return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value }
  }
  if (toolName === 'list_records') {
    const type = String(params?.type ?? '')
    const value = store.get(type) ?? []
    return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value }
  }
  if (toolName === 'update_record') {
    const value = params ?? {}
    return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value }
  }
  const value = { ok: true, tool: toolName }
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value }
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
      result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'xerolo-fixture', version: '0.1.0' } }
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
