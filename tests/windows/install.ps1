function Invoke-InstallerProcess($File, $Arguments, $Timeout = 180) {
    $process = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru
    if (-not $process.WaitForExit($Timeout * 1000)) { $process.Kill(); throw "Installer timed out: $File" }
    if ($process.ExitCode -notin @(0, 3010)) { throw "Installer failed ($($process.ExitCode)): $File" }
}
function Test-InstalledApplication($InstallDir, $AppExe) {
    $exe = Join-Path $InstallDir $AppExe
    if (-not (Test-Path $exe)) { throw "Installed executable missing: $exe" }
    if (Test-Path (Join-Path $InstallDir 'locknote-mcp.exe')) { throw 'Legacy executable installed' }
    $shortcut = Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'Locknote AI.lnk'
    if (-not (Test-Path $shortcut)) { throw 'Start Menu shortcut missing' }
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
    if ($link.TargetPath -ne $exe -or $link.WorkingDirectory.TrimEnd([char]92) -ne $InstallDir.TrimEnd([char]92)) { throw 'Shortcut target or working directory is incorrect' }
    $entries = @(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object DisplayName -eq 'Locknote AI')
    if (-not $entries.Count) { throw 'Uninstall registration missing' }
}
