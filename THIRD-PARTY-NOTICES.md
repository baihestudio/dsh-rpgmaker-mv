# Third-party notices

## `pnpm@10.15.1`

When no system `pnpm` is available, the installer keeps an app-owned exact `pnpm@10.15.1` runtime so DSH's standard plugin manager can run without modifying a user's global package manager. npm integrity: `sha512-NOU4wym1VTAUyo6PRTWZf5YYCh0PYUM5NXRJk1NQ2STiL4YUaCGRJk7DPRRirCFWGv+X9rsYBlNRwWLH6PbeZw==`. pnpm is distributed under the MIT License: https://github.com/pnpm/pnpm/blob/main/LICENSE.

## `forgejo-mcp@2.34.1`

The Release ZIP includes `tools/forgejo-mcp/forgejo-mcp.exe` as a separate
process. It is licensed under GPL-3.0-or-later; its license is packaged beside
the executable. The exact source used for this Windows amd64 build is
[`agentic-forges/forgejo-mcp` commit `223874f344d34c8922a6b299c83ec368b902e1a0`](https://git.b4mad.industries/agentic-forges/forgejo-mcp/src/commit/223874f344d34c8922a6b299c83ec368b902e1a0).
The bundled manifest records the source, Go toolchain, build target, flags, and
SHA-256.
