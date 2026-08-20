[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateNotNullOrEmpty()]
  [string] $LiteralPath
)

$ErrorActionPreference = 'Stop'
Remove-Item -LiteralPath $LiteralPath -Recurse -Force -ErrorAction Stop
if (Test-Path -LiteralPath $LiteralPath -ErrorAction Stop) {
  throw "Gate workspace still exists after native removal: $LiteralPath"
}
