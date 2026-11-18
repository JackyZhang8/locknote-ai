param([string]$PackageDir = 'dist', [string]$EvidenceDir = 'windows-evidence')
$ErrorActionPreference = 'Stop'
foreach ($name in @('webview2','install','startup','uninstall')) { . (Join-Path $PSScriptRoot "$name.ps1") }
New-Item -ItemType Directory -Force $EvidenceDir | Out-Null
$EvidenceDir = (Resolve-Path $EvidenceDir).Path
try {
    $runtime = Get-WebView2Version
    $config = Get-Content wails.json -Raw | ConvertFrom-Json
    $appExe = $config.outputfilename + '.exe'
    $version = (Get-Content VERSION -Raw).Trim().TrimStart('v')
    $os = Get-CimInstance Win32_OperatingSystem
    @{os=$os.Caption;build=$os.BuildNumber;webview2=$runtime;cpu=(Get-CimInstance Win32_Processor).Name;memory=(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory;status='Windows runner only; Windows 11 manual acceptance still required'} | ConvertTo-Json | Set-Content (Join-Path $EvidenceDir 'environment.json')
    foreach ($kind in @('msi','exe')) {
        $package = (Resolve-Path (Join-Path $PackageDir "locknote-ai-$version-windows-x64.$kind")).Path
        $install = Join-Path $env:ProgramFiles 'Locknote AI'
        if (Test-Path $install) { throw 'Acceptance requires a clean disposable Windows machine' }
        $logs = Join-Path $EvidenceDir $kind; New-Item -ItemType Directory -Force $logs | Out-Null
        $tempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
        $data = Join-Path $tempRoot ("locknote-acceptance-" + [guid]::NewGuid())
        New-Item -ItemType Directory -Force $data | Out-Null
        if ($kind -eq 'msi') {
            Invoke-InstallerProcess 'msiexec.exe' @( '/i', ('"'+$package+'"'), '/qn', '/norestart', '/L*V', ('"'+(Join-Path $logs 'install.log')+'"'))
        } else { Invoke-InstallerProcess $package @('/S', "/D=$install") }
        try {
            Test-InstalledApplication $install $appExe
            Test-ApplicationStartup (Join-Path $install $appExe) $data $logs
            $pluginData = Join-Path $data 'plugins/_data/acceptance'
            New-Item -ItemType Directory -Force $pluginData | Out-Null
            'synthetic plugin state' | Set-Content (Join-Path $pluginData 'state.txt')
            $before = Get-DataSnapshot $data
        } finally {
            if ($kind -eq 'msi') { Invoke-InstallerProcess 'msiexec.exe' @('/x', ('"'+$package+'"'), '/qn', '/norestart', '/L*V', ('"'+(Join-Path $logs 'uninstall.log')+'"')) }
            else { Invoke-InstallerProcess (Join-Path $install 'uninstall.exe') @('/S', "_?=$install") }
        }
        if (Test-Path (Join-Path $install $appExe)) { throw 'Executable remains after uninstall' }
        if (Test-Path (Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'Locknote AI.lnk')) { throw 'Shortcut remains after uninstall' }
        Test-DataPreserved $data $before
    }
} catch { $_ | Out-String | Set-Content (Join-Path $EvidenceDir 'failure.txt'); throw }
