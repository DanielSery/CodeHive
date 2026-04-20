param(
    [string]$Version = '',
    [string]$ReleaseNotes = ''
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# Wait for the app process to fully release file locks before building
Start-Sleep -Seconds 3

# --- Ensure gh is on PATH ---
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    $ghDefault = 'C:\Program Files\GitHub CLI\gh.exe'
    if (Test-Path $ghDefault) {
        $env:PATH += ';C:\Program Files\GitHub CLI'
    } else {
        Write-Error "GitHub CLI (gh) not found. Install it with: winget install GitHub.cli"
        exit 1
    }
}

# --- Resolve version ---
$packageJsonRaw = Get-Content 'package.json' -Raw
$packageJson = $packageJsonRaw | ConvertFrom-Json
if ($Version -eq '') {
    $parts = $packageJson.version -split '\.'
    $Version = "$($parts[0]).$($parts[1]).$([int]$parts[2] + 1)"
}
if ($Version -ne $packageJson.version) {
    $packageJsonRaw = $packageJsonRaw -replace '"version"\s*:\s*"[^"]*"', """version"": ""$Version"""
    Set-Content 'package.json' $packageJsonRaw -NoNewline
    Write-Host "Version bumped: $($packageJson.version) -> $Version" -ForegroundColor Cyan
}

$tag = "v$Version"
$zipName = "MUCHA-$tag-win.zip"
$zipPath = "dist\win-unpacked\$zipName"

Write-Host "Publishing MUCHA $tag" -ForegroundColor Cyan

# --- Check the tag doesn't already exist ---
$ErrorActionPreference = 'Continue'
$null = gh release view $tag 2>&1
$ErrorActionPreference = 'Stop'
if ($LASTEXITCODE -eq 0) {
    Write-Error "Release $tag already exists."
    exit 1
}

# --- Build ---
Write-Host "`nBuilding..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Error "Build failed."
    exit 1
}

# --- Zip ---
Write-Host "`nZipping dist\win-unpacked -> $zipPath" -ForegroundColor Yellow
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path 'dist\win-unpacked\*' -DestinationPath $zipPath
Write-Host "Created $zipName ($([Math]::Round((Get-Item $zipPath).Length / 1MB, 1)) MB)"

# --- Create GitHub release ---
Write-Host "`nCreating GitHub release $tag..." -ForegroundColor Yellow
if ($ReleaseNotes -ne '') {
    gh release create $tag $zipPath `
        --repo DanielSery/MUCHA `
        --title "MUCHA $tag" `
        --notes $ReleaseNotes
} else {
    gh release create $tag $zipPath `
        --repo DanielSery/MUCHA `
        --title "MUCHA $tag" `
        --generate-notes
}

Write-Host "`nDone. https://github.com/DanielSery/MUCHA/releases/tag/$tag" -ForegroundColor Green

# --- Restart app ---
Write-Host "`nRestarting MUCHA..." -ForegroundColor Cyan
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm', 'start' -WorkingDirectory $PSScriptRoot
