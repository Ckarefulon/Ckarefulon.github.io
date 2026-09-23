# 本地服务托盘：HTTP / HTTPS 底座（互斥）+ 公网隧道（可叠加）
# 双击根目录“.本地服务.lnk”默认启动 HTTP 并隐藏到托盘；右键托盘图标可勾选服务组合。
# 也可带参数启动：powershell -File launcher.ps1 [http|https|tunnel|http+tunnel|https+tunnel]

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$RootDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$IconPath = Join-Path $PSScriptRoot 'icon.ico'

. (Join-Path $PSScriptRoot 'network.ps1')
. (Join-Path $PSScriptRoot 'service.ps1')

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

# ---------- 托盘 UI ----------

$StatusItem = New-Object System.Windows.Forms.ToolStripMenuItem
$StatusItem.Text = '已停止'
$StatusItem.Enabled = $false

$HttpItem = New-Object System.Windows.Forms.ToolStripMenuItem
$HttpItem.Text = 'HTTP 服务'
$HttpItem.CheckOnClick = $false

$HttpsItem = New-Object System.Windows.Forms.ToolStripMenuItem
$HttpsItem.Text = 'HTTPS 服务'
$HttpsItem.CheckOnClick = $false

$TunnelItem = New-Object System.Windows.Forms.ToolStripMenuItem
$TunnelItem.Text = '公网隧道'
$TunnelItem.CheckOnClick = $false

$OpenItem = New-Object System.Windows.Forms.ToolStripMenuItem
$OpenItem.Text = '打开主页'

$LanItem = New-Object System.Windows.Forms.ToolStripMenuItem
$LanItem.Text = '局域网页面'

$CopyUrlItem = New-Object System.Windows.Forms.ToolStripMenuItem
$CopyUrlItem.Text = '复制隧道地址'
$CopyUrlItem.Visible = $false

$ExitItem = New-Object System.Windows.Forms.ToolStripMenuItem
$ExitItem.Text = '退出并停止'

$ContextMenu = New-Object System.Windows.Forms.ContextMenuStrip

[void]$ContextMenu.Items.Add($StatusItem)
[void]$ContextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void]$ContextMenu.Items.Add($HttpItem)
[void]$ContextMenu.Items.Add($HttpsItem)
[void]$ContextMenu.Items.Add($TunnelItem)
[void]$ContextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void]$ContextMenu.Items.Add($OpenItem)
[void]$ContextMenu.Items.Add($LanItem)
[void]$ContextMenu.Items.Add($CopyUrlItem)
[void]$ContextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
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

