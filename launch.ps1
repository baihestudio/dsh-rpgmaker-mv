[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $RemainingArgs
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$installer = Join-Path $root 'installer.exe'
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw 'installer.exe was not found. Repair the Release installation first.' }
& $installer launch @RemainingArgs
exit $LASTEXITCODE
