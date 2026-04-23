# Embed the Inter variable font into the engine HTML.
#
# PowerShell port of bake_font.py for Windows boxes without Python.
# Downloads the Inter variable woff2 and replaces any existing Google
# Fonts @import (or prior baked @font-face) in
# kiro_slideshow_engine_v3.html with a self-contained @font-face data URL.
#
# Run from repo root:   powershell -ExecutionPolicy Bypass -File scripts\bake_font.ps1

$ErrorActionPreference = 'Stop'

$repo   = Split-Path $PSScriptRoot -Parent
$engine = Join-Path $repo 'kiro_slideshow_engine_v3.html'

$urls = @(
    'https://cdn.jsdelivr.net/npm/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
    'https://rsms.me/inter/font-files/InterVariable.woff2'
)

$bytes = $null
foreach ($url in $urls) {
    try {
        Write-Host "Fetching $url ..."
        $resp  = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30
        $bytes = $resp.Content
        if ($bytes.Length -lt 10000) { throw "response too small ($($bytes.Length) bytes)" }
        Write-Host "[ok] fetched $($bytes.Length) bytes"
        break
    } catch {
        Write-Warning "[!] $url failed: $($_.Exception.Message)"
        $bytes = $null
    }
}

if (-not $bytes) { throw "all font sources failed" }

$b64 = [Convert]::ToBase64String($bytes)

$block = @"
  /* Inter variable font, baked inline to avoid any network race
     with html2canvas. Covers weights 400-900 in one woff2. */
  @font-face {
    font-family: 'Inter';
    font-style: normal;
    font-weight: 100 900;
    font-display: block;
    src: url(data:font/woff2;base64,$b64) format('woff2-variations');
  }
"@

$html = Get-Content -Raw $engine

# Replace prior Inter @font-face if present, else the Google Fonts @import,
# else insert the block right after <style>.
$facePat   = '(?ms)[ \t]*(?:/\*[^*]*?\*/\s*)?@font-face\s*\{[^}]*?Inter[^}]*?\}'
$importPat = "(?:/\*[^*]*?\*/\s*)?@import url\(['""]https://fonts\.googleapis\.com[^'""]+['""]\);"

function Replace-Once($text, $pattern, $replacement) {
    $rx = [regex]::new($pattern)
    $m  = $rx.Match($text)
    if (-not $m.Success) { return $null }
    return $text.Substring(0, $m.Index) + $replacement + $text.Substring($m.Index + $m.Length)
}

$newHtml = Replace-Once $html $facePat $block
if (-not $newHtml) { $newHtml = Replace-Once $html $importPat $block }
if (-not $newHtml) {
    Write-Warning "no @import or prior @font-face found; inserting after <style>"
    $newHtml = [regex]::new('<style>\s*').Replace($html, "<style>`n$block`n", 1)
}

Set-Content -Path $engine -Value $newHtml -NoNewline
Write-Host "wrote $(Split-Path $engine -Leaf) with embedded Inter font ($($b64.Length) b64 chars)"
