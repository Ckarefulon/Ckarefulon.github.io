# 启动壳（复刻原 launch_tray.ps1 模式）：拉起隐藏托盘后立即退出
$TrayScript = Join-Path $PSScriptRoot 'launcher.ps1'

$PowerShellExe = Join-Path `
    $env:SystemRoot `
    'System32\WindowsPowerShell\v1.0\powershell.exe'

$Arguments = (
    '-NoProfile ' +
    '-STA ' +
    '-ExecutionPolicy Bypass ' +
    '-WindowStyle Hidden ' +
    '-File "' + $TrayScript + '"'
)

# 可选启动方式参数：http | https | tunnel | ts 及 +ts 组合
$AllowedModes = @(
    'http', 'https', 'tunnel', 'http+tunnel', 'https+tunnel',
    'ts', 'http+ts', 'https+ts', 'tunnel+ts',
    'http+tunnel+ts', 'https+tunnel+ts'
)

if ($args.Count -ge 1 -and ($AllowedModes -contains $args[0])) {
    $Arguments = $Arguments + ' ' + $args[0]
}

Start-Process `
    -FilePath $PowerShellExe `
    -ArgumentList $Arguments `
    -WindowStyle Hidden
