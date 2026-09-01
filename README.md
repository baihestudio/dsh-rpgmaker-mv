# RPG Maker Agent
The AI production agent for RPG Maker MV and MZ

用户如何使用制作猿及其内置 Skills，请看 [用户指南](docs/user-guide.md)。安装、更新和
卸载则看 [Windows 安装与维护指南](docs/windows-release.md)。

## Windows Release ZIP (Phase 7)

For users, download the Windows Release ZIP, extract it, and double-click `Install.cmd`. The standalone compiled installer opens a folder picker before downloading, verifies the bundled desktop host, then obtains one explicit consent before any WinGet install or repair. It requires Node.js LTS 22+ with npm, installs the pinned DSH and RPG Maker MCPs, and creates the per-user Start Menu shortcut **RPG Maker Agent** targeting the native host. Re-running the same command upgrades an owned installation after one explicit running-Agent close confirmation. See [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) for bundled dependency notices.

The full first-run, repair, port-conflict, workspace-selection, and uninstall guide is in [`docs/windows-release.md`](docs/windows-release.md). Uninstall validates ownership metadata and preserves rollback/recovery state, mutable state, credentials, logs, and projects; `uninstall.ps1 -Purge` is explicit.

Contributors can still run the underlying bootstrap and doctor scripts from PowerShell:

```powershell
./bootstrap.ps1
./doctor.ps1
```

The harness keeps the official DeepSeek Harness runtime in an app-owned tree and never forks or edits DSH. Installation materializes one exact app-managed `web` profile with four direct managed package dependencies and six ordered DSH bundle layers: the in-box `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app` template layers, followed by pinned Web and image-generation packages plus the release-owned brand and workspace MCP bundles. Startup repairs that same profile when it is stale; Doctor reports its read-only health without changing profile state. Windows is the only supported product platform.

The real workspace acceptance uses only disposable state: `bun run phase2:real`
prepares the project-neutral Host from a neutral landing directory, checks the
CJK/space workspace, one pooled Host server, synchronously collected stable
`rpgmaker_*` tools, direct Agent-scoped calls, and observed engine/workspace child
identity. Its machine JSON reports the actual child/process evidence and shell
process observations; it does not claim a picker or permission retry from a
constant. The disposable native Windows fresh-install gate accepts explicit
source and desktop-host roots:

```powershell
bun run phase7:windows-installed -- --source-root (Get-Location).Path --desktop-host-root C:\temp\built-desktop-host
```

It builds a fresh archive, runs the compiled installer with Node and Bun absent
from its target `PATH`, performs a receipt-driven repair, verifies the host,
Node-based runtimes, app-owned pnpm/profile, shortcut, timing record, and
redacted log, and cleans only its disposable roots.

### Install and repair

`bootstrap.ps1` builds a fresh staging tree with the exact DSH package and npm integrity declared in [`src/config.ts`](src/config.ts), copies the release-owned `runtime-manifests/dsh/package.json` and `package-lock.json`, runs `npm ci`, verifies the exact package/lock facts and `koffi` with Node, then swaps it into place. The Release also carries equivalent locked manifests for MCPorter, RPG Maker MCP, and app-owned pnpm; target setup never generates a lock from the registry. A previous runtime is retained in a timestamped rollback directory. A failed install or verification removes only its own staging directory and leaves the active runtime untouched; older DSH releases are not accepted. If process termination or rollback cannot be confirmed, the lock reports a degraded state and preserves recoverable staging/rollback paths for manual recovery. Re-running against a valid runtime is a no-op; bootstrap, doctor, and launch serialize short runtime operations through the operation lock. A live DSH child also holds a session lease that prevents bootstrap or a second launch from swapping the runtime, while doctor remains available.

On Windows, the selected installation root owns program files, runtimes, and disposable cache. The fixed local state root remains `%LOCALAPPDATA%\\BaiheStudio\\DSH-RPGMaker-MV` for settings, credentials, logs, locks, and the installation-location receipt. Set `DSH_RPGMAKER_INSTALLATION_ROOT`, `DSH_HOME`, `DSH_RPGMAKER_DATA_ROOT`, or `DSH_RPGMAKER_RUNTIME` for a test-owned or alternate location. The doctor checks the actual executable paths and versions visible to the launcher, rather than trusting package-manager metadata.

### Launch DSH Web

```powershell
./launch.ps1
```

