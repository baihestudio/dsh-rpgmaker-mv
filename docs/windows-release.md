# Windows release journey

## Install from the Release ZIP

1. Download the Windows Release ZIP and extract it to a temporary folder.
2. Double-click `Install.cmd`.
3. Give the installer one explicit consent when prompted if it may install or repair prerequisites. This consent covers missing, wrong-version, and wrong-identity checks; command presence is never treated as consent. The installer uses WinGet only after that consent for:
   - Node.js LTS and npm (`OpenJS.NodeJS.LTS`)
   - Bun (`Oven-sh.Bun`)
   - PowerShell 7.4+ (`Microsoft.PowerShell`)
   - Git for Windows (`Git.Git`)
   - Microsoft Coreutils (`Microsoft.Coreutils`)
4. The installer verifies executable paths and versions, stages the pinned DSH `0.1.0-rc.7` runtime with Bun, verifies `koffi`, then creates a per-user Start Menu shortcut named **DSH for RPG Maker MV**.

No Git clone, npm install, or manual package command is needed for this path. Install is per-user and does not require elevation. Re-running `Install.cmd` is the supported repair path; a previous runtime is retained by the staged runtime swap for recovery. If post-swap bootstrap, metadata, or shortcut creation fails, the prior program tree is restored and the failed new tree is retained as a named diagnostic/recovery directory.

## Installed locations

- Program files: `%LOCALAPPDATA%\Programs\BaiheStudio\DSH-RPGMaker-MV`
- Mutable app data: `%LOCALAPPDATA%\BaiheStudio\DSH-RPGMaker-MV`
- DSH_HOME and local credential metadata: `%LOCALAPPDATA%\BaiheStudio\DSH-RPGMaker-MV\state`
- Redacted launcher logs: `logs`
- Disposable cache: `cache`
- Recent-project metadata: `recent-projects.json`
- DSH/MCP and app-owned tool runtimes: under the installed program root's `runtime` and `tools` directories

Generated settings contain paths and non-secret versions only. DeepSeek credentials are entered through DSH's loopback-only onboarding and are never printed into generated settings, project files, logs, or release artifacts.

## First launch and project switching

Use the Start Menu shortcut, or run `Launch.cmd` from the installed program root. On the first launch, a native Windows folder picker asks for an existing RPG Maker MV project. The selected folder must contain `Game.rpgproject`, `data`, and `js`; spaces and CJK characters are supported.

Later launches offer **continue last project** or **choose another project**. The selected project is recorded outside the project tree. One DSH instance owns one project; switching starts a new instance. The agent and RPG Maker MCP are the sole writers. If the RPG Maker editor is open, it is read-only: do not save from it, and reopen it before inspecting agent changes.

The web session always binds to `http://127.0.0.1:3081`. If that port is occupied, the launcher offers to open the existing session or asks you to close it and retry. It never silently selects another port and never starts concurrent project sessions.

## Doctor and repair

From the installed program root:

```powershell
./doctor.ps1
```

Doctor reports the resolved Node/npm, Bun, PowerShell, Git, Coreutils, DSH runtime, RPG Maker MCP runtime, complete image toolchain, pinned build packager, credential metadata, and mutable-layout facts without reading credential values. `Install.cmd` installs or repairs all agent dependencies together and safely reuses already verified versions. Repair any failed check by running `Install.cmd` again, then rerun Doctor.

## Uninstall

Double-click `Uninstall.cmd` in the installed program root. Default uninstall validates the harness ownership marker and install metadata before removing program files, app-owned runtimes, cache, and the BaiheStudio Start Menu shortcut. It preserves rollback/recovery trees, DSH state, credentials, logs, recent-project metadata, and all projects (projects are never discovered or deleted by the uninstaller). Unowned or malformed program trees are refused.

To explicitly delete local DSH state and credential metadata as well:

```powershell
./uninstall.ps1 -Purge
```

Purge is not automatic and still does not delete projects outside the app-data root.

## Presets and truthful limits

Four selectable presets use one shared DSH host/MCP composition:

- `rpgmaker` — default database, event, dialogue, map metadata, and plugin work;
- `playtest-debug` — MCP-owned static validation and NW.js launch/status/log/stop evidence;
- `asset-workshop` — deterministic ImageMagick and atlas workflows;
- `build-release` — pinned Windows/Web packaging and smoke checks.

The Debug preset can truthfully report process launch, logs, MCP stop, and post-stop status. A launched process is not a gameplay or visual assertion. Actual RPG Maker MV/NW.js Windows launch, installed MV discovery, and behavior remain Windows hardware-gate observations. Automated `phase6:real` uses only a disposable fixture; the explicit opt-in `bun run phase6:windows-manual -- --rpgmaker-installation <path>` gate is required for an installed MV path. macOS substitutes are reported as non-blocking and never presented as Windows evidence. Photoshop, Aseprite, and TexturePacker are optional user-owned enhancements.

This foundation release does **not** include automatic updates, MSI authoring, signing/notarization, store uploads, generated-game installers, concurrent projects, or automated gameplay/CDP supervision. The separate automated-playtest work remains on its documented draft/hold marker until this foundation is reviewed.
