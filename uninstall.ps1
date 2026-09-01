[CmdletBinding()]
param(
  [switch] $Purge
)

$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot 'installer.exe'
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw 'installer.exe was not found. Repair the Release installation first.' }
$arguments = @('uninstall')
if ($Purge) { $arguments += '--purge' }
& $installer @arguments
exit $LASTEXITCODE
