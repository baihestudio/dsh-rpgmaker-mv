# Windows release journey

## Install from the Release ZIP

1. Download the Windows Release ZIP and extract it to a temporary folder.
2. Double-click `Install.cmd`.
3. Give the installer one explicit consent when prompted if it may install or repair prerequisites. This consent covers missing, wrong-version, and wrong-identity checks; command presence is never treated as consent. The installer uses WinGet only after that consent for:
   - Node.js LTS and npm (`OpenJS.NodeJS.LTS`)
   - Python 3.13 (`Python.Python.3.13`; retained as a general Agent utility)
   - Bun (`Oven-sh.Bun`)
   - PowerShell 7.4+ (`Microsoft.PowerShell`)
   - Git for Windows (`Git.Git`)
   - Microsoft Coreutils (`Microsoft.Coreutils`)
   - 7-Zip (`7zip.7zip`; extracts the pinned ImageMagick `.7z` archive)
4. The installer verifies executable paths and versions, retains the verified WinGet Python as a general Agent utility, extracts the pinned portable ImageMagick with the verified 7-Zip, stages the pinned DSH `0.1.0-rc.8` runtime with Bun (npm integrity `sha512-VQU5NlomrKLRgcXuOf+sxWFvqxPA8q9vMhrKPlPPXiOJEhGlGlAdiyxZvZxkCVI+v0zbhe21cY3/luLyxpSzzA==`), installs the exact RPG Maker MCP, app-owned image tool plugin (scoped to 🎨 P图仔), and `@tta-lab/dsh-web@3.0.0-beta.1` through DSH's normal `web` profile plugin command, then creates a per-user Start Menu shortcut named **DSH for RPG Maker MV**. Normal launch additionally prepares the app-owned MCPorter runtime, Xerolo runtime, local workspace bundle, three presets, and neutral composition as needed.

The Web package belongs to DSH-managed profile state. If its plugin command fails after initializing that state, the installer reports failure and restores its program tree/shortcut; rerun `Install.cmd` to complete the profile setup. Profile-state rollback is intentionally not part of the installer.

No Git clone, npm install, or manual package command is needed for this path. Install is per-user and does not require elevation. Re-running `Install.cmd` is the supported repair path; a previous runtime is retained by the staged runtime swap for recovery. If post-swap bootstrap, metadata, or shortcut creation fails, the prior program tree is restored and the failed new tree is retained as a named diagnostic/recovery directory.

## Local WSL update helper

For a routine update of the existing local Windows installation from a WSL checkout, first build a fresh ZIP, then invoke the development helper through the local direct PowerShell wrapper:

```bash
bun run release:zip -- /mnt/c/Users/<windows-user>/AppData/Local/Temp/DSH-RPGMaker-MV-current.zip
nuc-powershell dev/update-local-windows.ps1 \
  -ReleaseZip /mnt/c/Users/<windows-user>/AppData/Local/Temp/DSH-RPGMaker-MV-current.zip \
  -Yes -StopRunningDsh
```

The helper is development-only. `-StopRunningDsh` explicitly stops DSH processes that hold the installed program tree before the atomic update; without it, the helper refuses to interrupt an active session. It extracts the ZIP into a unique local Windows Temp directory, invokes its normal `install.ps1`, and removes the extracted copy after a successful update. Pass `-KeepExtractedRelease` only when retaining diagnostics is useful.

## Installed locations

- Program files: `%LOCALAPPDATA%\Programs\BaiheStudio\DSH-RPGMaker-MV`
- Mutable app data: `%LOCALAPPDATA%\BaiheStudio\DSH-RPGMaker-MV`
- DSH_HOME and local credential metadata: `%LOCALAPPDATA%\BaiheStudio\DSH-RPGMaker-MV\state`
- Redacted launcher logs: `logs`
- Disposable cache: `cache`
- Neutral DSH Web landing directory: `neutral`
- DSH/MCP and app-owned tool runtimes: under the installed program root's `runtime` and `tools` directories

Generated settings contain paths and non-secret versions only. DeepSeek credentials are entered through DSH's loopback-only onboarding and are never printed into generated settings, project files, logs, or release artifacts.

## First launch and workspace switching

