@echo off
setlocal
cd /d "%~dp0"
call "%~dp0scripts\Open-Grafana-Playwright.cmd" %*
endlocal
