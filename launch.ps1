[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $RemainingArgs
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$bun = Get-Command bun.exe -ErrorAction SilentlyContinue
if (-not $bun) { throw 'Bun was not found. Run Install.cmd or repair the installation, then retry.' }
if (-not $env:DSH_RPGMAKER_PROGRAM_ROOT) { $env:DSH_RPGMAKER_PROGRAM_ROOT = $root }
if (-not $env:DSH_RPGMAKER_DATA_ROOT) { $env:DSH_RPGMAKER_DATA_ROOT = Join-Path $env:LOCALAPPDATA 'BaiheStudio\DSH-RPGMaker-MV' }
if (-not $env:DSH_HOME) { $env:DSH_HOME = Join-Path $env:DSH_RPGMAKER_DATA_ROOT 'state' }
if (-not $env:DSH_RPGMAKER_RUNTIME) { $env:DSH_RPGMAKER_RUNTIME = Join-Path $root 'runtime\dsh' }
& $bun.Source run (Join-Path $root 'src\cli.ts') launch @RemainingArgs
exit $LASTEXITCODE
