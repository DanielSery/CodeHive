$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

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

# --- Read version from package.json ---
$packageJson = Get-Content 'package.json' -Raw | ConvertFrom-Json
$version = $packageJson.version
$tag = "v$version"
$zipName = "CodeHive-$tag-win.zip"
$zipPath = "dist\win-unpacked\$zipName"

Write-Host "Publishing CodeHive $tag" -ForegroundColor Cyan

# --- Check the tag doesn't already exist ---
$ErrorActionPreference = 'Continue'
$null = gh release view $tag 2>&1
$ErrorActionPreference = 'Stop'
if ($LASTEXITCODE -eq 0) {
    Write-Error "Release $tag already exists. Bump the version in package.json first."
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
gh release create $tag $zipPath `
    --repo DanielSery/CodeHive `
    --title "CodeHive $tag" `
    --generate-notes

Write-Host "`nDone. https://github.com/DanielSery/CodeHive/releases/tag/$tag" -ForegroundColor Green
