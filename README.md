# dsh-rpgmaker-mv
DeepSeek for RPG Maker MV

## Windows Release ZIP (Phase 7)

For users, download the Windows Release ZIP, extract it, and double-click `Install.cmd`. The guided installer obtains one explicit consent before any WinGet install or repair, including missing, wrong-version, and wrong-identity prerequisites. It verifies the real executable paths and versions, installs Python 3.13 through WinGet for Vision Toolkit's isolated managed environment, installs the pinned DSH, RPG Maker MCP, build-packager, and Vision Toolkit dependencies plus the complete image toolchain, and creates the per-user Start Menu shortcut **DSH for RPG Maker MV**. See [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) for the pinned community package notice.

The full first-run, repair, port-conflict, project-switching, and uninstall guide is in [`docs/windows-release.md`](docs/windows-release.md). Uninstall validates ownership metadata and preserves rollback/recovery state, mutable state, credentials, logs, recent projects, and projects; `uninstall.ps1 -Purge` is explicit.

Contributors can still run the underlying bootstrap and doctor scripts from PowerShell:

```powershell
./bootstrap.ps1
./doctor.ps1
```

The harness keeps the official DeepSeek Harness runtime in an app-owned tree and never forks or edits DSH. Windows is the primary, release-blocking platform; macOS support is best effort.

### Install and repair

`bootstrap.ps1` builds a fresh staging tree with the pinned `@deepseek-ai/dsh@0.1.0-rc.7` (npm integrity `sha512-ZceDCJ8FAywih+USW/OMk9jEhunlvJBGEz4kqrhau23hPzbciOazZrywH0nBRsaalSeAJ1JGBmjtw4OSjToStw==`), runs `bun pm trust --all`, verifies the exact package/lock facts and `koffi`, then swaps it into place. A previous runtime is retained in a timestamped rollback directory. A failed install or verification removes only its own staging directory and leaves the active runtime untouched; older DSH releases are not accepted. If process termination or rollback cannot be confirmed, the lock reports a degraded state and preserves recoverable staging/rollback paths for manual recovery. Re-running against a valid runtime is a no-op; bootstrap, doctor, and launch serialize short runtime operations through the operation lock. A live DSH child also holds a session lease that prevents bootstrap or a second launch from swapping the runtime, while doctor remains available.

On Windows, program-owned DSH/MCP/tool runtimes default under `%LOCALAPPDATA%\\Programs\\BaiheStudio\\DSH-RPGMaker-MV`; mutable DSH state defaults under `%LOCALAPPDATA%\\BaiheStudio\\DSH-RPGMaker-MV\\state`. Set `DSH_HOME`, `DSH_RPGMAKER_PROGRAM_ROOT`, `DSH_RPGMAKER_DATA_ROOT`, or `DSH_RPGMAKER_RUNTIME` for a test-owned or alternate location. The doctor checks the actual executable paths and versions visible to the launcher, rather than trusting package-manager metadata.

### Launch a project

```powershell
./launch.ps1
# or skip the picker:
./launch.ps1 --project 'C:\Games\My RPG 游戏'
```

The Windows launcher uses a native folder picker, accepts a path containing spaces or CJK characters, requires `Game.rpgproject` plus `data` and `js` directories, and starts official DSH with the selected project as its process working directory. Paths are passed as process arguments/cwd values; they are not placed into a shell command string.

The launcher always shows this editing contract:

- The agent and RPG Maker MCP are the sole writers while the session is running.
- If the RPG Maker MV editor is open, it is read-only; do not save from it.
- Reopen the project in the editor before inspecting agent changes.

If neither `DEEPSEEK_API_KEY` nor DSH's local credential metadata is present, DSH's loopback-only local onboarding is called out before launch. The launcher never reads back, stores, or prints the credential value, and does not put it in generated settings, project files, or logs.

### Repository checks

```powershell
bun test
bun run check
# Optional real disposable pinned-DSH asset preset mount (no MCP service)
bun run phase4:real
# Optional real disposable DSH + Xerolo MCP acceptance
bun run phase2:real
# Optional real DSH rc.7 + Vision Toolkit compatibility (no image upload)
bun run phase8:real
```

Tests use disposable runtime, DSH home, credential, and MV project directories. They do not touch a user's installed DSH state, RPG Maker projects, applications, or credentials. The current macOS substitute suite uses fake prerequisite/runtime executables; `bun run phase2:real` additionally installs pinned DSH/Xerolo packages into a disposable temp runtime and verifies 41 tools, mutation reread, validation, backup/restore, and shutdown. Real PowerShell/Coreutils identity, Windows `.cmd` launch, spaces/CJK path, and installed DSH checks remain a release gate on a Windows runner in foundation ticket 07.

