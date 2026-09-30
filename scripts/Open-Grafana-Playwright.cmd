@echo off
setlocal
cd /d "%~dp0.."
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Open-Grafana-Playwright.ps1" %*
set "launcherExitCode=%errorlevel%"
if not "%launcherExitCode%"=="0" pause
endlocal & exit /b %launcherExitCode%
