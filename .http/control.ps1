# 命令行控制通道：根目录“.本地服务.cmd”通过命名管道把子命令发到正在运行的托盘进程。
#
# 为什么需要它：
#   service.ps1 的全部状态都在托盘进程的内存里（$script:SvcBaseProc / $script:SvcTunnelOn …），
#   新起一个进程 dot-source 同一个文件只会得到一份「看起来一样、其实互不相干」的状态，
#   照着它调 Set-SvcBase 会在用户已经跑着服务的情况下再起一套。
#   所以要真正等价于「右键托盘菜单」，命令必须落到那个已在跑的托盘进程里执行。
#
# 线程模型（关键，别改）：
#   PowerShell 脚本代码只能在拥有 Runspace 的线程上执行。命名管道监听必须放在后台线程，
#   但后台线程**不能**直接调用 Invoke-SvcToggleBase 之类的函数（会以 ScriptBlock.GetContextFromTLS
#   之类的形式崩掉整个进程）。所以这里拆成两半：
#     * 后台线程：只收管道字节，把命令塞进 ConcurrentQueue，再把「有活干了」这个信号置位；
#       它绝不碰任何 service.ps1 的函数。
#     * UI 线程：一个 WinForms Timer 周期性把队列里的命令取出，在托盘自己的线程上执行并回写结果。
#   客户端按「请求 id」匹配回包，所以同一连接可以一次问一条、也可以连续问。

$script:CtlPipeName   = 'CarefulLocalServiceControl'

# ⚠️ 必须是 ConcurrentQueue[string]，与下面 C# 里 CarefulPipeListener 的构造函数签名逐字一致。
#    曾经写成 ConcurrentQueue[object]：PowerShell 传参时会**静默转换**成另一个新实例
#    （ReferenceEquals = False），于是后台线程往新队列写、UI 线程读老的空队列 ——
#    表现为「管道能连上、命令永远不回包」，status 因此一直显示未运行。
$script:CtlQueue      = New-Object 'System.Collections.Concurrent.ConcurrentQueue[string]'
$script:CtlPort       = 9527

function Get-CtlPipeName {
    # 给自检脚本用：拿到实际管道名，避免两边写死不一致
    return $script:CtlPipeName
}

function Initialize-CtlChannel {
    param(
        [int]$Port = 9527
    )

    $script:CtlPort = $Port
    $script:CtlExitRequested = $false
    $script:CtlExitAt = $null
    $script:CtlPending = $null
    $script:CtlCurrentId = ''

    # 后台监听线程。用独立的 .NET 类而不是 PowerShell ScriptBlock：
    # ScriptBlock 在非 Runspace 线程上跑不了，这里必须用纯 .NET 代码。
    $Source = @'
using System;
using System.Collections.Concurrent;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;

public sealed class CarefulPipeListener
{
    private readonly string _pipeName;
    private readonly ConcurrentQueue<string> _inbox;
    private readonly ConcurrentQueue<string> _outbox;
    private Thread _thread;

    public CarefulPipeListener(string pipeName,
                               ConcurrentQueue<string> inbox,
                               ConcurrentQueue<string> outbox)
    {
        _pipeName = pipeName;
        _inbox = inbox;
        _outbox = outbox;
    }

    public void Start()
    {
        _thread = new Thread(Loop);
        _thread.IsBackground = true;
        _thread.Name = "CarefulPipeListener";
        _thread.Start();
    }

    private void Loop()
    {
        while (true)
        {
            try
            {
                using (NamedPipeServerStream server = new NamedPipeServerStream(
                    _pipeName,
                    PipeDirection.InOut,
                    1,
                    PipeTransmissionMode.Byte,
                    PipeOptions.None))
                {
                    server.WaitForConnection();
                    Handle(server);
                }
            }
            catch
            {
                // 单个连接出错不能让监听线程死掉，睡一下重新等下一个连接
                Thread.Sleep(200);
            }
        }
    }

    private void Handle(Stream stream)
    {
        StreamReader reader = new StreamReader(stream, new UTF8Encoding(false));
        StreamWriter writer = new StreamWriter(stream, new UTF8Encoding(false));
        writer.AutoFlush = true;

        string line = reader.ReadLine();
        if (line == null)
        {
            return;
        }

        // 报文：<请求id>\t<命令>\t<参数…>；回包：<请求id>\t<ok|err>\t<正文>
        string[] parts = line.Split('\t');
        string id = parts.Length > 0 ? parts[0] : "";
        string command = parts.Length > 1 ? parts[1] : "";

        StringBuilder argBuilder = new StringBuilder();
        for (int i = 2; i < parts.Length; i++)
        {
            if (i > 2) { argBuilder.Append('\t'); }
            argBuilder.Append(parts[i]);
        }

        _inbox.Enqueue(id + "\t" + command + "\t" + argBuilder.ToString());

        // 等 UI 线程把结果放回来（带上同一个 id）。
        // 上限要比服务端「等就绪」的 30 秒宽，否则启动类命令会在就绪前被判超时。
        DateTime deadline = DateTime.UtcNow.AddSeconds(90);
        while (DateTime.UtcNow < deadline)
        {
            string result;
            if (_outbox.TryDequeue(out result))
            {
                string[] rp = result.Split(new char[] { '\t' }, 3);
                if (rp.Length > 0 && rp[0] == id)
                {
                    writer.WriteLine(result);
                    return;
                }

                // 不是给这个请求的，放回去继续等（正常情况下不会发生）
                _outbox.Enqueue(result);
            }

            Thread.Sleep(25);
        }

        writer.WriteLine(id + "\terr\t控制通道超时：托盘进程没有在限时内响应");
    }
}
'@

    if (-not ('CarefulPipeListener' -as [type])) {
        Add-Type -TypeDefinition $Source -Language CSharp
    }

    # 管道只传「请求行」；回包队列由 UI 线程填充
    $script:CtlOutbox = New-Object 'System.Collections.Concurrent.ConcurrentQueue[string]'

    $script:CtlListener = New-Object CarefulPipeListener(
        $script:CtlPipeName,
        $script:CtlQueue,
        $script:CtlOutbox
    )

    $script:CtlListener.Start()
}

