# Development-only cleanup for the existing NUC intermediate installation.
# It is intentionally not called by install, launch, or release code.
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-FullPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  return [System.IO.Path]::GetFullPath($Path)
}

function Assert-ChildPath {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$Candidate,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $rootPath = Resolve-FullPath $Root
  $candidatePath = Resolve-FullPath $Candidate
  $prefix = if ($rootPath.EndsWith('\')) { $rootPath } else { "$rootPath\" }
  if ($candidatePath -eq $rootPath -or -not $candidatePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to touch $Label outside the expected app-owned root: $candidatePath"
  }
}

function Assert-NotReparsePoint {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $item = Get-ExistingItem -Path $Path -Label $Label
  if ($null -ne $item -and ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Refusing to touch $Label through a reparse point: $Path"
  }
}

function Get-ExistingItem {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )

  try {
    return Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  } catch {
    if ($_.CategoryInfo.Category -eq [System.Management.Automation.ErrorCategory]::ObjectNotFound) {
      return $null
    }
    throw "Could not inspect $Label at $Path; refusing to continue: $($_.Exception.Message)"
  }
}

function Assert-NoNestedReparsePoints {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $root = Get-ExistingItem -Path $Path -Label $Label
  if ($null -eq $root) {
    return
  }
  if (($root.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Refusing to remove $Label because it is a reparse point: $Path"
  }
  if (-not $root.PSIsContainer) {
    return
  }

  $pending = [System.Collections.Generic.Stack[string]]::new()
  [void]$pending.Push($root.FullName)
  while ($pending.Count -gt 0) {
    $current = $pending.Pop()
    try {
      $children = @(Get-ChildItem -LiteralPath $current -Force -ErrorAction Stop)
    } catch {
      throw "Could not inspect $Label beneath $current; refusing to continue: $($_.Exception.Message)"
    }
    foreach ($child in $children) {
      if (($child.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Refusing to remove $Label through a nested reparse point: $($child.FullName)"
      }
      if ($child.PSIsContainer) {
        [void]$pending.Push($child.FullName)
      }
    }
  }
}

function Remove-GeneratedRoot {
  param(
    [Parameter(Mandatory = $true)][string]$StateRoot,
    [Parameter(Mandatory = $true)][string]$Candidate,
    [Parameter(Mandatory = $true)][string]$Label
  )

  Assert-ChildPath -Root $StateRoot -Candidate $Candidate -Label $Label
  $item = Get-ExistingItem -Path $Candidate -Label $Label
  if ($null -eq $item) {
    Write-Output "$Label already absent: $Candidate"
    return
  }
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Refusing to remove $Label because it is a reparse point: $Candidate"
  }

  Remove-Item -LiteralPath $Candidate -Recurse -Force
  if (Test-Path -LiteralPath $Candidate -PathType Any) {
    throw "$Label still exists after removal: $Candidate"
  }
  Write-Output "Removed ${Label}: $Candidate"
}

if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
  throw 'LOCALAPPDATA is not set; refusing to guess a user state directory.'
}
if (-not [System.IO.Path]::IsPathRooted($env:LOCALAPPDATA)) {
  throw "LOCALAPPDATA must be an absolute path: $($env:LOCALAPPDATA)"
}

try {
  $listeners = @(Get-NetTCPConnection -LocalPort 3081 -State Listen -ErrorAction Stop)
} catch {
  throw "Could not verify whether DSH Web port 3081 is active; refusing to run: $($_.Exception.Message)"
}
if ($listeners.Count -gt 0) {
  $pids = ($listeners | Select-Object -ExpandProperty OwningProcess -Unique) -join ', '
  throw "Refusing to run while DSH Web port 3081 is active (PID(s): $pids). Stop DSH and retry."
}

$localAppData = Resolve-FullPath $env:LOCALAPPDATA
$mutableRoot = Join-Path $localAppData 'BaiheStudio\DSH-RPGMaker-MV'
$dshHome = Join-Path $mutableRoot 'state'
$webProfile = Join-Path $dshHome 'profiles\web'
$visionCache = Join-Path $dshHome 'cache\dsh-vision-toolkit'

Assert-NotReparsePoint -Path $localAppData -Label 'LOCALAPPDATA'
Assert-NotReparsePoint -Path $mutableRoot -Label 'mutable app root'
Assert-NotReparsePoint -Path $dshHome -Label 'DSH_HOME'
Assert-NotReparsePoint -Path (Join-Path $dshHome 'profiles') -Label 'generated profile parent'
Assert-NotReparsePoint -Path (Join-Path $dshHome 'cache') -Label 'generated cache parent'
Assert-ChildPath -Root $mutableRoot -Candidate $dshHome -Label 'DSH_HOME'
Assert-ChildPath -Root $dshHome -Candidate $webProfile -Label 'generated Web profile'
Assert-ChildPath -Root $dshHome -Candidate $visionCache -Label 'Vision cache'

Assert-NoNestedReparsePoints -Path $webProfile -Label 'generated Web profile'
Assert-NoNestedReparsePoints -Path $visionCache -Label 'Vision cache'

Write-Output 'DSH Web port 3081 is not active.'
Write-Output "Resetting only the generated app-owned Web profile and Vision cache under: $dshHome"
Remove-GeneratedRoot -StateRoot $dshHome -Candidate $webProfile -Label 'generated Web profile'
Remove-GeneratedRoot -StateRoot $dshHome -Candidate $visionCache -Label 'Vision cache'
Write-Output 'Reset complete. The next DSH launch will regenerate the Web profile and cache.'
