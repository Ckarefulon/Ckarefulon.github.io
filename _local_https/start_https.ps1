$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'network.ps1')

$Port = 9527

$InfoPath = Join-Path $PSScriptRoot 'certificate-info.json'
$DetectedIp = Get-PreferredLanIp
$CurrentIp = $DetectedIp

if (-not (Test-Path -LiteralPath $InfoPath -PathType Leaf)) {
    throw 'HTTPS certificate metadata is missing. Run setup_https.ps1 as Administrator.'
}

try {
    $Info = Get-Content $InfoPath | ConvertFrom-Json
    $ServerCert = Get-Item -LiteralPath (
        'Cert:\LocalMachine\My\' + $Info.ServerThumbprint
    ) -ErrorAction Stop
    $San = $ServerCert.Extensions |
        Where-Object { $_.Oid.Value -eq '2.5.29.17' } |
        Select-Object -First 1
}
catch {
    throw 'HTTPS server certificate is missing. Run setup_https.ps1 as Administrator.'
}

# A certificate for an old address must never be presented as valid for a new
# address. The tray refreshes the leaf certificate under the same trusted CA.
if (-not $San -or -not $San.Format($false).Contains($DetectedIp)) {
    throw (
        "The HTTPS certificate does not cover the current LAN address $DetectedIp. " +
        'Run setup_https.ps1 as Administrator to refresh the server certificate.'
    )
}

$SiteRoot = [IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot '..')
)

$SiteRoot = $SiteRoot.TrimEnd(
    [char[]]@([char]92, [char]47)
)

$RootPrefix = $SiteRoot + [IO.Path]::DirectorySeparatorChar
$ExcludePath = Join-Path $SiteRoot '.git\info\exclude'

$script:ExcludeFileStamp = ''
$script:ExcludeRules = @()

function Convert-ExcludeGlobToRegex {
    param(
        [string]$Glob
    )

    $Builder = New-Object System.Text.StringBuilder
    $Index = 0

    while ($Index -lt $Glob.Length) {
        $Character = [string]$Glob[$Index]

        if ($Character -eq '\') {
            if (($Index + 1) -lt $Glob.Length) {
                $Index++

                [void]$Builder.Append(
                    [Regex]::Escape(
                        [string]$Glob[$Index]
                    )
                )
            }
            else {
                [void]$Builder.Append('\\')
            }
        }
        elseif ($Character -eq '*') {
            if (
                ($Index + 1) -lt $Glob.Length -and
                [string]$Glob[$Index + 1] -eq '*'
            ) {
                while (
                    ($Index + 1) -lt $Glob.Length -and
                    [string]$Glob[$Index + 1] -eq '*'
                ) {
                    $Index++
                }

                if (
                    ($Index + 1) -lt $Glob.Length -and
                    [string]$Glob[$Index + 1] -eq '/'
                ) {
                    $Index++
                    [void]$Builder.Append('(?:.*/)?')
                }
                else {
                    [void]$Builder.Append('.*')
                }
            }
            else {
                [void]$Builder.Append('[^/]*')
            }
        }
        elseif ($Character -eq '?') {
            [void]$Builder.Append('[^/]')
        }
        else {
            [void]$Builder.Append(
                [Regex]::Escape($Character)
            )
        }

        $Index++
    }

    return $Builder.ToString()
}

