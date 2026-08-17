# Windows POSIX-like shell selection for DSH

**Decision:** ship Windows on the official DSH PowerShell path, with PowerShell 7.4+ as the execution language and Microsoft Coreutils for Windows as an optional/native command bundle. Keep `pwsh` required. Do not replace the executor with Git Bash, WSL, BusyBox, Nushell, or an unsandboxed shell MCP in the first release.

This is the smallest design that preserves DSH's existing Windows sandbox, credential handling, job lifecycle, native Windows paths, and process-tree ownership while making common commands (`find`, `grep`, `sed`, `awk`, `tee`, etc.) available. Coreutils supplies executables; it is **not** a shell and does not replace `pwsh`.

## Evidence and architecture

The current DSH source has an explicit platform gate in the base Cordis composition:

- `dsh-bash-sandbox` and `dsh-tool-bash` are disabled on `win32`.
- `dsh-pwsh-sandbox` and `dsh-tool-pwsh` are enabled on `win32`.
- The Windows tool runs a fresh `pwsh -NoLogo -NoProfile -NonInteractive -Command <command>` invocation; command text is one argv element, and `workdir` must be supplied for per-call cwd.
- The sandbox consumes the exact argv through `ctx.sandbox.confine()`. A confined run either gets an enforcing argv or fails closed; it does not silently fall back to an unrestricted child.
- The local subprocess service scrubs credential-shaped and ambient `DSH_*` variables, applies explicit environment overrides after scrubbing, captures bounded output, and owns timeout/cancellation/disposal. On Windows, ordinary process-tree termination uses `taskkill /PID <pid> /T /F`.
- The Windows ACL backend is deliberately reported as `enforcement: partial`: it restricts writes, but ambient ACLs, hard links, FAT volumes, read access, network access, and process visibility are not a complete security boundary.

Therefore changing `COMSPEC`, putting `bash.exe` first on `PATH`, or installing command binaries is not sufficient. A replacement persistent shell would have to implement the subprocess terminal seam, foreground readiness, process inspection, cancellation, tree cleanup, sandbox wrapping, environment policy, and tool/prompt contract.

Primary DSH sources (pinned to the observed commits):

- [base Cordis composition](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/bundle/base/cordis.patch.yml)
- [`dsh-pwsh-local` README](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/shell/pwsh-local/README.md) and [executor source](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/shell/pwsh-local/src/index.ts)
- [`dsh-tool-pwsh` README](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/shell/tool-pwsh/README.md)
- [`dsh-subprocess-local` README](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/subprocess/subprocess-local/README.md) and [process-inspector source](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/subprocess/subprocess-local/src/process-inspector.ts)
- [`dsh-sandbox` README](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/sandbox/sandbox/README.md) and [Windows ACL backend README](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/sandbox/sandbox-windows-acl/README.md)

## Comparison

| Option | POSIX command feel | Native Windows/Git/GUI access | DSH sandbox/process parity | First-release verdict |
|---|---|---|---|---|
| **PowerShell 7 + Microsoft Coreutils** | Good for non-conflicting utilities; PowerShell syntax remains underneath | **Best**; direct Win32 paths, `.exe`, Git, RPG Maker/NW.js, Photoshop | **Existing official path**; fresh calls, scrubbed env, Windows ACL sandbox, `taskkill` tree ownership | **Recommend** |
| Git Bash/MSYS2 | Best Bash compatibility | Good, but MSYS path conversion and fork/PTY behavior are another runtime | Git Bash does not survive DSH's restricted Windows token; requires full access in the direct Windows evidence below | Fallback only |
| WSL2 | Best Linux compatibility | Host GUI/native process control crosses a VM boundary; Windows projects live under `/mnt/c` | Not the DSH Windows ACL world; adds path, permission, filesystem, and lifecycle seams | Reject for default |
| BusyBox `ash` | Small POSIX subset | Native Win32 and suitable for a bundled shell | A viable sandboxed persistent-shell fallback, but no Bash arrays/`[[ ]]`; GPLv2 download/consent and custom maintenance | Fallback for Minimal mode |
| Nushell | Excellent cross-platform native shell, structured data | Native | No DSH executor/tool composition; not Bash/POSIX syntax | Reject for first release |
| Custom executor or shell MCP | Whatever we implement | Potentially excellent | Must recreate every DSH seam; an unsandboxed MCP is a material security regression | Reject |

