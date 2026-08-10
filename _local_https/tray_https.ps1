$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ServerScript = Join-Path $PSScriptRoot 'start_https.ps1'
$PowerShellExe = Join-Path `
    $env:SystemRoot `
    'System32\WindowsPowerShell\v1.0\powershell.exe'

$LocalAddress = 'https://localhost:9527'

$InfoPath = Join-Path $PSScriptRoot 'certificate-info.json'
$SetupScript = Join-Path $PSScriptRoot 'setup_https.ps1'
$CurrentIp = '127.0.0.1'

. (Join-Path $PSScriptRoot 'network.ps1')

function Test-CertificateReady {
    param(
        [string]$ExpectedIp
    )

    if (-not (Test-Path -LiteralPath $InfoPath -PathType Leaf)) {
        return $false
    }

    try {
        $Info = Get-Content $InfoPath | ConvertFrom-Json

        if (
            -not $Info.ServerThumbprint -or
            -not $Info.RootThumbprint
        ) {
            return $false
        }

        $ServerCert = Get-Item -LiteralPath (
            'Cert:\LocalMachine\My\' + $Info.ServerThumbprint
        ) -ErrorAction Stop

        $TrustedRoot = Get-Item -LiteralPath (
            'Cert:\LocalMachine\Root\' + $Info.RootThumbprint
        ) -ErrorAction Stop

        $San = $ServerCert.Extensions |
            Where-Object { $_.Oid.Value -eq '2.5.29.17' } |
            Select-Object -First 1

        return (
            $null -ne $TrustedRoot -and
            $ServerCert.NotAfter -gt (Get-Date).AddDays(1) -and
            $San -and
            $San.Format($false).Contains($ExpectedIp)
        )
    }
    catch {
        return $false
    }
}

function Sync-CertificateIfNeeded() {
    $DetectedIp = Get-PreferredLanIp

    if (-not (Test-CertificateReady -ExpectedIp $DetectedIp)) {
        try {
            $Process = Start-Process powershell.exe `
                -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$SetupScript`"" `
                -Verb RunAs -Wait -PassThru
            if ($Process -and $Process.ExitCode -eq 0) {
                return $true
            }
        } catch {}
        return $false
    }
    return $true
}

$CurrentIp = Get-PreferredLanIp

$LanAddress = "https://${CurrentIp}:9527"

# Prevent duplicate tray applications.
$CreatedNew = $false
$Mutex = New-Object System.Threading.Mutex(
    $true,
    'Local\CarefulHttpsTray',
    [ref]$CreatedNew
)

if (-not $CreatedNew) {
    exit 0
}

if (-not (Test-Path -LiteralPath $ServerScript -PathType Leaf)) {
    [System.Windows.Forms.MessageBox]::Show(
        "Missing file:`n$ServerScript",
        'Ckarefulon HTTPS',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    )

    $Mutex.Dispose()
    exit 1
}

$script:ServerPid = $null
$script:CustomTrayIcon = $null

function Find-ExistingServer {
    $TargetPath = $ServerScript.ToLowerInvariant()

    return Get-CimInstance `
        -ClassName Win32_Process `
        -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -ieq 'powershell.exe' -and
            $_.CommandLine -and
            $_.CommandLine.ToLowerInvariant().Contains($TargetPath)
        } |
        Select-Object -First 1
}

function Test-ServerRunning {
    if ($script:ServerPid) {
        $Process = Get-Process `
            -Id $script:ServerPid `
            -ErrorAction SilentlyContinue

        if ($Process) {
            return $true
        }

        $script:ServerPid = $null
    }

    $ExistingServer = Find-ExistingServer

    if ($ExistingServer) {
        $script:ServerPid = $ExistingServer.ProcessId
        return $true
    }

    return $false
}

function Update-TrayStatus {
    $Running = Test-ServerRunning

    if ($Running) {
        $StatusItem.Text = 'Status: Running'
        $StartItem.Enabled = $false
        $StopItem.Enabled = $true
        $OpenLocalItem.Enabled = $true
        $OpenLanItem.Enabled = $true
        $TrayIcon.Text = 'Ckarefulon HTTPS - Running'
    }
    else {
        $StatusItem.Text = 'Status: Stopped'
        $StartItem.Enabled = $true
        $StopItem.Enabled = $false
        $OpenLocalItem.Enabled = $false
        $OpenLanItem.Enabled = $false
        $TrayIcon.Text = 'Ckarefulon HTTPS - Stopped'
    }
}

function Start-Server {
    if (Test-ServerRunning) {
        Update-TrayStatus
        return
    }

    $Arguments = (
        '-NoProfile ' +
        '-ExecutionPolicy Bypass ' +
        '-WindowStyle Hidden ' +
        '-File "' + $ServerScript + '"'
    )

    try {
        $Process = Start-Process `
            -FilePath $PowerShellExe `
            -ArgumentList $Arguments `
            -WindowStyle Hidden `
            -PassThru

        $script:ServerPid = $Process.Id

        Start-Sleep -Milliseconds 700

        if ($Process.HasExited) {
            $script:ServerPid = $null

            $TrayIcon.ShowBalloonTip(
                3000,
                'Ckarefulon HTTPS',
                'The HTTPS server failed to start.',
                [System.Windows.Forms.ToolTipIcon]::Error
            )
        }
        else {
            $TrayIcon.ShowBalloonTip(
                2000,
                'Ckarefulon HTTPS',
                'Server started on port 9527.',
                [System.Windows.Forms.ToolTipIcon]::Info
            )
        }
    }
    catch {
        $script:ServerPid = $null

        $TrayIcon.ShowBalloonTip(
            3000,
            'Ckarefulon HTTPS',
            $_.Exception.Message,
            [System.Windows.Forms.ToolTipIcon]::Error
        )
    }

    Update-TrayStatus
}

