@echo off
chcp 65001 >nul
title make-index
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make-index.ps1" %*
set "RC=%ERRORLEVEL%"
echo.
if defined MAKE_INDEX_NOPAUSE exit /b %RC%
pause
exit /b %RC%
