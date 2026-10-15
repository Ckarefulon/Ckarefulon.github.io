# 本地服务引擎：HTTP / HTTPS 底座（互斥，共用端口）+ 公网隧道 / Tailscale（独立开关、可叠加）
# 不依赖 WinForms，可被托盘 launcher.ps1 或测试脚本 dot-source。
#
# 用法：
#   . (Join-Path $PSScriptRoot 'service.ps1')
#   Initialize-SvcEngine -RootDir <站点根> -Notify { param($t, $x, $i) ... }
#   Set-SvcBase 'http' | Set-SvcBase 'https' | Clear-SvcBase
#   Set-SvcTunnel $true | Set-SvcTunnel $false
#   (Get-SvcState)  -> 状态对象（含菜单勾选态）
#
# 设计要点（2026-09-22 修）：
#   * 隧道回源固定用 127.0.0.1 而不是 localhost：python --bind 0.0.0.0 只监听 IPv4，
#     而 localhost 可能优先解析到 ::1，cloudflared 回源打到 ::1 就会 502。
#   * 隧道方案跟随底座：底座 HTTPS 时回源 https 并加 --no-tls-verify，
#     否则 cloudflared 拿明文请求打 TLS 端口 -> 502。
#   * 启隧道前先等底座端口真正可连，避免 cloudflared 抢跑造成启动初期 502。
#   * 启 HTTPS 前做证书自检（SAN 覆盖当前 LAN IP + http.sys 绑定指纹与记录一致），
#     不满足就以管理员跑一次 setup_https.ps1 重签重绑 —— 这是「HTTPS 老出问题」的根因。
#   * Tailscale 是「连接开关」不是进程托管：勾选 = 探测 BackendState，Stopped 就 tailscale up 连回、
#     NeedsLogin / 服务没跑就拉起官方 GUI（单实例）；取消 = tailscale serve --https=<端口> off
#     （只撤本程序自己的映射，绝不全量 serve reset —— 443 等端口留给用户手动配的服务）+ tailscale down。
#     连上后再用 tailscale serve --bg --https=<外部端口> 把本端口反代到
#     https://<机器名>.<tailnet>.ts.net:<外部端口>（证书自动签发，首次签发需约半分钟，之后秒开）；
#     HTTPS 底座时上游用 https+insecure://127.0.0.1:端口。
#     探测走 status --json（Task 异步读输出 + WaitForExit 带超时，daemon 卡死也拖不死托盘线程），
#     tick 里最多 5 秒真实探一次，避免每 2 秒起一个 tailscale.exe。

$ErrorActionPreference = 'Stop'

# ---------- 配置 ----------

$script:SvcPort        = 9527
$script:SvcVersion     = '1.0.0'
$script:SvcRoot        = ''
$script:SvcHttpsScript = ''
$script:SvcSetupScript = ''
$script:SvcCloudflared = ''
$script:SvcPython      = ''
$script:SvcLogPrefix   = 'careful_service_'
$script:SvcTunnelHost  = '127.0.0.1'
$script:SvcTailscale   = ''       # tailscale.exe 路径（空 = 未启用 Tailscale 功能）

# ---------- 状态 ----------

$script:SvcBase              = ''       # '' | 'http' | 'https'
$script:SvcTunnelOn          = $false
$script:SvcBaseProc          = $null
$script:SvcTunnelProc        = $null
$script:SvcExternalBase      = $false   # 9527 被外部程序占用（非本引擎启动）
$script:SvcExternalHttps     = $false   # 外部服务本身就是 HTTPS
$script:SvcHttpsReady        = $false
$script:SvcHttpsSpawnAt      = $null
$script:SvcHttpsFailReported = $false
$script:SvcTunnelUrl         = $null
$script:SvcTunnelProbed      = $false

# Tailscale（连接开关的内部态）
$script:SvcTailscaleOn        = $false
$script:SvcTailscaleState     = ''      # BackendState：Running / Stopped / NeedsLogin / NoState / DaemonDown
$script:SvcTailscaleIp        = $null   # 本机 tailnet IPv4（100.x）
$script:SvcTailscaleProbeAt   = $null   # 上次真实探测时间（节流 5 秒）
$script:SvcTailscaleWarned    = $false  # 异常气泡只报一次，恢复后清零
$script:SvcTailscaleGuiAt     = $null   # 上次拉起 GUI 的时间（节流 30 秒）
$script:SvcTailscaleReadySeen = $false  # 本次开启后是否就绪过（首次就绪只报一次）
$script:SvcTailscaleServeUrl  = $null   # https://<机器名>.<tailnet>.ts.net:<外部端口>（serve 反代地址，就绪口径）
$script:SvcTailscaleServeBase = ''      # 设置 serve 时的底座类型，底座切换后需重设上游

# ---------- 内部工具 ----------

function Get-SvcLogPath {
    param(
        [string]$Name
    )

    return (Join-Path $env:TEMP ($script:SvcLogPrefix + $Name + '.log'))
}

function Invoke-SvcNotify {
    # 按名字调用宿主的 Show-SvcBalloon（托盘里定义）。
    # 刻意不走 ScriptBlock 参数：从 WinForms 计时器的事件回调里 & 一个 ScriptBlock，
    # 一旦该线程没有可用的 Runspace 就会以 ScriptBlock.GetContextFromTLS 崩溃整个进程。
    param(
        [string]$Title,
        [string]$Text,
        [string]$Icon = 'Info'
    )

    if (-not (Get-Command 'Show-SvcBalloon' -ErrorAction SilentlyContinue)) {
        return
    }

    try {
        Show-SvcBalloon -Title $Title -Text $Text -IconName $Icon
    }
    catch {
    }
}

