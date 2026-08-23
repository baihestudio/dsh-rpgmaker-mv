[CmdletBinding()]
param(
  [string[]]$SteamRoot
)

$ErrorActionPreference = 'Stop'
$AppId = '363890'
$seenRoots = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$roots = [System.Collections.Generic.List[string]]::new()
$searched = [System.Collections.Generic.List[string]]::new()

function Add-SteamRoot([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return }
  $expanded = [Environment]::ExpandEnvironmentVariables($Path).Trim().TrimEnd('\', '/')
  if ($seenRoots.Add($expanded)) { $roots.Add($expanded) }
}

if ($SteamRoot) {
  foreach ($root in $SteamRoot) { Add-SteamRoot $root }
} else {
  foreach ($entry in @(
    @{ Path = 'HKCU:\Software\Valve\Steam'; Property = 'SteamPath' },
    @{ Path = 'HKLM:\Software\WOW6432Node\Valve\Steam'; Property = 'InstallPath' },
    @{ Path = 'HKLM:\Software\Valve\Steam'; Property = 'InstallPath' }
  )) {
    try { Add-SteamRoot (Get-ItemPropertyValue -LiteralPath $entry.Path -Name $entry.Property -ErrorAction Stop) } catch {}
  }
  Add-SteamRoot (Join-Path ${env:ProgramFiles(x86)} 'Steam')
  Add-SteamRoot (Join-Path $env:ProgramFiles 'Steam')
}

# Steam records every configured library in the root libraryfolders.vdf. Parse
# only its path fields; do not recursively scan disks or inspect unrelated apps.
foreach ($root in @($roots)) {
  $libraryFile = Join-Path $root 'steamapps\libraryfolders.vdf'
  if (-not (Test-Path -LiteralPath $libraryFile -PathType Leaf)) { continue }
  $vdf = Get-Content -LiteralPath $libraryFile -Raw
  foreach ($match in [regex]::Matches($vdf, '"path"\s+"([^"]+)"')) {
    Add-SteamRoot ($match.Groups[1].Value.Replace('\\', '\'))
  }
}

foreach ($library in $roots) {
  $manifest = Join-Path $library "steamapps\appmanifest_$AppId.acf"
  $searched.Add($manifest)
  if (Test-Path -LiteralPath $manifest -PathType Leaf) {
    $acf = Get-Content -LiteralPath $manifest -Raw
    $installMatch = [regex]::Match($acf, '"installdir"\s+"([^"]+)"')
    if ($installMatch.Success) {
      $installDir = $installMatch.Groups[1].Value.Replace('\\', '\')
      $installationPath = Join-Path (Join-Path $library 'steamapps\common') $installDir
      $runtimePath = Join-Path $installationPath 'nwjs-win\Game.exe'
      if (Test-Path -LiteralPath $runtimePath -PathType Leaf) {
        [pscustomobject]@{
          found = $true
          source = 'steam-manifest'
          appId = $AppId
          steamLibrary = $library
          manifestPath = $manifest
          installationPath = $installationPath
          runtimePath = $runtimePath
          searchedManifests = @($searched)
        } | ConvertTo-Json -Depth 4 -Compress
        return
      }
    }
  }

  # A copied or newly installed Steam tree can briefly have its files before
  # the manifest is visible. This exact fallback remains bounded to known Steam
  # libraries and still verifies Game.exe.
  $installationPath = Join-Path $library 'steamapps\common\RPG Maker MV'
  $runtimePath = Join-Path $installationPath 'nwjs-win\Game.exe'
  if (Test-Path -LiteralPath $runtimePath -PathType Leaf) {
    [pscustomobject]@{
      found = $true
      source = 'steam-library'
      appId = $AppId
      steamLibrary = $library
      manifestPath = $null
      installationPath = $installationPath
      runtimePath = $runtimePath
      searchedManifests = @($searched)
    } | ConvertTo-Json -Depth 4 -Compress
    return
  }
}

[pscustomobject]@{
  found = $false
  source = 'not-found'
  appId = $AppId
  steamLibraries = @($roots)
  searchedManifests = @($searched)
} | ConvertTo-Json -Depth 4 -Compress