The comparison is based on first-party documentation plus the direct probes below. Git for Windows describes Git Bash as a Bash emulation. MSYS2 documents distinct MSYS/UCRT/MinGW environments and path conversion. Microsoft describes WSL2 as a lightweight VM and recommends keeping projects on the same filesystem as the tools for performance. Microsoft Coreutils explicitly documents shell conflicts, missing POSIX-signal utilities, CRLF, ACL, symlink, and path-separator differences. Sources: [Git for Windows](https://gitforwindows.org/), [MSYS2 environments](https://www.msys2.org/docs/environments/), [MSYS2 filesystem paths](https://www.msys2.org/docs/filesystem-paths/), [WSL version comparison](https://learn.microsoft.com/en-us/windows/wsl/compare-versions), [WSL filesystems](https://learn.microsoft.com/en-us/windows/wsl/filesystems), [BusyBox FAQ](https://www.busybox.net/FAQ.html), and [Nushell Book](https://www.nushell.sh/book/).

## Microsoft Coreutils: exact role and limitations

Microsoft's [Coreutils for Windows README](https://github.com/microsoft/coreutils/blob/a350b9cf5c9c178b1089902cde89275688862e32/README.md) says it is a Microsoft-maintained build of uutils/coreutils, findutils, and grep packaged as a native Windows multi-call binary. It is preview software and is installed with:

```powershell
winget install Microsoft.Coreutils
```

It requires PowerShell 7.4 or later; 7.6 is recommended for `~` support. It is not a command parser, pipeline runtime, process supervisor, persistent shell, or signal implementation.

Important command conflicts from Microsoft's own table:

- `find` is available as a native command; `grep`, `sed`, `awk`, and similar tools are useful non-alias additions.
- `cat`, `cp`, `ls`, `mkdir`, `mv`, `pwd`, `rm`, `sort`, `tee`, and others conflict with PowerShell aliases/built-ins. `kill`, `timeout`, `whoami`, and several POSIX-only commands are intentionally absent.
- `PATH` order does not defeat a PowerShell alias. The installer’s profile integration rewrites interactive PSReadLine input, but DSH deliberately invokes `-NoProfile`; do not depend on that integration in agent calls.
- Coreutils uses Windows paths, CRLF-sensitive byte behavior, ACL rather than POSIX permission semantics, `NUL` rather than `/dev/null`, and no general POSIX signals. Creating symlinks may require Developer Mode or elevation.

The [Microsoft installer](https://github.com/microsoft/coreutils/blob/a350b9cf5c9c178b1089902cde89275688862e32/src/pwsh-install.ps1) confirms that profile integration is a separate PowerShell-profile mutation and that the command directory is an explicit installation input. DSH should therefore verify the installed command directory and PATH, but must not edit or require a user profile for correctness.

## Direct probes

### Probes run on this macOS host

All probes used temporary state outside the repository.

1. **Portable command-behavior substitute:** a Bash/Node probe created a temporary path containing spaces and CJK characters, then verified environment values, globbing, a `sort | tr` pipeline, CRLF bytes, symlink reading, Git availability, persistent state/cwd in a long-lived shell, process-group cancellation, and `fs.watch`. Observed: all setup/quoting/glob/pipeline/env/symlink/Git/watch checks succeeded; the long-lived shell retained `STATE=kept` and cwd; SIGTERM ended the substitute process with `-15`. This establishes the required behavioral shape, not Windows behavior.
2. **`dsh-win32` source test suite:** extracted the pinned [dsh-win32](https://github.com/sjh9714/dsh-win32/tree/b39cbdc32c6cac1cac5d3d4cd1389a9f9eb4350b) source to `/tmp`, installed its dependencies there, built it, and ran `npm test`: **8 test files, 92 tests passed** on macOS. These are deterministic tests of the Windows inspector, terminal wrapper, shell decoding, filesystem fence, preset installation, and doctor envelope; they do not execute Windows APIs.
3. **Win32-branch substitute:** ran `scripts/win32-sim.mjs` with `process.platform` forced to `win32`, using `/bin/bash` as a fixture. The doctor envelope ran and correctly classified the simulated checks: Node pass, Git Bash pass, PowerShell 7 warn (not installed on macOS), sandbox shell warn (only Git Bash preset), and no Windows ACL probe without a Windows preset. This verifies the diagnostic branch, not Windows installation.
4. **Portable-eval probe:** built `dsh-win32` and passed the production-shaped `eval -- $'...'` wrapper through its `toPortableEval()` function. It rewrote to `eval $' ...'`, while unrelated input remained unchanged. This is the compatibility seam needed by the BusyBox-ash fallback.

### Required Windows probe matrix before release

| Requirement | macOS substitute | Windows hardware result still required |
|---|---|---|
| Spaces/CJK paths, quoting, globbing, pipes, env | Passed portable Bash/Node probe | Repeat under `pwsh -NoProfile` and Coreutils on NTFS paths, including `C:\...` and `~` |
| Cwd persistence expectation | Long-lived shell retained cwd; DSH `pwsh` semantics read from source | Confirm each fresh `pwsh` call uses `workdir`; confirm agent guidance does not assume state persistence |
| CRLF and UTF-8 | Observed CRLF bytes and UTF-8 path names | Confirm Coreutils and DSH UTF-8 preamble with CRLF files and CJK stdout |
| Symlinks | Read existing symlink | Test Developer Mode/elevation policy for creation and project links |
| Git | `git --version` passed | `Git.Git` install, Git Bash optional, native `git.exe` from `pwsh`, credential manager, worktrees |
| Coreutils conflicts | No Microsoft Windows binary available on macOS | `Get-Command -All`, `find`, `grep`, `sort`, `ls.cmd`/`cat.cmd`, aliases, PATH refresh, upgrade/disable behavior |
| Native `.exe` launch | No Windows executable | Launch NW.js, RPG Maker MV, Photoshop, and packaging tools with `Start-Process`; verify exit/working-directory behavior |
| Cancellation/process tree | POSIX process-group kill substitute passed | Long-running Playtest and child process tree; DSH timeout, `run_in_background`, `job_kill`, `taskkill /T` cleanup |
| File watching | Node `fs.watch` emitted an event | Watch RPG Maker project files from DSH and confirm no ACL/handle leak |
| Sandbox | DSH unit fence tests passed; no Windows token | `read-only`/`workspace-write` writes, private temp, GUI child inheritance, partial-enforcement reporting, and exact escalation behavior |
| Installation/update | `npm build` and 92 tests passed | `winget` install/upgrade/uninstall, PowerShell 7.4+ discovery, PATH and new-process visibility, no profile dependency |

**Platform boundary:** the Windows rows above cannot be truthfully marked passed on this macOS host. The macOS substitute probes are complete for portable shell behavior and source logic. No additional macOS hardware test is needed to choose the Windows stack; a separate native macOS DSH regression run is optional if changing shared Cordis composition.

## Recommended implementation

### Cordis/settings composition

Keep the existing official Windows gate. Do not mount Bash as a second `ctx.shell` provider.

```yaml
# Windows profile: retain the existing base rows
- id: sandbox
  name: '@deepseek-ai/dsh-sandbox-local'
- id: sandbox-policy
  name: '@deepseek-ai/dsh-sandbox-policy'
  config:
    mode: workspace-write
    workspaceRoot: !!js process.cwd()
- id: shell
  name: '@deepseek-ai/dsh-pwsh-sandbox'
  config:
    pwshPath: 'C:/Program Files/PowerShell/7/pwsh.exe'
- id: tool-pwsh
  name: '@deepseek-ai/dsh-tool-pwsh'
```

The real DSH row ids/names should follow the upstream base composition; the snippet is the intended shape, not a drop-in patch. Keep the existing `dsh-subprocess-local`, `dsh-shell-env`, jobs, approval, permission, filesystem, and credential rows. Do not bypass `ctx.sandbox`, replace `dsh-pwsh-sandbox` with `dsh-pwsh-local`, or expose an unsandboxed shell MCP as the normal path.

Recommended first-release settings:

- Require and explicitly resolve PowerShell 7.4+ (`pwsh.exe`), rather than allowing DSH's Windows PowerShell 5.1 fallback when Coreutils is enabled. The fallback may preserve basic DSH operation, but it cannot satisfy Coreutils' requirement and is known by the DSH Windows doctor to fail in the restricted sandbox.
- Keep the default `workspace-write` policy and `ask` approval. Use `danger-full-access` only as a same-command approved escalation for an operation that genuinely needs an external project/profile/GUI write.
- Set the DSH cwd to the RPG Maker project root. Use tool `workdir` for one-shot commands; never promise persistent cwd or variables because `tool-pwsh` starts a fresh process for every call.

### Installation and PATH ordering

1. Install PowerShell 7.4+ using Microsoft's documented Windows installer or `winget install Microsoft.PowerShell` ([Microsoft install docs](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows)). Prefer 7.6+ when available.
2. Install Git for Windows for native `git.exe` and optional human Git Bash: `winget install Git.Git` ([Git for Windows](https://gitforwindows.org/)). Git Bash is not the DSH executor.
3. Install native Coreutils: `winget install Microsoft.Coreutils`.
4. Start a new process after installation so PATH is refreshed. Locate `coreutils-manager.exe`/the command directory and confirm it is on the environment PATH visible to the DSH host. Put that directory ahead of unrelated third-party Unix shims, but do not expect it to override PowerShell aliases.
5. Validate before enabling the profile: `pwsh --version` is at least 7.4; `Get-Command coreutils-manager`; `Get-Command find`; `Get-Command grep`; and explicit `Get-Command ls.cmd`/`Get-Command cat.cmd`/`Get-Command sort.cmd` where shipped. Run the same checks through the DSH `pwsh` tool, because `-NoProfile` is intentional.
6. On updates, rerun the doctor and the command-conflict checks. Do not silently mutate the user's profile from DSH.

### Agent prompt/skill guidance

Add a Windows shell skill or scoped tool description with these rules:

- The execution language is PowerShell, not Bash. Use `$env:NAME`, `-LiteralPath`, `Join-Path`, `Get-ChildItem`, `Start-Process`, and `workdir`.
- Coreutils is available for non-conflicting native utilities. Use `find`, `grep`, `sed`, `awk`, and similar commands when they make the task clearer.
- PowerShell aliases win over PATH. For a conflicting Coreutils binary, call its explicit shim (`ls.cmd`, `cat.cmd`, `sort.cmd`, etc.) or use the PowerShell cmdlet; verify with `Get-Command -All`. Do not assume the Coreutils PSReadLine integration is active because DSH uses `-NoProfile`.
- Do not use POSIX-only `/dev/null`, `kill`, `timeout`, `chmod`, `chown`, `mkfifo`, or `uname` assumptions. Use `$null`/`NUL` as appropriate, DSH background jobs plus `job_kill`, `Stop-Process`/`taskkill` only when the task requires it, and Windows ACL semantics.
- For native GUI tools, use quoted `Start-Process -FilePath` with an explicit `-WorkingDirectory`; do not route a Windows GUI through WSL path translation. If the sandbox denies a required external write, retry the exact command once with the narrowest approved `sandbox_permissions` mode; do not pre-escalate or work around the denial.
- For project paths containing spaces/CJK, pass a quoted native path and prefer `-LiteralPath`; do not manually translate it to `/mnt/c` or MSYS `/c`.

## Sandbox and process-management implications

The recommended stack keeps the important DSH guarantees:

- The sandbox wraps the actual `pwsh.exe` argv, so Coreutils processes inherit the same Windows ACL restricted token and private temp directory. A Coreutils command writing outside the workspace should be denied and surfaced as a DSH sandbox fact, not retried through another shell.
- The Windows ACL backend is partial. It is a write restriction, not a complete read/network/process sandbox. A native GUI child can inherit the restricted token and may need an approved full-access retry or a future dedicated GUI capability. This is why a broad unsandboxed shell MCP is not an acceptable shortcut.
- The subprocess runtime scrubs ambient credentials and `DSH_*` variables, then adds only explicit managed values. Do not launch a second shell that reconstructs the ambient environment and bypasses this channel.
- `pwsh` foreground calls have bounded stdout/stderr capture and fresh process lifetime. Background calls use DSH jobs and Windows tree termination; they are not persistent shell state. A long-running RPG Maker Playtest belongs in `run_in_background` and must be verified with `job_output`/`job_kill` on Windows.
- Coreutils lacks POSIX signals. Do not build cancellation around a Coreutils `kill` or `timeout` command. DSH cancellation/timeout owns the process tree, and PowerShell/Windows APIs own any explicit native process control.

## Fallbacks and rejected alternatives

### Git Bash/MSYS2

Git Bash is the most attractive POSIX surface, but it is the wrong default for a sandboxed DSH agent. The independent `dsh-win32` implementation documents and tests that MSYS Bash dies under the Windows `workspace-write` restricted token (`TokenDefaultDacl`, `0xC0000022`), while its BusyBox `ash` variant survives. It also documents that MSYS fork emulation breaks ordinary parent-link tree discovery, requiring ConPTY console enumeration and signal fan-out. Its Git Bash preset consequently requires `danger-full-access`.

This is strong primary-source engineering evidence, but it is not a DSH upstream guarantee and its Windows CI was not run by this agent. Use Git Bash only as an explicitly selected full-access fallback, or use the dsh-win32 BusyBox preset if a maintained deployment has accepted its GPL/ash/custom-runtime trade-offs.

### WSL2

WSL2 gives the best Linux/Bash compatibility, but the DSH agent still needs to control Windows-native RPG Maker, NW.js, Photoshop, Git, and packaging processes. Crossing WSL/Windows boundaries adds path translation, `/mnt/c` filesystem performance, permission/metadata differences, GUI process lifetime, and a second environment/sandbox to explain. Microsoft’s own WSL filesystem guidance recommends keeping files and tools on the same filesystem for performance. WSL is a developer escape hatch, not the predictable native Windows execution world required here.

### BusyBox or another native shell bundle

BusyBox `ash` is a credible fallback because it is a small native executable and the dsh-win32 Windows CI evidence reports that it survives `workspace-write`. It is not Bash: arrays and `[[ ]]` are absent, and the official persistent-bash wrapper uses the Bash-specific `eval --` form (dsh-win32 must rewrite it). Bundling/download also brings GPLv2 consent, update, licensing, and maintenance work. Keep it behind an optional Minimal-mode profile, not in the official default.

### Nushell

Nushell is a good native cross-platform shell, but its structured values and syntax are intentionally unlike Bash/POSIX and unlike PowerShell. DSH has no existing Nushell executor, sandbox consumer, model tool, or process contract. It would create a second language choice without improving native GUI reliability enough to justify first-release scope.

### Custom shell executor or shell MCP

A custom executor is justified only if a Windows hardware matrix proves a decisive user-visible gain over `pwsh` plus Coreutils. Before then it duplicates the DSH process/subprocess/sandbox/job/tool/prompt seams. An unsandboxed MCP may make Git Bash easy, but it materially regresses the official Windows security model. Do not ship that as the default.

## Release acceptance decision

Ship the recommended stack after the Windows matrix passes, with these hard gates:

1. PowerShell 7.4+ is discovered explicitly and Coreutils is visible from DSH’s `-NoProfile` process.
2. Conflict commands are demonstrated both through a native Coreutils shim and through PowerShell fallback; the agent skill teaches the distinction.
3. Paths with spaces/CJK, CRLF, Git, symlink policy, native `.exe` launch, Playtest cancellation, file watching, and packaging all pass on a real Windows machine.
4. `workspace-write` and approved `danger-full-access` behavior are separately tested for RPG Maker/NW.js/Photoshop projects; sandbox denials are reported rather than bypassed.
5. No Windows default path depends on Git Bash, WSL, a user profile hook, or an unsandboxed MCP.

That leaves `pwsh` as the stable DSH execution substrate and makes Coreutils a replaceable command-availability layer rather than a second shell architecture.