function Start-SvcQuietProcess {
    # 统一用 ProcessStartInfo 起子进程。
    #
    # 不用 Start-Process：当当前进程存在大小写重名的环境变量（Path / PATH）时，
    # Start-Process 只要带 -RedirectStandardOutput/-RedirectStandardError 就会抛
    # “已添加项。字典中的关键字:"Path"所添加的关键字:"PATH"”，子进程根本起不来。
    #
    # 这里也不做异步日志泵：PowerShell 的 ScriptBlock 事件回调要等当前管道结束才会被处理，
    # 所以 BeginOutputReadLine 在同步脚本里永远落不了盘（实测日志文件一直为空）。
    # 需要日志就让子进程自己写（cloudflared 用 --logfile）；
    # 需要 stderr 就在子进程退出后用 ReadToEnd() 同步取（见 Get-SvcHttpsErrorText）。
    param(
        [string]$FilePath,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory = '',
        [switch]$CaptureStdErr
    )

    $Info = New-Object System.Diagnostics.ProcessStartInfo
    $Info.FileName = $FilePath
    $Info.UseShellExecute = $false
    $Info.CreateNoWindow = $true

    $Info.Arguments = (
        ($Arguments | ForEach-Object {
            '"' + ([string]$_ -replace '"', '\"') + '"'
        }) -join ' '
    )

    if ($WorkingDirectory) {
        $Info.WorkingDirectory = $WorkingDirectory
    }

    if ($CaptureStdErr) {
        $Info.RedirectStandardError = $true
    }

    $Process = New-Object System.Diagnostics.Process
    $Process.StartInfo = $Info

    if (-not $Process.Start()) {
        throw ('无法启动进程：' + $FilePath)
    }

    return $Process
}

function Test-SvcProcAlive {
    param(
        $Process
    )

    if (-not $Process) {
        return $false
    }

    try {
        return (-not $Process.HasExited)
    }
    catch {
        return $false
    }
}

function Stop-SvcProc {
    param(
        $Process
    )

    if (-not $Process) {
        return
    }

    try {
        if (Test-SvcProcAlive $Process) {
            Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
        }
    }
    catch {
    }

    try { $Process.Dispose() } catch {}
}

function Test-SvcTcp {
    param(
        [int]$TargetPort,
        [int]$TimeoutMs = 350
    )

    $Client = New-Object System.Net.Sockets.TcpClient

    try {
        $AsyncResult = $Client.BeginConnect('127.0.0.1', $TargetPort, $null, $null)
        if ($AsyncResult.AsyncWaitHandle.WaitOne($TimeoutMs)) {
            $Client.EndConnect($AsyncResult)
            return $true
        }
        return $false
    }
    catch {
        return $false
    }
    finally {
        try { $Client.Close() } catch {}
    }
}

function Test-SvcPortInUse {
    return (Test-SvcTcp -TargetPort $script:SvcPort)
}

function Test-SvcHttpsTls {
    # 对端口做一次 TLS 握手：成功 = 该端口在跑 HTTPS
    $Client = New-Object System.Net.Sockets.TcpClient

    try {
        $AsyncResult = $Client.BeginConnect('127.0.0.1', $script:SvcPort, $null, $null)
        if (-not $AsyncResult.AsyncWaitHandle.WaitOne(400)) {
            return $false
        }

        $Client.EndConnect($AsyncResult)

        $Stream = New-Object System.Net.Security.SslStream(
            $Client.GetStream(),
            $false,
            { $true }
        )

        try {
            $Stream.AuthenticateAsClient('localhost')
            return $true
        }
        finally {
            try { $Stream.Dispose() } catch {}
        }
    }
    catch {
        return $false
    }
    finally {
        try { $Client.Close() } catch {}
    }
}

function Wait-SvcPortUp {
    param(
        [int]$TimeoutMs = 4000
    )

    $Deadline = (Get-Date).AddMilliseconds($TimeoutMs)

    while ((Get-Date) -lt $Deadline) {
        if (Test-SvcPortInUse) {
            return $true
        }
        Start-Sleep -Milliseconds 150
    }

    return $false
}

function Wait-SvcPortFree {
    param(
        [int]$TimeoutMs = 2500
    )

    $Deadline = (Get-Date).AddMilliseconds($TimeoutMs)

    while ((Get-Date) -lt $Deadline) {
        if (-not (Test-SvcPortInUse)) {
            return $true
        }
        Start-Sleep -Milliseconds 150
    }

    return $false
}

function Get-SvcTunnelLogText {
    # cloudflared 用 --logfile 自己写日志（JSON 行），不需要父进程做日志泵
    try {
        return (Get-Content -LiteralPath (Get-SvcLogPath 'tunnel') -Raw -ErrorAction SilentlyContinue)
    }
    catch {
        return ''
    }
}

function Get-SvcHttpsErrorText {
    # 子进程退出后同步读 stderr：此时管道已关闭，ReadToEnd 不会阻塞
    $Process = $script:SvcBaseProc

    if (-not $Process) {
        return ''
    }

    try {
        if (-not $Process.HasExited) {
            return ''
        }

        return $Process.StandardError.ReadToEnd()
    }
    catch {
        return ''
    }
}

function Format-SvcLogDetail {
    param(
        [string]$Text,
        [int]$Max = 150
    )

    if (-not $Text) {
        return ''
    }

    $Flat = ($Text -replace '\s+', ' ').Trim()
    if ($Flat.Length -gt $Max) {
        $Flat = $Flat.Substring(0, $Max) + '…'
    }

    return $Flat
}

# ---------- 初始化 ----------

function Initialize-SvcEngine {
    param(
        [int]$Port = 9527,
        [string]$RootDir,
        [string]$HttpsScript,
        [string]$SetupScript,
        [string]$Cloudflared,
        [string]$PythonPath = '',
        [string]$LogPrefix = 'careful_service_',
        [string]$TunnelHost = '127.0.0.1',
        [string]$Tailscale = ''
    )

    $script:SvcPort = $Port
    $script:SvcRoot = $RootDir
    $script:SvcHttpsScript = $HttpsScript
    $script:SvcSetupScript = $SetupScript
    $script:SvcCloudflared = $Cloudflared
    $script:SvcPython = $PythonPath
    $script:SvcLogPrefix = $LogPrefix
    $script:SvcTunnelHost = $TunnelHost
    $script:SvcTailscale = $Tailscale
}

function Resolve-SvcPython {
    if ($script:SvcPython -and (Test-Path -LiteralPath $script:SvcPython -PathType Leaf)) {
        return $script:SvcPython
    }

    $Command = Get-Command 'python.exe' -ErrorAction SilentlyContinue
    if ($Command -and $Command.Source) {
        $script:SvcPython = $Command.Source
        return $script:SvcPython
    }

    $Fallback = 'C:\Users\Vxiao\.workbuddy\binaries\python\versions\3.13.12\python.exe'
    if (Test-Path -LiteralPath $Fallback -PathType Leaf) {
        $script:SvcPython = $Fallback
        return $script:SvcPython
    }

    return ''
}