function Format-CtlStatusText {
    # status 命令的输出：状态行 + 四行勾选态。勾选态直接来自 Get-SvcState，
    # 和右键菜单里看到的对号是同一份数据，不会出现两边不一致。
    param(
        $State
    )

    $Lines = @()
    $Lines += ('状态：' + $State.StatusText)
    $Lines += ('  ' + (Format-CtlCheck $State.HttpChecked) + ' HTTP 服务')
    $Lines += ('  ' + (Format-CtlCheck $State.HttpsChecked) + ' HTTPS 服务')
    $Lines += ('  ' + (Format-CtlCheck $State.TunnelChecked) + ' 公网隧道')
    $Lines += ('  ' + (Format-CtlCheck $State.TailscaleChecked) + ' Tailscale')

    if ($State.TunnelUrl) {
        $Lines += ('隧道地址：' + $State.TunnelUrl)
    }

    if ($State.TailscaleUrl) {
        $Lines += ('Tailscale 地址：' + $State.TailscaleUrl)
    }

    return ($Lines -join "`n")
}

function Format-CtlCheck {
    param(
        [bool]$Checked
    )

    if ($Checked) {
        return '[O]'
    }

    return '[ ]'
}

function Invoke-CtlCommand {
    # 在 UI 线程上执行一条命令，返回 @{ Ok = <bool>; Text = <string> }。
    # 这里的每一项都和托盘右键菜单项一一对应。
    param(
        [string]$Command,
        [string]$Argument = ''
    )

    # 启动/切换类命令：执行完等服务真正就绪再回包（命令行默认等，见 .本地服务.cmd）。
    # 服务状态只在托盘进程内存里，所以这个「等」必须在托盘这边做，客户端等不到。
    $WaitAfter = $false

    switch ($Command) {
        'http' {
            Invoke-SvcToggleBase 'http'
            $WaitAfter = $true
        }
        'https' {
            Invoke-SvcToggleBase 'https'
            $WaitAfter = $true
        }
        'tunnel' {
            Invoke-SvcToggleTunnel
            $WaitAfter = $true
        }
        'tailscale' {
            Invoke-SvcToggleTailscale
            $WaitAfter = $true
        }
        'open' {
            Invoke-SvcOpenPage -Lan $false
        }
        'lan' {
            Invoke-SvcOpenPage -Lan $true
        }
        'tsopen' {
            $Url = (Get-SvcState).TailscaleUrl
            if (-not $Url) {
                $Url = Get-SvcTailscaleUrl
            }

            if ($Url) {
                Start-Process $Url
            }
            else {
                return @{ Ok = $false; Text = 'Tailscale 地址尚未就绪（Tailscale 未勾选或还没连上）' }
            }
        }
        'copyurl' {
            $Url = Invoke-SvcCopyTunnelUrl
            if ($Url) {
                return @{ Ok = $true; Text = ('已复制隧道地址：' + $Url) }
            }

            return @{ Ok = $false; Text = '隧道地址尚未就绪（公网隧道未勾选或还没拿到地址）' }
        }
        'tscopyurl' {
            $Url = Invoke-SvcCopyTailscaleUrl
            if ($Url) {
                return @{ Ok = $true; Text = ('已复制 Tailscale 地址：' + $Url) }
            }

            return @{ Ok = $false; Text = 'Tailscale 地址尚未就绪（Tailscale 未勾选或还没连上）' }
        }
        'status' {
            return @{ Ok = $true; Text = (Format-CtlStatusText -State (Get-SvcState)) }
        }
        'stop' {
            # 「退出并停止」之前的停服务语义：停掉全部服务，但保留托盘
            Stop-SvcAll
            return @{ Ok = $true; Text = '已停止全部服务（托盘保留）' }
        }
        'exit' {
            # 「退出并停止」菜单项：服务全停 + 托盘退出。
            # 用显式的 Exit 标志而不是靠正文里的魔法字符串传递意图：
            # 正文是给人看的，拿它兼做控制信号，一旦哪天真返回同样文字就会误退出。
            return @{ Ok = $true; Text = '已退出并停止全部服务。'; Exit = $true }
        }
        default {
            return @{ Ok = $false; Text = ('未知命令：' + $Command) }
        }
    }

    if ($WaitAfter) {
        # 不能在这里同步等：会把 UI 线程（托盘图标、消息循环）冻住最长 30 秒。
        # 改为登记成一个「待就绪」请求，由后续 tick 推进，就绪后再回包。
        $script:CtlPending = @{
            Id      = $script:CtlCurrentId
            Since   = Get-Date
            Timeout = 30000
        }

        return $null
    }

    return @{ Ok = $true; Text = '' }
}

