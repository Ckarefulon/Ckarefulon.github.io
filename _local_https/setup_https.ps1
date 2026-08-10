$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'network.ps1')

$Ip = Get-PreferredLanIp

$Port = 9527
$AppId = '{6E798DB9-4226-4AA5-9432-B3DF54B2C027}'

$RootSubject = 'CN=Careful Local HTTPS Root CA'
$RootFriendlyName = 'Careful Local HTTPS Root CA'
$ServerFriendlyName = "Careful Local HTTPS Server $Ip"
$FirewallName = 'Careful Local HTTPS 9527'
$CerPath = Join-Path $PSScriptRoot 'LocalHttpsRootCA.cer'
$CrtPath = Join-Path $PSScriptRoot 'LocalHttpsRootCA.crt'
$InfoPath = Join-Path $PSScriptRoot 'certificate-info.json'

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)

    return $principal.IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator
    )
}

if (-not (Test-IsAdministrator)) {
    throw 'Run PowerShell as Administrator.'
}

$SanExtension = '2.5.29.17={text}IPAddress=127.0.0.1&IPAddress=' + $Ip + '&DNS=localhost'

# Reuse the recorded CA so phones only need to trust it once. The server
# certificate may be replaced whenever the LAN address changes.
$PreferredRootThumbprint = ''

if (Test-Path -LiteralPath $InfoPath -PathType Leaf) {
    try {
        $PreferredRootThumbprint = (
            Get-Content $InfoPath |
            ConvertFrom-Json
        ).RootThumbprint
    }
    catch {
    }
}

$UsableRoots = @(
    Get-ChildItem -Path 'Cert:\LocalMachine\My' -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Subject -eq $RootSubject -and
        $_.HasPrivateKey -and
        $_.NotAfter -gt (Get-Date).AddDays(30)
    }
)

$ExistingRoot = $UsableRoots |
    Where-Object { $_.Thumbprint -eq $PreferredRootThumbprint } |
    Select-Object -First 1

if (-not $ExistingRoot) {
    $ExistingRoot = $UsableRoots |
        Sort-Object NotBefore |
        Select-Object -First 1
}

if ($ExistingRoot) {
    Write-Host 'Reusing existing root CA certificate...' -ForegroundColor Cyan
    $RootCert = $ExistingRoot
} else {
    Write-Host 'Creating new root CA certificate...'
    $RootCert = New-SelfSignedCertificate `
        -Type Custom `
        -Subject $RootSubject `
        -FriendlyName $RootFriendlyName `
        -CertStoreLocation 'Cert:\LocalMachine\My' `
        -KeyAlgorithm RSA `
        -KeyLength 2048 `
        -HashAlgorithm SHA256 `
        -KeyExportPolicy Exportable `
        -KeyUsage CertSign, CRLSign, DigitalSignature `
        -TextExtension @(
            '2.5.29.19={critical}{text}ca=1&pathlength=1'
        ) `
        -NotAfter (Get-Date).AddYears(10)

}

Write-Host 'Exporting the root CA for phone installation...'
Export-Certificate `
    -Cert $RootCert `
    -FilePath $CerPath `
    -Type CERT `
    -Force | Out-Null

Copy-Item `
    -LiteralPath $CerPath `
    -Destination $CrtPath `
    -Force

Import-Certificate `
    -FilePath $CerPath `
    -CertStoreLocation 'Cert:\LocalMachine\Root' | Out-Null

Write-Host 'Creating HTTPS server certificate...'

$ServerCert = New-SelfSignedCertificate `
    -Type Custom `
    -Subject "CN=$Ip" `
    -FriendlyName $ServerFriendlyName `
    -Signer $RootCert `
    -CertStoreLocation 'Cert:\LocalMachine\My' `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -KeyExportPolicy Exportable `
    -KeyUsage DigitalSignature, KeyEncipherment `
    -TextExtension @(
        $SanExtension,
        '2.5.29.19={critical}{text}ca=0',
        '2.5.29.37={text}1.3.6.1.5.5.7.3.1'
    ) `
    -NotAfter (Get-Date).AddYears(2)

Write-Host 'Configuring HTTPS port...'

& netsh.exe http delete sslcert `
    "ipport=0.0.0.0:$Port" 2>$null | Out-Null

& netsh.exe http delete urlacl `
    "url=https://+:$Port/" 2>$null | Out-Null

& netsh.exe http add sslcert `
    "ipport=0.0.0.0:$Port" `
    "certhash=$($ServerCert.Thumbprint)" `
    "appid=$AppId" `
    'certstorename=MY'

if ($LASTEXITCODE -ne 0) {
    throw 'Failed to bind the HTTPS certificate.'
}

$CurrentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name

& netsh.exe http add urlacl `
    "url=https://+:$Port/" `
    "user=$CurrentUser"

if ($LASTEXITCODE -ne 0) {
    throw 'Failed to create the HTTPS URL reservation.'
}

$ExistingFirewallRule = Get-NetFirewallRule `
    -DisplayName $FirewallName `
    -ErrorAction SilentlyContinue

if (-not $ExistingFirewallRule) {
    New-NetFirewallRule `
        -DisplayName $FirewallName `
        -Direction Inbound `
        -Action Allow `
        -Protocol TCP `
        -LocalPort $Port `
        -Profile Private | Out-Null
}

$CertificateInfo = [PSCustomObject]@{
    Port               = $Port
    RootThumbprint     = $RootCert.Thumbprint
    ServerThumbprint   = $ServerCert.Thumbprint
    RootCertificateCer = $CerPath
    RootCertificateCrt = $CrtPath
}

$CertificateInfo |
    ConvertTo-Json |
    Set-Content -LiteralPath $InfoPath -Encoding ASCII

Write-Host ''
Write-Host 'HTTPS setup completed successfully.' -ForegroundColor Green
Write-Host "Address: https://${Ip}:${Port}"
Write-Host "Phone certificate: $CrtPath"
Write-Host ''
Write-Host 'Next command:'
Write-Host '.\_local_https\start_https.ps1'
