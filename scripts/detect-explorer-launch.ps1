[CmdletBinding()]
param(
  # Test seam: production callers omit this and the helper walks the process
  # tree. Supplying a name makes the Explorer/terminal decision deterministic
  # without pretending that a test process was launched by Explorer.
  [string]$ParentProcessName
)

function Get-ProcessRecord([uint32]$ProcessId) {
  try {
    return Get-CimInstance -ClassName Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
  } catch {
    return $null
  }
}

if ($ParentProcessName) {
  if ($ParentProcessName -ieq 'explorer.exe') { exit 0 }
  exit 1
}

# Install.cmd launches this helper from cmd.exe. The first ancestor is that
# cmd.exe; the second is the process that launched the batch file. Explorer is
# the only parent that receives the screen-preservation pause. If process
# inspection is unavailable, fail closed (terminal behavior: no pause).
$self = Get-ProcessRecord $PID
$ancestor = if ($self) { Get-ProcessRecord $self.ParentProcessId } else { $null }
for ($depth = 0; $depth -lt 2 -and $ancestor; $depth += 1) {
  if ($ancestor.Name -ieq 'explorer.exe') { exit 0 }
  $ancestor = Get-ProcessRecord $ancestor.ParentProcessId
}
exit 1
