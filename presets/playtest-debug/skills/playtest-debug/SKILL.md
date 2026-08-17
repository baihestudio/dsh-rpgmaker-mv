---
name: playtest-debug
description: Static validation and truthful RPG Maker MV NW.js Playtest diagnosis.
---

# Playtest Debug workflow

Use the preset's registered `playtest_debug` workflow for the complete loop;
it delegates to the existing session-scoped `mcp__rpgmaker_mv__*` tools and does
not start another MCP server. Use the individual tools only when the workflow
report identifies a targeted follow-up. Before starting Playtest, call
`validate_project` and stop if it reports errors. Call `playtest_status` first and refuse to start if another Playtest is already running; never rely on `playtest_start` to stop an unrelated session. Then call
`playtest_start` with `mode: "nwjs"` and an explicit `runtimePath` when the
Windows NW.js executable is known. A successful start is only process-launch
success.

Observe with `playtest_status` and `playtest_log`. Classify immediate exit,
MCP/startup errors, and useful stderr/stdout as launch or crash evidence. Call
`playtest_stop` on normal, timeout, cancellation, or failed-launch paths only
when this workflow owns the returned PID; after a failed/raced start with no
PID, never stop an unrelated session. Check status and report cleanup as
unconfirmed if ownership or descendants cannot be proven.

Report separate fields/outcomes for:

- static project validation;
- process launch and PID/status;
- crash or captured log evidence;
- cleanup/stop result; and
- behavior or visual verification, which remains **unverified** without a
  gameplay/screenshot/input workflow.