## Phase 2: RPG Maker Agent and MCP editing loop

`launch.ps1` now prepares the pinned `@xerolo44/rpgmaker-mv-mcp@0.1.0` in an app-owned staging runtime, probes its `tools/list` schema, installs the four Chinese-named specialist presets (`rpgmaker`, `playtest-debug`, `asset-workshop`, and `build-release`) as Code-derived compositions, validates the generated overlay through the pinned DSH `web --dump-config` path, and launches the official `web` profile with a generated `--patch` overlay. The fresh-state default is RPG Maker MV 开发助手; each preset keeps PTC/Code Mode and adds a domain persona while existing user defaults remain authoritative. The overlay supplies an app-contained Bun/Node JavaScript MCP entry as argv, the selected project as both `--project` and child cwd, `serverName: rpgmaker_mv`, and `failOnStartupError: true`; schema or project failures stop launch instead of presenting a tool-less session.

The RPG Maker preset treats the MCP/agent as the sole writer. Database, event/dialogue, map-metadata, plugin, and restore mutations use a targeted reread followed by `validate_project` before success is returned. The `.mcp-backups/` guidance is read-only: the harness reports the suggested `.gitignore` entry but never edits an existing project ignore file without user consent.

The generated preset and patch live under `DSH_HOME`; they contain executable paths and project-independent `process.cwd()` references only, never credentials. The pinned DSH Code preset is read from the installed runtime and is not edited.

## Phase 3: 游戏测试与调试助手

Select `--preset playtest-debug` when creating a session. The Debug skill directly sequences the existing `mcp__rpgmaker_mv__*` tools: static validation, idle status preflight, bounded Steam App ID `363890` discovery, NW.js launch when `nwjs-win\Game.exe` exists, browser-mode fallback otherwise, bounded status/log observation, MCP stop, and post-stop status. It never recursively scans disks, refuses an already-running Playtest, never adopts a PID or invokes OS process controls, and reports cleanup as unverified when MCP status cannot confirm it. Browser fallback returns a playable URL but cannot capture browser DevTools console output through `playtest_log`.

Reports distinguish static validation, process launch, crash/log evidence, cleanup confirmation, and behavior/visual gameplay verification. A launched process and clean log are not behavior verification. Harness-owned process-tree cleanup belongs to the separate automated-playtest capability; screenshot/input/gameplay automation is out of scope here.

## Phase 4: 游戏图片素材助手

Select the deterministic image preset when launching a project:

```powershell
./launch.ps1 --project 'C:\Games\My RPG 游戏' --preset asset-workshop
# For an explicit override, also pass --image-magick-sha256 <64-hex-digest>
```

`Install.cmd` provisions the complete app-owned image toolchain for every agent: ImageMagick `7.1.2-29`, `free-tex-packer-core@0.3.9`, and `oxipng@10.2.0`. Downloads are staged, checked against the pinned archive and executable hashes, verified by version, and installed atomically. Re-running the installer or launcher verifies and reuses a valid installation instead of downloading it again. Every launched session receives the resolved image workflow environment, so selecting 游戏图片素材助手 in the Web UI does not depend on which preset originally started DSH. Explicit overrides must still supply their expected SHA-256 and PATH aliases or `convert` are never accepted. `oxipng` is installed for readiness but is invoked only by an explicit `optimize-png` operation with a distinct output path.

Install prepares the Vision Toolkit managed Python runtime through a short local DSH Web boot; repeat installs and launches reuse its verified cache. All four RPG Maker assistants can use the shared Vision Toolkit for image understanding, OCR, grounding, and pixel comparison. The default provider is `https://vision.anionex.me/v1` with `gemini-3.7-flash`; image data is sent to that shared remote service. It allows 300 images per machine per day, five images per request, 4 MiB and 20,000,000 decoded pixels per image, and 4,096 output tokens. Configure a private or higher-quota provider under **Settings → Vision Toolkit**. Vision failures are reported separately from local image processing, and AI image generation is not included.

The skill owns pixel-safe resize, transparent trim/pad, fixed-grid sheet
slice/assembly, and no-rotation atlas packing. Each operation rejects an
existing output directory, canonicalizes approved parents, writes to a unique
sibling staging directory, verifies there, and commits without clobbering a
racing output. Atlas packing treats `--output` as one new output directory and
atomically renames that directory once; it contains the PNG, JSON, and
`manifest.json` artifacts. Manifests are emitted only after verification and
report representative-pixel verification rather than claiming universal
losslessness. Optional Photoshop,
Aseprite, and TexturePacker installations are detected as hints only; they are
never downloaded or required.

