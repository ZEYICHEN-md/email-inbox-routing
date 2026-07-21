#Requires -Version 5.1
$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DistDir = Join-Path $ProjectRoot "dist"
$ZipName = "email-inbox-routing.zip"
$ZipPath = Join-Path $DistDir $ZipName
$Stage = Join-Path $DistDir "email-inbox-routing"

Write-Host "Packing team distribution..." -ForegroundColor Cyan

if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Path $Stage -Force | Out-Null

$include = @(
    "src",
    "scripts",
    "tests",
    "fixtures",
    "outlook",
    "inbox",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    ".env.example",
    ".gitignore",
    "README.md"
)

foreach ($item in $include) {
    $src = Join-Path $ProjectRoot $item
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $Stage $item) -Recurse -Force
    }
}

# Ensure inbox gitkeep
$inboxKeep = Join-Path $Stage "inbox\.gitkeep"
if (-not (Test-Path $inboxKeep)) {
    New-Item -ItemType File -Path $inboxKeep -Force | Out-Null
}

# Strip secrets if accidentally present
@(".env", ".graph-token.json", ".pipeline-state.json") | ForEach-Object {
    $p = Join-Path $Stage $_
    if (Test-Path $p) { Remove-Item $p -Force; Write-Host "Removed $_ from pack" -ForegroundColor Yellow }
}

if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Compress-Archive -Path $Stage -DestinationPath $ZipPath -Force

$sizeMb = [math]::Round((Get-Item $ZipPath).Length / 1MB, 2)
Write-Host ""
Write-Host "Created: $ZipPath ($sizeMb MB)" -ForegroundColor Green
Write-Host "Share this zip with teammates. They run: npm run setup" -ForegroundColor Green
