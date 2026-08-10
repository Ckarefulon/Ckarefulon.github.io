function Get-PreferredLanIp {
    $CandidateRoutes = Get-NetRoute `
        -AddressFamily IPv4 `
        -DestinationPrefix '0.0.0.0/0' `
        -ErrorAction SilentlyContinue |
        Where-Object { $_.State -eq 'Alive' } |
        Sort-Object @{ Expression = {
            [int]$_.RouteMetric + [int]$_.InterfaceMetric
        } }

    foreach ($Route in $CandidateRoutes) {
        $Address = Get-NetIPAddress `
            -AddressFamily IPv4 `
            -InterfaceIndex $Route.InterfaceIndex `
            -ErrorAction SilentlyContinue |
            Where-Object {
                $_.AddressState -eq 'Preferred' -and
                -not $_.SkipAsSource -and
                $_.IPAddress -notlike '127.*' -and
                $_.IPAddress -notlike '169.254.*'
            } |
            Select-Object -First 1

        if ($Address) {
            return $Address.IPAddress
        }
    }

    $PhysicalIndexes = @(
        Get-NetAdapter -Physical -ErrorAction SilentlyContinue |
        Where-Object { $_.Status -eq 'Up' } |
        Select-Object -ExpandProperty InterfaceIndex
    )

    $Fallback = Get-NetIPAddress `
        -AddressFamily IPv4 `
        -ErrorAction SilentlyContinue |
        Where-Object {
            $PhysicalIndexes -contains $_.InterfaceIndex -and
            $_.AddressState -eq 'Preferred' -and
            -not $_.SkipAsSource -and
            $_.IPAddress -notlike '127.*' -and
            $_.IPAddress -notlike '169.254.*'
        } |
        Select-Object -First 1

    if ($Fallback) {
        return $Fallback.IPAddress
    }

    return '127.0.0.1'
}
