param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$demoRoot = $PSScriptRoot
$demoPort = 18766

& (Join-Path $demoRoot 'tools\sync-offline.ps1')

function Test-DemoServer([int]$CandidatePort) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$CandidatePort/static/offline.html" -TimeoutSec 1
        return $response.StatusCode -eq 200 -and $response.Content.Contains('data-offline-generator="resting-slow-20260924"') -and $response.Content.Contains('view-guard')
    } catch { return $false }
}
if (-not (Test-DemoServer $demoPort)) {
    while (Get-NetTCPConnection -LocalPort $demoPort -State Listen -ErrorAction SilentlyContinue) { $demoPort++ }
    $demoPythonPath = $null
    $demoCandidates = @(
        (Join-Path $demoRoot '.venv\Scripts\python.exe'),
        (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe')
    )
    $demoCommand = Get-Command 'python.exe' -ErrorAction SilentlyContinue
    if ($demoCommand) { $demoCandidates += $demoCommand.Source }
    foreach ($candidate in $demoCandidates) {
        if (Test-Path -LiteralPath $candidate) { & $candidate --version 2>$null; if ($LASTEXITCODE -eq 0) { $demoPythonPath=$candidate; break } }
    }
    $demoArgs = @('-m','http.server',"$demoPort",'--bind','127.0.0.1')
    if (-not $demoPythonPath) {
        $demoCommand = Get-Command 'py.exe' -ErrorAction SilentlyContinue
        if ($demoCommand) {
            & $demoCommand.Source -3 --version 2>$null
            if ($LASTEXITCODE -eq 0) { $demoPythonPath=$demoCommand.Source; $demoArgs=@('-3')+$demoArgs }
        }
    }
    if (-not $demoPythonPath) { throw 'Python 3 is required. Install it or open /static/offline.html through the existing NX service.' }
    Start-Process -FilePath $demoPythonPath -ArgumentList $demoArgs -WorkingDirectory $demoRoot -WindowStyle Hidden | Out-Null
    $demoReady = $false
    for ($attempt=0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 200
        if (Test-DemoServer $demoPort) { $demoReady=$true; break }
    }
    if (-not $demoReady) { throw "Demo server failed to start on port $demoPort" }
}
$demoUrl = "http://127.0.0.1:$demoPort/static/offline.html?build=resting-slow-20260924"
Write-Host "DreamGuardian offline demo: $demoUrl"
if (-not $NoOpen) { Start-Process $demoUrl }
