[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$TriggerScript,
  [Parameter(Mandatory = $true)]
  [string]$InspectScript,
  [Parameter(Mandatory = $true)]
  [string]$ProjectPath,
  [Parameter(Mandatory = $true)]
  [string]$InputPath,
  [Parameter(Mandatory = $true)]
  [string]$OutputPath,
  [string]$WebUrl = 'http://127.0.0.1:3081/',
  [string]$PwshExecutable = 'pwsh.exe',
  [int]$TimeoutSeconds = 240
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-DshWeb {
  try {
    $response = Invoke-WebRequest -Uri $WebUrl -UseBasicParsing -TimeoutSec 2
    return [int]$response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Wait-DshWeb {
  param([DateTime]$Deadline)
  while ((Get-Date) -lt $Deadline) {
    if (Test-DshWeb) { return }
    Start-Sleep -Milliseconds 250
  }
  throw "DSH Web did not return HTTP 200 before the deadline: $WebUrl"
}

function Start-ImageTrigger {
  param([string]$ScriptPath, [string]$Operation, [string]$Path)
  $arguments = @(
    '-NoLogo', '-NoProfile', '-NonInteractive', '-File', $ScriptPath,
    '-ProjectPath', $ProjectPath,
    '-Operation', $Operation,
    '-InputPath', $InputPath,
    '-OutputPath', $Path
  )
  return Start-Process -FilePath $PwshExecutable -ArgumentList $arguments -PassThru -WindowStyle Hidden
}

$startedAt = Get-Date
$deadline = $startedAt.AddSeconds($TimeoutSeconds)
$trimPad = $null
$inspect = $null
$trimPad = Start-ImageTrigger -ScriptPath $TriggerScript -Operation 'image_trim_pad' -Path $OutputPath
try {
  while (-not $trimPad.HasExited) {
    if (-not (Test-DshWeb)) {
      throw "DSH Web stopped responding while image_trim_pad was running: $WebUrl"
    }
    if ((Get-Date) -ge $deadline) {
      throw "image_trim_pad workflow exceeded the ${TimeoutSeconds}-second deadline"
    }
    Start-Sleep -Milliseconds 250
    $trimPad.Refresh()
  }
  if ($trimPad.ExitCode -ne 0) {
    throw "image_trim_pad trigger failed with exit code $($trimPad.ExitCode)"
  }
  Wait-DshWeb -Deadline $deadline

  $inspect = Start-ImageTrigger -ScriptPath $InspectScript -Operation 'image_inspect' -Path $OutputPath
  while (-not $inspect.HasExited) {
    if (-not (Test-DshWeb)) {
      throw "DSH Web stopped responding while the subsequent image_inspect was running: $WebUrl"
    }
    if ((Get-Date) -ge $deadline) {
      throw "image_inspect workflow exceeded the ${TimeoutSeconds}-second deadline"
    }
    Start-Sleep -Milliseconds 250
    $inspect.Refresh()
  }
  if ($inspect.ExitCode -ne 0) {
    throw "The subsequent image_inspect trigger failed with exit code $($inspect.ExitCode)"
  }
  Wait-DshWeb -Deadline $deadline
  [pscustomobject]@{
    ok = $true
    webUrl = $WebUrl
    trimPadExitCode = $trimPad.ExitCode
    inspectExitCode = $inspect.ExitCode
    elapsedMs = [int]((Get-Date) - $startedAt).TotalMilliseconds
    inputPath = $InputPath
    outputPath = $OutputPath
  } | ConvertTo-Json -Compress
} finally {
  if ($trimPad -and -not $trimPad.HasExited) { Stop-Process -Id $trimPad.Id -Force -ErrorAction SilentlyContinue }
  if ($inspect -and -not $inspect.HasExited) { Stop-Process -Id $inspect.Id -Force -ErrorAction SilentlyContinue }
}