# ---------- 证书自检（HTTPS 起不来的根因就在这里）----------

function Get-SvcBoundCertHash {
    # http.sys 实际绑在端口上的证书指纹（小写十六进制）
    $Key = 'HKLM:\SYSTEM\CurrentControlSet\Services\HTTP\Parameters\SslBindingInfo\0.0.0.0:' +
        [string]$script:SvcPort

    try {
        $Value = Get-ItemProperty -Path $Key -ErrorAction Stop
        if ($Value.SslCertHash) {
            return (($Value.SslCertHash | ForEach-Object { $_.ToString('x2') }) -join '')
        }
    }
    catch {
    }

    return ''
}

function Test-SvcCertificateReady {
    param(
        [string]$ExpectedIp
    )

    if (-not (Test-Path -LiteralPath $script:SvcSetupScript -PathType Leaf)) {
        return $false
    }

    if (-not (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $script:SvcSetupScript) 'certificate-info.json') -PathType Leaf)) {
        return $false
    }

    try {
        $Info = Get-Content (Join-Path (Split-Path -Parent $script:SvcSetupScript) 'certificate-info.json') |
            ConvertFrom-Json

        if (-not $Info.ServerThumbprint -or -not $Info.RootThumbprint) {
            return $false
        }

        $ServerCert = Get-Item -LiteralPath ('Cert:\LocalMachine\My\' + $Info.ServerThumbprint) -ErrorAction Stop

        $TrustedRoot = Get-Item -LiteralPath ('Cert:\LocalMachine\Root\' + $Info.RootThumbprint) -ErrorAction Stop

        $San = $ServerCert.Extensions |
            Where-Object { $_.Oid.Value -eq '2.5.29.17' } |
            Select-Object -First 1

        if (-not $TrustedRoot -or -not $ServerCert.HasPrivateKey) {
            return $false
        }

        if ($ServerCert.NotAfter -le (Get-Date).AddDays(1)) {
            return $false
        }

        if (-not $San -or -not $San.Format($false).Contains($ExpectedIp)) {
            return $false
        }

        # 记录里的证书必须就是 http.sys 实际绑定的那张。
        # 换 IP 重签之后如果没重绑，HttpListener.Start() 会直接失败。
        $Bound = Get-SvcBoundCertHash
        if ($Bound -and ($Bound -ne $ServerCert.Thumbprint.ToLowerInvariant())) {
            return $false
        }

        return $true
    }
    catch {
        return $false
    }
}

function Sync-SvcCertificate {
    # 以管理员重跑 setup_https.ps1：重签服务器证书（SAN 含当前 IP）+ 重绑 http.sys + 保 urlacl
    if (-not (Test-Path -LiteralPath $script:SvcSetupScript -PathType Leaf)) {
        return $false
    }

    try {
        $PowerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

        $Process = Start-Process -FilePath $PowerShellExe `
            -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$($script:SvcSetupScript)`"" `
            -Verb RunAs `
            -Wait `
            -PassThru `
            -WindowStyle Hidden

        if ($Process -and $Process.ExitCode -eq 0) {
            # http.sys 的绑定信息落注册表有一点点延迟，重试几次再定论
            for ($Attempt = 0; $Attempt -lt 6; $Attempt++) {
                if (Test-SvcCertificateReady -ExpectedIp (Get-PreferredLanIp)) {
                    return $true
                }
                Start-Sleep -Milliseconds 400
            }
        }
    }
    catch {
    }

    return $false
}

# ---------- 底座（HTTP / HTTPS，互斥）----------

function Start-SvcHttpBase {
    if (Test-SvcPortInUse) {
        # 端口已被占用：接管状态，但不抢占别人的进程
        $script:SvcExternalBase = $true

        if (Test-SvcHttpsTls) {
            # 占端口的是 HTTPS：隧道回源必须跟着走 TLS，否则 502
            $script:SvcExternalHttps = $true
        }

        return $true
    }

    $script:SvcExternalBase = $false
    $script:SvcExternalHttps = $false

    $Python = Resolve-SvcPython
    if (-not $Python) {
        Invoke-SvcNotify '启动失败' '未找到 python，无法启动 HTTP 服务' 'Error'
        return $false
    }

    try {
        $script:SvcBaseProc = Start-SvcQuietProcess `
            -FilePath $Python `
            -Arguments @('-m', 'http.server', [string]$script:SvcPort, '--bind', '0.0.0.0') `
            -WorkingDirectory $script:SvcRoot
    }
    catch {
        Invoke-SvcNotify '启动失败' ('HTTP 服务启动异常：' + $_.Exception.Message) 'Error'
        return $false
    }

    if (-not (Wait-SvcPortUp 4000)) {
        Invoke-SvcNotify '启动失败' "HTTP 服务未能在 $($script:SvcPort) 端口就绪" 'Error'
        return $false
    }

    return $true
}

function Start-SvcHttpsBase {
    if (Test-SvcHttpsTls) {
        $script:SvcExternalBase = $true
        $script:SvcExternalHttps = $true
        $script:SvcHttpsReady = $true
        return $true
    }

    if (Test-SvcPortInUse) {
        # TCP 通但不是 TLS：端口被明文 HTTP 占着
        Invoke-SvcNotify '无法启动 HTTPS' (
            "$($script:SvcPort) 已被明文 HTTP 占用，请先停止占用程序再切换" ) 'Error'
        return $false
    }

    if (-not (Test-Path -LiteralPath $script:SvcHttpsScript -PathType Leaf)) {
        Invoke-SvcNotify '启动失败' '缺少 start_https.ps1' 'Error'
        return $false
    }

    # 证书自检：SAN 要覆盖当前 LAN IP，且 http.sys 绑定指纹要和记录一致
    if (-not (Test-SvcCertificateReady -ExpectedIp (Get-PreferredLanIp))) {
        if (-not (Sync-SvcCertificate)) {
            Invoke-SvcNotify 'HTTPS 证书需要刷新' (
                '证书未覆盖当前局域网地址，刷新需要管理员授权（已取消或失败）' ) 'Error'
            return $false
        }
    }

    $script:SvcHttpsReady = $false
    $script:SvcHttpsFailReported = $false

    try {
        $PowerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

        $script:SvcBaseProc = Start-SvcQuietProcess `
            -FilePath $PowerShellExe `
            -Arguments @(
                '-NoProfile',
                '-ExecutionPolicy',
                'Bypass',
                '-WindowStyle',
                'Hidden',
                '-File',
                $script:SvcHttpsScript
            ) `
            -CaptureStdErr

        $script:SvcHttpsSpawnAt = Get-Date
    }
    catch {
        Invoke-SvcNotify '启动失败' ('HTTPS 服务启动异常：' + $_.Exception.Message) 'Error'
        return $false
    }

    # TLS 就绪探测（HttpListener 起得比较慢，给足时间）
    $Deadline = (Get-Date).AddSeconds(8)
    while ((Get-Date) -lt $Deadline) {
        if (Test-SvcHttpsTls) {
            $script:SvcHttpsReady = $true
            return $true
        }

        if (-not (Test-SvcProcAlive $script:SvcBaseProc)) {
            break
        }

        Start-Sleep -Milliseconds 250
    }

    if ($script:SvcHttpsReady) {
        return $true
    }

    $Detail = Format-SvcLogDetail (Get-SvcHttpsErrorText)
    Invoke-SvcNotify 'HTTPS 启动失败' (
        '请检查证书配置（管理员运行 .http/setup_https.ps1） ' + $Detail) 'Error'

    $script:SvcHttpsFailReported = $true
    return $false
}

function Stop-SvcBaseProcess {
    Stop-SvcProc $script:SvcBaseProc

    $script:SvcBaseProc = $null
    $script:SvcExternalBase = $false
    $script:SvcExternalHttps = $false
    $script:SvcHttpsReady = $false
    $script:SvcHttpsSpawnAt = $null
    $script:SvcHttpsFailReported = $false

    [void](Wait-SvcPortFree 2500)
}

function Start-SvcBase {
    param(
        [ValidateSet('http', 'https')]
        [string]$Kind
    )

    if ($Kind -eq 'https') {
        return (Start-SvcHttpsBase)
    }

    return (Start-SvcHttpBase)
}

function Set-SvcBase {
    # 切换底座（点 HTTP / HTTPS 菜单项）。失败时回滚到原底座，不留下"勾了却没跑"的矛盾态。
    param(
        [ValidateSet('http', 'https')]
        [string]$Kind
    )

    if ($script:SvcBase -eq $Kind) {
        return
    }

    $Previous = $script:SvcBase
    $KeepTunnel = $script:SvcTunnelOn

    Stop-SvcBaseProcess
    $script:SvcBase = ''

    if (Start-SvcBase -Kind $Kind) {
        $script:SvcBase = $Kind
    }
    elseif ($Previous) {
        # 回滚
        if (Start-SvcBase -Kind $Previous) {
            $script:SvcBase = $Previous
        }
        else {
            $script:SvcTunnelOn = $false
        }
    }

    if ($KeepTunnel -and $script:SvcBase) {
        $script:SvcTunnelOn = $true
    }

    Sync-SvcTunnel
}

function Clear-SvcBase {
    # 取消底座勾选 = 全部停止（隧道失去底座没有意义）
    $WasExternal = (
        ($script:SvcBase -eq 'http' -and $script:SvcExternalBase) -or
        ($script:SvcBase -eq 'https' -and $script:SvcExternalHttps)
    )

    $script:SvcTunnelOn = $false
    Stop-SvcTunnelProcess
    Stop-SvcBaseProcess
    $script:SvcBase = ''

    if ($WasExternal) {
        Invoke-SvcNotify '已停止' (
            "已停止接管，$($script:SvcPort) 上的外部服务仍在运行，未被关闭" ) 'Info'
    }
}

function Stop-SvcAll {
    Clear-SvcBase
}

# ---------- 公网隧道（叠加在底座上）----------

function Get-SvcTunnelArguments {
    # 回源固定 127.0.0.1：避免 localhost 解析到 ::1 而底座只听 IPv4 造成 502。
    # --logfile 让 cloudflared 自己写日志（父进程不做日志泵，ScriptBlock 回调不可靠），
    # 隧道地址就从这份日志里解析出来。
    $TunnelUrl = "http://$($script:SvcTunnelHost):$($script:SvcPort)"
    if ($script:SvcBase -eq 'https') {
        $TunnelUrl = "https://$($script:SvcTunnelHost):$($script:SvcPort)"
    }

    $Arguments = @(
        'tunnel',
        '--url',
        $TunnelUrl,
        '--logfile',
        (Get-SvcLogPath 'tunnel')
    )

    if ($script:SvcBase -eq 'https') {
        # 回源是自签名证书，必须跳过校验
        $Arguments += '--no-tls-verify'
    }

    return $Arguments
}

function Start-SvcTunnelProcess {
    if (-not (Test-Path -LiteralPath $script:SvcCloudflared -PathType Leaf)) {
        Invoke-SvcNotify '启动失败' '未找到 cloudflared.exe' 'Error'
        return $false
    }

    if (-not $script:SvcBase) {
        Invoke-SvcNotify '启动失败' '公网隧道需要先启动 HTTP 或 HTTPS 服务' 'Error'
        return $false
    }

    # 等底座端口真正可连：cloudflared 抢跑会造成启动初期 502
    if (-not (Wait-SvcPortUp 5000)) {
        Invoke-SvcNotify '隧道启动失败' "底座在 $($script:SvcPort) 端口未就绪，未启动隧道" 'Error'
        return $false
    }

    try {
        Remove-Item -LiteralPath (Get-SvcLogPath 'tunnel') -Force -ErrorAction SilentlyContinue

        $script:SvcTunnelProc = Start-SvcQuietProcess `
            -FilePath $script:SvcCloudflared `
            -Arguments (Get-SvcTunnelArguments)

        $script:SvcTunnelUrl = $null
        $script:SvcTunnelProbed = $false
        return $true
    }
    catch {
        Invoke-SvcNotify '启动失败' ('隧道启动异常：' + $_.Exception.Message) 'Error'
        return $false
    }
}

function Stop-SvcTunnelProcess {
    Stop-SvcProc $script:SvcTunnelProc

    $script:SvcTunnelProc = $null
    $script:SvcTunnelUrl = $null
    $script:SvcTunnelProbed = $false

    Remove-Item -LiteralPath (Get-SvcLogPath 'tunnel') -Force -ErrorAction SilentlyContinue
}

function Sync-SvcTunnel {
    # 按「隧道开关 + 当前底座」对齐隧道进程
    if (-not $script:SvcTunnelOn) {
        Stop-SvcTunnelProcess
        return
    }

    if (-not $script:SvcBase) {
        $script:SvcTunnelOn = $false
        Stop-SvcTunnelProcess
        return
    }

    Stop-SvcTunnelProcess

    if (-not (Start-SvcTunnelProcess)) {
        # 起不来就回退勾选态，别让菜单卡在"启动中"
        $script:SvcTunnelOn = $false
        Stop-SvcTunnelProcess
    }
}

function Set-SvcTunnel {
    param(
        [bool]$On
    )

    if ($On) {
        # 隧道不能独立存在：没有底座就补一个默认 HTTP 底座
        if (-not $script:SvcBase) {
            Set-SvcBase 'http'
        }

        if (-not $script:SvcBase) {
            return
        }

        $script:SvcTunnelOn = $true
        Sync-SvcTunnel
        return
    }

    $script:SvcTunnelOn = $false
    Stop-SvcTunnelProcess
}

# ---------- Tailscale（独立开关：管理本机 tailnet 连接）----------

function Get-SvcTailscaleInfo {
    # 只读探测：status --json -> BackendState + Self.TailscaleIPs[0]。
    # daemon 不可达 / 解析失败一律返回 $null（上层按 DaemonDown 处理）。
    # 输出用 Task 异步读，WaitForExit 带超时：daemon 卡死也不会把托盘线程一起拖死。
    if (-not (Test-Path -LiteralPath $script:SvcTailscale -PathType Leaf)) {
        return $null
    }

    try {
        $Info = New-Object System.Diagnostics.ProcessStartInfo
        $Info.FileName = $script:SvcTailscale
        $Info.Arguments = 'status --json'
        $Info.UseShellExecute = $false
        $Info.CreateNoWindow = $true
        $Info.RedirectStandardOutput = $true
        $Info.RedirectStandardError = $true

        $Process = New-Object System.Diagnostics.Process
        $Process.StartInfo = $Info

        if (-not $Process.Start()) {
            return $null
        }

        $OutTask = $Process.StandardOutput.ReadToEndAsync()
        $ErrTask = $Process.StandardError.ReadToEndAsync()

        if (-not $Process.WaitForExit(8000)) {
            try { Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue } catch {}
            try { $Process.Dispose() } catch {}
            return $null
        }

        $Output = ''
        try { $Output = $OutTask.Result } catch {}
        try { [void]$ErrTask.Result } catch {}
        $Process.Dispose()

        $Json = $Output | ConvertFrom-Json
        $Ip = $null
        if ($Json.Self -and $Json.Self.TailscaleIPs -and @($Json.Self.TailscaleIPs).Count -gt 0) {
            $Ip = [string]@($Json.Self.TailscaleIPs)[0]
        }

        return [PSCustomObject]@{
            Reachable = $true
            State     = [string]$Json.BackendState
            Ip        = $Ip
        }
    }
    catch {
        return $null
    }
}

function Invoke-SvcTailscaleCli {
    # 同步跑一条 tailscale CLI 命令（up / down），返回退出码是否为 0。
    # CLI 走本地命名管道 API，无需管理员。
    param(
        [string[]]$CliArguments,
        [int]$TimeoutMs = 15000
    )

    if (-not (Test-Path -LiteralPath $script:SvcTailscale -PathType Leaf)) {
        return $false
    }

    try {
        $Info = New-Object System.Diagnostics.ProcessStartInfo
        $Info.FileName = $script:SvcTailscale
        $Info.Arguments = ($CliArguments -join ' ')
        $Info.UseShellExecute = $false
        $Info.CreateNoWindow = $true
        $Info.RedirectStandardOutput = $true
        $Info.RedirectStandardError = $true

        $Process = New-Object System.Diagnostics.Process
        $Process.StartInfo = $Info

        if (-not $Process.Start()) {
            return $false
        }

        $OutTask = $Process.StandardOutput.ReadToEndAsync()
        $ErrTask = $Process.StandardError.ReadToEndAsync()

        if (-not $Process.WaitForExit($TimeoutMs)) {
            try { Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue } catch {}
            try { $Process.Dispose() } catch {}
            return $false
        }

        try { [void]$OutTask.Result } catch {}
        try { [void]$ErrTask.Result } catch {}
        $Code = $Process.ExitCode
        $Process.Dispose()

        return ($Code -eq 0)
    }
    catch {
        return $false
    }
}

function Start-SvcTailscaleGui {
    # 拉起官方 GUI（tailscale-ipn.exe，单实例）：需要登录 / 服务未装时由它处理（必要时自带 UAC）
    if (-not (Test-Path -LiteralPath $script:SvcTailscale -PathType Leaf)) {
        return
    }

    try {
        $Gui = Join-Path (Split-Path -Parent $script:SvcTailscale) 'tailscale-ipn.exe'
        if (Test-Path -LiteralPath $Gui -PathType Leaf) {
            [void](Start-SvcQuietProcess -FilePath $Gui)
        }
    }
    catch {
    }
}

function Start-SvcTailscaleGuiThrottled {
    # GUI 拉起节流（30 秒），避免探测循环里反复 spawn
    $NeedGui = (
        (-not $script:SvcTailscaleGuiAt) -or
        (((Get-Date) - $script:SvcTailscaleGuiAt).TotalMilliseconds -gt 30000)
    )

    if ($NeedGui) {
        $script:SvcTailscaleGuiAt = Get-Date
        Start-SvcTailscaleGui
    }
}

function Get-SvcTailscaleUrl {
    return $script:SvcTailscaleServeUrl
}

function Get-SvcTailscaleServeStatusText {
    # serve status --json 的原始输出（daemon 不可达时返回 ''）
    if (-not (Test-Path -LiteralPath $script:SvcTailscale -PathType Leaf)) {
        return ''
    }

    try {
        $Info = New-Object System.Diagnostics.ProcessStartInfo
        $Info.FileName = $script:SvcTailscale
        $Info.Arguments = 'serve status --json'
        $Info.UseShellExecute = $false
        $Info.CreateNoWindow = $true
        $Info.RedirectStandardOutput = $true
        $Info.RedirectStandardError = $true

        $Process = New-Object System.Diagnostics.Process
        $Process.StartInfo = $Info

        if (-not $Process.Start()) {
            return ''
        }

        $OutTask = $Process.StandardOutput.ReadToEndAsync()
        $ErrTask = $Process.StandardError.ReadToEndAsync()

        if (-not $Process.WaitForExit(8000)) {
            try { Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue } catch {}
            try { $Process.Dispose() } catch {}
            return ''
        }

        $Output = ''
        try { $Output = $OutTask.Result } catch {}
        try { [void]$ErrTask.Result } catch {}
        $Process.Dispose()

        return ([string]$Output)
    }
    catch {
        return ''
    }
}

function Find-SvcTailscaleServeUrl {
    # 从 serve status --json 解析本节点的 ts.net 反代地址。
    # ⚠️ JSON 里没有 https:// 字样：域名只出现在键名 "机器名.ts.net:<外部端口>" 里；
    #    明文 https:// 形式只在非 JSON 的 status 输出里，两种都兼容。
    # 匹配键必须带本服务的外部端口（= SvcPort），防止把 443 上别人手动配的服务认领成自己的。
    $Text = Get-SvcTailscaleServeStatusText

    if (-not $Text -or -not $Text.Contains(':' + $script:SvcPort)) {
        return $null
    }

    $ServeHost = $null

    if ($Text -match ('([A-Za-z0-9.-]+\.ts\.net):' + [regex]::Escape([string]$script:SvcPort))) {
        $ServeHost = $Matches[1]
    }
    elseif ($Text -match 'https://([A-Za-z0-9.-]+\.ts\.net)(?::[0-9]+)?') {
        $ServeHost = $Matches[1]
    }

    if (-not $ServeHost) {
        return $null
    }

    return ('https://' + $ServeHost.TrimEnd('.') + ':' + $script:SvcPort + '/')
}

function Invoke-SvcTailscaleServeSet {
    # tailscale serve --bg --https=<外部端口>：反代到 https://<机器名>.<tailnet>.ts.net:<外部端口>。
    # 显式指定外部端口（与底座同号），不占用 443 —— 443 留给用户手动配的其他服务。
    # HTTPS 底座时上游也是 TLS（自签名），得用 https+insecure 指过去。
    # 配置本身秒级生效，证书在后台签发（首次约半分钟），超时只是防 daemon 卡死。
    $Target = '127.0.0.1:' + $script:SvcPort

    if ($script:SvcBase -eq 'https') {
        $Target = 'https+insecure://127.0.0.1:' + $script:SvcPort
    }

    return (Invoke-SvcTailscaleCli -CliArguments @('serve', '--bg', ('--https=' + $script:SvcPort), $Target) -TimeoutMs 30000)
}

function Sync-SvcTailscale {
    # 按「Tailscale 开关」对齐 tailnet 连接。托盘 tick 周期调用，Set-SvcTailscale 即时调用。
    # 返回首次就绪时的访问地址（其余情况返回 ''，托盘只负责复制）。
    if (-not $script:SvcTailscaleOn) {
        return ''
    }

    # 探测节流：tick 2 秒一次，真实进程探测最多 5 秒一次
    $NeedProbe = $true
    if (
        $script:SvcTailscaleProbeAt -and
        (((Get-Date) - $script:SvcTailscaleProbeAt).TotalMilliseconds -lt 5000)
    ) {
        $NeedProbe = $false
    }

    if ($NeedProbe) {
        $script:SvcTailscaleProbeAt = Get-Date
        $Info = Get-SvcTailscaleInfo

        if ($Info -and $Info.Reachable) {
            $script:SvcTailscaleState = $Info.State
            if ($Info.Ip) { $script:SvcTailscaleIp = $Info.Ip }
        }
        else {
            $script:SvcTailscaleState = 'DaemonDown'
        }
    }

    if ($script:SvcTailscaleState -ne 'Running') {
        # 未连网：按 BackendState 自动拉起
        switch ($script:SvcTailscaleState) {
            'Stopped' {
                # 服务在跑、tailnet 被断开：tailscale up 直接连回
                if (Invoke-SvcTailscaleCli -CliArguments @('up')) {
                    $script:SvcTailscaleProbeAt = $null
                }
                elseif (-not $script:SvcTailscaleWarned) {
                    $script:SvcTailscaleWarned = $true
                    Invoke-SvcNotify 'Tailscale 连接失败' 'tailscale up 未能连回 tailnet，请查看 Tailscale 窗口' 'Error'
                }
            }
            'NeedsLogin' {
                Start-SvcTailscaleGuiThrottled
                if (-not $script:SvcTailscaleWarned) {
                    $script:SvcTailscaleWarned = $true
                    Invoke-SvcNotify 'Tailscale 需要登录' '已打开 Tailscale 窗口，请在窗口里完成登录' 'Warning'
                }
            }
            default {
                # DaemonDown / NoState：GUI 自己会带起服务（必要时 UAC）
                Start-SvcTailscaleGuiThrottled
                if (-not $script:SvcTailscaleWarned) {
                    $script:SvcTailscaleWarned = $true
                    Invoke-SvcNotify 'Tailscale 未运行' '已尝试打开 Tailscale，请按窗口提示启动或登录' 'Warning'
                }
            }
        }

        return ''
    }

    # tailnet 已连：确保 serve 反代（HTTPS）就位
    $NeedServeSync = (
        (-not $script:SvcTailscaleServeUrl) -or
        ($script:SvcTailscaleServeBase -ne $script:SvcBase)
    )

    if ($NeedServeSync) {
        # 先查现有配置（幂等：daemon 已有本端口反代就不用重设），
        # set 后配置落到后端有 ~1 秒延迟，带重试轮询再定论（实测立刻读会拿到空 {}）。
        $Found = Find-SvcTailscaleServeUrl

        if (-not $Found) {
            if (Invoke-SvcTailscaleServeSet) {
                for ($Attempt = 0; $Attempt -lt 4 -and -not $Found; $Attempt++) {
                    Start-Sleep -Milliseconds 500
                    $Found = Find-SvcTailscaleServeUrl
                }
            }
        }

        if ($Found) {
            $script:SvcTailscaleServeUrl = $Found
            $script:SvcTailscaleServeBase = $script:SvcBase
        }

        if (-not $script:SvcTailscaleServeUrl) {
            if (-not $script:SvcTailscaleWarned) {
                $script:SvcTailscaleWarned = $true
                Invoke-SvcNotify 'Tailscale HTTPS 配置失败' (
                    'tailscale serve 未能就位，请在 Tailscale 管理台确认 MagicDNS 与 HTTPS 证书已开启') 'Error'
            }

            return ''
        }
    }

    $script:SvcTailscaleWarned = $false

    if (-not $script:SvcTailscaleReadySeen) {
        $script:SvcTailscaleReadySeen = $true
        Invoke-SvcNotify 'Tailscale' (
            'HTTPS 已就绪：' + $script:SvcTailscaleServeUrl + '（首次访问需等证书签发约半分钟）') 'Info'
        return $script:SvcTailscaleServeUrl
    }

    return ''
}

function Set-SvcTailscale {
    param([bool]$On)

    if ($On) {
        if (-not (Test-Path -LiteralPath $script:SvcTailscale -PathType Leaf)) {
            Invoke-SvcNotify '启动失败' '未找到 tailscale.exe，请先安装 Tailscale' 'Error'
            return $false
        }

        $script:SvcTailscaleOn = $true
        $script:SvcTailscaleWarned = $false
        $script:SvcTailscaleReadySeen = $false
        $script:SvcTailscaleProbeAt = $null
        $script:SvcTailscaleGuiAt = $null
        $script:SvcTailscaleServeUrl = $null
        $script:SvcTailscaleServeBase = ''

        [void](Sync-SvcTailscale)
        return $true
    }

    # 关闭 = 撤掉 serve 反代 + tailscale down 断开 tailnet（服务与 GUI 保留，随时可再连回）
    $script:SvcTailscaleOn = $false
    $script:SvcTailscaleState = ''
    $script:SvcTailscaleIp = $null
    $script:SvcTailscaleWarned = $false
    $script:SvcTailscaleReadySeen = $false
    $script:SvcTailscaleProbeAt = $null
    $script:SvcTailscaleServeUrl = $null
    $script:SvcTailscaleServeBase = ''

    if (Test-Path -LiteralPath $script:SvcTailscale -PathType Leaf) {
        # 只撤本程序自己那条映射（--https=<端口> off），绝不全量 serve reset ——
        # 节点上可能还有用户手动配的其他服务（比如占 443 的），一把 reset 会把别人清掉。
        [void](Invoke-SvcTailscaleCli -CliArguments @('serve', ('--https=' + $script:SvcPort), 'off'))
        [void](Invoke-SvcTailscaleCli -CliArguments @('down'))
    }
}

# ---------- 定时健康检查（托盘 tick 调用）----------

function Update-SvcTunnelUrl {
    # 轮询 cloudflared 日志，拿到 trycloudflare 地址。返回新发现的地址（否则 ''）。
    if (-not $script:SvcTunnelOn -or $script:SvcTunnelUrl) {
        return ''
    }

    $Text = Get-SvcTunnelLogText

    if ($Text -and $Text -match 'https://[A-Za-z0-9-]+\.trycloudflare\.com') {
        $script:SvcTunnelUrl = $Matches[0]
        Invoke-SvcNotify '公网隧道' ('隧道已就绪：' + $script:SvcTunnelUrl) 'Info'
        return $script:SvcTunnelUrl
    }

    return ''
}

function Test-SvcTunnelOrigin {
    # 隧道就绪后回源自检一次：拿到 5xx 说明回源方式不对（历史 502 就是这样来的）
    if (-not $script:SvcTunnelUrl -or $script:SvcTunnelProbed) {
        return
    }

    $script:SvcTunnelProbed = $true

    try {
        $Response = Invoke-WebRequest -Uri ($script:SvcTunnelUrl + '/') `
            -Method Head `
            -TimeoutSec 10 `
            -UseBasicParsing `
            -ErrorAction Stop

        if ($Response.StatusCode -ge 500) {
            Invoke-SvcNotify '隧道回源异常' (
                "隧道地址返回 $($Response.StatusCode)，请检查底座是否正常运行" ) 'Warning'
        }
    }
    catch {
        $Code = $null
        try { $Code = [int]$_.Exception.Response.StatusCode } catch {}

        if ($Code -and $Code -ge 500) {
            Invoke-SvcNotify '隧道回源异常' (
                "隧道地址返回 $Code（回源异常），请检查底座是否正常运行" ) 'Warning'
        }
    }
}

function Test-SvcHealth {
    # HTTPS 子进程意外退出 / 隧道启动失败
    if ($script:SvcBase -eq 'https' -and -not $script:SvcExternalHttps) {
        $Process = $script:SvcBaseProc

        if ($Process -and -not (Test-SvcProcAlive $Process)) {
            if ($script:SvcHttpsReady) {
                $script:SvcHttpsReady = $false
                Invoke-SvcNotify 'HTTPS 已退出' 'HTTPS 服务进程已结束' 'Warning'
            }
            elseif (
                -not $script:SvcHttpsFailReported -and
                $script:SvcHttpsSpawnAt -and
                (((Get-Date) - $script:SvcHttpsSpawnAt).TotalMilliseconds -gt 1500)
            ) {
                $script:SvcHttpsFailReported = $true
                $Detail = Format-SvcLogDetail (Get-SvcHttpsErrorText)
                Invoke-SvcNotify 'HTTPS 启动失败' (
                    '请检查证书配置（管理员运行 .http/setup_https.ps1） ' + $Detail) 'Error'
            }
        }
        elseif ($Process -and -not $script:SvcHttpsReady) {
            if (Test-SvcHttpsTls) {
                $script:SvcHttpsReady = $true
            }
        }
    }

    if ($script:SvcTunnelOn -and -not $script:SvcTunnelUrl) {
        $Process = $script:SvcTunnelProc

        if ($Process -and -not (Test-SvcProcAlive $Process)) {
            $Detail = Format-SvcLogDetail (Get-SvcTunnelLogText) 120
            Invoke-SvcNotify '隧道启动失败' ('cloudflared 已退出 ' + $Detail) 'Error'

            $script:SvcTunnelOn = $false
            $script:SvcTunnelProc = $null
        }
    }
}

# ---------- 状态派生 ----------

function Get-SvcState {
    $BaseRunning = $false
    $BaseReady = $false

    if ($script:SvcBase -eq 'http') {
        if ($script:SvcExternalBase) {
            $BaseRunning = Test-SvcPortInUse
        }
        else {
            $BaseRunning = Test-SvcProcAlive $script:SvcBaseProc
        }
        $BaseReady = $BaseRunning
    }
    elseif ($script:SvcBase -eq 'https') {
        if ($script:SvcExternalHttps) {
            $BaseRunning = $true
            $BaseReady = $true
        }
        else {
            $BaseRunning = Test-SvcProcAlive $script:SvcBaseProc
            $BaseReady = $script:SvcHttpsReady
        }
    }

    $TunnelRunning = $false
    if ($script:SvcTunnelOn) {
        $TunnelRunning = (Test-SvcProcAlive $script:SvcTunnelProc) -or [bool]$script:SvcTunnelUrl
    }

    $TailscaleRunning = $false
    if ($script:SvcTailscaleOn) {
        $TailscaleRunning = (
            $script:SvcTailscaleState -eq 'Running' -and [bool]$script:SvcTailscaleServeUrl
        )
    }

    $Names = @()

    if ($script:SvcBase -eq 'http') {
        $Suffix = ''
        if ($script:SvcExternalBase) { $Suffix = '（外部）' }
        $Names += ('HTTP' + $Suffix)
    }
    elseif ($script:SvcBase -eq 'https') {
        $Suffix = ''
        if ($script:SvcExternalHttps) { $Suffix = '（外部）' }
        $Names += ('HTTPS' + $Suffix)
    }

    if ($script:SvcTunnelOn) {
        $Names += '公网隧道'
    }

    if ($script:SvcTailscaleOn) {
        $Names += 'Tailscale'
    }

    $AnyRunning = $BaseRunning -or $TunnelRunning -or $TailscaleRunning
    $AllReady = (
        ($script:SvcBase -eq '' -or $BaseReady) -and
        (-not $script:SvcTunnelOn -or [bool]$script:SvcTunnelUrl) -and
        (-not $script:SvcTailscaleOn -or $TailscaleRunning)
    )

    if ($Names.Count -eq 0 -or -not $AnyRunning) {
        $StatusText = '已停止'
    }
    elseif ($AllReady) {
        $StatusText = '运行中：' + ($Names -join ' + ')
    }
    else {
        $StatusText = '启动中：' + ($Names -join ' + ')
    }

    return [PSCustomObject]@{
        Base             = $script:SvcBase
        TunnelOn         = $script:SvcTunnelOn
        BaseRunning      = $BaseRunning
        BaseReady        = $BaseReady
        TunnelRunning    = $TunnelRunning
        TunnelUrl        = $script:SvcTunnelUrl
        AnyRunning       = $AnyRunning
        StatusText       = $StatusText
        HttpChecked      = ($script:SvcBase -eq 'http')
        HttpsChecked     = ($script:SvcBase -eq 'https')
        TunnelChecked    = [bool]$script:SvcTunnelOn
        TailscaleChecked = [bool]$script:SvcTailscaleOn
        TailscaleRunning = $TailscaleRunning
        TailscaleUrl     = (Get-SvcTailscaleUrl)
        CanOpen          = $AnyRunning
        CanOpenLan       = $BaseRunning
        CanCopyUrl       = [bool]$script:SvcTunnelUrl
        CanOpenTailscale = ($TailscaleRunning -and $BaseRunning)
        CanCopyTailscaleUrl = $TailscaleRunning
        Tooltip          = ('本地服务：' + $StatusText)
    }
}

# ---------- 菜单动作（托盘右键与命令行共用同一份实现，避免两边行为漂移）----------
#
# 命名对齐托盘菜单项：Toggle-* 是「再点一次就取消」的勾选语义，
# 与 launcher.ps1 里各菜单项点击回调完全一致。

function Invoke-SvcToggleBase {
    # HTTP 服务 / HTTPS 服务菜单项：已勾选 -> 全部停止；未勾选 -> 底座切过去
    param(
        [ValidateSet('http', 'https')]
        [string]$Kind
    )

    $State = Get-SvcState

    $Checked = $State.HttpChecked
    if ($Kind -eq 'https') {
        $Checked = $State.HttpsChecked
    }

    if ($Checked) {
        Clear-SvcBase
    }
    else {
        Set-SvcBase $Kind
    }
}

function Invoke-SvcToggleTunnel {
    # 公网隧道菜单项
    Set-SvcTunnel (-not (Get-SvcState).TunnelChecked)
}

function Invoke-SvcToggleTailscale {
    # Tailscale 菜单项
    if ((Get-SvcState).TailscaleChecked) {
        Set-SvcTailscale $false
    }
    else {
        [void](Set-SvcTailscale $true)
    }
}

function Invoke-SvcOpenPage {
    # 打开主页菜单项（Lan = $true 则是「局域网页面」）
    param(
        [bool]$Lan = $false
    )

    Start-Process (Get-SvcOpenUrl -Lan $Lan)
}

function Invoke-SvcCopyTunnelUrl {
    # 复制隧道地址菜单项
    $Url = (Get-SvcState).TunnelUrl
    if ($Url) {
        Set-Clipboard -Value $Url
    }

    return $Url
}

function Invoke-SvcCopyTailscaleUrl {
    # 复制 Tailscale 地址菜单项
    $Url = (Get-SvcState).TailscaleUrl
    if ($Url) {
        Set-Clipboard -Value $Url
    }

    return $Url
}

function Get-SvcOpenUrl {
    param(
        [bool]$Lan = $false
    )

    if ($script:SvcTunnelUrl -and -not $Lan) {
        return $script:SvcTunnelUrl
    }

    $Scheme = 'http'
    if ($script:SvcBase -eq 'https') {
        $Scheme = 'https'
    }

    $HostName = 'localhost'
    if ($Lan) {
        $HostName = Get-PreferredLanIp
    }

    return ($Scheme + '://' + $HostName + ':' + $script:SvcPort + '/')
}
