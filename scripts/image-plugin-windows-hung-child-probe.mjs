import { mkdtemp, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  IMAGE_OPERATION_CLEANUP_GRACE_MS,
  clearChildSpawner,
  clearTerminationCommandSpawner,
  clearTreeTerminator,
  invokeImageOperation,
  setChildSpawner
} from '../bundle/dsh-image-workshop/lib/workshop-client.js'

if (process.platform !== 'win32') {
  throw new Error('The direct image-plugin hung-child probe is Windows-only.')
}

const root = await mkdtemp(join(tmpdir(), 'dsh-image-plugin-windows-probe-'))
const logPath = join(root, 'image-workshop.jsonl')
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
})
const spawner = Object.assign(() => child, { platform: 'win32' })
setChildSpawner(spawner)
const controller = new AbortController()
const startedAt = Date.now()
let cleanupStartedAt = startedAt
const operation = invokeImageOperation(
  'inspect',
  ['--input', 'hung-child.png'],
  { DSH_IMAGE_WORKSHOP_CLI: 'test-owned-hung-child', BUN_EXECUTABLE: process.execPath, DSH_IMAGE_WORKSHOP_LOG: logPath },
  controller.signal
)
setTimeout(() => {
  cleanupStartedAt = Date.now()
  controller.abort('native Windows hung-child probe')
}, 100)

try {
  await operation
  throw new Error('The hung-child probe unexpectedly completed successfully.')
} catch (error) {
  const elapsedMs = Date.now() - startedAt
  const cleanupElapsedMs = Date.now() - cleanupStartedAt
  if (cleanupElapsedMs > IMAGE_OPERATION_CLEANUP_GRACE_MS) {
    throw new Error(`Windows image cancellation exceeded the five-second cleanup grace (${cleanupElapsedMs} ms).`)
  }
  const code = error?.code
  if (code !== 'cancelled' && code !== 'IMAGE_CANCELLATION_INCOMPLETE') {
    throw new Error(`Unexpected image cancellation result: ${error instanceof Error ? error.message : String(error)}`)
  }
  console.log(JSON.stringify({ ok: true, elapsedMs, cleanupElapsedMs, code, logPath }))
} finally {
  clearChildSpawner()
  clearTreeTerminator()
  clearTerminationCommandSpawner()
  if (child.exitCode === null && child.signalCode === null) child.kill()
  await rm(root, { recursive: true, force: true })
}
