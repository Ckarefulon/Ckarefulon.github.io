<#
	目录索引生成器 —— 主逻辑
	用法：双击同目录下的 make-index.cmd（或 powershell -File make-index.ps1）

	规则
	  1. 站点根目录始终处理。
	  2. 其余目录：只有「自身名字以大写字母 A-Z 开头」才处理；小写字母开头的父目录，整支跳过。
	  3. 页面内容 = 该目录下所有「名字以大写字母开头」的直接子文件夹（不含文件、不含小写文件夹）。
	  4. 已存在 index.html 时：
	       带生成标记 @generated:dir-index 的 → 内容有变化才刷新（脚本自己的产物）
	       不带标记的（手写页）            → 绝不触碰
	  5. 页面里的链接指向 /相对路径/ ，子目录本身也会有 index.html，点进去不会 404。

	参数
	  -Root   指定起始目录，默认 = 本脚本所在目录（即站点根）
	  -DryRun 只打印计划，不写文件
#>
[CmdletBinding()]
param(
	[string]$Root,
	[switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$MARKER = '@generated:dir-index'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if ($PSBoundParameters.ContainsKey('Root') -and $Root) {
	$siteRoot = (Resolve-Path -LiteralPath $Root).Path.TrimEnd('\')
} else {
	$siteRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path.TrimEnd('\')
}

# ---------- 小工具 ----------

function Get-RelPath {
	param([string]$Full)
	if ($Full.Length -le $siteRoot.Length) { return '' }
	return $Full.Substring($siteRoot.Length).TrimStart('\')
}

function Get-UrlPath {
	param([string]$Rel)
	if ([string]::IsNullOrEmpty($Rel)) { return '/' }
	$segs = $Rel -split '\\'
	return '/' + (($segs | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/') + '/'
}

function HtmlEnc {
	param([string]$Text)
	return [System.Net.WebUtility]::HtmlEncode($Text)
}

# 站点的公共资源（nav.css / nav.js / site-scope.js）都带 ?v= 缓存号，且这些号会被全站统一提升。
# 这里不写死，改成扫一遍站内 HTML，取出现次数最多的那个版本号，跟着站点走。
function Get-AssetVer {
	param([string]$Asset)   # 例如 nav.js、nav.css、site-scope.js
	$counts = @{}
	$files = @(Get-ChildItem -LiteralPath $siteRoot -Filter *.html -Recurse -File -Force -ErrorAction SilentlyContinue |
		Where-Object { $_.Name -notlike '.*' -and $_.FullName -notmatch '\\\.[^\\]*\\' -and $_.Length -gt 0 })
	$pattern = [regex]::Escape($Asset) + '\?v=([^"''&\s>]+)'
	foreach ($f in $files) {
		try {
			$sr = New-Object System.IO.StreamReader($f.FullName, [System.Text.Encoding]::UTF8)
			$buf = New-Object char[] 8192
			$n = $sr.Read($buf, 0, $buf.Length)
			$sr.Close()
			$head = if ($n -gt 0) { -join $buf[0..($n - 1)] } else { '' }
		} catch { continue }
		$m = [regex]::Match($head, $pattern)
		if ($m.Success) {
			$v = $m.Groups[1].Value
			if ($counts.ContainsKey($v)) { $counts[$v] = $counts[$v] + 1 } else { $counts[$v] = 1 }
		}
	}
	if ($counts.Count -eq 0) { return '' }
	$top = $counts.GetEnumerator() | Sort-Object -Property Value -Descending | Select-Object -First 1
	return '?v=' + $top.Key
}

# 该目录下「大写字母开头」的直接子文件夹（真符号链接 / junction 跳过，避免递归成环）
#
# 注意：OneDrive 的按需占位目录同样带 ReparsePoint 属性，不能用它判断链接
#       （用 Attributes -band ReparsePoint 会把目录全部误杀）；
#       LinkType 只有真链接才非空，这里以 LinkType 为准。
function Get-UpperDirs {
	param([System.IO.DirectoryInfo]$Dir)
	Get-ChildItem -LiteralPath $Dir.FullName -Directory -Force -ErrorAction SilentlyContinue |
		Where-Object {
			$_.Name -cmatch '^[A-Z]' -and
			[string]::IsNullOrEmpty($_.LinkType)
		} |
		Sort-Object -Property Name
}

# ---------- 模板 ----------

$pageTpl = @'
<!doctype html>
<html lang="zh-CN">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
	<link rel="icon" href="/favicon.svg?v=7" type="image/svg+xml">

	<!-- 主题先落地，避免深浅色闪一下（与其它页面共用 smartCubeTheme） -->
	<script>
		(function () {
			var saved = null;
			try { saved = localStorage.getItem("smartCubeTheme"); } catch (e) {}
			var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
			document.documentElement.dataset.theme = saved || (prefersDark ? "dark" : "light");
		})();
	</script>

	<!-- 设计令牌（dsk-*），必须先于页面样式 -->
	<link rel="stylesheet" href="/ui/colors_and_type.css">
	<link rel="stylesheet" href="/nav/nav.css@@VER_NAVCSS@@">
	<script src="/assets/services/core/site-scope.js@@VER_SCOPE@@" defer></script>
	<script src="/nav/nav.js@@VER_NAVJS@@" defer></script>

	<!-- @@MARKER@@ : 本页由 make-index 自动生成，手动修改会在下次运行时被覆盖 -->
	<meta name="generator" content="make-index (@@MARKER@@)">
	<title>@@PAGETITLE@@</title>
	<style>
		:root {
			--surfaceSolid: var(--dsk-card);
			--line: var(--dsk-border);
			--ink: var(--dsk-foreground);
			--muted: var(--dsk-foreground-muted);
		}
		* { box-sizing: border-box; }
		body {
			margin: 0;
			min-height: 100vh;
			padding-top: var(--site-nav-height, 44px);
			background-image: var(--dsk-page-bg);
			background-attachment: fixed;
			color: var(--ink);
			font-family: var(--dsk-font-sans);
			font-size: var(--dsk-text-base);
			-webkit-font-smoothing: antialiased;
		}
		.dirPage { max-width: 1040px; margin: 0 auto; padding: 44px 24px 80px; }
		.dirBack {
			display: inline-flex; align-items: center; gap: 6px;
			font-size: var(--dsk-text-sm); color: var(--muted);
			text-decoration: none; transition: color .16s ease;
		}
		.dirBack:hover { color: var(--dsk-accent); }
		.dirTitle {
			margin: 14px 0 0;
			font-size: var(--dsk-text-4xl);
			font-weight: 650;
			line-height: var(--dsk-leading-tight);
			letter-spacing: -0.02em;
		}
		.dirTitle b {
			font-weight: inherit;
			background: linear-gradient(118deg, var(--dsk-purple-200), var(--dsk-accent));
			-webkit-background-clip: text;
			background-clip: text;
			color: transparent;
		}
		.dirMeta { margin: 10px 0 0; font-size: var(--dsk-text-sm); color: var(--muted); }
		.dirGrid {
			list-style: none;
			margin: 30px 0 0;
			padding: 0;
			display: grid;
			gap: 14px;
			grid-template-columns: repeat(auto-fill, minmax(272px, 1fr));
		}
		.dirCard {
			display: flex; align-items: center; gap: 14px;
			padding: 16px 18px;
			border-radius: var(--dsk-radius-lg);
			background: linear-gradient(158deg, rgba(107, 93, 194, 0.16), rgba(22, 19, 40, 0.92) 58%);
			border: 1px solid var(--dsk-card-border);
			color: inherit; text-decoration: none;
			box-shadow: var(--dsk-shadow-sm);
			transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease;
		}
		.dirCard:hover {
			transform: translateY(-2px);
			border-color: rgba(36, 240, 234, 0.34);
			box-shadow: 0 10px 30px rgba(36, 240, 234, 0.10), var(--dsk-shadow-md);
		}
		.dirCard:focus-visible { outline: 2px solid var(--dsk-ring); outline-offset: 2px; }
		.dirIcon { flex: none; display: flex; color: var(--dsk-purple-300); transition: color .18s ease; }
		.dirCard:hover .dirIcon { color: var(--dsk-accent); }
		.dirBody { flex: 1; min-width: 0; }
		.dirName {
			display: block;
			font-size: var(--dsk-text-lg);
			font-weight: 600;
			letter-spacing: -0.01em;
			overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		}
		.dirHint {
			display: block;
			margin-top: 3px;
			font-size: var(--dsk-text-xs);
			font-family: var(--dsk-font-mono);
			color: var(--muted);
		}
		.dirGo {
			flex: none;
			font-size: var(--dsk-text-lg);
			color: var(--dsk-foreground-subtle);
			transition: transform .18s ease, color .18s ease;
		}
		.dirCard:hover .dirGo { color: var(--dsk-accent); transform: translateX(3px); }
		.dirEmpty {
			margin: 30px 0 0;
			padding: 30px;
			border-radius: var(--dsk-radius-lg);
			border: 1px dashed var(--dsk-border);
			background: rgba(42, 40, 64, 0.35);
			color: var(--muted);
			font-size: var(--dsk-text-sm);
			text-align: center;
		}
		.dirFoot { margin: 36px 0 0; font-size: var(--dsk-text-xs); color: var(--dsk-foreground-subtle); }
		:root[data-theme="light"] .dirCard {
			background: linear-gradient(158deg, rgba(93, 78, 168, 0.08), rgba(255, 255, 255, 0.96) 58%);
		}
		:root[data-theme="light"] .dirEmpty { background: rgba(236, 238, 246, 0.6); }
		@media (max-width: 520px) {
			.dirPage { padding: 28px 16px 60px; }
			.dirTitle { font-size: var(--dsk-text-3xl); }
			.dirGrid { grid-template-columns: 1fr; }
		}
	</style>
</head>
<body>
	<main class="dirPage">
@@BACKLINK@@		<h1 class="dirTitle"><b>@@H1@@</b></h1>
		<p class="dirMeta">@@META@@</p>
@@CONTENT@@		<p class="dirFoot">此页由 make-index 脚本自动生成</p>
	</main>

	<!-- nav.js 只注册 window.siteNav，顶栏要由页面自己 init；顺带把主题切换接上 -->
	<script>
		(function () {
			function applyTheme(theme) {
				theme = theme === "dark" ? "dark" : "light";
				document.documentElement.dataset.theme = theme;
				var btn = document.getElementById("siteThemeToggle");
				if (btn) { btn.textContent = theme === "dark" ? "\u2600" : "\u263E"; }
				try { localStorage.setItem("smartCubeTheme", theme); } catch (e) {}
			}
			function boot() {
				if (window.siteNav && typeof window.siteNav.init === "function") {
					window.siteNav.init({ setTheme: applyTheme });
				}
			}
			if (document.readyState === "loading") {
				document.addEventListener("DOMContentLoaded", boot);
			} else {
				boot();
			}
		})();
	</script>
</body>
</html>
'@

$itemTpl = @'
			<li>
				<a class="dirCard" href="@@HREF@@">
					<span class="dirIcon"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2a2 2 0 0 1 1.6.8L11.5 7H18a3 3 0 0 1 3 3v6.5A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"/></svg></span>
					<span class="dirBody">
						<span class="dirName">@@NAME@@</span>
						<span class="dirHint">@@HINT@@</span>
					</span>
					<span class="dirGo" aria-hidden="true">&#8594;</span>
				</a>
			</li>
'@

# ---------- 公共资源版本号（跟着站点现况走，避免写死被回退） ----------

$verNavCss = Get-AssetVer 'nav.css'
$verNavJs = Get-AssetVer 'nav.js'
$verScope = Get-AssetVer 'site-scope.js'

# ---------- 生成单页 ----------

function New-IndexHtml {
	param(
		[System.IO.DirectoryInfo]$Dir,
		[object[]]$Upper,
		[string]$Rel
	)

	$isRoot = [string]::IsNullOrEmpty($Rel)
	$title = if ($isRoot) { 'Ckarefulon' } else { $Dir.Name }
	$pageTitle = if ($isRoot) { 'Ckarefulon &#8212; 目录' } else { (HtmlEnc $Rel) + ' &#8212; 目录' }

	if ($isRoot) {
		$back = ''
		$meta = '站点根目录 &#183; 共 ' + $Upper.Count + ' 个子文件夹'
	} else {
		$parentRel = Split-Path -Path $Rel -Parent
		$parentName = if ($parentRel) { Split-Path -Path $parentRel -Leaf } else { '站点首页' }
		$back = "`t`t" + '<a class="dirBack" href="' + (Get-UrlPath $parentRel) + '">&#8592; 返回 ' + (HtmlEnc $parentName) + '</a>' + "`n"
		$meta = '共 ' + $Upper.Count + ' 个子文件夹'
	}

	if ($Upper.Count -eq 0) {
		$content = "`t`t" + '<div class="dirEmpty">此目录下暂无大写字母开头的子文件夹。</div>' + "`n"
	} else {
		$sb = New-Object System.Text.StringBuilder
		[void]$sb.Append("`t`t" + '<ul class="dirGrid">' + "`n")
		foreach ($c in $Upper) {
			$childRel = if ($isRoot) { $c.Name } else { $Rel + '\' + $c.Name }
			$subCount = @(Get-UpperDirs -Dir $c).Count
			$hint = if ($subCount -gt 0) { "$subCount 个子文件夹" } else { '暂无子目录' }
			$item = $itemTpl.Replace('@@HREF@@', (Get-UrlPath $childRel)).Replace('@@NAME@@', (HtmlEnc $c.Name)).Replace('@@HINT@@', $hint)
			[void]$sb.Append($item)
			[void]$sb.Append("`n")
		}
		[void]$sb.Append("`t`t" + '</ul>' + "`n")
		$content = $sb.ToString()
	}

	$html = $pageTpl
	$html = $html.Replace('@@MARKER@@', $MARKER)
	$html = $html.Replace('@@VER_NAVCSS@@', $verNavCss)
	$html = $html.Replace('@@VER_NAVJS@@', $verNavJs)
	$html = $html.Replace('@@VER_SCOPE@@', $verScope)
	$html = $html.Replace('@@PAGETITLE@@', $pageTitle)
	$html = $html.Replace('@@BACKLINK@@', $back)
	$html = $html.Replace('@@H1@@', (HtmlEnc $title))
	$html = $html.Replace('@@META@@', $meta)
	$html = $html.Replace('@@CONTENT@@', $content)
	return $html + "`n"
}

# ---------- 遍历 ----------

$created   = New-Object System.Collections.ArrayList
$refreshed = New-Object System.Collections.ArrayList
$kept      = New-Object System.Collections.ArrayList
$untouched = New-Object System.Collections.ArrayList
$planned   = New-Object System.Collections.ArrayList

$queue = New-Object System.Collections.Queue
$queue.Enqueue((Get-Item -LiteralPath $siteRoot))
$visited = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

while ($queue.Count -gt 0) {
	$dir = $queue.Dequeue()
	if (-not $visited.Add($dir.FullName)) { continue }   # 兜底：同一目录不重复处理
	$rel = Get-RelPath $dir.FullName
	$upper = @(Get-UpperDirs -Dir $dir)
	$indexPath = Join-Path $dir.FullName 'index.html'
	$html = New-IndexHtml -Dir $dir -Upper $upper -Rel $rel

	if (-not (Test-Path -LiteralPath $indexPath)) {
		[void]$created.Add($rel)
		[void]$planned.Add(($rel, '新建'))
		if (-not $DryRun) { [System.IO.File]::WriteAllText($indexPath, $html, $utf8NoBom) }
	} else {
		$existing = [System.IO.File]::ReadAllText($indexPath, [System.Text.Encoding]::UTF8)
		if ($existing.IndexOf($MARKER) -lt 0) {
			# 手写的 index.html —— 不碰
			[void]$untouched.Add($rel)
		} elseif ($existing -eq $html) {
			[void]$kept.Add($rel)
		} else {
			[void]$refreshed.Add($rel)
			[void]$planned.Add(($rel, '刷新'))
			if (-not $DryRun) { [System.IO.File]::WriteAllText($indexPath, $html, $utf8NoBom) }
		}
	}

	# 只往「大写开头」的子目录里继续走；小写开头的一律不进
	foreach ($c in $upper) { $queue.Enqueue($c) }
}

# ---------- 输出 ----------

Write-Host ''
Write-Host '  目录索引生成器' -ForegroundColor Magenta
Write-Host ('  站点根：' + $siteRoot) -ForegroundColor DarkGray
Write-Host ('  公共资源版本（自动探测）：nav.css ' + $(if ($verNavCss) { $verNavCss } else { '(无)' }) + ' / nav.js ' + $(if ($verNavJs) { $verNavJs } else { '(无)' })) -ForegroundColor DarkGray
if ($DryRun) { Write-Host '  模式：试运行（不写入文件）' -ForegroundColor Yellow }
Write-Host ''

if ($planned.Count -gt 0) {
	$tag = if ($DryRun) { '[计划]' } else { '[已写]' }
	foreach ($p in $planned) {
		$show = if ([string]::IsNullOrEmpty($p[0])) { '(站点根目录)' } else { $p[0] }
		Write-Host ('    ' + $tag + ' ' + $p[1] + '  ' + $show)
	}
	Write-Host ''
}

Write-Host ('  新建 ' + $created.Count + ' 个' + $(if ($DryRun) { '（试运行）' } else { '' })) -ForegroundColor Green
Write-Host ('  刷新 ' + $refreshed.Count + ' 个') -ForegroundColor Cyan
Write-Host ('  已是最新 ' + $kept.Count + ' 个') -ForegroundColor DarkGray
if ($untouched.Count -gt 0) {
	Write-Host ''
	Write-Host ('  跳过 ' + $untouched.Count + ' 个已存在的手写 index.html：') -ForegroundColor DarkYellow
	foreach ($u in $untouched) {
		$show = if ([string]::IsNullOrEmpty($u)) { '(站点根目录)' } else { $u }
		Write-Host ('    - ' + $show) -ForegroundColor DarkYellow
	}
}
Write-Host ''
Write-Host '  完成。' -ForegroundColor Green
Write-Host ''