function Test-CtlReady {
    # 待就绪请求的推进：每 tick 调一次，就绪/超时则返回回包正文（否则 $null）
    param(
        $Pending
    )

    $State = Get-SvcState

    $Ready = ($State.StatusText -like '运行中*') -or ($State.StatusText -eq '已停止')
    $TimedOut = (((Get-Date) - $Pending.Since).TotalMilliseconds -ge $Pending.Timeout)

    if (-not $Ready -and -not $TimedOut) {
        return $null
    }

    $Ok = $Ready -or ($State.StatusText -like '运行中*')

    return @{ Ok = $Ok; Text = (Format-CtlStatusText -State $State) }
}

function Update-CtlPending {
    # 处理中的「待就绪」请求：就绪/超时后回包。每 tick 调一次。
    if (-not $script:CtlPending) {
        return
    }

    $Result = Test-CtlReady -Pending $script:CtlPending
    if (-not $Result) {
        return
    }

    $Id = $script:CtlPending.Id
    $script:CtlPending = $null

    $Text = [string]$Result.Text
    $Text = $Text -replace "`r`n", '\n'
    $Text = $Text -replace "`n", '\n'

    $Status = 'ok'
    if (-not $Result.Ok) {
        $Status = 'err'
    }

    [void]$script:CtlOutbox.Enqueue($Id + "`t" + $Status + "`t" + $Text)
}

function Update-CtlChannel {
    # UI 线程（托盘 Timer）周期性调用：取出后台线程收到的命令，执行并回写结果。
    # 必须整体兜异常：异常冒泡出 UI 回调会把整个托盘进程带走。
    if (-not $script:CtlQueue) {
        return
    }

    # 先把上一轮没回完的「待就绪」请求推进（就绪/超时后回包）
    Update-CtlPending

    $Request = $null
    $Pending = 0

    while ($script:CtlQueue.TryDequeue([ref]$Request)) {
        $Pending++

        # 一次 tick 最多处理 8 条，避免恶意/异常客户端把 UI 线程霸占住
        if ($Pending -gt 8) {
            break
        }

        # 同一时刻只允许一个待就绪请求：多了会让「哪条命令对应哪个回包」变得难以推理
        if ($script:CtlPending) {
            $Parts0 = ([string]$Request).Split("`t", 3)
            $Id0 = ''
            if ($Parts0.Count -ge 1) { $Id0 = $Parts0[0] }
            [void]$script:CtlOutbox.Enqueue($Id0 + "`terr`t上一条启动命令还在等就绪，请稍后重试")
            continue
        }

        $Parts = ([string]$Request).Split("`t", 3)
        $Id = ''
        $Command = ''
        $Argument = ''

        if ($Parts.Count -ge 1) { $Id = $Parts[0] }
        if ($Parts.Count -ge 2) { $Command = $Parts[1] }
        if ($Parts.Count -ge 3) { $Argument = $Parts[2] }

        $Ok = $true
        $Text = ''
        $ExitWanted = $false

        try {
            $script:CtlCurrentId = $Id
            $Result = Invoke-CtlCommand -Command $Command -Argument $Argument

            if ($null -eq $Result) {
                # 已登记成待就绪请求，回包由 Update-CtlPending 负责，这里不能回
                continue
            }

            $Ok = $Result.Ok
            $Text = [string]$Result.Text
            $ExitWanted = [bool]$Result.Exit
        }
        catch {
            $Ok = $false
            $Text = ('执行失败：' + $_.Exception.Message)
            Write-SvcTrayError $_
        }

        # 正文里的换行必须转义：回包是「一行一条」，裸换行会把协议拆坏
        $Text = $Text -replace "`r`n", '\n'
        $Text = $Text -replace "`n", '\n'

        $Status = 'ok'
        if (-not $Ok) {
            $Status = 'err'
        }

        [void]$script:CtlOutbox.Enqueue($Id + "`t" + $Status + "`t" + $Text)

        if ($ExitWanted) {
            $script:CtlExitRequested = $true
        }
    }
}
