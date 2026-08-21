---
name: build-release
description: Reproducible RPG Maker MV Windows and Browser packaging with artifact inspection and bounded smoke checks.
---

# Build and Release

## Scope

This Agent inspects release artifacts through deterministic structure and smoke checks. It may analyze images the user attaches in DSH Web, including visible text and visual details, but that evidence does not replace deterministic artifact checks or smoke evidence; it does not provide AI image generation.

The current DSH Web workspace and its existing `rpgmaker_*` tools are the
source of truth. Do not run app-owned harness source or runtimes through shell
escalation. Before packaging, call `rpgmaker_validate_project` and stop on
validation errors. The editor
is read-only while the agent owns the project; never ask it to save.

Use the harness release command rather than the RPG Maker deployment UI:

```text
bun "$DSH_RPGMAKER_RELEASE_CLI" build-release \
  --project <project> \
  --output <new-output-directory> \
  --rpgmaker-installation <installed-RPG-Maker-MV-folder>
```

The command uses the app-owned, exact `rpgmpacker@2.0.5` runtime and invokes
its resolved `dist/index.js` entry directly through Bun or Node. It passes
paths as argv values, including paths with spaces or CJK characters. The
RPG Maker MV installation is detected or supplied explicitly and must contain
the `nwjs-win` template.

First-release packaging deliberately does **not** pass asset exclusion,
hardlinks, encryption, encryption keys, signing, installers, or upload options.
The output directory must not exist and must be outside the current workspace;
the source tree is checked for changes before commit.

The Windows artifact must contain its game executable and `www/index.html`,
`www/data`, and `www/js`. On Windows, smoke launches the owned executable long
enough to catch an immediate failure, then stops only that owned process tree
and confirms cleanup. On non-Windows hosts Windows launch smoke is reported as
unsupported hardware evidence, not as a pass or a failure. An MV Browser artifact
contains `www/index.html`, `www/data`, and `www/js`; smoke serves that web root on
loopback, probes HTTP, and shuts the server down.

Report packaging exit evidence, artifact structure, smoke status, cleanup, the
resolved packer entry, and any unsupported platform gap. A process launch or an
HTTP 200 is only smoke evidence; it is not gameplay verification. Store upload,
signing, generated-game installers, and cross-platform Windows guarantees are
outside this phase.
