param([Parameter(Mandatory)][string]$Exe,[Parameter(Mandatory)][string]$DataDir)
$ErrorActionPreference = 'Stop'
$process = Start-Process -FilePath $Exe -ArgumentList @('check-db','-data',('"'+$DataDir+'"')) -PassThru
if (-not $process.WaitForExit(180000)) { $process.Kill(); throw 'Database check timed out' }
if ($process.ExitCode -ne 0) { throw 'Database/foreign-key/FTS integrity failed. Close all writers before maintenance.' }