The Windows launcher is project-neutral: it never opens a folder picker, reads
recent projects, writes app-owned project-selection state, or accepts
`launch --project`. The Release ZIP carries the prebuilt
`bundle/dsh-workspace-mcp` package and generated MV/MZ manifests. Launch
prepares and verifies the source-pinned DSH, pnpm, MCPorter, and Xerolo MV/Redseb MZ MCP runtimes (declared in [`src/config.ts`](src/config.ts), [`src/profile.ts`](src/profile.ts), [`src/mcport.ts`](src/mcport.ts), and [`src/rpgmaker.ts`](src/rpgmaker.ts)), the exact app-managed `web` profile (four direct packages and six
ordered bundle layers: the DSH base/web-app template followed by Web, image
generation, brand, and workspace MCP), the default preset, and the effective composition before
starting official DSH. DSH starts in
an app-owned neutral landing directory; choose and switch RPG Maker folders in
DSH Web. `rpgmaker` is the default preset. New Agents default to
`deepseek-v4-flash-vision-exp`; the normal
DSH Web model selection remains a user override, and existing sessions retain
their logged model choice. User-attached PNG, JPEG, WebP, and GIF images may be
read as image input; this does not add image generation, remote URL ingestion,
or automated gameplay capture.

The workspace bundle validates either `Game.rpgproject` (MV) or
`game.rmmzproject` (MZ), plus `data` and `js`, directly under the DSH Web
workspace. Each Agent receives stable names such as
`rpgmaker_validate_project`; session identifiers and MCP transport names never
appear in prompts or history. Agents in one workspace
share one warm connection for the selected engine, while different
engine/workspace pairs remain isolated. The
workspace server is Host-lifetime: it stays warm after its last Agent leaves and
closes only when the Host shuts down. There is no concurrent-writer locking or
serialization and no idle eviction. If a pooled engine child crashes, affected
workspace Agents fail until the Host restarts; automatic child restart is not
provided.

The launcher always shows this editing contract:

- The agent and its `rpgmaker_*` tools are the sole writers while the session is running.
- Do not have multiple Agents write to the same project at the same time.
- If the RPG Maker MV or MZ editor is open, it is read-only; do not save from it.
- Reopen the project in the editor before inspecting agent changes.

If neither `DEEPSEEK_API_KEY` nor DSH's local credential metadata is present, DSH's loopback-only local onboarding is called out before launch. The launcher never reads back, stores, or prints the credential value, and does not put it in generated settings, project files, or logs.

### Repository checks

```powershell
bun test
bun run check
# Optional real project-neutral DSH + dual-engine workspace acceptance
bun run phase2:real
```

Tests use disposable runtime, DSH home, credential, and MV/MZ project directories. They do not touch a user's installed DSH state, RPG Maker projects, applications, or credentials. The ordinary suite uses fake prerequisite/runtime executables; the optional real gate installs the pinned DSH/MCPorter/Xerolo/Redseb packages only into a disposable temp runtime and verifies the selected engine tool contract. Real PowerShell/Coreutils identity, Windows `.cmd` launch, and installed project checks remain the complementary Windows runner gate.

## Phase 2: RPG Maker Agent and MCP editing loop

`launch.ps1` prepares the exact-pinned app-owned MCPorter and dual-engine RPG Maker runtimes,
the complete managed `web` profile (including the local `dsh-workspace-mcp`
Host bundle), the default `rpgmaker` preset, and a project-neutral
`web --dump-config` composition before launch. The picker displays
`🐒 制作猿`. The access layer supplies stable `rpgmaker_<raw engine tool name>` tools
synchronously and validates the live workspace connection before the first request.
Invalid or ambiguous workspaces fail before a server starts.

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
exactly one effective official row in the custom Agent preset; the
preset compositions never contain it. Re-running preparation rewrites the
app-owned patch, repairing older generated patches that inserted a duplicate.

MZ workspaces use Redseb's pinned 119-tool editing surface, including targeted
database/map/event/tile writes, dry-run previews, and project/reference
validation. MZ Playtest launch/status/log/stop, screenshots, runtime input, and
build/release automation are intentionally unsupported; the Playtest Debug
preset reports that boundary instead of launching an MV runtime.

## Phase 3: 游戏设计与文档

`🐒 制作猿` 在机制、叙事、节奏、数值、玩家目标或设计文档任务中按需读取
`game-design` 与 `game-design-bootstrap` Skills。它在同一工作空间维护设计资料，
可检查文档明确指向的项目路径并按需使用 Web 研究；保留自适应索引、决策、待确认
问题和参考资料，不强加固定档案结构，也不会自动删除既有文档。

## Phase 4: Playtest 调试

