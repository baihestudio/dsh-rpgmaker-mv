@echo off
setlocal
set "ROOT=%~dp0"
set "DSH_RPGMAKER_PROGRAM_ROOT=%ROOT:~0,-1%"
set "DSH_RPGMAKER_DATA_ROOT=%LOCALAPPDATA%\BaiheStudio\DSH-RPGMaker-MV"
set "DSH_HOME=%DSH_RPGMAKER_DATA_ROOT%\state"
set "DSH_RPGMAKER_RUNTIME=%DSH_RPGMAKER_PROGRAM_ROOT%\runtime\dsh"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%ROOT%launch.ps1" %*
exit /b %ERRORLEVEL%
