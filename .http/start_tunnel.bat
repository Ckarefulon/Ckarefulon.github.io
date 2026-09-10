@echo off
REM 一键启动工作区 HTTP 访问脚本（cloudflared 快速隧道）
REM 用法：双击运行，或在 Git Bash 中运行 bash start_tunnel.sh
REM 依赖：C:\Users\Vxiao\.workbuddy\binaries\cloudflared.exe

setlocal

REM 检查 cloudflared 是否存在
if not exist "C:\Users\Vxiao\.workbuddy\binaries\cloudflared.exe" (
    echo 错误：未找到 cloudflared.exe
    echo 请先下载 cloudflared：
    echo   curl -L -o cloudflared-windows-amd64.exe ^
    echo     https://gh-proxy.com/https://github.com/cloudflare/cloudflared/releases/download/2024.12.1/cloudflared-windows-amd64.exe
    pause
    exit /b 1
)

echo ============================================
echo  本机 HTTP 服务器检测...
echo ============================================

REM 检测 9527 端口
set PORT=9527
curl -s -o NUL -w "端口 %PORT%: %%http_code%%" http://localhost:%PORT%/ 2>nul
echo.

echo 请确保本地 HTTP 服务器已在 %PORT% 端口运行
echo （启动命令：python -m http.server %PORT% --bind 0.0.0.0）
echo.

echo ============================================
echo  启动 cloudflared 快速隧道...
echo ============================================
echo.

"C:\Users\Vxiao\.workbuddy\binaries\cloudflared.exe" tunnel --url http://localhost:%PORT%

endlocal
