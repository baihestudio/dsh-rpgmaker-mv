---
name: playtest-debug
description: Static validation and truthful RPG Maker MV NW.js Playtest diagnosis.
---

# Playtest Debug workflow

Use the existing `rpgmaker_mv` MCP. Before starting Playtest, call
`validate_project` and stop if it reports errors. Call `playtest_status` first and refuse to start if another Playtest is already running; `playtest_start` stops any existing tracked process. Then call
`playtest_start` with `mode: "nwjs"` and an explicit `runtimePath` when the
Windows NW.js executable is known. A successful start is only process-launch
success.

Observe with `playtest_status` and `playtest_log`. Classify immediate exit,
MCP/startup errors, and useful stderr/stdout as launch or crash evidence. Call
`playtest_stop` on every normal, timeout, cancellation, or failed-launch path,
then check status so no tracked Playtest process remains. Report cleanup as unconfirmed unless status is explicitly stopped and the owning process-tree verifier confirms no descendants.

Report separate fields/outcomes for:

- static project validation;
- process launch and PID/status;
- crash or captured log evidence;
- cleanup/stop result; and
- behavior or visual verification, which remains **unverified** without a
  gameplay/screenshot/input workflow.
