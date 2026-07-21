#Requires -Version 5.1
<#
.SYNOPSIS
  First-time setup for email inbox routing tool.

.DESCRIPTION
  - Checks Node.js
  - npm install
  - Creates .env from .env.example if missing
  - Prompts for LLM_API_KEY
  - Sets user env EMAIL_ROUTING_HOME for Outlook VBA
#>
param(
    [switch]$SkipVerify
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

Write-Host ""
Write-Host "=== Email Inbox Routing Setup ===" -ForegroundColor Cyan
Write-Host "Project: $ProjectRoot"
Write-Host ""

# Node.js
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "ERROR: Node.js not found. Install from https://nodejs.org (LTS)" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Node $(node -v)"

# npm install
Write-Host ""
Write-Host "Running npm install..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "[OK] Dependencies installed"

# .env
$envFile = Join-Path $ProjectRoot ".env"
$exampleFile = Join-Path $ProjectRoot ".env.example"
if (-not (Test-Path $envFile)) {
    if (-not (Test-Path $exampleFile)) {
        Write-Host "ERROR: .env.example not found" -ForegroundColor Red
        exit 1
    }
    Copy-Item $exampleFile $envFile
    Write-Host ""
    Write-Host "Created .env from .env.example" -ForegroundColor Green
}

# Prompt for API key if placeholder
$envContent = Get-Content $envFile -Raw
if ($envContent -match "your_key_here" -or $envContent -notmatch "LLM_API_KEY=\S+") {
    Write-Host ""
    Write-Host "Enter your LLM_API_KEY (LLM provider / OpenAI-compatible, NOT a colleague's key):" -ForegroundColor Yellow
    $key = Read-Host "LLM_API_KEY"
    if ($key.Trim().Length -gt 0) {
        $envContent = $envContent -replace "LLM_API_KEY=.*", "LLM_API_KEY=$key"
        Set-Content -Path $envFile -Value $envContent.TrimEnd() -Encoding UTF8
        Write-Host "[OK] LLM_API_KEY saved to .env"
    } else {
        Write-Host "WARN: Skipped API key — edit .env manually before classify" -ForegroundColor Yellow
    }
} else {
    Write-Host "[OK] .env already configured"
}

# User environment variable for VBA
[Environment]::SetEnvironmentVariable("EMAIL_ROUTING_HOME", $ProjectRoot, "User")
$env:EMAIL_ROUTING_HOME = $ProjectRoot
Write-Host "[OK] EMAIL_ROUTING_HOME = $ProjectRoot"
Write-Host "     (Restart Outlook if VBA was already open)"

Write-Host ""
if (-not $SkipVerify) {
    Write-Host "Running verify..." -ForegroundColor Yellow
    npm run verify
}

Write-Host ""
Write-Host "=== Setup complete ===" -ForegroundColor Green
Write-Host "Next:"
Write-Host "  1. npm run classify -- --body-file fixtures/atra-media-inquiry.txt"
Write-Host "  2. Install Outlook macro: see outlook/README.md"
Write-Host ""