function Write-SvcTrayError {
    # 事件回调里的异常绝不能冒泡出去：会直接带走整个托盘进程。落盘留证即可。
    param(
        $ErrorRecord
    )

    try {
        $Message = ''
        if ($ErrorRecord -and $ErrorRecord.Exception) {
            $Message = $ErrorRecord.Exception.Message
        }
        else {
            $Message = [string]$ErrorRecord
        }

        Add-Content `
            -LiteralPath (Join-Path $env:TEMP 'careful_service_tray_err.log') `
            -Value ((Get-Date).ToString('s') + '  ' + $Message) `
            -Encoding UTF8
    }
    catch {
    }
}

function Show-SvcBalloon {
    # 引擎按名字回调这个函数（Invoke-SvcNotify），不要改成 ScriptBlock 参数
    param(
        [string]$Title,
        [string]$Text,
        [string]$IconName = 'Info'
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
        Write-SvcTrayError $_
    }
}

function Update-TrayStatus {
    $State = Get-SvcState

    $StatusItem.Text = $State.StatusText

    $HttpItem.Checked = $State.HttpChecked
    $HttpsItem.Checked = $State.HttpsChecked
    $TunnelItem.Checked = $State.TunnelChecked

    $OpenItem.Enabled = $State.CanOpen
    $LanItem.Enabled = $State.CanOpenLan
    $CopyUrlItem.Visible = $State.CanCopyUrl

    $Tooltip = $State.Tooltip
    if ($Tooltip.Length -gt 62) {
        $Tooltip = $Tooltip.Substring(0, 62)
    }
    $TrayIcon.Text = $Tooltip
}

function Open-Page {
    param(
        [bool]$Lan
    )

    try {
        Start-Process (Get-SvcOpenUrl -Lan $Lan)
    }
    catch {
    }
}

# 引擎配置：气泡回调走 launcher 里的 Show-SvcBalloon 函数（按名字找，不用 ScriptBlock）
Initialize-SvcEngine `
    -Port 9527 `
    -RootDir $RootDir `
    -HttpsScript (Join-Path $PSScriptRoot 'start_https.ps1') `
    -SetupScript (Join-Path $PSScriptRoot 'setup_https.ps1') `
    -Cloudflared 'C:\Users\Vxiao\.workbuddy\binaries\cloudflared.exe'

# ---------- 菜单交互（多选语义）----------

$HttpItem.Add_Click({
    try {
        # 已勾选 -> 全部停止；未勾选 -> 底座切到 HTTP（隧道若开着则跟随重启）
        if ((Get-SvcState).HttpChecked) {
            Clear-SvcBase
        }
        else {
            Set-SvcBase 'http'
        }

        Update-TrayStatus
    }
    catch {
        Write-SvcTrayError $_
    }
})

$HttpsItem.Add_Click({
    try {
        if ((Get-SvcState).HttpsChecked) {
            Clear-SvcBase
        }
        else {
            Set-SvcBase 'https'
        }

        Update-TrayStatus
    }
    catch {
        Write-SvcTrayError $_
    }
})

$TunnelItem.Add_Click({
    try {
        if ((Get-SvcState).TunnelChecked) {
            Set-SvcTunnel $false
        }
        else {
            Set-SvcTunnel $true
        }

        Update-TrayStatus
    }
    catch {
        Write-SvcTrayError $_
    }
})

$OpenItem.Add_Click({
    try { Open-Page $false } catch { Write-SvcTrayError $_ }
})

$LanItem.Add_Click({
    try { Open-Page $true } catch { Write-SvcTrayError $_ }
})

$CopyUrlItem.Add_Click({
    try {
        $Url = (Get-SvcState).TunnelUrl
        if ($Url) { Set-Clipboard -Value $Url }
    }
    catch {
        Write-SvcTrayError $_
    }
})

# 双击托盘图标打开当前入口
$TrayIcon.Add_DoubleClick({
    try { Open-Page $false } catch { Write-SvcTrayError $_ }
})

$ExitItem.Add_Click({
    try {
        Stop-SvcAll

        $Timer.Stop()
        $Timer.Dispose()

        $TrayIcon.Visible = $false
        $TrayIcon.Dispose()
        $ContextMenu.Dispose()

        try { $Mutex.ReleaseMutex() } catch {}
        $Mutex.Dispose()
    }
    catch {
        Write-SvcTrayError $_
    }

    [System.Windows.Forms.Application]::ExitThread()
})

# 定时刷新状态、健康检查、轮询隧道地址
# 回调里必须整体兜异常：一旦有异常冒泡出事件回调，整个托盘进程会被带走。
$Timer = New-Object System.Windows.Forms.Timer
$Timer.Interval = 2000
$Timer.Add_Tick({
    try {
        Test-SvcHealth

        $NewUrl = Update-SvcTunnelUrl
        if ($NewUrl) {
            try { Set-Clipboard -Value $NewUrl } catch {}
            Show-SvcBalloon -Title '公网隧道' -Text ('隧道已就绪，地址已复制：' + $NewUrl) -IconName 'Info'
            Test-SvcTunnelOrigin
        }

        Update-TrayStatus
    }
    catch {
        Write-SvcTrayError $_
    }
})
$Timer.Start()

# 启动方式：参数 http|https|tunnel|http+tunnel|https+tunnel，默认 http
$StartupBase = 'http'
$StartupTunnel = $false

if ($args.Count -ge 1) {
    switch ($args[0]) {
        'http' { $StartupBase = 'http' }
        'https' { $StartupBase = 'https' }
        'tunnel' {
            $StartupBase = 'http'
            $StartupTunnel = $true
        }
        'http+tunnel' {
            $StartupBase = 'http'
            $StartupTunnel = $true
        }
        'https+tunnel' {
            $StartupBase = 'https'
            $StartupTunnel = $true
        }
    }
}

try {
    try {
        Set-SvcBase $StartupBase

        if ($StartupTunnel) {
            Set-SvcTunnel $true
        }
    }
    catch {
        Write-SvcTrayError $_
    }

    Update-TrayStatus

    $Hint = '已隐藏到托盘，右键图标可勾选 HTTP / HTTPS / 公网隧道'
    if ((Get-SvcState).StatusText -eq '已停止') {
        $Hint = '本地服务未启动，右键托盘图标勾选要启用的服务'
    }

    Show-SvcBalloon -Title '本地服务' -Text $Hint -IconName 'Info'

    [System.Windows.Forms.Application]::Run()
}
finally {
    $NeedCleanup = $false
    try { $NeedCleanup = $TrayIcon.Visible } catch { $NeedCleanup = $false }

    if ($NeedCleanup) {
        Stop-SvcAll
        $Timer.Stop()
        $Timer.Dispose()
        $TrayIcon.Visible = $false
        $TrayIcon.Dispose()
        $ContextMenu.Dispose()

        try { $Mutex.ReleaseMutex() } catch {}
        $Mutex.Dispose()
    }
}
