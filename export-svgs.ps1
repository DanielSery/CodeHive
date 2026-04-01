$ErrorActionPreference = 'Stop'

$sourceFile  = "c:\Repos\CodeHive\master\src\renderer\sidebar\worktree-tab-icons.js"
$outputDir   = "C:\Repos\images"
$chromePath  = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$size        = 64  # 16 * 4x scale
$tempDir     = [System.IO.Path]::GetTempPath()

# Colors (dark theme values): label -> hex
$colors = @{
    'text'       = '#cdd6f4'
    'text-muted' = '#6c7086'
    'accent'     = '#89b4fa'
    'green'      = '#a6e3a1'
    'yellow'     = '#f9e2af'
    'red'        = '#f38ba8'
    'peach'      = '#fab387'
}

# icon name -> array of color labels it can appear in
$iconColors = @{
    'BIN_ICON_SVG'                   = @('text-muted', 'red')
    'DOT_COMMIT_PUSH_SVG'            = @('green')
    'DOT_CREATE_PR_SVG'              = @('green')
    'DOT_OPEN_PR_SVG'                = @('yellow', 'green', 'peach', 'red')
    'DOT_COMPLETE_PR_SVG'            = @('green')
    'DOT_RESOLVE_TASK_SVG'           = @('green', 'accent', 'red')
    'DOT_OPEN_TASK_SVG'              = @('text-muted')
    'DOT_SWITCH_SVG'                 = @('text-muted')
    'DOT_DONE_SWITCH_SVG'            = @('text-muted', 'yellow', 'red')
    'DOT_PIPELINE_SVG'               = @('accent', 'yellow', 'red')
    'INSTALL_BTN_SVG'                = @('green', 'accent', 'red')
    'OPEN_DIRECTORY_SVG'             = @('text-muted', 'text')
    'CLONE_REPO_SVG'                 = @('text-muted', 'text')
    'AZURE_PAT_SVG'                  = @('text-muted', 'text')
    'GIT_APP_SVG'                    = @('text-muted', 'text')
    'THEME_DARK_SVG'                 = @('text-muted', 'text')
    'THEME_LIGHT_SVG'                = @('text-muted', 'text')
    'TERMINAL_SVG'                   = @('text-muted', 'accent')
    'UPDATE_SVG'                     = @('text-muted', 'accent')
}

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

# Build the set of expected output filenames
$expectedFiles = @{}
foreach ($name in $iconColors.Keys) {
    foreach ($colorLabel in $iconColors[$name]) {
        $expectedFiles["${name}_${colorLabel}.png"] = $true
    }
}

# Remove any PNGs in the output dir that are no longer in the export list
foreach ($existing in Get-ChildItem -Path $outputDir -Filter "*.png") {
    if (-not $expectedFiles.ContainsKey($existing.Name)) {
        Remove-Item $existing.FullName -Force
        Write-Host "Removed stale: $($existing.Name)"
    }
}

$source     = Get-Content $sourceFile -Raw
$regex      = [regex]"const\s+(\w+_SVG)\s*=\s*'(<svg[\s\S]+?</svg>)'"
$svgMatches = $regex.Matches($source)

$svgMap = @{}
foreach ($m in $svgMatches) {
    $svgMap[$m.Groups[1].Value] = $m.Groups[2].Value
}

Write-Host "Found $($svgMap.Count) SVGs"

foreach ($name in $iconColors.Keys | Sort-Object) {
    $svg = $svgMap[$name]
    if (-not $svg) { Write-Host "MISSING SVG: $name"; continue }

    foreach ($colorLabel in $iconColors[$name]) {
        $hex      = $colors[$colorLabel]
        $outName  = "${name}_${colorLabel}.png"
        $htmlPath = Join-Path $tempDir "$outName.html"
        $outPath  = Join-Path $outputDir $outName

        $html = @"
<!DOCTYPE html><html><head><style>
* { margin:0; padding:0; }
html, body { width:${size}px; height:${size}px; background:#1e1e2e; display:flex; align-items:center; justify-content:center; color:$hex; overflow:hidden; }
svg { width:${size}px; height:${size}px; }
</style></head><body>$svg</body></html>
"@
        Set-Content -Path $htmlPath -Value $html -Encoding UTF8

        $fileUrl = "file:///" + ($htmlPath -replace '\\', '/')
        & $chromePath --headless --disable-gpu --screenshot="$outPath" `
            --window-size="$size,$size" --hide-scrollbars `
            --user-data-dir="$tempDir\chrome-ud-$outName" $fileUrl 2>$null
        Start-Sleep 2

        if (Test-Path $outPath) {
            Write-Host "Saved: $outName"
        } else {
            Write-Host "FAILED: $outName"
        }

        Remove-Item $htmlPath -ErrorAction SilentlyContinue
        Remove-Item "$tempDir\chrome-ud-$outName" -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "Done."
