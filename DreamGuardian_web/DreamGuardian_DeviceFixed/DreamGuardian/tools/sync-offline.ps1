[CmdletBinding()]
param()

$packageRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $packageRoot 'static\index.html'
$outputPath = Join-Path $packageRoot 'static\offline.html'

if (-not (Test-Path -LiteralPath $sourcePath)) {
    throw "Production page not found: $sourcePath"
}

$html = [System.IO.File]::ReadAllText($sourcePath, [System.Text.Encoding]::UTF8)
$lineBreak = if ($html.Contains("`r`n")) { "`r`n" } else { "`n" }

function Replace-RegexRequired([string]$InputText, [string]$Pattern, [string]$Replacement, [string]$Description) {
    $expression = [regex]::new($Pattern)
    if (-not $expression.IsMatch($InputText)) {
        throw "Cannot generate offline page: missing $Description marker."
    }
    return $expression.Replace($InputText, $Replacement, 1)
}

$html = Replace-RegexRequired -InputText $html -Pattern '(?is)<title\b[^>]*>.*?</title>' -Replacement '<title>DreamGuardian &#183; Windows &#31163;&#32447;&#27169;&#25311; &#183; 查看详情更新版</title>' -Description 'page title'
$html = Replace-RegexRequired -InputText $html -Pattern '(?i)<body\b([^>]*)>' -Replacement '<body$1 data-offline="true" data-offline-generator="resting-slow-20260924">' -Description 'body'
$html = Replace-RegexRequired -InputText $html -Pattern '(?i)<div\s+class="top-status"\s*>' -Replacement ('<div class="top-status">' + $lineBreak + '      <span class="offline-badge">&#31163;&#32447;&#27169;&#25311; &#183; &#38750;&#30495;&#23454;&#35774;&#22791;</span>') -Description 'top status'
$html = Replace-RegexRequired -InputText $html -Pattern '(?is)<div\s+class="sidebar-foot"\s*>.*?</div>' -Replacement '<div class="sidebar-foot"><span>OFFLINE DEMO</span><p>&#27169;&#25311;&#25968;&#25454; &#183; &#19981;&#36830;&#25509;&#30495;&#23454;&#35774;&#22791;</p></div>' -Description 'sidebar footer'
$sleepScriptPattern = '(?im)^(\s*)(<script\s+src="/static/sleep-modules\.js(?:\?[^\"]*)?"\s*></script>)'
$sleepScriptReplacement = ('$1<script src="/static/offline-mock.js?v=6"></script>' + $lineBreak + '$1$2')
$html = Replace-RegexRequired -InputText $html -Pattern $sleepScriptPattern -Replacement $sleepScriptReplacement -Description 'sleep modules script'
$html = Replace-RegexRequired -InputText $html -Pattern '(?i)<!doctype\s+html>\s*' -Replacement ('<!doctype html>' + $lineBreak + '<!-- Generated from static/index.html by tools/sync-offline.ps1. Do not edit directly. -->' + $lineBreak) -Description 'doctype'

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($outputPath, $html, $utf8NoBom)
Write-Host "Offline page synchronized: $outputPath"
