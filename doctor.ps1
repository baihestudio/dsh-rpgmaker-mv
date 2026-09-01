[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $RemainingArgs
)

$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot 'installer.exe'
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
  throw "The Release is incomplete: installer.exe was not found under $PSScriptRoot."
}
& $installer doctor @RemainingArgs
exit $LASTEXITCODE
