param([Parameter(Mandatory)][string]$Exe,[Parameter(Mandatory)][string]$DataDir,[int]$Runs=3,[string]$EvidenceDir='windows-performance')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'startup.ps1')
New-Item -ItemType Directory -Force $EvidenceDir | Out-Null
$EvidenceDir=(Resolve-Path $EvidenceDir).Path
# Probes create a synthetic note: use a disposable synthetic dataset only.
if ((Read-Host 'Use only a disposable synthetic dataset. Type SYNTHETIC') -ne 'SYNTHETIC') { throw 'Cancelled' }
for($i=1;$i -le $Runs;$i++){
 $run=Join-Path $EvidenceDir ('run-'+$i);New-Item -ItemType Directory -Force $run | Out-Null
 Test-ApplicationStartup $Exe $DataDir $run
}
@{os=(Get-CimInstance Win32_OperatingSystem).Caption;cpu=(Get-CimInstance Win32_Processor).Name;memory=(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory;disks=(Get-PhysicalDisk | Select-Object FriendlyName,MediaType,Size);databaseBytes=(Get-Item (Join-Path $DataDir 'locknote.db')).Length;note='First observed launch is not verified cold-cache timing. Record note/plugin counts separately.'} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $EvidenceDir 'environment.json')
