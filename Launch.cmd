@echo off
setlocal DisableDelayedExpansion
set "ROOT=%~dp0"
rem Root and runtime defaults are derived by launch.ps1 (which also respects
rem pre-set environment variables and reads install.json), so a non-default
rem install launches against its own mutable state.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%ROOT%launch.ps1" %*
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" (
  echo Launch failed with exit code %CODE%.
  pause
)
exit /b %CODE%
