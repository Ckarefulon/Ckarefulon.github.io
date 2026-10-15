<#
  本地服务 · 命令行客户端（由根目录“.server.cmd”调用，也可直接 powershell -File 运行）

  两种入口，行为刻意分开：
    * 双击 .server.cmd（不带参数）= 只管把托盘拉起来并隐藏到托盘区，黑框闪一下就走。
    * 在终端里带参数执行 = 只做这一件事，**绝不自动拉起托盘**；托盘没在跑就直接提示，
      要启动请显式用 `.server.cmd start`。

  设计要点：
    * 与托盘通信走命名管道 CarefulLocalServiceControl（见 control.ps1）。
      托盘状态全在它的进程内存里，新起进程自己读不到，必须问那个在跑的托盘。
    * 「不自动拉起托盘」是刻意的：命令行的结果应当是确定的，
      不能因为顺手起了个托盘就让 `status` 之类的查询产生副作用。
#>

$ErrorActionPreference = 'Stop'

$HttpDir = $PSScriptRoot
$RootDir = [IO.Path]::GetFullPath((Join-Path $HttpDir '..'))
$PipeName = 'CarefulLocalServiceControl'

# 子命令 -> 说明（help 也用这份，保证不会两处不一致）
$Commands = [ordered]@{
    'start'     = '启动托盘并隐藏到托盘区（双击 .server.cmd 等效）'
    'status'    = '查看状态（含各项勾选态）'
    'http'      = 'HTTP 服务：勾选/取消（取消 = 全部停止）'
    'https'     = 'HTTPS 服务：勾选/取消（取消 = 全部停止）'
    'tunnel'    = '公网隧道：勾选/取消'
    'tailscale' = 'Tailscale：勾选/取消'
    'open'      = '打开主页'
    'lan'       = '局域网页面'
    'tsopen'    = '打开 Tailscale 页面'
    'copyurl'   = '复制隧道地址'
    'tscopyurl' = '复制 Tailscale 地址'
    'stop'      = '停止全部服务（保留托盘）'
    'exit'      = '退出并停止（托盘一起退出）'
    'help'      = '显示本帮助'
}

# 命令别名：托盘内部叫 ts，用户可能写 ts 也可能写 tailscale，两个都收。
# help 只列规范名，别名不重复出现在帮助里。
$CommandAliases = @{
    'ts' = 'tailscale'
}

function Write-Usage {
    Write-Host ''
    Write-Host '本地服务 · 命令行控制' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '用法（在终端里执行）：'
    Write-Host '  .server.cmd start             启动托盘并隐藏到托盘区（默认 HTTP）'
    Write-Host '  .server.cmd <命令> [<命令>…]  执行命令，可一次写多条'
    Write-Host ''
    Write-Host '示例：.server.cmd http ts       同时开 HTTP 与 Tailscale'
    Write-Host ''
    Write-Host '双击 .server.cmd 等于 start：只把托盘拉起来，不留命令行窗口。'
    Write-Host '命令执行时若托盘未运行，会先问你是否启动它。'
    Write-Host ''
    Write-Host '命令（与右键托盘图标菜单项对应）：'

    foreach ($Name in $Commands.Keys) {
        Write-Host ('  ' + $Name.PadRight(12) + $Commands[$Name])
    }

    Write-Host ''
}

