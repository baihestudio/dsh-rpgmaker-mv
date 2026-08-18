@echo off
setlocal DisableDelayedExpansion
set "ROOT=%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%ROOT%uninstall.ps1" %*
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" (
  echo Uninstall failed with exit code %CODE%.
  pause
)
exit /b %CODE%