Use the Start Menu shortcut, or run `Launch.cmd` from the installed program root.
The launcher is project-neutral: it opens no folder picker, reads no recent
project list, writes no app-owned project-selection state, and rejects
`launch --project`. The Release ZIP carries the prebuilt
`bundle/dsh-workspace-mcp` package, including its generated Xerolo manifest;
installation copies it to the stable app-owned program tree. Before spawning
DSH, launch verifies or repairs the exact-pinned app-owned pnpm 10.15.1,
MCPorter 0.12.3, and Xerolo RPG Maker MCP 0.1.0 runtimes, links the local
workspace bundle into the `web` profile, installs the three presets, and verifies
the effective composition from the neutral landing directory. The bundle's
profile patch inserts only the Host service entry point; each shipped preset
composition mounts the `/agent` entry point in Agent scope. The generated
RPG Maker Host patch selects the Agent preset but does not insert a timeout
policy: pinned DSH rc.8's `web` profile owns the official Host row
`id: timeout-policy` / `@deepseek-ai/dsh-tool-call-timeout-policy`. Launch
preparation and Doctor validate the effective `web --dump-config` composition
and require exactly one official row across all three custom presets; the
preset compositions remain policy-free. The Web package's patch selects
Organon for stock PTC/Code batched search, registers `web_fetch`, `web_docs`,
and `web_sgraph`, and keeps DSH's root URL-only `tool-web` disabled. Re-running preparation rewrites the
app-owned patch, repairing older generated patches that inserted a duplicate.
The access layer shares Host state through the root-context WeakMap and does
not publish a service into the ROOT realm or filter preset ids itself. The
profile link is made during this pre-launch preparation, never while an install
tree swap is in progress. Omit `--preset` to use `rpgmaker`, or pass `--preset game-design`,
or `asset-workshop` as the default Agent
preset. The visible names are `🐒 程序猿`, `🐶 策划汪`, and
`🎨 P图仔`. New Agents across all three presets default to
`deepseek-v4-flash-vision-exp`; the normal DSH Web model selection remains a
user override, and existing sessions retain their logged model choice.
User-attached PNG, JPEG, WebP, and GIF images may be read as image input only;
no image generation, remote URL ingestion, or automated gameplay capture is
added.

Choose a game folder in DSH Web. The workspace must contain `Game.rpgproject`,
`data`, and `js` directly beneath its root; parents and workspace-authored
configuration are never searched. You can switch workspaces in the Web UI
without restarting DSH. Stable Agent tools use names such as
`rpgmaker_validate_project`; the internal workspace server name and session
identity never enter model-facing names. Agents in one workspace share one warm
MCP connection, while different workspaces receive isolated servers. The
workspace server is Host-lifetime: it stays warm after its last Agent leaves and
closes only when the DSH Host shuts down. There is no concurrent-writer locking
or serialization and no idle eviction; do not have multiple Agents write to the
same project at the same time. If a pooled Xerolo child crashes, the affected
workspace Agents fail until the DSH Host is restarted; automatic child restart
is not provided.

The agent and its `rpgmaker_*` tools are the sole writers. If the RPG Maker
editor is open, it is read-only: do not save from it, and reopen it before
inspecting agent changes.

### Forgejo issue reporting

Every shipped preset also uses DSH's native `@deepseek-ai/dsh-mcp-client` to
start `forgejo-mcp` over stdio. It publishes upstream tools under the
`mcp__forgejo__*` namespace. Install the upstream executable separately, then
set `DSH_FORGEJO_MCP_COMMAND` to its absolute path and restart DSH; set
`DSH_FORGEJO_ACCESS_TOKEN` only in the launch environment. The shared
`forgejo-issue-report` Skill uses `mcp__forgejo__list_repo_issues` and
`mcp__forgejo__create_issue` only for
`baihestudio/dsh-rpgmaker-mv`. Use a dedicated Forgejo credential restricted
to that repository, because the native MCP client intentionally exposes the
server's general API surface.

The web session always binds to `http://127.0.0.1:3081`. If that port is occupied, the launcher offers to open the existing session or asks you to close it and retry. It never silently selects another port and never starts concurrent project sessions.

## Post-review acceptance sequence

The ordinary workspace seam is covered by `bun test tests/phase10.test.ts`.
`bun test tests/phase7.test.ts` also builds a disposable Release ZIP, extracts it
under a path containing spaces/CJK, performs a fake installed-tree first-launch
preparation, breaks the local `web` profile bundle entry, and verifies the
supported preparation path repairs it. The two-workspace mutation matrix stays
only in phase 10.

