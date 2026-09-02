@echo off
setlocal DisableDelayedExpansion
set "ROOT=%~dp0"
if not "%*"=="" (
  echo Install.cmd does not accept arguments. Run installer.exe install explicitly for maintenance options.
  exit /b 2
)
set "DSH_EXPLORER_LAUNCH=0"
set "DSH_CONTEXT_HELPER=%ROOT%scripts\detect-explorer-launch.ps1"
if exist "%DSH_CONTEXT_HELPER%" if exist "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" (
  "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%DSH_CONTEXT_HELPER%" >nul 2>nul
  if not errorlevel 1 set "DSH_EXPLORER_LAUNCH=1"
)
if not exist "%ROOT%installer.exe" (
  echo installer.exe is missing from this Release.
  if "%DSH_EXPLORER_LAUNCH%"=="1" pause
  exit /b 2
)
pushd "%ROOT%"
"%ROOT%installer.exe" install --release-root "%ROOT%"
set "CODE=%ERRORLEVEL%"
popd
if "%DSH_EXPLORER_LAUNCH%"=="1" (
  pause
) else if not "%CODE%"=="0" (
  echo Installation failed with exit code %CODE%.
)
exit /b %CODE%
