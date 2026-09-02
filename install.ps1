[CmdletBinding()]
param(
  [switch] $NonInteractive,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $RemainingArgs
)

$ErrorActionPreference = 'Stop'
if ($null -ne $RemainingArgs -and $RemainingArgs.Count -gt 0) {
  throw 'install.ps1 does not accept arguments. Run installer.exe install explicitly for maintenance options.'
}
$installer = Join-Path $PSScriptRoot 'installer.exe'
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
  throw "The Release is incomplete: installer.exe was not found under $PSScriptRoot."
}
$arguments = @('install', '--release-root', $PSScriptRoot)
if ($NonInteractive) { $arguments += '--non-interactive' }
& $installer @arguments
exit $LASTEXITCODE
