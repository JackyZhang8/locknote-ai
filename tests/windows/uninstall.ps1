function Test-DataPreserved($DataDir, $Before) {
    foreach ($item in $Before) {
        $file = Join-Path $DataDir $item.Path
        if (-not (Test-Path $file) -or (Get-FileHash $file).Hash -ne $item.Hash) { throw "Uninstall changed user data: $($item.Path)" }
    }
}
function Get-DataSnapshot($DataDir) {
    @(Get-ChildItem $DataDir -Recurse -File | ForEach-Object { @{Path=[IO.Path]::GetRelativePath($DataDir,$_.FullName);Hash=(Get-FileHash $_.FullName).Hash} })
}
