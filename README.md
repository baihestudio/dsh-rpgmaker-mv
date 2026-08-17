# dsh-rpgmaker-mv
DeepSeek for RPG Maker MV

## Phase 1: Windows bootstrap, doctor, and launcher

The harness keeps the official DeepSeek Harness runtime in an app-owned tree and never forks or edits DSH. Windows is the primary, release-blocking platform; macOS support is best effort.

### Install and repair

Install Bun, PowerShell 7.4+, Git for Windows, and Microsoft Coreutils for Windows. From PowerShell in this repository:

```powershell
./bootstrap.ps1
./doctor.ps1
```

`bootstrap.ps1` builds a fresh staging tree with the pinned `@deepseek-ai/dsh@0.1.0-rc.6`, runs `bun pm trust --all`, verifies the installed DSH package and `koffi`, then swaps it into place. A previous runtime is retained in a timestamped rollback directory. A failed install or verification removes only its own staging directory and leaves the active runtime untouched. If process termination or rollback cannot be confirmed, the lock reports a degraded state and preserves recoverable staging/rollback paths for manual recovery. Re-running against a valid runtime is a no-op; bootstrap, doctor, and launch serialize short runtime operations through the operation lock. A live DSH child also holds a session lease that prevents bootstrap or a second launch from swapping the runtime, while doctor remains available.

The app-owned runtime defaults under the configured DSH home. Set `DSH_HOME` or `DSH_RPGMAKER_RUNTIME` to use a test-owned or alternate location. The doctor checks the actual executable paths and versions visible to the launcher, rather than trusting package-manager metadata.

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
# Optional real disposable DSH + Xerolo MCP acceptance
bun run phase2:real
```

Tests use disposable runtime, DSH home, credential, and MV project directories. They do not touch a user's installed DSH state, RPG Maker projects, applications, or credentials. The current macOS substitute suite uses fake prerequisite/runtime executables; `bun run phase2:real` additionally installs pinned DSH/Xerolo packages into a disposable temp runtime and verifies 41 tools, mutation reread, validation, backup/restore, and shutdown. Real PowerShell/Coreutils identity, Windows `.cmd` launch, spaces/CJK path, and installed DSH checks remain a release gate on a Windows runner in foundation ticket 06.

## Phase 2: RPG Maker Agent and MCP editing loop

`launch.ps1` now prepares the pinned `@xerolo44/rpgmaker-mv-mcp@0.1.0` in an app-owned staging runtime, probes its `tools/list` schema, installs the `rpgmaker` agent preset as a Code-derived composition, validates the generated overlay through the pinned DSH `web --dump-config` path, and launches the official `web` profile with a generated `--patch` overlay. The overlay supplies an app-contained Bun/Node JavaScript MCP entry as argv, the selected project as both `--project` and child cwd, `serverName: rpgmaker_mv`, and `failOnStartupError: true`; schema or project failures stop launch instead of presenting a tool-less session.

The RPG Maker preset treats the MCP/agent as the sole writer. Database, event/dialogue, map-metadata, plugin, and restore mutations use a targeted reread followed by `validate_project` before success is returned. The `.mcp-backups/` guidance is read-only: the harness reports the suggested `.gitignore` entry but never edits an existing project ignore file without user consent.

The generated preset and patch live under `DSH_HOME`; they contain executable paths and project-independent `process.cwd()` references only, never credentials. The pinned DSH Code preset is read from the installed runtime and is not edited.

## Editing model

In the first release, the agent is the sole writer while an RPG Maker MV project is under agent control. The editor may remain open only for read-only reference: users must not save from it, and must reopen the project before inspecting agent changes.
