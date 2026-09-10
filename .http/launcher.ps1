# 本地服务托盘启动器：HTTP / HTTPS / 公网隧道 三合一
# 双击根目录“本地服务.lnk”默认启动 HTTP 并隐藏到托盘；右键托盘图标可切换方式。
# 也可带参数启动：powershell -File launcher.ps1 http|https|tunnel

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$RootDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$IconPath = Join-Path $PSScriptRoot 'icon.ico'
$HttpsScript = Join-Path $PSScriptRoot 'start_https.ps1'
$Port = 9527
$CloudflaredPath = 'C:\Users\Vxiao\.workbuddy\binaries\cloudflared.exe'
$TunnelOutLog = Join-Path $env:TEMP 'careful_tunnel_out.log'
$TunnelErrLog = Join-Path $env:TEMP 'careful_tunnel_err.log'
$HttpsErrLog = Join-Path $env:TEMP 'careful_https_err.log'

. (Join-Path $PSScriptRoot 'network.ps1')

# 单实例保护
$CreatedNew = $false
$Mutex = New-Object System.Threading.Mutex(
    $true,
    'Local\CarefulUnifiedHttpTray',
    [ref]$CreatedNew
)

if (-not $CreatedNew) {
    exit 0
}

$script:Mode = ''
$script:Procs = @()
$script:ExternalHttp = $false
$script:ExternalHttps = $false
$script:HttpsReady = $false
$script:TunnelUrl = $null
$script:HttpsFailReported = $false
$script:HttpsSpawnAt = $null

function Show-Balloon {
    param(
        [string]$Title,
        [string]$Text,
        [string]$IconName
    )
    try {
        $TrayIcon.ShowBalloonTip(
            3000,
            $Title,
            $Text,
            [System.Windows.Forms.ToolTipIcon]$IconName
        )
    }
    catch {
    }
}

