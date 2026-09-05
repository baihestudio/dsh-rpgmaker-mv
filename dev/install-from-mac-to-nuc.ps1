# Development-only target-side half of `just install-from-mac-to-nuc`.
# The Mac helper copies a fresh archive to this fixed Windows Temp path, then
# this script stops the installed DSH process tree, then runs the ordinary
# transactional installer.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
  throw 'LOCALAPPDATA is not set; refusing to guess local Windows installation paths.'
}

$zipPath = Join-Path ([System.IO.Path]::GetTempPath()) 'DSH-RPGMaker-MV-from-mac.zip'
if (-not (Test-Path -LiteralPath $zipPath -PathType Leaf)) {
  throw "Mac transfer archive was not found: $zipPath"
}

$programRoot = Join-Path $env:LOCALAPPDATA 'Programs\BaiheStudio\DSH-RPGMaker-MV'
$running = @(
  Get-CimInstance Win32_Process |
    Where-Object { $_.ExecutablePath -like "*$programRoot*" -or $_.CommandLine -like "*$programRoot*" } |
    Select-Object -ExpandProperty ProcessId -Unique
)
if ($running.Count -gt 0) {
  $runningSet = [System.Collections.Generic.HashSet[int]]::new()
  foreach ($processId in $running) { [void] $runningSet.Add([int] $processId) }
  $roots = @(
    Get-CimInstance Win32_Process |
      Where-Object { $runningSet.Contains([int] $_.ProcessId) -and -not $runningSet.Contains([int] $_.ParentProcessId) } |
      Select-Object -ExpandProperty ProcessId -Unique
  )
  foreach ($processId in $roots) {
    Write-Output "Stopping installed DSH process tree rooted at PID $processId"
    & "$env:SystemRoot\System32\taskkill.exe" /PID $processId /T /F | Out-Host
  }
  Start-Sleep -Milliseconds 800
  $remaining = @(
    Get-CimInstance Win32_Process |
      Where-Object { $_.ExecutablePath -like "*$programRoot*" -or $_.CommandLine -like "*$programRoot*" } |
      Select-Object -ExpandProperty ProcessId -Unique
  )
  if ($remaining.Count -gt 0) {
    throw "DSH processes still use the installed program tree after termination (PID(s): $($remaining -join ', '))."
  }
}

$extractRoot = Join-Path ([System.IO.Path]::GetTempPath()) "dsh-rpgmaker-mac-update-$([guid]::NewGuid().ToString('N'))"
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

  $profileManifest = Join-Path $env:LOCALAPPDATA 'BaiheStudio\DSH-RPGMaker-MV\state\profiles\web\package.json'
  $profile = Get-Content -LiteralPath $profileManifest -Raw | ConvertFrom-Json
  $brand = $profile.dependencies.'@baihestudio/dsh-rpgmaker-brand'
  if ([string]::IsNullOrWhiteSpace($brand)) {
    throw "Installed Web profile does not list @baihestudio/dsh-rpgmaker-brand: $profileManifest"
  }
  $logo = Join-Path $env:LOCALAPPDATA 'BaiheStudio\DSH-RPGMaker-MV\state\profiles\web\node_modules\@baihestudio\dsh-rpgmaker-brand\assets\maker-ape-logo.png'
  if (-not (Test-Path -LiteralPath $logo -PathType Leaf)) {
    throw "Installed RPG Maker Agent logo is missing: $logo"
  }
  $completed = $true
  Write-Output "Installed RPG Maker Agent branding: $brand"
  Write-Output "Verified logo: $logo"
} finally {
  if ($completed -and (Test-Path -LiteralPath $extractRoot)) {
    Remove-Item -LiteralPath $extractRoot -Recurse -Force
  } elseif (Test-Path -LiteralPath $extractRoot) {
    Write-Warning "Retained extracted release for diagnostics: $extractRoot"
  }
}
