[CmdletBinding()]
param(
  [switch] $Yes,
  [switch] $NoPause
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$programRoot = Join-Path $env:LOCALAPPDATA 'Programs\BaiheStudio\DSH-RPGMaker-MV'
$mutableRoot = Join-Path $env:LOCALAPPDATA 'BaiheStudio\DSH-RPGMaker-MV'
$env:DSH_RPGMAKER_PROGRAM_ROOT = $programRoot
$env:DSH_RPGMAKER_DATA_ROOT = $mutableRoot
$env:DSH_HOME = Join-Path $mutableRoot 'state'
$env:DSH_RPGMAKER_RUNTIME = Join-Path $programRoot 'runtime\dsh'

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $parts = @($machine, $user, $env:Path) | Where-Object { $_ }
  $env:Path = ($parts -join ';')
}

# This is one consent for every possible missing or identity/version-invalid
# prerequisite. The CLI performs the authoritative checks and all post-Bun
# prerequisite work; command presence is never treated as consent.
$consent = [bool] $Yes
if (-not $consent) {
  Write-Host 'DSH for RPG Maker MV may use WinGet to install or repair these prerequisites:'
  Write-Host '  - Node.js LTS/npm, Python 3.13, Bun, PowerShell 7.4+, Git for Windows, Microsoft Coreutils, 7-Zip'
  $answer = Read-Host 'Allow WinGet to install or repair prerequisites? [Y/N]'
  if ($answer -notmatch '^(?i)y(es)?$') {
    $consent = $false
    Write-Host 'No WinGet consent was given. Existing prerequisites will be verified; no prerequisite will be installed.'
  } else {
    $consent = $true
  }
}

Refresh-Path
$bun = Get-Command bun.exe -ErrorAction SilentlyContinue
if (-not $bun) {
  if (-not $consent) { throw 'Bun was not found and prerequisite installation was not consented to. Re-run Install.cmd and allow WinGet.' }
  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if (-not $winget) { throw 'WinGet was not found. Install Microsoft App Installer, then run Install.cmd again.' }
  Write-Host 'Installing Bun so the harness CLI can run...'
  & $winget.Source install --id Oven-sh.Bun --exact --accept-source-agreements --accept-package-agreements
  if ($LASTEXITCODE -ne 0) { throw "WinGet could not install Bun (exit code $LASTEXITCODE)." }
  Refresh-Path
  $bun = Get-Command bun.exe -ErrorAction SilentlyContinue
  if (-not $bun) { throw 'Bun was not found after prerequisite installation. Open a new terminal and retry Install.cmd.' }
}

$cli = Join-Path $root 'src\cli.ts'
$arguments = @('run', $cli, 'install', '--release-root', $root)
$winget = Get-Command winget.exe -ErrorAction SilentlyContinue
if ($winget) { $arguments += @('--winget-executable', $winget.Source) }
if ($consent) { $arguments += '--yes' }
& $bun.Source @arguments
$code = $LASTEXITCODE
if ($code -ne 0) { throw "DSH installation failed (exit code $code)." }
Write-Host 'DSH for RPG Maker MV is installed. Use the Start Menu shortcut to launch it.'
if (-not $NoPause) { Read-Host 'Press Enter to close' | Out-Null }
