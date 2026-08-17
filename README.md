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
```

Tests use disposable runtime, DSH home, credential, and MV project directories. They do not touch a user's installed DSH state, RPG Maker projects, applications, or credentials. The current macOS substitute suite uses fake prerequisite/runtime executables; the real PowerShell/Coreutils identity, Windows `.cmd` launch, spaces/CJK path, and installed DSH checks remain a release gate on a Windows runner in foundation ticket 06.

## Editing model

In the first release, the agent is the sole writer while an RPG Maker MV project is under agent control. The editor may remain open only for read-only reference: users must not save from it, and must reopen the project before inspecting agent changes.
