$TrayScript = Join-Path $PSScriptRoot 'tray_https.ps1'

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

Start-Process `
    -FilePath $PowerShellExe `
    -ArgumentList $Arguments `
    -WindowStyle Hidden