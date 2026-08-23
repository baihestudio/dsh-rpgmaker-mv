[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $RemainingArgs
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$user = [Environment]::GetEnvironmentVariable('Path', 'User')
$env:Path = (@($machine, $user, $env:Path) | Where-Object { $_ }) -join ';'
$bun = Get-Command bun.exe -ErrorAction SilentlyContinue
if (-not $bun) { throw 'Bun was not found. Run Install.cmd or repair the installation, then retry.' }
$env:BUN_EXECUTABLE = $bun.Source
if (-not $env:DSH_RPGMAKER_PROGRAM_ROOT) { $env:DSH_RPGMAKER_PROGRAM_ROOT = $root }
if (-not $env:DSH_RPGMAKER_DATA_ROOT) {
  # The installer records the real mutable root in install.json. Prefer it so a
  # non-default install (e.g. on another drive) launches against its own state
  # instead of the LOCALAPPDATA default.
  $recordedMutableRoot = $null
  $metadata = Join-Path $root 'install.json'
  if (Test-Path $metadata) {
    try {
      $recorded = Get-Content $metadata -Raw | ConvertFrom-Json
      if ($recorded.mutableRoot) { $recordedMutableRoot = [string] $recorded.mutableRoot }
    } catch {
      # Malformed metadata falls back to the default below.
    }
  }
  $env:DSH_RPGMAKER_DATA_ROOT = if ($recordedMutableRoot) { $recordedMutableRoot } else { Join-Path $env:LOCALAPPDATA 'BaiheStudio\DSH-RPGMaker-MV' }
}
if (-not $env:DSH_HOME) { $env:DSH_HOME = Join-Path $env:DSH_RPGMAKER_DATA_ROOT 'state' }
if (-not $env:DSH_RPGMAKER_RUNTIME) { $env:DSH_RPGMAKER_RUNTIME = Join-Path $root 'runtime\dsh' }
& $bun.Source run (Join-Path $root 'src\cli.ts') launch @RemainingArgs
exit $LASTEXITCODE