function Send-PipeCommand {
    # 发一条命令给托盘，返回 @{ Ok = <bool>; Text = <string> }；管道不可达返回 $null
    param(
        [string]$Command,
        [string]$Argument = ''
    )

    $Client = New-Object System.IO.Pipes.NamedPipeClientStream(
        '.',
        $PipeName,
        [System.IO.Pipes.PipeDirection]::InOut
    )

    try {
        $Client.Connect(1500)
    }
    catch {
        $Client.Dispose()
        return $null
    }

    try {
        $Utf8 = New-Object System.Text.UTF8Encoding($false)
        $Writer = New-Object System.IO.StreamWriter($Client, $Utf8)
        $Writer.AutoFlush = $true
        $Reader = New-Object System.IO.StreamReader($Client, $Utf8)

        # 请求 id 用时间戳即可：每条命令一个独立连接，不需要真正唯一
        $Id = [string][DateTime]::UtcNow.Ticks

        $Writer.WriteLine($Id + "`t" + $Command + "`t" + $Argument)

        $Reply = $Reader.ReadLine()
        if (-not $Reply) {
            return @{ Ok = $false; Text = '托盘没有返回结果（连接被提前关闭）' }
        }

        $Parts = $Reply.Split("`t", 3)
        $Text = ''
        if ($Parts.Count -ge 3) {
            $Text = $Parts[2]
        }

        # control.ps1 把正文里的换行转义成 \n，这里还原
        $Text = $Text -replace '\\n', "`n"

        $Ok = ($Parts.Count -ge 2 -and $Parts[1] -eq 'ok')

        return @{ Ok = $Ok; Text = $Text }
    }
    finally {
        try { $Client.Dispose() } catch {}
    }
}

function Test-TrayRunning {
    # 托盘在不在。
    #
    # 判据是「能不能真的连上并拿到回包」，不是「管道名字在不在」：
    # 托盘被强杀（任务管理器结束进程）时，内核里可能留下一个**死的**管道实例 ——
    # 名字还在，但没人 accept，只看名字会把「死管道」误判成「托盘在运行」，
    # 于是所有命令都发不出去却先被告知一切正常。
    # 连通性是唯一权威的判据；管道不存在时直接短路，省掉一次连接尝试。
    if (-not (Test-PipeExists)) {
        return $false
    }

    return ($null -ne (Send-PipeCommand -Command 'status'))
}

