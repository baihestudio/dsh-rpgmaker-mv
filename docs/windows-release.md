# Windows release journey

## Install from the Release ZIP

1. Download the Windows Release ZIP and extract it to a temporary folder.
2. Double-click `Install.cmd`.
3. Give the installer one explicit consent when prompted if it may install or repair prerequisites. This consent covers missing, wrong-version, and wrong-identity checks; command presence is never treated as consent. The installer uses WinGet only after that consent for:
   - Node.js LTS and npm (`OpenJS.NodeJS.LTS`)
   - Python 3.13 (`Python.Python.3.13`; Vision Toolkit requires Python 3.11+)
   - Bun (`Oven-sh.Bun`)
   - PowerShell 7.4+ (`Microsoft.PowerShell`)
   - Git for Windows (`Git.Git`)
   - Microsoft Coreutils (`Microsoft.Coreutils`)
   - 7-Zip (`7zip.7zip`; extracts the pinned ImageMagick `.7z` archive)
4. The installer verifies executable paths and versions, supplies the verified WinGet Python to Vision Toolkit's isolated managed environment, extracts the pinned portable ImageMagick with the verified 7-Zip, stages the pinned DSH `0.1.0-rc.7` runtime with Bun, installs the exact RPG Maker MCP, build packager, Vision Toolkit profile dependency, and the app-owned image tool plugin (scoped to 游戏图片素材助手), then creates a per-user Start Menu shortcut named **DSH for RPG Maker MV**. Normal launch additionally prepares the app-owned MCPorter runtime, Xerolo runtime, local workspace bundle, four presets, and neutral composition as needed. The Vision Toolkit package and license notice are listed in [`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md).

No Git clone, npm install, or manual package command is needed for this path. Install is per-user and does not require elevation. Re-running `Install.cmd` is the supported repair path; a previous runtime is retained by the staged runtime swap for recovery. If post-swap bootstrap, metadata, or shortcut creation fails, the prior program tree is restored and the failed new tree is retained as a named diagnostic/recovery directory.

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
workspace bundle into the `web` profile, installs the four presets, and verifies
the effective composition from the neutral landing directory. The profile link
is made during this pre-launch preparation, never while an install tree swap is
in progress. Omit `--preset` to use `rpgmaker`, or pass `--preset
playtest-debug`, `asset-workshop`, or `build-release` as the default Agent
preset.

Choose a game folder in DSH Web. The workspace must contain `Game.rpgproject`,
`data`, and `js` directly beneath its root; parents and workspace-authored
configuration are never searched. You can switch workspaces in the Web UI
without restarting DSH. Stable Agent tools use names such as
`rpgmaker_validate_project`; the internal workspace server name and session
identity never enter model-facing names. Agents in one workspace share one warm
MCP connection, while different workspaces receive isolated servers. Do not
have multiple Agents write to the same project at the same time.

The agent and its `rpgmaker_*` tools are the sole writers. If the RPG Maker
editor is open, it is read-only: do not save from it, and reopen it before
inspecting agent changes.

The web session always binds to `http://127.0.0.1:3081`. If that port is occupied, the launcher offers to open the existing session or asks you to close it and retry. It never silently selects another port and never starts concurrent project sessions. The disposable Vision Toolkit compatibility probe is `bun run phase8:real`; it boots DSH rc.7, prepares the managed runtime, activates the ten visual tools in each shipped preset, and never sends an image to the provider.

## Doctor and repair

From the installed program root:

```powershell
./doctor.ps1
```

Doctor reports the resolved Node/npm, Bun, PowerShell, Git, Coreutils, DSH runtime, RPG Maker MCP runtime, complete image toolchain, pinned build packager, Vision Toolkit profile and managed-runtime status, credential metadata, and mutable-layout facts without reading credential values. Installation performs a short local Web boot to prepare the Vision Toolkit managed Python cache; it never calls the remote vision provider. `Install.cmd` installs or repairs all agent dependencies together and safely reuses already verified versions. Repair any failed check by running `Install.cmd` again, then rerun Doctor.

## Uninstall

Double-click `Uninstall.cmd` in the installed program root. Default uninstall validates the harness ownership marker and install metadata before removing program files, app-owned runtimes, cache, and the BaiheStudio Start Menu shortcut. It preserves rollback/recovery trees, DSH state, credentials, logs, and all projects (projects are never discovered or deleted by the uninstaller). Unowned or malformed program trees are refused.

To explicitly delete local DSH state and credential metadata as well:

```powershell
./uninstall.ps1 -Purge
```

Purge is not automatic and still does not delete projects outside the app-data root.

## Presets and truthful limits

Four selectable presets use one shared DSH host/MCP composition and stable Agent-scoped `rpgmaker_*` tools:

- `rpgmaker` — default database, event, dialogue, map metadata, and plugin work;
- `playtest-debug` — MCP-owned static validation and NW.js launch/status/log/stop evidence;
- `asset-workshop` — deterministic ImageMagick and atlas workflows;
- `build-release` — pinned Windows/Web packaging and smoke checks.

All four presets expose Vision Toolkit understanding and OCR tools. By default, visual requests send images to the shared `https://vision.anionex.me/v1` service; the service has a 300-image daily machine quota, five-image request limit, 4 MiB/20,000,000-pixel image limits, and 4,096 output-token limit. Configure a private provider under **Settings → Vision Toolkit**. AI image generation is not included.

The Debug preset can truthfully report process launch, logs, MCP stop, and post-stop status. A launched process is not a gameplay or visual assertion. Actual RPG Maker MV/NW.js Windows launch, installed MV discovery, and behavior remain Windows hardware-gate observations. Automated `phase6:real` uses only a disposable fixture; the explicit opt-in `bun run phase6:windows-manual -- --rpgmaker-installation <path>` gate is required for an installed MV path. macOS substitutes are reported as non-blocking and never presented as Windows evidence. Photoshop, Aseprite, and TexturePacker are optional user-owned enhancements.

This foundation release does **not** include automatic updates, MSI authoring, signing/notarization, store uploads, generated-game installers, concurrent-writer locking for Agents sharing one project, or automated gameplay/CDP supervision. The separate automated-playtest work remains on its documented draft/hold marker until this foundation is reviewed.
