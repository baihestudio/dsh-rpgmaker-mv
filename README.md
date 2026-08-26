# dsh-rpgmaker-mv
DeepSeek for RPG Maker MV

## Windows Release ZIP (Phase 7)

For users, download the Windows Release ZIP, extract it, and double-click `Install.cmd`. The guided installer obtains one explicit consent before any WinGet install or repair, including missing, wrong-version, and wrong-identity prerequisites. It verifies the real executable paths and versions, installs the verified Python 3.13 WinGet runtime as a general Agent utility, installs the pinned DSH, RPG Maker MCP, and complete image toolchain, and creates the per-user Start Menu shortcut **DSH for RPG Maker MV**. See [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) for bundled dependency notices.

The full first-run, repair, port-conflict, workspace-selection, and uninstall guide is in [`docs/windows-release.md`](docs/windows-release.md). Uninstall validates ownership metadata and preserves rollback/recovery state, mutable state, credentials, logs, and projects; `uninstall.ps1 -Purge` is explicit.

Contributors can still run the underlying bootstrap and doctor scripts from PowerShell:

```powershell
./bootstrap.ps1
./doctor.ps1
```

The harness keeps the official DeepSeek Harness runtime in an app-owned tree and never forks or edits DSH. Windows is the primary, release-blocking platform; macOS support is best effort.

The real workspace acceptance uses only disposable state: `bun run phase2:real`
prepares the project-neutral Host from a neutral landing directory, checks the
CJK/space workspace, one pooled Host server, synchronously collected stable
`rpgmaker_*` tools, direct Agent-scoped calls, and observed Xerolo child
identity. Its machine JSON reports the actual child/process evidence and shell
process observations; it does not claim a picker or permission retry from a
constant. The installed-tree Windows gate is the exact NUC command sequence:

```powershell
Set-Location "$env:LOCALAPPDATA\Programs\BaiheStudio\DSH-RPGMaker-MV"
bun run phase7:windows-installed -- --installed-root (Get-Location).Path
```

It launches the supported installed `Launch.cmd`, observes the real fixed-port
Web readiness and project-neutral process arguments, repairs a deliberately
broken local profile link, runs the installed-tree Agent probe, and cleans up
all disposable state/processes.

### Install and repair

`bootstrap.ps1` builds a fresh staging tree with the pinned `@deepseek-ai/dsh@0.1.0-rc.8` (npm integrity `sha512-VQU5NlomrKLRgcXuOf+sxWFvqxPA8q9vMhrKPlPPXiOJEhGlGlAdiyxZvZxkCVI+v0zbhe21cY3/luLyxpSzzA==`), runs `bun pm trust --all`, verifies the exact package/lock facts and `koffi`, then swaps it into place. A previous runtime is retained in a timestamped rollback directory. A failed install or verification removes only its own staging directory and leaves the active runtime untouched; older DSH releases are not accepted. If process termination or rollback cannot be confirmed, the lock reports a degraded state and preserves recoverable staging/rollback paths for manual recovery. Re-running against a valid runtime is a no-op; bootstrap, doctor, and launch serialize short runtime operations through the operation lock. A live DSH child also holds a session lease that prevents bootstrap or a second launch from swapping the runtime, while doctor remains available.

On Windows, program-owned DSH/MCP/tool runtimes default under `%LOCALAPPDATA%\\Programs\\BaiheStudio\\DSH-RPGMaker-MV`; mutable DSH state defaults under `%LOCALAPPDATA%\\BaiheStudio\\DSH-RPGMaker-MV\\state`. Set `DSH_HOME`, `DSH_RPGMAKER_PROGRAM_ROOT`, `DSH_RPGMAKER_DATA_ROOT`, or `DSH_RPGMAKER_RUNTIME` for a test-owned or alternate location. The doctor checks the actual executable paths and versions visible to the launcher, rather than trusting package-manager metadata.

### Launch DSH Web

```powershell
./launch.ps1
# optionally choose the default Agent preset:
./launch.ps1 --preset asset-workshop
```

The Windows launcher is project-neutral: it never opens a folder picker, reads
recent projects, writes app-owned project-selection state, or accepts
`launch --project`. The Release ZIP carries the prebuilt
`bundle/dsh-workspace-mcp` package and generated Xerolo manifest. Launch
prepares and verifies the pinned DSH, pnpm 10.15.1, MCPorter 0.12.3, Xerolo
0.1.0, the five presets, the effective composition, and the app-owned
`dsh-workspace-mcp` profile link before starting official DSH. DSH starts in
an app-owned neutral landing directory; choose and switch RPG Maker folders in
DSH Web. `rpgmaker` is the default when `--preset` is omitted. New Agents across
all five shipped presets default to `deepseek-v4-flash-vision-exp`; the normal
DSH Web model selection remains a user override, and existing sessions retain
their logged model choice. User-attached PNG, JPEG, WebP, and GIF images may be
read as image input; this does not add image generation, remote URL ingestion,
or automated gameplay capture.