function Update-ExcludeRules {
    $CurrentStamp = 'missing'

    if (Test-Path -LiteralPath $ExcludePath -PathType Leaf) {
        $ExcludeFile = Get-Item -LiteralPath $ExcludePath

        $CurrentStamp = (
            [string]$ExcludeFile.LastWriteTimeUtc.Ticks +
            ':' +
            [string]$ExcludeFile.Length
        )
    }

    if ($CurrentStamp -eq $script:ExcludeFileStamp) {
        return
    }

    $NewRules = @()

    if ($CurrentStamp -ne 'missing') {
        $Lines = [IO.File]::ReadAllLines($ExcludePath)

        foreach ($OriginalLine in $Lines) {
            $Pattern = $OriginalLine.TrimEnd()

            if ([string]::IsNullOrEmpty($Pattern)) {
                continue
            }

            if ($Pattern.StartsWith('\#')) {
                $Pattern = $Pattern.Substring(1)
            }
            elseif ($Pattern.StartsWith('#')) {
                continue
            }

            $Negated = $false

            if ($Pattern.StartsWith('\!')) {
                $Pattern = $Pattern.Substring(1)
            }
            elseif ($Pattern.StartsWith('!')) {
                $Negated = $true
                $Pattern = $Pattern.Substring(1)
            }

            if ([string]::IsNullOrEmpty($Pattern)) {
                continue
            }

            $Anchored = $Pattern.StartsWith('/')
            $DirectoryOnly = $Pattern.EndsWith('/')

            if ($Anchored) {
                $Pattern = $Pattern.Substring(1)
            }

            if ($DirectoryOnly) {
                $Pattern = $Pattern.TrimEnd('/')
            }

            if ([string]::IsNullOrEmpty($Pattern)) {
                continue
            }

            $ContainsSlash = $Pattern.Contains('/')
            $RegexBody = Convert-ExcludeGlobToRegex $Pattern

            if ($Anchored -or $ContainsSlash) {
                $RegexText = '^' + $RegexBody
            }
            else {
                $RegexText = '(?:^|/)' + $RegexBody
            }

            # A matching directory also blocks everything below it.
            $RegexText += '(?:/.*)?$'

            $NewRules += [PSCustomObject]@{
                Regex   = $RegexText
                Negated = $Negated
                Source  = $OriginalLine
            }
        }
    }

    $script:ExcludeRules = $NewRules
    $script:ExcludeFileStamp = $CurrentStamp

    Write-Host (
        'Reloaded exclude rules: ' +
        [string]$NewRules.Count
    )
}

