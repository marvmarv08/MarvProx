param(
    [ValidateSet('Configure', 'Build', 'Test')]
    [string]$Step = 'Configure',
    [string]$ProbeRoot = (Join-Path $env:LOCALAPPDATA 'MarvProxBuild'),
    [ValidatePattern('^[a-zA-Z0-9-]+$')][string]$SourceName = 'reference',
    [ValidatePattern('^[a-zA-Z0-9-]+$')][string]$BuildName = 'build',
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath (Join-Path $ProbeRoot ($SourceName + '\CMakeLists.txt')))) {
    throw 'Prepare the locked reference before building.'
}
Set-Location -LiteralPath $ProbeRoot
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vs = (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
if (-not $vs) { throw 'Visual Studio C++ Build Tools are unavailable.' }
Import-Module (Join-Path $vs 'Common7\Tools\Microsoft.VisualStudio.DevShell.dll')
Enter-VsDevShell -VsInstallPath $vs -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64'
$env:PATH = (Join-Path $ProbeRoot '.venv\Scripts') + ';' + (Join-Path $ProbeRoot 'tools\cmake\bin') + ';' + $env:PATH
$env:CONAN_HOME = Join-Path $ProbeRoot 'conan'
$env:MARVPROX_TEST_CERT_DIR = Join-Path $ProbeRoot 'test-cert'
$logs = Join-Path (Join-Path $ProbeRoot 'logs') $BuildName
$null = New-Item -ItemType Directory -Path $logs -Force

if ($Step -eq 'Configure') {
    $program = Join-Path $ProbeRoot 'tools\cmake\bin\cmake.exe'
    $conanArgs = '--build=missing;--lockfile-out=' + (Join-Path $ProbeRoot 'conan.lock')
    if (Test-Path -LiteralPath (Join-Path $ProbeRoot 'conan.lock')) {
        $conanArgs += ';--lockfile=' + (Join-Path $ProbeRoot 'conan.lock')
    }
    $arguments = @('-S', (Join-Path $ProbeRoot $SourceName), '-B', (Join-Path $ProbeRoot $BuildName),
        '-G', 'Visual Studio 17 2022', '-A', 'x64', '-DCMAKE_BUILD_TYPE=Release',
        '-DCMAKE_CONFIGURATION_TYPES=Release', '-DCONAN_INSTALL_BUILD_CONFIGURATIONS=Release',
        ('-DCONAN_INSTALL_ARGS=' + $conanArgs))
} elseif ($Step -eq 'Build') {
    # Force relinking: MSBuild reused executables older than the rebuilt core library.
    foreach ($target in @('src\Release\Proxy.exe', 'tests\Release\GTProxy_tests.exe')) {
        $output = Join-Path (Join-Path $ProbeRoot $BuildName) $target
        if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output }
    }
    $program = Join-Path $ProbeRoot 'tools\cmake\bin\cmake.exe'
    $arguments = @('--build', (Join-Path $ProbeRoot $BuildName), '--config', 'Release', '--parallel', '2')
    if ($Clean) { $arguments += '--clean-first' }
} else {
    $program = Join-Path $ProbeRoot 'tools\cmake\bin\ctest.exe'
    $arguments = @('--test-dir', (Join-Path $ProbeRoot $BuildName), '-C', 'Release', '--output-on-failure')
}

$stdout = Join-Path $logs ($Step.ToLowerInvariant() + '.stdout.log')
$stderr = Join-Path $logs ($Step.ToLowerInvariant() + '.stderr.log')
# Arguments are fixed switches and Windows paths; a quote cannot occur in a Windows file name.
$commandLine = ($arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
$process = Start-Process -FilePath $program -ArgumentList $commandLine -NoNewWindow -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
# Wait for CMake itself; compiler worker processes may remain idle for reuse after it exits.
$null = $process.Handle
$process.WaitForExit()
$exitCode = $process.ExitCode
[pscustomobject]@{ step=$Step; exitCode=$exitCode; stdout=$stdout; stderr=$stderr } | ConvertTo-Json -Compress
Get-Content -LiteralPath $stdout -Tail 10
Get-Content -LiteralPath $stderr -Tail 15
$process.Dispose()
exit $exitCode
