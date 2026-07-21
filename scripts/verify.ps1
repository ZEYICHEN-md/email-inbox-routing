#Requires -Version 5.1
$ErrorActionPreference = "Continue"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$failed = $false

function Ok($msg) { Write-Host "[OK] $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "[FAIL] $msg" -ForegroundColor Red; $script:failed = $true }
function Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "=== IR Email Routing Verify ===" -ForegroundColor Cyan

# Node
if (Get-Command node -ErrorAction SilentlyContinue) {
    Ok "Node $(node -v)"
} else {
    Fail "Node.js not installed"
}

# .env
$envFile = Join-Path $ProjectRoot ".env"
if (Test-Path $envFile) {
    $raw = Get-Content $envFile -Raw
    if ($raw -match "LLM_API_KEY=your_key_here" -or $raw -notmatch "LLM_API_KEY=\S{8,}") {
        Fail ".env exists but LLM_API_KEY not set"
    } else {
        Ok ".env configured"
    }
} else {
    Fail ".env missing — run: npm run setup"
}

# VBA path env
$home = [Environment]::GetEnvironmentVariable("EMAIL_ROUTING_HOME", "User")
if ($home -and (Test-Path (Join-Path $home "scripts\classify-json.bat"))) {
    Ok "EMAIL_ROUTING_HOME -> $home"
} else {
    Warn "EMAIL_ROUTING_HOME not set — run: npm run setup (or edit VBA path manually)"
}

# BAT
$bat = Join-Path $ProjectRoot "scripts\classify-json.bat"
if (Test-Path $bat) {
    Ok "classify-json.bat exists"
} else {
    Fail "classify-json.bat missing"
}

# LLM smoke test
Write-Host ""
Write-Host "LLM smoke test (atra sample)..." -ForegroundColor Yellow
$out = Join-Path $env:TEMP "ir-routing-verify.json"
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"$bat`" --body-file `"$ProjectRoot\fixtures\atra-media-inquiry.txt`" --out `"$out`"" -Wait -PassThru -NoNewWindow
if ($proc.ExitCode -ne 0) {
    Fail "classify-json exit code $($proc.ExitCode)"
} elseif (-not (Test-Path $out)) {
    Fail "no output JSON"
} else {
    $json = Get-Content $out -Raw
    if ($json -match '"ok":\s*true' -and $json -match "PR_Media_International") {
        Ok "LLM classify -> PR_Media_International"
    } else {
        Fail "unexpected classify result"
    }
}

Write-Host ""
if ($failed) {
    Write-Host "Verify FAILED" -ForegroundColor Red
    exit 1
}
Write-Host "Verify PASSED" -ForegroundColor Green
exit 0
