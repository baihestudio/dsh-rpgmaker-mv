import { spawn } from 'node:child_process';

const MAX_CREDENTIAL_BYTES = 64 * 1024;

class CredentialWrapperError extends Error {}

function credentialRequest(rawUrl) {
  let endpoint;
  try {
    endpoint = new URL(rawUrl);
  } catch {
    throw new CredentialWrapperError('FORGEJO_GIT_CREDENTIAL_URL is not a valid URL.');
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || !endpoint.host) {
    throw new CredentialWrapperError('FORGEJO_GIT_CREDENTIAL_URL must be an HTTP(S) URL with a host.');
  }
  if (endpoint.username || endpoint.password) {
    throw new CredentialWrapperError('FORGEJO_GIT_CREDENTIAL_URL must not contain credentials.');
  }
  const path = endpoint.pathname.replace(/^\/+/, '');
  return [
    `protocol=${endpoint.protocol.slice(0, -1)}`,
    `host=${endpoint.host}`,
    ...(path ? [`path=${path}`] : []),
    '',
    ''
  ].join('\n');
}

function readGitCredential(command, request) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, ['credential', 'fill'], {
        env: { ...process.env, GCM_INTERACTIVE: 'Never', GIT_TERMINAL_PROMPT: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch {
      reject(new CredentialWrapperError('could not start git credential fill.'));
      return;
    }
    const chunks = [];
    let byteLength = 0;
    child.stdout.on('data', (chunk) => {
      byteLength += chunk.length;
      if (byteLength > MAX_CREDENTIAL_BYTES) {
        child.kill();
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.resume();
    child.once('error', () => reject(new CredentialWrapperError('could not start git credential fill.')));
    child.once('close', (code) => {
      if (byteLength > MAX_CREDENTIAL_BYTES) {
        reject(new CredentialWrapperError('git credential fill returned too much data.'));
      } else if (code !== 0) {
        reject(new CredentialWrapperError(`git credential fill failed with exit code ${code ?? 1}.`));
      } else {
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });
    child.stdin.end(request);
  });
}

function credentialPassword(output) {
  for (const line of output.split(/\r?\n/)) {
    if (!line.startsWith('password=')) continue;
    const password = line.slice('password='.length);
    if (password) return password;
  }
  throw new CredentialWrapperError('no password was returned by git credential fill.');
}

function startForgejoMcp(command, args, token) {
  return new Promise((resolve, reject) => {
    const environment = { ...process.env, FORGEJO_ACCESS_TOKEN: token };
    delete environment.DSH_FORGEJO_ACCESS_TOKEN;
    let child;
    try {
      child = spawn(command, args, {
        cwd: process.cwd(),
        env: environment,
        stdio: 'inherit',
        windowsHide: true
      });
    } catch {
      reject(new CredentialWrapperError('could not start forgejo-mcp.'));
      return;
    }
    const signals = ['SIGINT', 'SIGTERM'];
    const handlers = new Map();
    for (const signal of signals) {
      const handler = () => {
        if (!child.killed) child.kill(signal);
      };
      handlers.set(signal, handler);
      process.once(signal, handler);
    }
    const removeSignalHandlers = () => {
      for (const [signal, handler] of handlers) process.off(signal, handler);
    };
    child.once('error', () => {
      removeSignalHandlers();
      reject(new CredentialWrapperError('could not start forgejo-mcp.'));
    });
    child.once('exit', (code, signal) => {
      removeSignalHandlers();
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

async function main() {
  const credentialUrl = process.env.FORGEJO_GIT_CREDENTIAL_URL;
  const forgejoMcp = process.env.FORGEJO_MCP_EXECUTABLE;
  if (!credentialUrl) throw new CredentialWrapperError('FORGEJO_GIT_CREDENTIAL_URL is not configured.');
  if (!forgejoMcp) throw new CredentialWrapperError('FORGEJO_MCP_EXECUTABLE is not configured.');
  const credential = await readGitCredential(process.env.FORGEJO_GIT_EXECUTABLE || 'git', credentialRequest(credentialUrl));
  return startForgejoMcp(forgejoMcp, process.argv.slice(2), credentialPassword(credential));
}

main().then(
  (code) => { process.exitCode = code; },
  (error) => {
    const message = error instanceof CredentialWrapperError ? error.message : 'unexpected credential-wrapper failure.';
    process.stderr.write(`Forgejo MCP credential wrapper: ${message}\n`);
    process.exitCode = 1;
  }
);
