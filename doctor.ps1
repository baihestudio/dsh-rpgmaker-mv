[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $RemainingArgs
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$bun = Get-Command bun.exe -ErrorAction SilentlyContinue
if (-not $bun) { throw 'Bun was not found. Run Install.cmd or install Bun, then retry.' }
& $bun.Source run (Join-Path $root 'src\cli.ts') doctor @RemainingArgs
exit $LASTEXITCODE
