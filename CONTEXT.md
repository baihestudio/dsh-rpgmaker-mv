# RPG Maker Agent Installation

This context names the user-visible parts of installing and maintaining RPG Maker Agent on Windows.

## Language

**Installation session**:
One user-initiated operation that begins before prerequisite work and ends only after the product has passed final verification. Its status represents the whole installation, not a child installer such as WinGet.
_Avoid_: Install command, WinGet installation

**First installation**:
An installation session for a user account that has no recorded RPG Maker Agent installation. It is the only session in which the user chooses an installation root.
_Avoid_: Fresh bootstrap

**Installation root**:
The directory chosen during first installation that owns the program, DSH runtime, tool runtimes, and disposable cache. Upgrade and repair reuse it; changing an existing installation root is a separate migration capability.
_Avoid_: Program root, install location

**Local state root**:
The fixed per-user directory under `%LOCALAPPDATA%` that holds small settings, credentials, and logs independently of the installation root.
_Avoid_: Data root

**External prerequisite**:
A required system or user-level dependency acquired over the network outside the installation root, such as a package installed by WinGet. Its installation location is not controlled by the RPG Maker Agent installation-root choice.
_Avoid_: Tool runtime, bundled dependency

**Tool runtime**:
An application-owned executable or package runtime installed beneath the installation root and versioned with RPG Maker Agent.
_Avoid_: External prerequisite

**Desktop host**:
The packaged native RPG Maker Agent window that owns startup and the lifetime of its sidecar process.
_Avoid_: Installer, Agent

**Sidecar**:
The application-owned background process started by the desktop host to launch and supervise the local DSH Web session for RPG Maker work.
_Avoid_: Desktop host, installer
