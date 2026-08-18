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
$winget = Get-Command winget.exe -ErrorAction SilentlyContinue
$required = @(
  @{ Name = 'node.exe'; Label = 'Node.js LTS/npm'; Id = 'OpenJS.NodeJS.LTS' },
  @{ Name = 'bun.exe'; Label = 'Bun'; Id = 'Oven-sh.Bun' },
  @{ Name = 'pwsh.exe'; Label = 'PowerShell 7.4+'; Id = 'Microsoft.PowerShell' },
  @{ Name = 'git.exe'; Label = 'Git for Windows'; Id = 'Git.Git' },
  @{ Name = 'coreutils-manager.exe'; Label = 'Microsoft Coreutils'; Id = 'Microsoft.Coreutils' }
)

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($machine -and $user) { $env:Path = "$machine;$user" }
  elseif ($machine) { $env:Path = $machine }
  elseif ($user) { $env:Path = $user }
}

Refresh-Path
$missing = @($required | Where-Object { -not (Get-Command $_.Name -ErrorAction SilentlyContinue) })
if ($missing.Count -gt 0) {
  Write-Host 'DSH for RPG Maker MV needs these Windows prerequisites:'
  $missing | ForEach-Object { Write-Host "  - $($_.Label) [$($_.Id)]" }
  if (-not $Yes) {
    $answer = Read-Host 'Install the missing prerequisites with WinGet? [Y/N]'
    if ($answer -notmatch '^(?i)y(es)?$') { throw 'Installation cancelled. No prerequisite was installed.' }
  }
  if (-not $winget) { throw 'WinGet was not found. Install Microsoft App Installer, then run Install.cmd again.' }
  foreach ($item in $missing) {
    Write-Host "Installing $($item.Label)..."
    & $winget.Source install --id $item.Id --exact --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) { throw "WinGet could not install $($item.Label) (exit code $LASTEXITCODE)." }
  }
  Refresh-Path
}

$bun = Get-Command bun.exe -ErrorAction SilentlyContinue
if (-not $bun) { throw 'Bun was not found after prerequisite installation. Open a new terminal and retry Install.cmd.' }
$cli = Join-Path $root 'src\cli.ts'
& $bun.Source run $cli install --release-root $root --yes
$code = $LASTEXITCODE
if ($code -ne 0) { throw "DSH installation failed (exit code $code)." }
Write-Host 'DSH for RPG Maker MV is installed. Use the Start Menu shortcut to launch it.'
if (-not $NoPause) { Read-Host 'Press Enter to close' | Out-Null }