function Test-PortInUse {
    $Client = New-Object System.Net.Sockets.TcpClient
    try {
        $AsyncResult = $Client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if ($AsyncResult.AsyncWaitHandle.WaitOne(300)) {
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

function Test-HttpsTls {
    # 对 9527 做一次 TLS 握手：成功=HTTPS 服务在跑；失败=明文服务占用或无服务
    $Client = New-Object System.Net.Sockets.TcpClient
    try {
        $AsyncResult = $Client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $AsyncResult.AsyncWaitHandle.WaitOne(300)) {
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

function Test-Running {
    # http 模式的外部服务要实时探测（外部程序可能随时被关掉）
    if ($script:Mode -eq 'http' -and $script:ExternalHttp) {
        return (Test-PortInUse)
    }
    if ($script:ExternalHttps) {
        return $true
    }
    foreach ($Process in $script:Procs) {
        try {
            if (-not $Process.HasExited) {
                return $true
            }
        }
        catch {
        }
    }
    return $false
}

function Test-Ready {
    # 就绪判定：未就绪时状态显示"启动中"，就绪后显示"运行中"
    if ($script:Mode -eq 'http') {
        if ($script:ExternalHttp) {
            # Test-Running 已实时确认端口通，避免重复探测
            return $true
        }
        return (Test-PortInUse)
    }
    elseif ($script:Mode -eq 'https') {
        return ($script:ExternalHttps -or $script:HttpsReady)
    }
    elseif ($script:Mode -eq 'tunnel') {
        return ($null -ne $script:TunnelUrl)
    }
    return $false
}

function Stop-Mine {
    foreach ($Process in $script:Procs) {
        try {
            $Exited = $false
            try { $Exited = $Process.HasExited } catch { $Exited = $true }
            if (-not $Exited) {
                Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
            }
        }
        catch {
        }
        try { $Process.Dispose() } catch {}
    }
    $script:Procs = @()
    $script:ExternalHttp = $false
    $script:ExternalHttps = $false
    $script:HttpsReady = $false
    Remove-Item -LiteralPath $TunnelOutLog, $TunnelErrLog, $HttpsErrLog -Force -ErrorAction SilentlyContinue
}

function Start-HttpServer {
    if (Test-PortInUse) {
        $script:ExternalHttp = $true
        return
    }

    $script:ExternalHttp = $false

    try {
        $Process = Start-Process -FilePath 'python' `
            -ArgumentList "-m http.server $Port --bind 0.0.0.0" `
            -WorkingDirectory $RootDir `
            -WindowStyle Hidden `
            -PassThru
        $script:Procs += $Process
    }
    catch {
        Show-Balloon '启动失败' ('未找到 python：' + $_.Exception.Message) 'Error'
    }
}

function Start-HttpsServer {
    if (-not (Test-Path -LiteralPath $HttpsScript -PathType Leaf)) {
        Show-Balloon '启动失败' '缺少 start_https.ps1' 'Error'
        return
    }

    try {
        $PowerShellExe = Join-Path `
            $env:SystemRoot `
            'System32\WindowsPowerShell\v1.0\powershell.exe'

        $Process = Start-Process -FilePath $PowerShellExe `
            -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$HttpsScript`"" `
            -WindowStyle Hidden `
            -RedirectStandardError $HttpsErrLog `
            -PassThru

        $script:Procs += $Process
        $script:HttpsSpawnAt = Get-Date
    }
    catch {
        Show-Balloon '启动失败' $_.Exception.Message 'Error'
    }
}

function Start-TunnelProcess {
    if (-not (Test-Path -LiteralPath $CloudflaredPath -PathType Leaf)) {
        Show-Balloon '启动失败' '未找到 cloudflared.exe' 'Error'
        return
    }

    try {
        Remove-Item -LiteralPath $TunnelOutLog, $TunnelErrLog -Force -ErrorAction SilentlyContinue

        $Process = Start-Process -FilePath $CloudflaredPath `
            -ArgumentList "tunnel --url http://localhost:$Port" `
            -WindowStyle Hidden `
            -RedirectStandardOutput $TunnelOutLog `
            -RedirectStandardError $TunnelErrLog `
            -PassThru

        $script:Procs += $Process
    }
    catch {
        Show-Balloon '启动失败' $_.Exception.Message 'Error'
    }
}

function Switch-Mode {
    param(
        [string]$NewMode
    )

    Stop-Mine
    $script:Mode = $NewMode
    $script:TunnelUrl = $null
    $script:HttpsFailReported = $false
    $script:HttpsReady = $false
    $script:ExternalHttps = $false

    if ($NewMode -eq 'http') {
        Start-HttpServer
    }
    elseif ($NewMode -eq 'https') {
        if (Test-HttpsTls) {
            # 外部已有 HTTPS 在跑：接管状态，不重复启动
            $script:ExternalHttps = $true
        }
        elseif (Test-PortInUse) {
            # TCP 通但 TLS 握手失败：9527 被明文 HTTP 等程序占用
            Show-Balloon '无法启动 HTTPS' '9527 已被明文 HTTP 等程序占用，请先停止占用程序再切换' 'Error'
        }
        else {
            Start-HttpsServer
        }
    }
    elseif ($NewMode -eq 'tunnel') {
        Start-HttpServer
        Start-TunnelProcess
    }

    Update-TrayStatus
}

function Open-Page {
    param(
        [bool]$Lan
    )

    if ($script:Mode -eq 'tunnel' -and -not $Lan -and $script:TunnelUrl) {
        try { Start-Process $script:TunnelUrl } catch {}
        return
    }

    $Scheme = 'http'
    if ($script:Mode -eq 'https') {
        $Scheme = 'https'
    }

    $HostName = 'localhost'
    if ($Lan) {
        $HostName = Get-PreferredLanIp
    }

    try {
        Start-Process ($Scheme + '://' + $HostName + ':' + $Port + '/')
    }
    catch {
    }
}

function Update-TrayStatus {
    $Running = Test-Running
    $Ready = Test-Ready

    $Name = switch ($script:Mode) {
        'http'   { 'HTTP' }
        'https'  { 'HTTPS' }
        'tunnel' { '隧道' }
        default  { '' }
    }

    $Suffix = ''
    if ($script:Mode -eq 'http' -and $script:ExternalHttp) {
        $Suffix = '（外部）'
    }
    if ($script:Mode -eq 'https' -and $script:ExternalHttps) {
        $Suffix = '（外部）'
    }

    if ($Running -and $Ready) {
        $StatusItem.Text = "运行中：$Name$Suffix"
        $TrayIcon.Text = "本地服务：$Name$Suffix"
    }
    elseif ($Running) {
        $StatusItem.Text = "启动中：$Name$Suffix"
        $TrayIcon.Text = "本地服务：启动中"
    }
    else {
        $StatusItem.Text = '已停止'
        $TrayIcon.Text = '本地服务：已停止'
    }

    $HttpItem.Checked = ($script:Mode -eq 'http')
    $HttpsItem.Checked = ($script:Mode -eq 'https')
    $TunnelItem.Checked = ($script:Mode -eq 'tunnel')
    $OpenItem.Enabled = $Running
    $LanItem.Enabled = $Running
    $CopyUrlItem.Visible = ($script:Mode -eq 'tunnel' -and $script:TunnelUrl)
}

# ---------- 托盘 UI ----------

$ContextMenu = New-Object System.Windows.Forms.ContextMenuStrip

$StatusItem = New-Object System.Windows.Forms.ToolStripMenuItem
$StatusItem.Text = '已停止'
$StatusItem.Enabled = $false

$HttpItem = New-Object System.Windows.Forms.ToolStripMenuItem
$HttpItem.Text = 'HTTP 服务'

$HttpsItem = New-Object System.Windows.Forms.ToolStripMenuItem
$HttpsItem.Text = 'HTTPS 服务'

$TunnelItem = New-Object System.Windows.Forms.ToolStripMenuItem
$TunnelItem.Text = '公网隧道'

$OpenItem = New-Object System.Windows.Forms.ToolStripMenuItem
$OpenItem.Text = '打开主页'

$LanItem = New-Object System.Windows.Forms.ToolStripMenuItem
$LanItem.Text = '局域网页面'

$CopyUrlItem = New-Object System.Windows.Forms.ToolStripMenuItem
$CopyUrlItem.Text = '复制地址'
$CopyUrlItem.Visible = $false

$ExitItem = New-Object System.Windows.Forms.ToolStripMenuItem
$ExitItem.Text = '退出并停止'

[void]$ContextMenu.Items.Add($StatusItem)
[void]$ContextMenu.Items.Add(
    (New-Object System.Windows.Forms.ToolStripSeparator)
)
[void]$ContextMenu.Items.Add($HttpItem)
[void]$ContextMenu.Items.Add($HttpsItem)
[void]$ContextMenu.Items.Add($TunnelItem)
[void]$ContextMenu.Items.Add(
    (New-Object System.Windows.Forms.ToolStripSeparator)
)
[void]$ContextMenu.Items.Add($OpenItem)
[void]$ContextMenu.Items.Add($LanItem)
[void]$ContextMenu.Items.Add($CopyUrlItem)
[void]$ContextMenu.Items.Add(
    (New-Object System.Windows.Forms.ToolStripSeparator)
)
[void]$ContextMenu.Items.Add($ExitItem)

$TrayIcon = New-Object System.Windows.Forms.NotifyIcon

if (Test-Path -LiteralPath $IconPath -PathType Leaf) {
    $TrayIcon.Icon = New-Object System.Drawing.Icon($IconPath)
}
else {
    $TrayIcon.Icon = [System.Drawing.SystemIcons]::Application
}

$TrayIcon.Text = '本地服务'
$TrayIcon.ContextMenuStrip = $ContextMenu
$TrayIcon.Visible = $true

$HttpItem.Add_Click({
    Switch-Mode 'http'
})

$HttpsItem.Add_Click({
    Switch-Mode 'https'
})

$TunnelItem.Add_Click({
    Switch-Mode 'tunnel'
})

$OpenItem.Add_Click({
    Open-Page $false
})

$LanItem.Add_Click({
    Open-Page $true
})

$CopyUrlItem.Add_Click({
    if ($script:TunnelUrl) {
        try { Set-Clipboard -Value $script:TunnelUrl } catch {}
    }
})

# 双击托盘图标打开当前方式的主页
$TrayIcon.Add_DoubleClick({
    Open-Page $false
})

$ExitItem.Add_Click({
    Stop-Mine

    $Timer.Stop()
    $Timer.Dispose()

    $TrayIcon.Visible = $false
    $TrayIcon.Dispose()
    $ContextMenu.Dispose()

    try { $Mutex.ReleaseMutex() } catch {}
    $Mutex.Dispose()

    [System.Windows.Forms.Application]::ExitThread()
})

# 定时刷新状态、检测 HTTPS 启动失败、轮询隧道地址
$Timer = New-Object System.Windows.Forms.Timer
$Timer.Interval = 2000
$Timer.Add_Tick({
    if (
        -not $script:HttpsFailReported -and
        $script:Mode -eq 'https' -and
        -not $script:ExternalHttps -and
        -not $script:HttpsReady -and
        $script:Procs.Count -gt 0
    ) {
        $Process = $script:Procs[0]
        $Exited = $false
        try { $Exited = $Process.HasExited } catch { $Exited = $true }

        if ($Exited) {
            if (
                $script:HttpsSpawnAt -and
                (((Get-Date) - $script:HttpsSpawnAt).TotalMilliseconds -gt 1800)
            ) {
                $script:HttpsFailReported = $true

                $Detail = ''
                try {
                    $Raw = Get-Content -LiteralPath $HttpsErrLog -Raw -ErrorAction SilentlyContinue
                    if ($Raw) {
                        $Detail = ($Raw -replace '\s+', ' ').Trim()
                        if ($Detail.Length -gt 140) {
                            $Detail = $Detail.Substring(0, 140) + '…'
                        }
                    }
                }
                catch {
                }

                Show-Balloon 'HTTPS 启动失败' ('请检查证书配置，或以管理员运行 .http/setup_https.ps1 ' + $Detail) 'Error'
            }
        }
        else {
            # 子进程存活时才做 TLS 就绪探测；就绪后不再握手（轻量化）
            if (Test-HttpsTls) {
                $script:HttpsReady = $true
            }
        }
    }

    if ($script:Mode -eq 'tunnel' -and -not $script:TunnelUrl) {
        $Text = ''
        try {
            $Text += Get-Content -LiteralPath $TunnelOutLog -Raw -ErrorAction SilentlyContinue
            $Text += Get-Content -LiteralPath $TunnelErrLog -Raw -ErrorAction SilentlyContinue
        }
        catch {
        }

        if ($Text -and $Text -match 'https://[A-Za-z0-9-]+\.trycloudflare\.com') {
            $script:TunnelUrl = $Matches[0]
            try { Set-Clipboard -Value $script:TunnelUrl } catch {}
            Show-Balloon '公网隧道' ('隧道已就绪，地址已复制：' + $script:TunnelUrl) 'Info'
        }
    }

    Update-TrayStatus
})
$Timer.Start()

# 启动方式：参数 http|https|tunnel，默认 http
$StartupMode = 'http'
if ($args.Count -ge 1 -and ($args[0] -eq 'https' -or $args[0] -eq 'tunnel')) {
    $StartupMode = $args[0]
}

try {
    Switch-Mode $StartupMode
    $TrayIcon.ShowBalloonTip(
        2500,
        '本地服务',
        '已隐藏到托盘，右键图标选择服务方式',
        [System.Windows.Forms.ToolTipIcon]::Info
    )

    [System.Windows.Forms.Application]::Run()
}
finally {
    $NeedCleanup = $false
    try { $NeedCleanup = $TrayIcon.Visible } catch { $NeedCleanup = $false }

    if ($NeedCleanup) {
        Stop-Mine
        $Timer.Stop()
        $Timer.Dispose()
        $TrayIcon.Visible = $false
        $TrayIcon.Dispose()
        $ContextMenu.Dispose()

        try { $Mutex.ReleaseMutex() } catch {}
        $Mutex.Dispose()
    }
}
