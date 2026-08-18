import { runVisionToolkitProfileProbe } from './vision-toolkit-profile-probe.mjs'

try {
  console.log(JSON.stringify(await runVisionToolkitProfileProbe({ includePresets: true })))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
