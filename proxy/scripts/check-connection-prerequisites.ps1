param([string]$ProbeRoot=(Join-Path $env:LOCALAPPDATA 'MarvProxBuild'))
$ErrorActionPreference='Stop'
$domains=@('growtopia1.com','www.growtopia1.com','growtopia2.com','www.growtopia2.com')
$mapped=@{}
$hostsPath=Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
foreach($line in [IO.File]::ReadAllLines($hostsPath)) {
 $fields=($line -split '#',2)[0].Trim() -split '\s+'
 if($fields.Count -ge 2) {foreach($domain in $fields[1..($fields.Count-1)]) {if($domains -contains $domain) {$mapped[$domain]=$fields[0]}}}
}
$tcp=@([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object Port -eq 443)
$udp=@([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveUdpListeners() | Where-Object Port -eq 16999)
$certificate=Join-Path $ProbeRoot 'connection-runtime\resources\cert.pem'
$python=Join-Path $ProbeRoot 'tools\python\python.exe'
$certificateInfo=$null
if(Test-Path -LiteralPath $certificate) {
 $code = "import ssl,sys,json,hashlib; p=sys.argv[1]; c=ssl._ssl._test_decode_cert(p); d=ssl.PEM_cert_to_DER_cert(open(p).read()); print(json.dumps(dict(sha256=hashlib.sha256(d).hexdigest(),expires=c['notAfter'],dnsNames=[v for k,v in c.get('subjectAltName',[]) if k=='DNS'])))"
 $json=& $python -c $code $certificate
 if($LASTEXITCODE) {throw 'Cannot inspect the dedicated certificate'}
 $certificateInfo=$json | ConvertFrom-Json
}
$game=Join-Path $env:LOCALAPPDATA 'Growtopia\Growtopia.exe'
$version=$null
if(Test-Path -LiteralPath $game) {$version=(Get-Item -LiteralPath $game).VersionInfo.FileVersion}
[pscustomobject]@{
 tcp443Available=($tcp.Count -eq 0); udp16999Available=($udp.Count -eq 0)
 relevantHostsEntries=$mapped.Count
 allDomainsLoopback=(@($domains | Where-Object {$mapped[$_] -ne '127.0.0.1'}).Count -eq 0)
 localCertificate=$certificateInfo; executableVersion=$version
 liveConnectionVerified=$false; inventoryVerified=$false
 machineChangesApplied=$false
} | ConvertTo-Json -Depth 5