### Authorized disposable real gate

From a checkout on a machine authorized to fetch the pinned packages, run:

```powershell
bun run phase2:real
```

This provisions temporary DSH, MCPorter, and Xerolo runtimes plus one temporary
CJK/space MV workspace, then removes them. It performs no model request and no
workspace mutation. Its final JSON records the neutral launch seam, one Host
runtime/server, 41 stable schemas, successful direct Agent-scoped calls, and
`xeroloProcessEvidence` containing the observed child PID/image/parent identity
and matching `--project`/entry observations. It also records matching shell
processes; an empty list is the evidence for no shell escalation. Subprocess
failure diagnostics pass through the repository redaction boundary.

### Authorized NUC installed-release gate

Run these exact commands on the NUC from the installed program root:

```powershell
Set-Location "$env:LOCALAPPDATA\Programs\BaiheStudio\DSH-RPGMaker-MV"
bun run phase7:windows-installed -- --installed-root (Get-Location).Path
```

This first verifies the installed DSH, pnpm, MCPorter, and Xerolo runtimes
without downloading anything. It then provisions only disposable DSH state, a
disposable CJK/space workspace, and temporary profile data. It launches the supported installed `Launch.cmd`,
waits for an HTTP response on `127.0.0.1:3081`, observes the real launcher
processes and neutral-landing message with zero `--project` arguments, shuts
the process tree down with Windows `taskkill /T /F`, deliberately removes the
local `web` profile bundle entry, repeats `Launch.cmd` for repair evidence, and
runs the installed-tree Agent probe for 41 stable tools and one observed Xerolo
child. The JSON emits `firstLaunch`, `repair`, `agentEvidence`, and
`shutdown.firstPortClosed`/`shutdown.repairPortClosed` evidence. It sends no
model request, mutates no real game, and uses no external service beyond the
local loopback Web process. The gate cleans its temporary roots and every
process it starts.

## Doctor and repair

From the installed program root:

```powershell
./doctor.ps1
```

Doctor reports the resolved Node/npm, Python, Bun, PowerShell, Git, Coreutils, DSH runtime, RPG Maker MCP runtime, complete image toolchain, credential metadata, and mutable-layout facts without reading credential values. Python is verified independently as a general Agent utility; no managed image runtime is prepared. `Install.cmd` installs or repairs all agent dependencies together and safely reuses already verified versions. Repair any failed check by running `Install.cmd` again, then rerun Doctor.

## Uninstall

Double-click `Uninstall.cmd` in the installed program root. Default uninstall validates the harness ownership marker and install metadata before removing program files, app-owned runtimes, cache, and the BaiheStudio Start Menu shortcut. It preserves rollback/recovery trees, DSH state, credentials, logs, and all projects (projects are never discovered or deleted by the uninstaller). Unowned or malformed program trees are refused.

To explicitly delete local DSH state and credential metadata as well:

```powershell
./uninstall.ps1 -Purge
```

Purge is not automatic and still does not delete projects outside the app-data root.

## Presets and truthful limits

Three selectable presets share the DSH Web profile; two use the shared MCP composition and stable Agent-scoped `rpgmaker_*` tools:

- `rpgmaker` — default database, event, dialogue, map metadata, plugin work, and Playtest debug through the playtest-debug Skill;
- `game-design` — Code-derived Markdown design workspace, without the RPG Maker MCP Agent row;
- `asset-workshop` — deterministic ImageMagick and atlas workflows.

Only the `asset-workshop` preset exposes the seven deterministic local image tools. The other two presets do not mount image tools. No remote vision, OCR, or AI image-generation provider is installed or configured.

The `rpgmaker` preset's Playtest debug skill can truthfully report process launch, logs, MCP stop, and post-stop status. A launched process is not a gameplay or visual assertion. Actual RPG Maker MV/NW.js Windows launch, installed MV discovery, and behavior remain Windows hardware-gate observations. macOS substitutes are reported as non-blocking and never presented as Windows evidence. Photoshop, Aseprite, and TexturePacker are optional user-owned enhancements.

This foundation release does **not** include automatic updates, MSI authoring, signing/notarization, store uploads, generated-game installers, concurrent-writer locking for Agents sharing one project, or automated gameplay/CDP supervision. The separate automated-playtest work remains on its documented draft/hold marker until this foundation is reviewed.
