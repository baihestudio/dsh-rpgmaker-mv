[CmdletBinding()]
param(
  [switch] $Purge,
  [switch] $Yes,
  [switch] $NoPause
)

$ErrorActionPreference = 'Stop'
$programRoot = $PSScriptRoot
$mutableRoot = Join-Path $env:LOCALAPPDATA 'BaiheStudio\DSH-RPGMaker-MV'
$appData = if ($env:APPDATA) { $env:APPDATA } else { Join-Path $env:USERPROFILE 'AppData\Roaming' }
$shortcut = Join-Path $appData 'Microsoft\Windows\Start Menu\Programs\BaiheStudio\DSH for RPG Maker MV.lnk'

if ($Purge -and -not $Yes) {
  $answer = Read-Host 'Purge DSH settings, local credentials, logs, cache, and recent-project metadata too? [Y/N]'
  if ($answer -notmatch '^(?i)y(es)?$') { throw 'Purge cancelled. Program files were not removed.' }
}

Remove-Item -LiteralPath $shortcut -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $mutableRoot 'cache') -Recurse -Force -ErrorAction SilentlyContinue
if ($Purge) {
  Remove-Item -LiteralPath $mutableRoot -Recurse -Force -ErrorAction SilentlyContinue
}
$programParent = Split-Path -Parent $programRoot
$programName = Split-Path -Leaf $programRoot
Get-ChildItem -LiteralPath $programParent -Filter "$programName.rollback-*" -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $programRoot -Recurse -Force -ErrorAction SilentlyContinue
Write-Host 'DSH for RPG Maker MV program files and cache were removed.'
if ($Purge) { Write-Host 'DSH state and local credential metadata were purged by explicit request.' }
else { Write-Host "State, credentials, logs, and recent projects remain under $mutableRoot. Projects outside that folder are never deleted." }
if (-not $NoPause) { Read-Host 'Press Enter to close' | Out-Null }
