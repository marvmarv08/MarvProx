# MarvProx native component

Pinned source preparation, native patches, and Windows build helpers for an offline probe and a read-only connection candidate. The browser demo is independent of this component.

## Source layout

The implementation is distributed as two sequential patches rather than a vendored upstream checkout:

1. `patches/0001-offline-probe-policy.patch` adds bounded offline probing and related tests.
2. `patches/0002-readonly-connection.patch` adds read-only connection, inventory-state, and native status-view code.

`upstream.lock.json` identifies the exact upstream source, submodules, and license fingerprint. `conan.lock` pins native dependency recipe revisions. The source-preparation helper rejects a mismatched or dirty destination instead of overwriting it. Use a new destination when repeating preparation.

Upstream attribution is retained in [the third-party notices](../THIRD_PARTY_NOTICES.md). Reference checkouts, bundled resources, generated certificates, and compiler output are not part of this repository.

## Windows prerequisites

The build scripts expect an x64 Visual Studio 2022 C++ toolchain and Windows SDK. Configure a local workspace at `%LOCALAPPDATA%\MarvProxBuild` containing:

- Python at `tools\python\python.exe`.
- CMake at `tools\cmake\bin\cmake.exe`.
- A Python virtual environment at `.venv` with Conan installed.
- Git available on PATH.
- OpenSSL available for disposable test certificates.

The lock records tool versions from the source preparation environment; this publication does not install or verify a Windows toolchain automatically. Conan downloads build dependencies when required.

## Prepare and build

Run from this repository in PowerShell after configuring the prerequisites:

```powershell
$source = (Resolve-Path .\proxy).Path
$root = Join-Path $env:LOCALAPPDATA 'MarvProxBuild'
$python = Join-Path $root 'tools\python\python.exe'
& $python "$source\scripts\prepare-reference.py" --lock "$source\upstream.lock.json" --destination "$root\reference"
if ($LASTEXITCODE) { throw 'Source preparation failed' }
git -C "$root\reference" -c core.autocrlf=false apply --check "$source\patches\0001-offline-probe-policy.patch"
if ($LASTEXITCODE) { throw 'Offline patch check failed' }
git -C "$root\reference" -c core.autocrlf=false apply "$source\patches\0001-offline-probe-policy.patch"
if ($LASTEXITCODE) { throw 'Offline patch failed' }
git -C "$root\reference" -c core.autocrlf=false apply --check "$source\patches\0002-readonly-connection.patch"
if ($LASTEXITCODE) { throw 'Read-only patch check failed' }
git -C "$root\reference" -c core.autocrlf=false apply "$source\patches\0002-readonly-connection.patch"
if ($LASTEXITCODE) { throw 'Read-only patch failed' }
Copy-Item "$source\conan.lock" "$root\conan.lock"
& "$source\scripts\build-probe.ps1" -ProbeRoot $root -Step Configure
if ($LASTEXITCODE) { throw 'Configure failed' }
& "$source\scripts\build-probe.ps1" -ProbeRoot $root -Step Build
if ($LASTEXITCODE) { throw 'Build failed' }
```

The build helper enters the x64 compiler environment, isolates Conan state and logs inside the workspace, and forces relinking of the generated executables. Use `-Clean` after C++ class-layout changes. A repeat preparation can use matching `-SourceName reference-replay -BuildName build-replay` arguments instead of resetting existing work.

## Offline test fixtures

Tests use a disposable localhost certificate. Generate it locally; do not commit or install its private key into system trust:

```powershell
$null = New-Item -ItemType Directory -Force "$root\test-cert"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=localhost -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' -keyout "$root\test-cert\key.pem" -out "$root\test-cert\cert.pem"
if ($LASTEXITCODE) { throw 'Test certificate generation failed' }
& "$source\scripts\build-probe.ps1" -ProbeRoot $root -Step Test
if ($LASTEXITCODE) { throw 'Native tests failed' }
& "$source\scripts\check-startup.ps1" -ProbeRoot $root
if ($LASTEXITCODE) { throw 'Startup checks failed' }
```

Regenerate expired fixtures. The build's resource-copy step is not a trusted runtime certificate setup. Do not distribute generated runtime folders or upstream bundled private keys.

## Read-only candidate limits

The read-only launcher requires a separately configured local runtime and certificate; it is not a ready-to-run release package. The prerequisite and UI scripts are developer diagnostics, not proof of a successful game connection. They do not configure system routing or enable real item dropping.

Windows native compilation and execution have not been rerun for this rebranded publication snapshot. Current-client connectivity and real inventory remain unverified. The browser tests and patch replay described in [verification scope](../docs/verification.md) do not establish Windows runtime compatibility.
