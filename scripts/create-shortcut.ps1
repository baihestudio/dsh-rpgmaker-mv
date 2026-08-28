[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $TargetPath,
  [Parameter(Mandatory = $true)] [string] $ShortcutPath,
  [Parameter(Mandatory = $true)] [string] $WorkingDirectory,
  [string] $IconPath
)

$ErrorActionPreference = 'Stop'
$parent = Split-Path -Parent $ShortcutPath
New-Item -ItemType Directory -Force -Path $parent | Out-Null
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = $TargetPath
$shortcut.WorkingDirectory = $WorkingDirectory
$shortcut.Description = 'RPG Maker Agent'
if ($IconPath) { $shortcut.IconLocation = $IconPath }
$shortcut.Save()
Write-Output $ShortcutPath
