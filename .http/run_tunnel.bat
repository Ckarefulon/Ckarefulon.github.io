@echo off
REM Start HTTP server and ngrok tunnel
REM Usage: run_tunnel.bat [port]

set PORT=%~1
if "%PORT%"=="" set PORT=8000

echo ========================================
echo  Local HTTP Server + Public Tunnel
echo ========================================
echo.
echo  Local:  http://localhost:%PORT%
echo.

REM Start Python HTTP server in background
start /B python -m http.server %PORT% --bind 0.0.0.0

REM Wait for server to start
timeout /t 2 /nobreak >nul

REM Check if ngrok is available
where ngrok >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [INFO] ngrok not found in PATH.
    echo.
    echo  Option 1 - Download ngrok (recommended, 2 min setup):
    echo    1. Go to https://ngrok.com/signup
    echo    2. Get auth token from https://dashboard.ngrok.com/get-started/your-authtoken
    echo    3. Download from https://ngrok.com/download
    echo    4. Place ngrok.exe in this folder or add to PATH
    echo    5. Run: ngrok http %PORT%
    echo.
    echo  Option 2 - Use the Python tunnel script:
    echo    python tunnel.py %PORT%
    echo.
    echo  Option 3 - Quick ngrok one-liner (if you have Python + requests):
    echo    python -c "import webbrowser; webbrowser.open('https://ngrok.com/download')"
    echo.
    echo  Your public IP:
    python -c "import urllib.request; print('  ' + urllib.request.urlopen('https://api.ipify.org', timeout=5).read().decode())" 2>nul
    echo.
    echo  HTTP server is running at: http://localhost:%PORT%
    echo  Press any key to stop the HTTP server...
    pause >nul
    taskkill /F /IM python.exe /FI "WINDOWTITLE eq*http.server*" 2>nul
    exit /b
)

REM ngrok is available - start tunnel
echo [INFO] Starting ngrok tunnel...
echo.
ngrok http %PORT%
echo.
echo Tunnel stopped.
pause
