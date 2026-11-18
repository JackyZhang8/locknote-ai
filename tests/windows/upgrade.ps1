param(
    [Parameter(Mandatory)][string]$OldPackage,
    [Parameter(Mandatory)][string]$NewPackage,
    [ValidateSet('msi','exe')][string]$Kind='msi',
    [string]$OldInstallDir=(Join-Path $env:ProgramFiles 'Locknote AI'),
    [string]$OldExe='locknote-mcp.exe',
    [string]$EvidenceDir='windows-evidence/upgrade'
)
# Run elevated on a disposable VM; use a genuinely older version package.
$ErrorActionPreference='Stop'
foreach($script in @('install','startup','uninstall')) { . (Join-Path $PSScriptRoot ($script+'.ps1')) }
$OldPackage=(Resolve-Path $OldPackage).Path
$NewPackage=(Resolve-Path $NewPackage).Path
if(Test-Path $OldInstallDir) { throw 'Requires a clean disposable machine' }
New-Item -ItemType Directory -Force $EvidenceDir | Out-Null
$EvidenceDir=(Resolve-Path $EvidenceDir).Path
$data=Join-Path ([IO.Path]::GetTempPath()) ('locknote-upgrade-'+[guid]::NewGuid())
New-Item -ItemType Directory -Force $data | Out-Null
function Install-Package($Path,$Log) {
    if($Kind -eq 'msi') { Invoke-InstallerProcess 'msiexec.exe' @('/i', ('"'+$Path+'"'), '/qn', '/norestart', '/L*V', ('"'+$Log+'"')) }
    else { Invoke-InstallerProcess $Path @('/S', "/D=$OldInstallDir") }
}
try {
    Install-Package $OldPackage (Join-Path $EvidenceDir 'old-install.log')
    $oldLogs=Join-Path $EvidenceDir 'old';New-Item -ItemType Directory -Force $oldLogs | Out-Null
    Test-ApplicationStartup (Join-Path $OldInstallDir $OldExe) $data $oldLogs -Legacy
    $originalNote=(Get-Content (Join-Path $oldLogs 'startup-result.json') -Raw | ConvertFrom-Json).note
    $oldToken=(Get-FileHash (Join-Path $data 'token')).Hash
    $pluginDir=Join-Path $data 'plugins/_data/upgrade-probe'
    New-Item -ItemType Directory -Force $pluginDir | Out-Null
    'preserve plugin configuration' | Set-Content (Join-Path $pluginDir 'config.txt')
    $pluginBefore=Get-DataSnapshot $pluginDir
    Install-Package $NewPackage (Join-Path $EvidenceDir 'new-install.log')
    $appExe=(Get-Content wails.json -Raw | ConvertFrom-Json).outputfilename+'.exe'
    Test-InstalledApplication $OldInstallDir $appExe
    $newLogs=Join-Path $EvidenceDir 'new';New-Item -ItemType Directory -Force $newLogs | Out-Null
    Test-ApplicationStartup (Join-Path $OldInstallDir $appExe) $data $newLogs -ExpectedNote $originalNote
    if((Get-FileHash (Join-Path $data 'token')).Hash -ne $oldToken) { throw 'Upgrade replaced the token' }
    Test-DataPreserved $pluginDir $pluginBefore
    Invoke-InstallerProcess (Join-Path $OldInstallDir $appExe) @('check-db','-data',('"'+$data+'"'))
    'PARTIAL: automatic probes passed; compare original note IDs, notebooks, tags and history, and verify GUI manually.' | Set-Content (Join-Path $EvidenceDir 'result.txt')
} catch { $_ | Out-String | Set-Content (Join-Path $EvidenceDir 'failure.txt'); throw }
# Preserve installation, synthetic dataset and logs for manual inspection.
Write-Output "Synthetic upgrade data: $data"