function Stop-Server {
    $ExistingServer = Find-ExistingServer

    if ($ExistingServer) {
        Stop-Process `
            -Id $ExistingServer.ProcessId `
            -Force `
            -ErrorAction SilentlyContinue
    }

    $script:ServerPid = $null

    $TrayIcon.ShowBalloonTip(
        1500,
        'Ckarefulon HTTPS',
        'Server stopped.',
        [System.Windows.Forms.ToolTipIcon]::Info
    )

    Update-TrayStatus
}

function Open-LocalPage {
    if (Test-ServerRunning) {
        Start-Process $LocalAddress
    }
}

function Open-LanPage {
    if (Test-ServerRunning) {
        Start-Process $LanAddress
    }
}

$ContextMenu = New-Object System.Windows.Forms.ContextMenuStrip

$StatusItem = New-Object System.Windows.Forms.ToolStripMenuItem
$StatusItem.Text = 'Status: Starting'
$StatusItem.Enabled = $false

$StartItem = New-Object System.Windows.Forms.ToolStripMenuItem
$StartItem.Text = 'Start server'

$StopItem = New-Object System.Windows.Forms.ToolStripMenuItem
$StopItem.Text = 'Stop server'

$OpenLocalItem = New-Object System.Windows.Forms.ToolStripMenuItem
$OpenLocalItem.Text = 'Open localhost'

$OpenLanItem = New-Object System.Windows.Forms.ToolStripMenuItem
$OpenLanItem.Text = "Open $CurrentIp"

$ExitItem = New-Object System.Windows.Forms.ToolStripMenuItem
$ExitItem.Text = 'Exit and stop server'

[void]$ContextMenu.Items.Add($StatusItem)
[void]$ContextMenu.Items.Add(
    (New-Object System.Windows.Forms.ToolStripSeparator)
)
[void]$ContextMenu.Items.Add($StartItem)
[void]$ContextMenu.Items.Add($StopItem)
[void]$ContextMenu.Items.Add(
    (New-Object System.Windows.Forms.ToolStripSeparator)
)
[void]$ContextMenu.Items.Add($OpenLocalItem)
[void]$ContextMenu.Items.Add($OpenLanItem)
[void]$ContextMenu.Items.Add(
    (New-Object System.Windows.Forms.ToolStripSeparator)
)
[void]$ContextMenu.Items.Add($ExitItem)

$TrayIcon = New-Object System.Windows.Forms.NotifyIcon

# Load custom tray icon from ..\favicon.ico if it exists.
$SiteRoot = [IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..')
)

$IconPath = Join-Path $SiteRoot 'favicon.ico'

if (Test-Path -LiteralPath $IconPath -PathType Leaf) {
    $script:CustomTrayIcon = New-Object System.Drawing.Icon($IconPath)
    $TrayIcon.Icon = $script:CustomTrayIcon
}
else {
    $TrayIcon.Icon = [System.Drawing.SystemIcons]::Application
}

$TrayIcon.Text = 'Ckarefulon HTTPS'
$TrayIcon.ContextMenuStrip = $ContextMenu
$TrayIcon.Visible = $true

$StartItem.Add_Click({
    Start-Server
})

$StopItem.Add_Click({
    Stop-Server
})

$OpenLocalItem.Add_Click({
    Open-LocalPage
})

$OpenLanItem.Add_Click({
    Open-LanPage
})

# Double-click tray icon to open localhost.
$TrayIcon.Add_DoubleClick({
    if (-not (Test-ServerRunning)) {
        Start-Server
        Start-Sleep -Milliseconds 500
    }

    Open-LocalPage
})

$ExitItem.Add_Click({
    Stop-Server

    $Timer.Stop()
    $Timer.Dispose()

    $TrayIcon.Visible = $false
    $TrayIcon.Dispose()
    $ContextMenu.Dispose()

    [System.Windows.Forms.Application]::ExitThread()
})

# Refresh status in case the server exits unexpectedly.
$Timer = New-Object System.Windows.Forms.Timer
$Timer.Interval = 2000
$Timer.Add_Tick({
    Update-TrayStatus
})
$Timer.Start()

try {
    # Auto-update certificate if IP changed
    if (Sync-CertificateIfNeeded) {
        $CurrentIp = Get-PreferredLanIp
        $LanAddress = "https://${CurrentIp}:9527"
        $OpenLanItem.Text = "Open $CurrentIp"
    }

    Start-Server
    Update-TrayStatus

    [System.Windows.Forms.Application]::Run()
}
finally {
    $Timer.Stop()
    $Timer.Dispose()

    $TrayIcon.Visible = $false
    $TrayIcon.Dispose()

    # Clean up custom tray icon if loaded.
    if ($script:CustomTrayIcon) {
        $script:CustomTrayIcon.Dispose()
        $script:CustomTrayIcon = $null
    }

    $ContextMenu.Dispose()

    $Mutex.ReleaseMutex()
    $Mutex.Dispose()
}