The workspace bundle validates `Game.rpgproject`, `data`, and `js` directly
under the DSH Web workspace. Each Agent receives stable names such as
`rpgmaker_validate_project`; workspace hashes, session identifiers, and MCP
transport names never appear in prompts or history. Agents in one workspace
share one warm connection, while different workspaces remain isolated. The
workspace server is Host-lifetime: it stays warm after its last Agent leaves and
closes only when the Host shuts down. There is no concurrent-writer locking or
serialization and no idle eviction. If a pooled Xerolo child crashes, affected
workspace Agents fail until the Host restarts; automatic child restart is not
provided.

The launcher always shows this editing contract:

- The agent and its `rpgmaker_*` tools are the sole writers while the session is running.
- Do not have multiple Agents write to the same project at the same time.
- If the RPG Maker MV editor is open, it is read-only; do not save from it.
- Reopen the project in the editor before inspecting agent changes.

If neither `DEEPSEEK_API_KEY` nor DSH's local credential metadata is present, DSH's loopback-only local onboarding is called out before launch. The launcher never reads back, stores, or prints the credential value, and does not put it in generated settings, project files, or logs.

### Repository checks

```powershell
bun test
bun run check
# Optional real disposable pinned-DSH asset preset mount (no MCP service)
bun run phase4:real
# Optional real project-neutral DSH + Xerolo workspace acceptance
bun run phase2:real
```

Tests use disposable runtime, DSH home, credential, and MV project directories. They do not touch a user's installed DSH state, RPG Maker projects, applications, or credentials. The ordinary suite uses fake prerequisite/runtime executables; `bun run phase2:real` additionally installs the pinned DSH/MCPorter/Xerolo packages into a disposable temp runtime and verifies the project-neutral workspace Host, 41 stable tools, CJK/space paths, one pooled server, and shutdown. The two-workspace mutation matrix remains in the ordinary workspace test; it is not duplicated in the Windows gate. Real PowerShell/Coreutils identity, Windows `.cmd` launch, and installed MV checks remain the complementary Windows runner gate.

## Phase 2: RPG Maker Agent and MCP editing loop

`launch.ps1` prepares the exact-pinned app-owned MCPorter and Xerolo runtimes,
the local `dsh-workspace-mcp` Host bundle, three Chinese-named specialist
presets (`rpgmaker`, `game-design`, and `asset-workshop`),
and a project-neutral `web --dump-config` composition before
launch. The picker displays `🐒 程序猿`, `🐶 策划汪`, and `🎨 P图仔`
in that order; `rpgmaker` remains the default. `game-design` is a
Code-derived document-workspace preset without the RPG Maker Agent row; the
other two presets retain their scoped MCP/image boundaries. The access layer supplies stable
`rpgmaker_<raw Xerolo name>` tools synchronously and validates the live
workspace connection before the first request. It contains no preset filter:
presets that do not mount the row receive no RPG Maker tools. Invalid
workspaces fail before a server starts.

Every shipped preset mounts the official DSH `@deepseek-ai/dsh-mcp-client`
for the upstream Forgejo MCP server, so its full tool surface is published with
names such as `mcp__forgejo__list_repo_issues` and
`mcp__forgejo__create_issue`. Every Release ZIP includes the app-owned
`tools/forgejo-mcp/forgejo-mcp.exe`; both a fresh `Install.cmd` run and the
transactional local update path verify its pinned SHA-256 and `--version`.
Users do not install Go or supply an MCP executable. `DSH_FORGEJO_MCP_COMMAND`
remains an explicit override only.

The packaged wrapper clears other Git credential helpers, selects Git Credential
Manager, and performs a non-interactive lookup for
`http://forgejo.localhost:17480/baihestudio/dsh-rpgmaker-mv.git`. It uses only
an already-stored Git Credential Manager password (the Forgejo PAT) and does
not prompt for, create, or persist a PAT. The password reaches only the
Forgejo MCP child as `FORGEJO_ACCESS_TOKEN`; it is never written to generated
presets or Release ZIPs. Native MCP access is intentionally general, while two
shared Skills constrain automatic reporting to `baihestudio/dsh-rpgmaker-mv`:
`forgejo-agent-issue-report` files verified agent-observed defects, blockers,
and tool/MCP failures; `forgejo-user-feedback-report` clarifies user-reported
experience or capability feedback before filing it. Both use the same
non-secret, complete deduplication protocol.

The RPG Maker preset treats the MCP/agent as the sole writer. Its mounted
`mv-reference.md` is a compact, locally authored map of MV core/runtime layers,
`DataManager`, `$data*` records including `$dataSkills`, `Game_Interpreter`,
manager/game-object/UI layers, and official MV Help, Plugin Specifications, and
Output Formats links. Plugin work verifies the actual project's `js/rpg_*.js`
API and data first, uses ES5 and MV-supported `fs` rather than `node:fs`, and
makes only the smallest necessary change without speculative compatibility
layers, broad refactors, extra interfaces, or reviewer/second-model workflows.

