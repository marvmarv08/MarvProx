param(
    [string]$ProbeRoot = (Join-Path $env:LOCALAPPDATA 'MarvProxBuild'),
    [string]$Executable = (Join-Path $ProbeRoot 'build\src\Release\Proxy.exe')
)
$ErrorActionPreference = 'Stop'
$Executable = (Resolve-Path -LiteralPath $Executable).Path
$workspace = Join-Path $ProbeRoot ('smoke-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $workspace
$reports = @()
try {
    foreach ($scenario in @('normal', 'missing-certificate', 'malformed-config', 'no-argument')) {
        $directory = Join-Path $workspace $scenario
        $null = New-Item -ItemType Directory -Path $directory
        $null = New-Item -ItemType Directory -Path (Join-Path $directory 'scripts')
        Set-Content -LiteralPath (Join-Path $directory 'scripts\sentinel.lua') -Encoding ASCII -Value 'local f = assert(io.open("script-ran", "w")); f:write("executed"); f:close()'
        $configuration = '{"server":{"port":0,"web_port":0},"log":{"print_message":true,"print_game_update_packet":true,"print_variant":true,"print_extra":true}}'
        if ($scenario -eq 'malformed-config') { $configuration = '{ SYNTHETIC_CONFIG_SECRET' }
        Set-Content -LiteralPath (Join-Path $directory 'config.json') -Encoding ASCII -Value $configuration
        if ($scenario -ne 'missing-certificate') {
            $null = New-Item -ItemType Directory -Path (Join-Path $directory 'resources')
            foreach ($name in @('cert.pem', 'key.pem')) {
                Copy-Item -LiteralPath (Join-Path $ProbeRoot ('test-cert\' + $name)) -Destination (Join-Path $directory ('resources\' + $name))
            }
        }
        $arguments = @()
        if ($scenario -ne 'no-argument') { $arguments = @('--offline-smoke-test') }
        $parameters = @{ FilePath=$Executable; WorkingDirectory=$directory; NoNewWindow=$true; PassThru=$true;
            RedirectStandardOutput=(Join-Path $directory 'stdout.txt'); RedirectStandardError=(Join-Path $directory 'stderr.txt') }
        if ($arguments.Count) { $parameters.ArgumentList = $arguments }
        $process = Start-Process @parameters
        $null = $process.Handle
        $endpoints = @()
        $deadline = [DateTime]::UtcNow.AddSeconds(15)
        while (-not $process.HasExited -and [DateTime]::UtcNow -lt $deadline) {
            $rows = & (Join-Path $env:SystemRoot 'System32\netstat.exe') -ano
            foreach ($row in $rows) {
                $fields = $row.Trim() -split '\s+'
                if ($fields.Count -ge 4 -and $fields[-1] -eq [string]$process.Id) {
                    $endpoints += $fields[1]
                    if (-not $fields[1].StartsWith('127.0.0.1:')) { throw 'Probe opened a non-loopback endpoint.' }
                }
            }
            Start-Sleep -Milliseconds 20
        }
        if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit(); throw 'Probe exceeded startup deadline.' }
        $process.WaitForExit()
        $status = $process.ExitCode
        $process.Dispose()
        $process = $null
        $output = (Get-Content -LiteralPath (Join-Path $directory 'stdout.txt') -Raw) + (Get-Content -LiteralPath (Join-Path $directory 'stderr.txt') -Raw)
        if (Test-Path -LiteralPath (Join-Path $directory 'script-ran')) { throw 'Probe executed a script.' }
        if ($scenario -eq 'normal') {
            if ($status -ne 0 -or @($endpoints | Sort-Object -Unique).Count -lt 3) { throw 'Normal startup or listener observation failed.' }
            $expected = @('[info] probe.starting', '[info] probe.ready', '[info] probe.stopped')
        } elseif ($scenario -eq 'no-argument') {
            if ($status -ne 2 -or $endpoints.Count) { throw 'Argument gate failed.' }
            $expected = @('Offline readiness build. Use --offline-smoke-test for a bounded local check.')
        } else {
            if ($status -ne 1) { throw 'Startup failure did not exit cleanly.' }
            $expected = @('[info] probe.starting', '[info] probe.startup_failed')
        }
        $lines = @($output -split '\r?\n' | Where-Object { $_ })
        if (($lines -join "`n") -cne ($expected -join "`n")) { throw 'Output exceeded the fixed lifecycle allowlist.' }
        $reports += [pscustomobject]@{ scenario=$scenario; passed=$true; exitCode=$status; loopbackEndpoints=@($endpoints | Sort-Object -Unique); scriptExecuted=$false }
    }
    $reports | ConvertTo-Json -Depth 4
} finally {
    if ($process -and -not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
    Remove-Item -LiteralPath $workspace -Recurse -Force
}
