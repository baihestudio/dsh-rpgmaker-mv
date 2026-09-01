@echo off
setlocal DisableDelayedExpansion
set "ROOT=%~dp0"
if not exist "%ROOT%installer.exe" (
  echo installer.exe is missing from this installation.
  exit /b 2
)
"%ROOT%installer.exe" uninstall %*
exit /b %ERRORLEVEL%