The RPG Maker preset treats the MCP/agent as the sole writer. Database,
event/dialogue, map-metadata, plugin, and restore mutations use stable
`rpgmaker_*` names, a targeted reread followed by `rpgmaker_validate_project`,
and visible warnings before success is returned. The `.mcp-backups/` guidance
is read-only: the harness reports the suggested `.gitignore` entry but never
edits an existing project ignore file without user consent.

The generated preset and patch live under `DSH_HOME`; they contain owned
runtime paths and no credentials. The pinned DSH Code preset is read from the
installed runtime and is not edited. Neither app-owned Host patch inserts the
timeout policy: the pinned DSH `web` profile owns the official
`id: timeout-policy` / `@deepseek-ai/dsh-tool-call-timeout-policy` row at Host
scope. Launch preparation and Doctor validate `web --dump-config` and require
exactly one effective official row across all three custom Agent presets; the
preset compositions never contain it. Re-running preparation rewrites the
app-owned patch, repairing older generated patches that inserted a duplicate.

## Phase 3: 🐶 策划汪

Select `--preset game-design` for a Code-derived assistant that maintains Markdown
design material in the selected document workspace. It follows workspace
`AGENTS.md` guidance, may inspect reachable paths named by the documents, and uses
shared Web research when useful. It keeps an adaptive index, decisions, open
questions, and material references without imposing a fixed archive tree or deleting
existing documents automatically.

## Phase 4: Playtest 调试

`🐒 程序猿` 直接完成真实 Playtest 与日志诊断。发起调试时，它先通过 Skill 工具读取并遵循 `presets/rpgmaker/skills/playtest-debug/` Skill，按有界序列编排稳定的 `rpgmaker_*` 工具：静态验证、空闲预检、有界 Steam App ID `363890` 发现、存在 `nwjs-win\Game.exe` 时 NW.js 启动、否则浏览器模式回退、有界状态/日志观察、MCP stop 与停止后状态确认。它绝不递归扫描磁盘，拒绝已运行的 Playtest，不认领 PID 也不调用 OS 进程控制，MCP 状态无法确认清理时如实报告 unverified。浏览器回退返回可玩 URL，但 `rpgmaker_playtest_log` 无法捕获浏览器 DevTools 控制台输出。

报告区分静态验证、进程启动、崩溃/日志证据、清理确认与行为/视觉验证。进程启动和干净日志不是行为验证。Harness 拥有的进程树清理属于独立的 automated-playtest 能力；截图/输入/gameplay 自动化不在本仓库范围。

## Phase 5: 🎨 P图仔

Select the deterministic image preset when creating a DSH Web Agent:

```powershell
./launch.ps1 --preset asset-workshop
# For an explicit image operation override, also pass --image-magick-sha256 <64-hex-digest>
```

`Install.cmd` provisions the complete app-owned image toolchain for every agent: ImageMagick `7.1.2-29`, `free-tex-packer-core@0.3.9`, and `oxipng@10.2.0`. Downloads are staged, checked against the pinned archive and executable hashes, verified by version, and installed atomically. Re-running the installer or launcher verifies and reuses a valid installation instead of downloading it again. Every launched session receives the resolved image workflow environment, so selecting 🎨 P图仔 in the Web UI does not depend on which preset originally started DSH. Explicit overrides must still supply their expected SHA-256 and PATH aliases or `convert` are never accepted. `oxipng` is installed for readiness but is invoked only by an explicit `optimize-png` operation with a distinct output path.

Python 3.13 remains a verified WinGet-managed general Agent utility and is checked independently by Doctor. Image work is local and deterministic: the Asset Workshop Agent exposes seven structured tools backed by the pinned ImageMagick, free-tex-packer-core, and oxipng toolchain. No remote vision, OCR, or AI image-generation provider is installed or configured.

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

## Phase 6: DSH runtime foundation

All launcher, preset, Windows shell, MCP, image, and Playtest contracts are mounted and checked against the official `@deepseek-ai/dsh@0.1.0-rc.8` runtime. The staged runtime verifies Bun installation/trust, the exact top-level package version and npm integrity, the DSH executable, and `koffi` before an atomic swap. Post-swap verification restores the prior runtime on failure and preserves the unverified tree for inspection; no live runtime is mutated in place.

The Xerolo MCP lock check is deliberately limited to its stable release facts: exact top-level version, `dist/index.js` bin, and pinned npm integrity. Missing or tampered lock data fails closed; transitive dependency metadata and unrelated Bun lock internals are not pinned. The production editing contract is the mounted RPG Maker skill plus stable `rpgmaker_*` tools, with disposable real acceptance covering mutation rereads, validation, backup/restore, schema rejection, and the `rpgmaker`, `game-design`, and asset-only preset boundaries.

## Editing model

In the first release, the agent is the sole writer while an RPG Maker MV workspace is under agent control; do not have multiple Agents write to it simultaneously. The editor may remain open only for read-only reference: users must not save from it, and must reopen the project before inspecting agent changes.

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
```

The foundation stops before automated gameplay/CDP supervision, which remains on its separate draft/hold marker.
