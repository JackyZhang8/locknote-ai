function Test-ApplicationStartup($Exe, $DataDir, $LogDir, [switch]$Legacy, [string]$ExpectedNote) {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0); $listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $process = Start-Process -FilePath $Exe -ArgumentList @('-data', ('"' + $DataDir + '"'), '-addr', "127.0.0.1:$port") -PassThru -RedirectStandardOutput (Join-Path $LogDir 'app.stdout.log') -RedirectStandardError (Join-Path $LogDir 'app.stderr.log')
    try {
        $ready = $false
        while ($watch.Elapsed.TotalSeconds -lt 45) {
            if ($process.HasExited) { throw 'Application exited before workspace readiness' }
            $startup = Join-Path $DataDir 'startup.log'
            if ((Test-Path $startup) -and (Get-Content $startup -Raw) -match 'frontend.first.interactive') { $ready = $true; break }
            if ($Legacy) {
                try { $null = Invoke-RestMethod "http://127.0.0.1:$port/api/notes?limit=1" -TimeoutSec 2; $ready = $true; break } catch { }
            }
            Start-Sleep -Milliseconds 200
        }
        if (-not $ready) { throw 'No frontend.first.interactive milestone; process existence is insufficient' }
        $interactiveMs = $watch.ElapsedMilliseconds
        $base = "http://127.0.0.1:$port"
        $notes = Invoke-RestMethod "$base/api/notes?limit=5"
        if ($null -eq $notes.notes) { throw 'Notes API unavailable' }
        if ($ExpectedNote) {
            $existing = Invoke-RestMethod "$base/api/notes/$ExpectedNote"
            if ($existing.content -ne 'Preserve this note' -or $existing.tags -notcontains 'acceptance') { throw 'Upgrade changed the original note or tags' }
        }
        $token = (Get-Content (Join-Path $DataDir 'token') -Raw).Trim()
        $headers = @{Authorization="Bearer $token";Accept='application/json, text/event-stream'}
        $body = @{jsonrpc='2.0';id=1;method='initialize';params=@{protocolVersion='2024-11-05';capabilities=@{};clientInfo=@{name='windows-acceptance';version='1'}}} | ConvertTo-Json -Depth 8
        $response = Invoke-WebRequest "$base/mcp" -Method Post -Headers $headers -ContentType 'application/json' -Body $body
        if ($response.StatusCode -ne 200 -or $response.Content -notmatch 'serverInfo') { throw 'MCP initialization failed' }
        $session = $response.Headers['Mcp-Session-Id']
        if ($session) { $headers['Mcp-Session-Id'] = [string]$session }
        $toolsBody = @{jsonrpc='2.0';id=2;method='tools/list';params=@{}} | ConvertTo-Json -Depth 8
        $tools = Invoke-WebRequest "$base/mcp" -Method Post -Headers $headers -ContentType 'application/json' -Body $toolsBody
        if ($tools.Content -notmatch 'save_note') { throw 'MCP tools unavailable' }
        $saveBody = @{jsonrpc='2.0';id=3;method='tools/call';params=@{name='save_note';arguments=@{title='MCP acceptance';content='MCP roundtrip content';external_id='windows-acceptance-mcp'}}} | ConvertTo-Json -Depth 8
        $saved = Invoke-WebRequest "$base/mcp" -Method Post -Headers $headers -ContentType 'application/json' -Body $saveBody
        $rpc = $saved.Content | ConvertFrom-Json
        if ($rpc.error -or $rpc.result.isError) { throw 'MCP note creation failed' }
        $visible = Invoke-RestMethod "$base/api/notes?q=MCP%20roundtrip%20content"
        if (-not $visible.total) { throw 'MCP write is not visible through notes API' }
        $unauthorized = Invoke-WebRequest "$base/mcp" -Method Post -Headers @{Authorization='Bearer invalid-token'} -ContentType 'application/json' -Body $body -SkipHttpErrorCheck
        if ($unauthorized.StatusCode -ne 401) { throw 'MCP accepted an invalid token' }
        $created = Invoke-RestMethod "$base/api/notes" -Method Post -ContentType 'application/json' -Body '{"title":"Windows acceptance","content":"Preserve this note","tags":["acceptance"]}'
        if (-not $created.id) { throw 'Note persistence failed' }
        [ordered]@{elapsedMs=$interactiveMs;readiness=$(if ($Legacy) {'HTTP only; legacy frontend needs manual validation'} else {'frontend.first.interactive'});process=$process.Id;note=$created.id} | ConvertTo-Json | Set-Content (Join-Path $LogDir 'startup-result.json')
    } finally {
        if (-not $process.HasExited) { $null = $process.CloseMainWindow(); if (-not $process.WaitForExit(10000)) { $process.Kill(); $process.WaitForExit() } }
        if (Test-Path (Join-Path $DataDir 'startup.log')) { Copy-Item (Join-Path $DataDir 'startup.log') (Join-Path $LogDir 'startup.log') -Force }
    }
}