The same operations are available at the helper seam for disposable checks:

```powershell
bun src/cli.ts image resize-pixel --input source.png --output generated.png --scale 3
bun src/cli.ts image sheet-slice --input sheet.png --output-dir frames --cell-width 48 --cell-height 48
bun src/cli.ts image atlas-pack --inputs-json '["a.png","b.png"]' --output atlas-output --max-size 2048
```

## Phase 5: DSH rc.7 foundation upgrade

All launcher, preset, Windows shell, MCP, image, and Playtest contracts are mounted and checked against the official `@deepseek-ai/dsh@0.1.0-rc.7` runtime. The staged runtime verifies Bun installation/trust, the exact top-level package version and npm integrity, the DSH executable, and `koffi` before an atomic swap. Post-swap verification restores the prior runtime on failure and preserves the unverified tree for inspection; no live runtime is mutated in place.

The Xerolo MCP lock check is deliberately limited to its stable release facts: exact top-level version, `dist/index.js` bin, and pinned npm integrity. Missing or tampered lock data fails closed; transitive dependency metadata and unrelated Bun lock internals are not pinned. The production editing contract is the mounted RPG Maker skill plus direct MCP tools, with disposable real acceptance covering mutation rereads, validation, backup/restore, schema rejection, and the `rpgmaker`, `playtest-debug`, and asset-only preset boundaries.

## Editing model

In the first release, the agent is the sole writer while an RPG Maker MV project is under agent control. The editor may remain open only for read-only reference: users must not save from it, and must reopen the project before inspecting agent changes.

## Phase 6: 游戏构建与发布助手

Select `--preset build-release` for a packaging session, or run the harness
workflow directly after the existing RPG Maker MCP has validated the project:

```powershell
bun "$env:DSH_RPGMAKER_RELEASE_CLI" build-release `
  --project 'C:\Games\My RPG 游戏' `
  --output 'C:\Games\releases\my-game-2026-08-17' `
  --rpgmaker-installation 'C:\Program Files\RPG Maker MV'
```

The workflow installs and verifies exact `rpgmpacker@2.0.5` in an app-owned
runtime and invokes its resolved `dist/index.js` through direct Bun/Node argv.
It requires the detected RPG Maker MV installation and its `nwjs-win` template.
Asset exclusion, hardlinks, and encryption remain off. Output is staged in a
fresh sibling directory, inspected, smoke-tested, and atomically committed; an
existing output or a source-overlapping output is rejected, and the source tree
is checked for mutation.

Windows output must contain the game executable and `www/index.html`,
`www/data`, and `www/js`. On Windows the smoke owns and cleans up only its
launched process tree. An MV Browser output contains `www/index.html`,
`www/data`, and `www/js`; its smoke serves that web root over loopback HTTP and
shuts the server down. On macOS and
other non-Windows hosts, Windows launch smoke is explicitly reported as
unsupported hardware evidence while Browser smoke remains advisory and
runnable. Store uploads, signing, generated-game installers, and cross-platform
Windows guarantees are not part of this phase.

Run the disposable real acceptance (it installs pinned DSH, Xerolo MCP, and
rpgmpacker into a temporary directory, validates through the MCP, and removes
all state afterward):

```powershell
bun run phase6:real
# Explicit Windows hardware gate only; never part of normal acceptance:
bun run phase6:windows-manual -- --rpgmaker-installation 'C:\Program Files\RPG Maker MV'
```

## Phase 7: Windows release gate

Build and inspect a real Release ZIP without overwriting an existing archive:

```powershell
bun run release:zip -- C:\temp\DSH-RPGMaker-MV-Windows.zip
```

The release gate uses test-owned fake user/install roots in automated tests. The complete foundation acceptance is:

```powershell
bun test
bun run check
bun run phase2:real
bun run phase4:real
bun run phase6:real
bun run phase8:real
```

The automated `phase6:real` acceptance always uses a disposable fixture-owned RPG Maker installation, including on Windows; it never reads a user-installed path. The explicit `phase6:windows-manual` gate is the only path that accepts an installed RPG Maker MV path and requires that opt-in argument. Non-Windows real acceptances truthfully mark Windows NW.js and Windows artifact launch as unsupported hardware evidence; they do not substitute macOS or a fake process for the Windows gate. The foundation stops before automated gameplay/CDP supervision, which remains on its separate draft/hold marker.
