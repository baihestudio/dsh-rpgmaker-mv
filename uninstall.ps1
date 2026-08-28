[CmdletBinding()]
param(
  [switch] $Purge,
  [switch] $Yes,
  [switch] $NoPause
)

$ErrorActionPreference = 'Stop'
$programRoot = $PSScriptRoot
$mutableRoot = Join-Path $env:LOCALAPPDATA 'BaiheStudio\DSH-RPGMaker-MV'
$dshHome = Join-Path $mutableRoot 'state'
$appData = if ($env:APPDATA) { $env:APPDATA } else { Join-Path $env:USERPROFILE 'AppData\Roaming' }
$shortcut = Join-Path $appData 'Microsoft\Windows\Start Menu\Programs\BaiheStudio\RPG Maker Agent.lnk'

if ($Purge -and -not $Yes) {
  $answer = Read-Host 'Purge DSH settings, local credentials, logs, cache, and recent-project metadata too? [Y/N]'
  if ($answer -notmatch '^(?i)y(es)?$') { throw 'Purge cancelled. No program files were removed.' }
}

$bun = Get-Command bun.exe -ErrorAction SilentlyContinue
if (-not $bun) { throw 'Bun was not found. Run Install.cmd or repair the installation, then retry.' }
$cli = Join-Path $programRoot 'src\cli.ts'
$arguments = @(
  'run', $cli, 'uninstall',
  '--program-root', $programRoot,
  '--mutable-root', $mutableRoot,
  '--dsh-home', $dshHome,
  '--start-menu-shortcut', $shortcut
)
if ($Purge) { $arguments += '--purge' }
& $bun.Source @arguments
$code = $LASTEXITCODE
if ($code -ne 0) { throw "DSH uninstall failed (exit code $code)." }
if (-not $NoPause) { Read-Host 'Press Enter to close' | Out-Null }
