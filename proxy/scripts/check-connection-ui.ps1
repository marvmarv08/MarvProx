param([string]$ProbeRoot=(Join-Path $env:LOCALAPPDATA 'MarvProxBuild'), [string]$Executable=(Join-Path $ProbeRoot 'build\src\Release\Proxy.exe'))
$ErrorActionPreference='Stop'
Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class MarvProxWindowCheck {
 public delegate bool Callback(IntPtr window,IntPtr parameter);
 [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback,IntPtr parameter);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window,StringBuilder text,int size);
 public static IntPtr Find(uint pid) {
  var found=IntPtr.Zero;
  EnumWindows((window,parameter)=>{uint owner;GetWindowThreadProcessId(window,out owner);var name=new StringBuilder(256);GetClassName(window,name,name.Capacity);if(owner==pid && name.ToString()=="MarvProxReadOnlyWindow"){found=window;return false;}return true;},IntPtr.Zero);
  return found;
 }
 [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent,Callback callback,IntPtr parameter);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr handle,uint message,UIntPtr size,StringBuilder text,uint flags,uint timeout,out UIntPtr result);
 [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr handle,uint message,IntPtr wparam,IntPtr lparam);
 public static string Text(IntPtr parent) {
  var rows=new List<string>();
  EnumChildWindows(parent,(window,parameter)=>{var text=new StringBuilder(32768);UIntPtr result;SendMessageTimeout(window,0x000D,(UIntPtr)text.Capacity,text,2,1000,out result);rows.Add(text.ToString());return true;},IntPtr.Zero);
  return String.Join("\n",rows);
 }
}
'@
$process=$null
$work=Join-Path $ProbeRoot ('ui-check-'+[guid]::NewGuid().ToString('N'))
$null=New-Item -ItemType Directory $work
try {
 foreach($scenario in @('candidate-and-disconnect','close-window','connection-startup-close')) {
  $startup=$scenario -eq 'connection-startup-close'
  $earlyClose=$scenario -ne 'candidate-and-disconnect'
  $arguments=if($startup){@('--connection-test','--upstream','www.growtopia1.com','--timeout','30')}else{@('--ui-smoke-test')}
  $directory=if($startup){Join-Path $ProbeRoot 'connection-runtime'}else{$work}
  $process=Start-Process -FilePath $Executable -ArgumentList $arguments -WorkingDirectory $directory -PassThru -RedirectStandardOutput "$work\out.txt" -RedirectStandardError "$work\err.txt"
  $null=$process.Handle
  $deadline=[DateTime]::UtcNow.AddSeconds(12)
  $candidate=$false; $cleared=$false; $requested=$false; $ready=$false
  while(-not $process.HasExited -and [DateTime]::UtcNow -lt $deadline) {
   $process.Refresh()
   $window=[MarvProxWindowCheck]::Find([uint32]$process.Id)
   if($window -ne [IntPtr]::Zero) {
    $text=[MarvProxWindowCheck]::Text($window)
    if($text.Contains('UNVERIFIED') -and $text.Contains('100') -and $text.Contains('12')) { $candidate=$true }
    if($text.Contains('Disconnected') -and -not $text.Contains("100`t12")) { $cleared=$true }
    if($startup) {
     $rows=& "$env:SystemRoot\System32\netstat.exe" -ano
     foreach($row in $rows) {
      $fields=$row.Trim() -split '\s+'
      if($fields.Count -eq 5 -and $fields[0] -eq 'TCP' -and $fields[1] -eq '127.0.0.1:443' -and $fields[-1] -eq [string]$process.Id) {$ready=$true}
     }
     if($text.Contains('Connection failed')) {throw 'Read-only runtime startup failed'}
    }
    if($earlyClose -and (($startup -and $ready) -or (-not $startup -and $candidate)) -and -not $requested) {
     $null=[MarvProxWindowCheck]::PostMessage($window,0x10,[IntPtr]::Zero,[IntPtr]::Zero); $requested=$true
    }
   }
   Start-Sleep -Milliseconds 40
  }
  if(-not $process.HasExited) {throw 'Window did not shut down within deadline'}
  $process.WaitForExit()
  if($process.ExitCode -ne 0 -or (-not $startup -and -not $candidate) -or ($startup -and -not $ready) -or (-not $earlyClose -and -not $cleared)) {throw ("Native window check failed: {0}; candidate={1}; cleared={2}; ready={3}; exit={4}" -f $scenario,$candidate,$cleared,$ready,$process.ExitCode)}
  $output=(Get-Content "$work\out.txt" -Raw)+(Get-Content "$work\err.txt" -Raw)
  $allowed=@('[info] connection.starting','[info] connection.connected','[info] connection.disconnected','[info] connection.failed','[info] connection.stopped')
  foreach($line in @($output -split '\r?\n' | Where-Object {$_})) {if(-not $startup -or $allowed -notcontains $line) {throw 'Read-only UI emitted unexpected output'}}
  [pscustomobject]@{scenario=$scenario;passed=$true;candidateObserved=$candidate;disconnectCleared=$cleared;listenerReady=$ready;exitCode=$process.ExitCode} | ConvertTo-Json -Compress
  $process.Dispose();$process=$null
 }
} finally {
 if($process -and -not $process.HasExited) {$process.Kill();$process.WaitForExit()}
 Remove-Item -LiteralPath $work -Recurse -Force
}
