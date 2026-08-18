[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $SourceRoot,
  [Parameter(Mandatory = $true)] [string] $Destination
)

$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $Destination) {
  throw "Refusing to overwrite existing archive: $Destination"
}
$parent = Split-Path -Parent $Destination
New-Item -ItemType Directory -Force -Path $parent | Out-Null
Compress-Archive -Path (Join-Path $SourceRoot '*') -DestinationPath $Destination -CompressionLevel Optimal
Write-Output $Destination
