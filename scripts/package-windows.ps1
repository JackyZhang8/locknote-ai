$ErrorActionPreference = 'Stop'
$config = Get-Content wails.json -Raw | ConvertFrom-Json
$AppExe = $config.outputfilename + '.exe'
if ($AppExe -ne 'locknote-ai.exe') { throw "Unexpected executable: $AppExe" }
$binary = (Resolve-Path (Join-Path 'build/bin' $AppExe)).Path
if ((Get-Item $binary).Length -lt 1024) { throw 'Application executable is invalid' }
if (Test-Path build/bin/locknote-mcp.exe) { throw 'Stale locknote-mcp.exe in build output' }
$version = (Get-Content VERSION -Raw).Trim().TrimStart('v')
if ($env:RELEASE_VERSION -and $version -ne $env:RELEASE_VERSION) { throw 'Release version mismatch' }
New-Item -ItemType Directory -Force dist | Out-Null
$name = "locknote-ai-$version-windows-x64"
$installers = @(Get-ChildItem build/bin -Filter '*installer.exe')
if ($installers.Count -ne 1) { throw 'Expected exactly one NSIS installer' }
Copy-Item $installers[0].FullName "dist/$name.exe"
candle.exe -nologo -arch x64 -ext WixUIExtension "-dVersion=$version" "-dBinary=$binary" "-dAppExe=$AppExe" -out build/packaging/windows.wixobj build/packaging/windows.wxs
if ($LASTEXITCODE -ne 0) { throw 'WiX compilation failed' }
light.exe -nologo -ext WixUIExtension -spdb -out "dist/$name.msi" build/packaging/windows.wixobj
if ($LASTEXITCODE -ne 0) { throw 'MSI linking failed' }
# Inspect the actual MSI file table and extracted binary, not just source XML.
$installer = New-Object -ComObject WindowsInstaller.Installer
$database = $installer.OpenDatabase((Resolve-Path "dist/$name.msi").Path, 0)
$view = $database.OpenView('SELECT `FileName` FROM `File`'); $view.Execute()
$names = @(); while ($record = $view.Fetch()) { $names += $record.StringData(1) }; $view.Close()
if (-not ($names | Where-Object { ($_ -split [regex]::Escape('|'))[-1] -eq $AppExe })) { throw 'MSI File table does not contain the expected executable' }
$tempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$extract = Join-Path $tempRoot ('locknote-msi-layout-' + [guid]::NewGuid())
$layout = Start-Process msiexec.exe -ArgumentList @('/a', ('"'+(Resolve-Path "dist/$name.msi").Path+'"'), '/qn', ('TARGETDIR="'+$extract+'"')) -PassThru
if (-not $layout.WaitForExit(120000)) { $layout.Kill(); throw 'MSI administrative extraction timed out' }
if ($layout.ExitCode -notin @(0,3010)) { throw 'MSI administrative extraction failed' }
$payload = @(Get-ChildItem $extract -Recurse -Filter $AppExe)
if ($payload.Count -ne 1 -or (Get-FileHash $payload[0].FullName).Hash -ne (Get-FileHash $binary).Hash) { throw 'MSI payload differs from the built executable' }
