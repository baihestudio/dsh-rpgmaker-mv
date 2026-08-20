---
name: playtest-debug
description: Static validation plus NW.js-or-browser RPG Maker MV Playtest diagnosis.
---

# Playtest Debug

## Scope

This Agent reports process, log, and workspace evidence through the stable workspace tools. Remote visual analysis, OCR, and AI image generation are not provided.

Use the existing Agent-scoped stable `rpgmaker_*` tools. Do not start another
MCP server, register a workflow, adopt a PID, recursively scan disks, or invoke
OS process controls. Do not run app-owned harness source or runtimes through
shell escalation. The current workspace's pooled server owns the Playtest.
The one permitted host probe is the harness-owned Steam runtime locator beside
this Skill.

Run this bounded sequence:

1. Call `rpgmaker_validate_project`. If it reports errors, stop and report
   static validation failure; do not launch Playtest.
2. Call `rpgmaker_playtest_status`. If `running` is `true`, refuse to start and
   ask the Agent/user to resolve the existing Playtest. If `running` is `false`
   but a PID is present, treat the status as inconsistent and also refuse to
   start. Never adopt a PID. Require `running: false` with no PID before
   continuing.
3. Run the harness-owned locator at
   `$env:DSH_HOME\.agent-presets\playtest-debug\skills\playtest-debug\find-rpgmaker-mv-runtime.ps1`
   once with the `pwsh` tool and parse its single JSON result. It checks Steam
   App ID `363890`, configured Steam libraries, and the exact `nwjs-win\Game.exe`
   path without scanning whole drives.
4. If the locator returns `found: true`, call `rpgmaker_playtest_start` with
   `{ "mode": "nwjs", "runtimePath": <returned runtimePath> }`. If it returns
   `found: false`, immediately call `rpgmaker_playtest_start` with
   `{ "mode": "browser" }` instead and present the returned URL as the
   playable fallback. Do not keep searching or ask the user to locate Game.exe
   before offering browser mode. State that browser console output remains in
   browser DevTools and is not captured by `rpgmaker_playtest_log`. A
   successful response proves launch/serving only; an MCP error is launch
   failure.
5. Poll `rpgmaker_playtest_status` a finite number of times with a finite
   interval or deadline. For NW.js, capture `rpgmaker_playtest_log` after launch
   and when diagnosing an early exit, timeout, or MCP error. For browser mode,
   do not claim access to browser DevTools logs. Classify launch errors, exit
   state, and available evidence separately from behavior.
6. On a successfully started Playtest, call `rpgmaker_playtest_stop` on normal
   completion, timeout, cancellation, or failed observation. This is the MCP
   stop operation; never replace it with `taskkill`, PowerShell, shell commands,
   or another OS termination mechanism.
7. Poll `rpgmaker_playtest_status` after stop. Mark cleanup **confirmed** only
   when MCP reports `running: false` with no PID. If stop/status cannot confirm
   that state, mark cleanup **unverified**, explain the evidence, and ask the
   Agent/user to resolve it. Do not claim cleanup success and do not kill a
   process directly. This foundation skill does not guarantee descendant
   cleanup; the later automated-playtest supervisor owns that guarantee.

Report separate fields for static validation, launch mode, process/server
launch, available status/log or crash evidence, cleanup confirmation, and
behavior/visual verification. Behavior remains **unverified** unless a separate
gameplay, screenshot, or input workflow supplies evidence; a running process,
served URL, or clean log is not behavior verification.