function Test-PipeExists {
    # 廉价预筛：管道名字是否存在。只用来避免不必要的连接尝试，不作为最终判据。
    try {
        foreach ($P in [System.IO.Directory]::GetFiles('\\.\pipe\')) {
            if ($P -like ('*' + $PipeName)) {
                return $true
            }
        }
    }
    catch {
    }

    return $false
}

function Start-Tray {
    # 只负责把托盘拉起来（默认 HTTP）。要额外开哪几项，启动后照常发命令即可，
    # 所以这里不再有「启动方式」参数那一套。
    $Launch = Join-Path $HttpDir 'launch.ps1'
    if (-not (Test-Path -LiteralPath $Launch -PathType Leaf)) {
        throw ('缺少启动脚本：' + $Launch)
    }

    $PowerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

    $Arguments = @(
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        $Launch
    )

    $Info = New-Object System.Diagnostics.ProcessStartInfo
    $Info.FileName = $PowerShellExe
    $Info.Arguments = (
        ($Arguments | ForEach-Object { '"' + ([string]$_ -replace '"', '\"') + '"' }) -join ' '
    )
    $Info.UseShellExecute = $false
    $Info.CreateNoWindow = $true

    $Process = New-Object System.Diagnostics.Process
    $Process.StartInfo = $Info

    if (-not $Process.Start()) {
        throw '无法启动托盘进程'
    }

    $Process.Dispose()
}

function Wait-TrayReady {
    # 等托盘就绪：**管道出现即视为启动成功**。
    #
    # 判据刻意不用「能不能连上」：托盘总是先把控制通道建起来再对外服务，
    # 管道出现就意味着托盘图标已经在托盘区、程序正在运行。
    # 而连通性会受杀软/权限/沙箱这类与托盘本身无关的因素影响，
    # 拿它当启动成功的判据会把「托盘其实起来了」误报成「启动失败」。
    param(
        [int]$TimeoutMs = 25000
    )

    $Deadline = (Get-Date).AddMilliseconds($TimeoutMs)

    while ((Get-Date) -lt $Deadline) {
        if (Test-PipeExists) {
            return $true
        }

        Start-Sleep -Milliseconds 200
    }

    return $false
}

# ---------- 主流程 ----------

$ArgList = @($args)
$First = ''

# 首词只用来判断「是启动托盘还是执行命令」，别名归一化统一放在下面的命令循环里做。
if ($ArgList.Count -ge 1 -and $ArgList[0]) {
    $First = ([string]$ArgList[0]).Trim().ToLowerInvariant()
}

if ($CommandAliases.ContainsKey($First)) {
    $First = $CommandAliases[$First]
}

# 1) 帮助
if ($First -eq 'help' -or $First -eq '-h' -or $First -eq '--help' -or $First -eq '/?') {
    Write-Usage
    exit 0
}

# 2) 启动托盘，只有两个入口：
#
#   .server.cmd         双击/裸调 —— 拉起托盘（默认 HTTP）
#   .server.cmd start   显式启动
#
# start 不接受参数：要额外开哪几项，直接在后面写命令即可（.server.cmd http ts）。
$IsLauncher = ($First -eq '' -or $First -eq 'start')

if ($IsLauncher) {
    if (Test-TrayRunning) {
        Write-Host '本地服务托盘已在运行。' -ForegroundColor Yellow
        Write-Host '（查看状态：.server.cmd status）'
        exit 0
    }

    Start-Tray

    if (-not (Wait-TrayReady)) {
        Write-Host '托盘启动失败或超时，请手动双击 .server.cmd 重试。' -ForegroundColor Red
        exit 1
    }

    Write-Host '已启动并隐藏到托盘。' -ForegroundColor Green

    # start 后面的命令继续执行（.server.cmd start ts）
    if ($ArgList.Count -lt 2) {
        exit 0
    }

    $CommandList = @($ArgList[1..($ArgList.Count - 1)])
}
else {
    # 3) 其余入口都是命令，可以一次写多条
    $CommandList = @($ArgList)
}

# 规范化每条命令；任何一条不认识就整体拒绝，避免执行一半才发现打错字
$Todo = @()
foreach ($Raw in $CommandList) {
    $Name = ([string]$Raw).Trim().ToLowerInvariant()
    if (-not $Name) {
        continue
    }

    if ($CommandAliases.ContainsKey($Name)) {
        $Name = $CommandAliases[$Name]
    }

    if (-not $Commands.Contains($Name)) {
        Write-Host ('未知命令：' + ([string]$Raw).Trim()) -ForegroundColor Red
        Write-Usage
        exit 2
    }

    # help 混在中间就地展开
    if ($Name -eq 'help') {
        Write-Usage
        continue
    }

    $Todo += $Name
}

if ($Todo.Count -eq 0) {
    exit 0
}

# 托盘没在跑时先问一句：确认后启动托盘（默认 HTTP），再把命令依次执行掉。
# 回答 N 就什么都不做 —— 命令行的副作用必须是用户点头过的。
if (-not (Test-TrayRunning)) {
    $Answer = Read-Host '本地服务托盘未运行，是否现在启动？[Y/N]'

    if ($Answer -notmatch '^[Yy]') {
        Write-Host '已取消。'
        exit 1
    }

    Start-Tray

    if (-not (Wait-TrayReady)) {
        Write-Host '托盘启动失败或超时，请手动双击 .server.cmd 重试。' -ForegroundColor Red
        exit 1
    }

    Write-Host '托盘已启动（默认 HTTP）。' -ForegroundColor Green
    Write-Host ''
}

# 依次执行。每条命令都发一次；最后一条的回包负责收尾显示，
# 中间的（如 http）不回显自己的状态 —— 否则 `http ts` 会刷两遍状态块。
$Failed = $false

for ($i = 0; $i -lt $Todo.Count; $i++) {
    $Name = $Todo[$i]
    $IsLast = ($i -eq $Todo.Count - 1)

    $Result = Send-PipeCommand -Command $Name
    if ($null -eq $Result) {
        Write-Host ('与托盘通信失败（管道不可用）：' + $Name) -ForegroundColor Red
        exit 1
    }

    if ($IsLast) {
        if ($Result.Text) {
            if ($Result.Ok) {
                Write-Host $Result.Text
            }
            else {
                Write-Host $Result.Text -ForegroundColor Red
            }
        }
    }
    elseif (-not $Result.Ok -and $Result.Text) {
        # 中间步骤失败要报出来，但继续把剩下的做完（每条命令相互独立）
        Write-Host ($Name + '：' + $Result.Text) -ForegroundColor Red
    }

    if (-not $Result.Ok) {
        $Failed = $true
    }
}

if ($Failed) {
    exit 1
}

exit 0