`🐒 制作猿` 在 MV 工作空间直接完成真实 Playtest 与日志诊断。发起调试时，它先通过 Skill 工具读取并遵循 `presets/rpgmaker/skills/playtest-debug/` Skill，按有界序列编排稳定的 `rpgmaker_*` 工具：静态验证、空闲预检、有界 Steam App ID `363890` 发现、存在 `nwjs-win\Game.exe` 时 NW.js 启动、否则浏览器模式回退、有界状态/日志观察、MCP stop 与停止后状态确认。MZ 工作空间不提供 Playtest、截图、运行时输入或构建发布，相关请求会如实报告不支持。它绝不递归扫描磁盘，拒绝已运行的 Playtest，不认领 PID 也不调用 OS 进程控制，MCP 状态无法确认清理时如实报告 unverified。浏览器回退返回可玩 URL，但 `rpgmaker_playtest_log` 无法捕获浏览器 DevTools 控制台输出。

报告区分静态验证、进程启动、崩溃/日志证据、清理确认与行为/视觉验证。进程启动和干净日志不是行为验证。Harness 拥有的进程树清理属于独立的 automated-playtest 能力；截图/输入/gameplay 自动化不在本仓库范围。

## Phase 5: 图片素材

`Install.cmd` installs `ImageMagick.ImageMagick` with WinGet as the Windows-wide
`magick` command; it is not an app-owned binary or DSH plugin. 制作猿在图片素材
任务中按需读取 `image-assets` Skill：Kepos 生成或编辑视觉候选，`magick` 进行像素
缩放、绿幕清理和精灵表准备，并直接接入 RPG Maker 工作流。

## Phase 6: DSH runtime foundation

All launcher, preset, Windows shell, MCP, and Playtest contracts are mounted and checked against the official DSH runtime declared in [`src/config.ts`](src/config.ts). The staged runtime verifies the exact npm package-lock, package version and integrity, the Node-based DSH executable, and `koffi` before an atomic swap. Post-swap verification restores the prior runtime on failure and preserves the unverified tree for inspection; no live runtime is mutated in place.

The MV and MZ MCP lock checks are deliberately limited to their stable release facts: exact top-level version, `dist/index.js` bin, and pinned npm integrity. Missing or tampered lock data fails closed; transitive dependency metadata is not pinned. The production editing contract is the mounted RPG Maker skills plus stable `rpgmaker_*` tools, with disposable real acceptance covering mutation rereads, validation, backup/restore, and schema rejection.

## Editing model

In the first release, the agent is the sole writer while an RPG Maker MV or MZ workspace is under agent control; do not have multiple Agents write to it simultaneously. The editor may remain open only for read-only reference: users must not save from it, and must reopen the project before inspecting agent changes.

## Phase 7: Windows release gate

Build and inspect a real Release ZIP without overwriting an existing archive:

```powershell
bun run release:zip -- C:\temp\DSH-RPGMaker-MV-Windows.zip --desktop-host-root C:\temp\built-desktop-host
```

The public `release:zip` command requires the explicit prebuilt
`--desktop-host-root` payload even when it runs from WSL or macOS, and strictly
inspects that payload before reporting success. The release gate uses
test-owned fake user/install roots in automated tests. The complete foundation
acceptance is:

```powershell
bun test
bun run check
bun run phase2:real
```

The foundation stops before automated gameplay/CDP supervision, which remains on its separate draft/hold marker.

## Electrobun Windows desktop adapter

The reusable Electrobun/Cottontail/WebView2 host lives in the separate
`dsh-electronbun` repository. This product repository supplies only the thin
RPG Maker sidecar adapter and a generated host manifest; it does not copy the
host's supervisor, startup state machine, or runtime recovery logic. The release
packager consumes the resulting prebuilt host payload, verifies its pinned
contract, and installs it under `desktop-host` beside the product tree. See
[`docs/windows-electrobun.md`](docs/windows-electrobun.md) and stage a
test-owned host workspace with:

```sh
bun run desktop:stage -- --host-root /path/to/dsh-electronbun --output-root /tmp/dsh-rpgmaker-electrobun
```

The adapter currently pins the verified Windows Bun `1.3.14`, dynamically
loads the installed product launcher, and lets the native WebView2 host load
the existing project-neutral DSH Web session on `127.0.0.1:3081`. The product
sidecar passes DSH's explicit `--no-open` flag; the embedded WebView is the only
UI opener. A maintainer can provide an already-built payload explicitly when
building a release:

```sh
bun run release:zip -- /tmp/DSH-RPGMaker-MV-Windows.zip \
  --desktop-host-root /path/to/built-desktop-host
```

The public command always requires and strictly inspects the explicit payload.
It must contain the canonical `desktop-host.json` descriptor, the pinned host
commit/Bun version, its native `.exe` launch target, and required
`sidecarEntrypoint`/`supervisorExecutable` fields pointing to the exact staged
files. The descriptor must also carry the schema-versioned sidecar provenance
object produced by `desktop:stage`, containing the current adapter-source and
bundled-sidecar SHA-256 digests. The release gate recomputes both values before
accepting the payload; it never builds or downloads the host on a user's
machine.
