param(
    [string]$ProbeRoot = (Join-Path $env:LOCALAPPDATA 'MarvProxBuild'),
    [switch]$RequireDeveloperEnvironment
)

$ErrorActionPreference = 'Stop'

function Find-Executable([string[]]$Candidates) {
    foreach ($candidate in $Candidates) {
        if (-not $candidate) { continue }
        $command = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($command -and $command.CommandType -eq 'Application') { return $command.Source }
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    return $null
}

function Invoke-CapturedTool([string]$Executable, [string]$Arguments) {
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $Executable
    $info.Arguments = $Arguments
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $info
    try {
        $null = $process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(30000)) {
            $process.Kill()
            throw 'Tool version check timed out'
        }
        return [pscustomobject]@{ code=$process.ExitCode; output=($stdout.Result + $stderr.Result) }
    } finally { $process.Dispose() }
}

function Test-VersionedTool([string]$Name, [string]$Executable, [version]$Minimum, [int]$Major = -1) {
    if (-not $Executable) {
        return [pscustomobject]@{ name=$Name; available=$false; version=$null; issue='Executable not found' }
    }
    if ($Executable -match '\\WindowsApps\\') {
        return [pscustomobject]@{ name=$Name; available=$false; version=$null; issue='WindowsApps alias is not a verified interpreter' }
    }
    try {
        $result = Invoke-CapturedTool $Executable '--version'
        $match = [regex]::Match($result.output, '\d+\.\d+(?:\.\d+)?')
        if ($result.code -ne 0 -or -not $match.Success) { throw 'Version check failed' }
        $actual = [version]$match.Value
        $valid = $actual -ge $Minimum -and ($Major -lt 0 -or $actual.Major -eq $Major)
        return [pscustomobject]@{ name=$Name; available=$valid; version=$actual.ToString(); issue=if($valid){$null}else{'Unsupported version'} }
    } catch {
        return [pscustomobject]@{ name=$Name; available=$false; version=$null; issue='Executable version check failed' }
    }
}

$python = Find-Executable @(
    (Join-Path $ProbeRoot '.venv\Scripts\python.exe'),
    (Join-Path $ProbeRoot 'tools\python\python.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python313\python.exe'),
    'python'
)
$cmake = Find-Executable @(
    (Join-Path $ProbeRoot 'tools\cmake\bin\cmake.exe'),
    (Join-Path $env:ProgramFiles 'CMake\bin\cmake.exe'),
    'cmake'
)
$conan = Find-Executable @((Join-Path $ProbeRoot '.venv\Scripts\conan.exe'))
$entries = @(
    (Test-VersionedTool 'Python' $python ([version]'3.12')),
    (Test-VersionedTool 'CMake' $cmake ([version]'3.24')),
    (Test-VersionedTool 'Conan' $conan ([version]'2.0') 2)
)

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$installation = $null
if (Test-Path -LiteralPath $vswhere) {
    $installation = (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
}
$compiler = Find-Executable @('cl')
if (-not $compiler -and $installation) {
    $compiler = (Get-ChildItem -Path (Join-Path $installation 'VC\Tools\MSVC\*\bin\Hostx64\x64\cl.exe') -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1).FullName
}
$compilerOK = $false
$compilerVersion = $null
if ($compiler) {
    try {
        # MSVC writes its normal banner to stderr even when its help command succeeds.
        $result = Invoke-CapturedTool $compiler '/?'
        $compilerOK = $result.code -eq 0
        $compilerVersion = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($compiler).FileVersion
    } catch { $compilerOK = $false }
}
$developerOK = -not $RequireDeveloperEnvironment -or $env:VSCMD_ARG_TGT_ARCH -eq 'x64'
$entries += [pscustomobject]@{
    name='MSVC x64'; available=($compilerOK -and $developerOK); version=$compilerVersion
    issue=if(-not $compilerOK){'Working x64 C++ compiler not found'}elseif(-not $developerOK){'Run from the x64 Visual Studio developer environment'}else{$null}
}
$entries | ConvertTo-Json -Depth 3
if (@($entries | Where-Object { -not $_.available }).Count) { exit 1 }
exit 0
