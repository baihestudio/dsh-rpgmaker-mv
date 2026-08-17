---
name: playtest-debug
description: Static validation and truthful RPG Maker MV NW.js Playtest diagnosis.
---

# Playtest Debug

Use only the existing session-scoped `mcp__rpgmaker_mv__*` tools. Do not start
another MCP server, register a workflow, adopt a PID, or invoke OS process
controls. The selected MCP owns the Playtest process.

Run this bounded sequence:

1. Call `mcp__rpgmaker_mv__validate_project`. If it reports errors, stop and
   report static validation failure; do not launch Playtest.
2. Call `mcp__rpgmaker_mv__playtest_status`. If `running` is `true`, refuse to
   start and ask the Agent/user to resolve the existing Playtest. If `running`
   is `false` but a PID is present, treat the status as inconsistent and also
   refuse to start. Never adopt a PID. Require `running: false` with no PID
   before continuing.
3. Call `mcp__rpgmaker_mv__playtest_start` with `{ "mode": "nwjs" }` and an
   explicit `runtimePath` when the Windows NW.js executable is known. A
   successful response proves process launch only. An MCP error is launch
   failure; do not infer ownership from a later status response.
4. Poll `playtest_status` a finite number of times with a finite interval or
   deadline. Capture `playtest_log` after launch and when diagnosing an early
   exit, timeout, or MCP error. Classify launch errors, exit state, and useful
   stdout/stderr separately from behavior.
5. On a successfully started Playtest, call `mcp__rpgmaker_mv__playtest_stop`
   on normal completion, timeout, cancellation, or failed observation. This is
   the MCP stop operation; never replace it with `taskkill`, PowerShell, shell
   commands, or another OS termination mechanism.
6. Poll `playtest_status` after stop. Mark cleanup **confirmed** only when MCP
   reports `running: false` with no PID. If stop/status cannot confirm that
   state, mark cleanup **unverified**, explain the evidence, and ask the
   Agent/user to resolve it. Do not claim cleanup success and do not kill a
   process directly. This foundation skill does not guarantee descendant
   cleanup; the later automated-playtest supervisor owns that guarantee.

Report separate fields for static validation, process launch, status/log or
crash evidence, cleanup confirmation, and behavior/visual verification.
Behavior remains **unverified** unless a separate gameplay, screenshot, or
input workflow supplies evidence; a running process and clean log are not
behavior verification.
