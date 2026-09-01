import { runCli } from './cli';

// The compiled Release executable is the authoritative entrypoint.  An
// extracted Release launched without a command always means first install;
// maintenance commands are explicit and are dispatched by the same binary.
const argv = process.argv.slice(2);
const args = argv.length === 0 ? ['install', '--release-root', process.cwd()] : argv;
const code = await runCli(args);
process.exitCode = code;
