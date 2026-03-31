$ErrorActionPreference = 'Stop'

$sourceFile  = "c:\Repos\CodeHive\master\src\renderer\sidebar\worktree-tab-icons.js"
$outputDir   = "C:\Repos\images"
$chromePath  = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$size        = 64  # 16 * 4x scale
$tempDir     = [System.IO.Path]::GetTempPath()

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$source     = Get-Content $sourceFile -Raw
$regex      = [regex]"const\s+(\w+_SVG)\s*=\s*'(<svg[\s\S]+?</svg>)'"
$svgMatches = $regex.Matches($source)

Write-Host "Found $($svgMatches.Count) SVGs"

foreach ($m in $svgMatches) {
    $name    = $m.Groups[1].Value
    $svg     = $m.Groups[2].Value
    $htmlPath = Join-Path $tempDir "$name.html"
    $shotPath = Join-Path $tempDir "$name.png"
    $outPath  = Join-Path $outputDir "$name.png"

    $html = @"
<!DOCTYPE html><html><head><style>
* { margin:0; padding:0; }
html, body { width:${size}px; height:${size}px; background:#1e1e2e; display:flex; align-items:center; justify-content:center; color:#cdd6f4; overflow:hidden; }
svg { width:${size}px; height:${size}px; }
</style></head><body>$svg</body></html>
"@
    Set-Content -Path $htmlPath -Value $html -Encoding UTF8

    $fileUrl = "file:///" + ($htmlPath -replace '\\', '/')
    Push-Location $tempDir
    & $chromePath --headless --disable-gpu --screenshot="$name.png" `
        --window-size="$size,$size" --hide-scrollbars `
        --user-data-dir="$tempDir\chrome-ud-$name" $fileUrl 2>$null
    Pop-Location

    if (Test-Path $shotPath) {
        Move-Item $shotPath $outPath -Force
        Write-Host "Saved: $name.png"
    } else {
        Write-Host "FAILED: $name"
    }

    Remove-Item $htmlPath -ErrorAction SilentlyContinue
    Remove-Item "$tempDir\chrome-ud-$name" -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Done."