function Test-IsBlockedPath {
    param(
        [string]$RelativePath
    )

    $RelativePath = $RelativePath.Replace('\', '/')
    $RelativePath = $RelativePath.TrimStart('/')

    if ([string]::IsNullOrEmpty($RelativePath)) {
        return $false
    }

    # Always block every path segment named .git.
    foreach ($Segment in $RelativePath.Split('/')) {
        if ($Segment -ieq '.git') {
            return $true
        }
    }

    Update-ExcludeRules

    $Blocked = $false

    # Rules are processed in order. The final matching rule wins.
    foreach ($Rule in $script:ExcludeRules) {
        if ($RelativePath -match $Rule.Regex) {
            $Blocked = -not $Rule.Negated
        }
    }

    return $Blocked
}

function Get-RelativeWebPath {
    param(
        [string]$FullPath
    )

    if ($FullPath -ieq $SiteRoot) {
        return ''
    }

    return $FullPath.Substring(
        $RootPrefix.Length
    ).Replace('\', '/')
}

function Get-ContentType {
    param(
        [string]$FilePath
    )

    switch ([IO.Path]::GetExtension($FilePath).ToLowerInvariant()) {
        '.html'  { return 'text/html; charset=utf-8' }
        '.htm'   { return 'text/html; charset=utf-8' }
        '.css'   { return 'text/css; charset=utf-8' }
        '.js'    { return 'text/javascript; charset=utf-8' }
        '.mjs'   { return 'text/javascript; charset=utf-8' }
        '.json'  { return 'application/json; charset=utf-8' }
        '.txt'   { return 'text/plain; charset=utf-8' }
        '.xml'   { return 'application/xml; charset=utf-8' }
        '.svg'   { return 'image/svg+xml' }
        '.png'   { return 'image/png' }
        '.jpg'   { return 'image/jpeg' }
        '.jpeg'  { return 'image/jpeg' }
        '.gif'   { return 'image/gif' }
        '.webp'  { return 'image/webp' }
        '.ico'   { return 'image/x-icon' }
        '.woff'  { return 'font/woff' }
        '.woff2' { return 'font/woff2' }
        '.ttf'   { return 'font/ttf' }
        '.wasm'  { return 'application/wasm' }
        '.mp3'   { return 'audio/mpeg' }
        '.wav'   { return 'audio/wav' }
        '.ogg'   { return 'audio/ogg' }
        '.mp4'   { return 'video/mp4' }
        default  { return 'application/octet-stream' }
    }
}

function Send-TextResponse {
    param(
        $Response,
        [int]$StatusCode,
        [string]$Text
    )

    $Bytes = [Text.Encoding]::UTF8.GetBytes($Text)

    $Response.StatusCode = $StatusCode
    $Response.ContentType = 'text/plain; charset=utf-8'
    $Response.ContentLength64 = $Bytes.Length

    $Response.OutputStream.Write(
        $Bytes,
        0,
        $Bytes.Length
    )
}

$Listener = New-Object System.Net.HttpListener
$Listener.Prefixes.Add("https://+:$Port/")

try {
    Update-ExcludeRules
    $Listener.Start()

    Write-Host ''
    Write-Host 'HTTPS server started.' -ForegroundColor Green
    Write-Host "Address: https://${CurrentIp}:${Port}"
    Write-Host "Site root: $SiteRoot"
    Write-Host "Exclude file: $ExcludePath"
    Write-Host 'The .git path is always blocked.'
    Write-Host 'Press Ctrl+C to stop.'
    Write-Host ''

    while ($Listener.IsListening) {
        $Context = $Listener.GetContext()
        $Request = $Context.Request
        $Response = $Context.Response

        try {
            if (
                $Request.HttpMethod -ne 'GET' -and
                $Request.HttpMethod -ne 'HEAD'
            ) {
                Send-TextResponse `
                    -Response $Response `
                    -StatusCode 405 `
                    -Text '405 Method Not Allowed'

                continue
            }

            $UrlPath = [Uri]::UnescapeDataString(
                $Request.Url.AbsolutePath.TrimStart('/')
            )

            $RelativeInputPath = $UrlPath.Replace(
                '/',
                [IO.Path]::DirectorySeparatorChar
            )

            $RequestedPath = [IO.Path]::GetFullPath(
                (Join-Path $SiteRoot $RelativeInputPath)
            )

            # Prevent ../, absolute paths and other root escapes.
            if (
                $RequestedPath -ne $SiteRoot -and
                -not $RequestedPath.StartsWith(
                    $RootPrefix,
                    [StringComparison]::OrdinalIgnoreCase
                )
            ) {
                Send-TextResponse `
                    -Response $Response `
                    -StatusCode 403 `
                    -Text '403 Forbidden'

                continue
            }

            $RelativePath = Get-RelativeWebPath $RequestedPath

            if (Test-IsBlockedPath $RelativePath) {
                Send-TextResponse `
                    -Response $Response `
                    -StatusCode 403 `
                    -Text '403 Forbidden'

                continue
            }

            if (
                Test-Path `
                    -LiteralPath $RequestedPath `
                    -PathType Container
            ) {
                $RequestedPath = Join-Path `
                    $RequestedPath `
                    'index.html'
            }

            # Check again after resolving a directory to index.html.
            if (
                $RequestedPath -ne $SiteRoot -and
                -not $RequestedPath.StartsWith(
                    $RootPrefix,
                    [StringComparison]::OrdinalIgnoreCase
                )
            ) {
                Send-TextResponse `
                    -Response $Response `
                    -StatusCode 403 `
                    -Text '403 Forbidden'

                continue
            }

            $RelativePath = Get-RelativeWebPath $RequestedPath

            if (Test-IsBlockedPath $RelativePath) {
                Send-TextResponse `
                    -Response $Response `
                    -StatusCode 403 `
                    -Text '403 Forbidden'

                continue
            }

            if (
                -not (
                    Test-Path `
                        -LiteralPath $RequestedPath `
                        -PathType Leaf
                )
            ) {
                Send-TextResponse `
                    -Response $Response `
                    -StatusCode 404 `
                    -Text '404 Not Found'

                continue
            }

            $Bytes = [IO.File]::ReadAllBytes($RequestedPath)

            $Response.StatusCode = 200
            $Response.ContentType = Get-ContentType $RequestedPath
            $Response.ContentLength64 = $Bytes.Length
            $Response.Headers['Cache-Control'] = 'no-store'
            $Response.Headers['X-Content-Type-Options'] = 'nosniff'

            if ($Request.HttpMethod -ne 'HEAD') {
                $Response.OutputStream.Write(
                    $Bytes,
                    0,
                    $Bytes.Length
                )
            }
        }
        catch {
            try {
                Send-TextResponse `
                    -Response $Response `
                    -StatusCode 500 `
                    -Text '500 Internal Server Error'
            }
            catch {
            }
        }
        finally {
            $Response.OutputStream.Close()
        }
    }
}
finally {
    if ($Listener.IsListening) {
        $Listener.Stop()
    }

    $Listener.Close()
}
