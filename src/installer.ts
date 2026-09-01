import { dirname } from 'node:path';

import { runCli } from './cli';

// The compiled Release executable is the authoritative entrypoint.  An
// extracted Release launched without a command always means first install;
// maintenance commands are explicit and are dispatched by the same binary.
export function installerArguments(argv: readonly string[] = process.argv.slice(2), executablePath: string = process.execPath): string[] {
  return argv.length === 0 ? ['install', '--release-root', dirname(executablePath)] : [...argv];
}

if (import.meta.main) {
  const code = await runCli(installerArguments());
  process.exitCode = code;
}
