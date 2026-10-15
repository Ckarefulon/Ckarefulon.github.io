@echo off
rem ============================================================
rem  Local service launcher (CLI entry point).
rem
rem  Keep this file ASCII-only: cmd.exe reads .cmd as ANSI (GBK on
rem  this machine), so UTF-8 Chinese comments would be mangled and
rem  cmd would try to execute the fragments.
rem  User-facing Chinese text lives in .http\cmd.ps1 instead.
rem
rem  Behaviour:
rem    * Double-click (no arguments) -> start the tray and vanish.
rem      Only the outer console flashes; the tray itself is started
rem      detached with no window of its own.
rem    * Run from a terminal with arguments -> execute that command
rem      in this console and print the result here.
rem ============================================================

setlocal
set "SCRIPT=%~dp0.http\cmd.ps1"

rem %~1 is empty when double-clicked; that path must not block.
if "%~1"=="" goto launch_detached

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
set "CODE=%ERRORLEVEL%"
endlocal & exit /b %CODE%

:launch_detached
rem Detached hidden start: the tray process must survive this console
rem (closing a console kills children attached to it), so we hand it
rem to `start` which creates it in its own context, then exit at once.
start "" /b powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%SCRIPT%" start >nul 2>&1
exit /b 0
