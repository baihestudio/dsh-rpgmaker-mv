[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $RemainingArgs
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
& bun run (Join-Path $root 'src/cli.ts') doctor @RemainingArgs
exit $LASTEXITCODE
