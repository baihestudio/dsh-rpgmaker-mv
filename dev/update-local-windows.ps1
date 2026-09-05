# Development-only local Windows update helper.
# Build a Release ZIP first, then run this on the local Windows host through
# nuc-powershell (or PowerShell 7 directly). It never contacts another host.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $ReleaseZip,
  [switch] $StopRunningDsh,
  [switch] $KeepExtractedRelease
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-FullPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  return [System.IO.Path]::GetFullPath($Path)
}

if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
  throw 'LOCALAPPDATA is not set; refusing to guess local Windows installation paths.'
}

$zipPath = Resolve-FullPath $ReleaseZip
if (-not (Test-Path -LiteralPath $zipPath -PathType Leaf)) {
  throw "Release ZIP was not found: $zipPath"
}
if (-not [string]::Equals([System.IO.Path]::GetExtension($zipPath), '.zip', [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Release input must be a ZIP archive: $zipPath"
}

$programRoot = Join-Path $env:LOCALAPPDATA 'Programs\BaiheStudio\DSH-RPGMaker-MV'
$running = @(
  Get-CimInstance Win32_Process |
    Where-Object { $_.ExecutablePath -like "*$programRoot*" -or $_.CommandLine -like "*$programRoot*" } |
    Select-Object -ExpandProperty ProcessId -Unique
)
if ($running.Count -gt 0) {
  if (-not $StopRunningDsh) {
    throw "DSH processes are using the installed program tree (PID(s): $($running -join ', ')). Close DSH or rerun with -StopRunningDsh."
  }
  foreach ($processId in $running) {
    & "$env:SystemRoot\System32\taskkill.exe" /PID $processId /T /F | Out-Host
  }
  Start-Sleep -Milliseconds 800
  $remaining = @(
    Get-CimInstance Win32_Process |
      Where-Object { $_.ExecutablePath -like "*$programRoot*" -or $_.CommandLine -like "*$programRoot*" } |
      Select-Object -ExpandProperty ProcessId -Unique
  )
  if ($remaining.Count -gt 0) {
    throw "DSH processes still use the installed program tree (PID(s): $($remaining -join ', '))."
  }
}

$extractRoot = Join-Path ([System.IO.Path]::GetTempPath()) "dsh-rpgmaker-update-$([guid]::NewGuid().ToString('N'))"
$completed = $false
try {
  New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force
  $installer = Join-Path $extractRoot 'installer.exe'
  if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
    throw "Release ZIP does not contain installer.exe at its root: $zipPath"
  }

  Push-Location $extractRoot
  try {
    & $installer install --release-root $extractRoot --non-interactive
  } finally {
    Pop-Location
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Release installer failed with exit code $LASTEXITCODE."
  }
  $completed = $true
  Write-Output "Updated local installation from: $zipPath"
} finally {
  if ($completed -and -not $KeepExtractedRelease) {
    Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
  } elseif (Test-Path -LiteralPath $extractRoot) {
    Write-Warning "Retained extracted release for diagnostics: $extractRoot"
  }
}
