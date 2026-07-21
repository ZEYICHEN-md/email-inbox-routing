@echo off
REM Wrapper for Outlook VBA — uses full node path (Outlook often lacks PATH).
setlocal
cd /d "%~dp0.."

set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=%LocalAppData%\Programs\nodejs\node.exe"
if not exist "%NODE%" (
  echo node.exe not found. Install Node.js or edit scripts/classify-json.bat >&2
  exit /b 9009
)

"%NODE%" "node_modules\tsx\dist\cli.mjs" scripts/classify-json.ts %*
exit /b %ERRORLEVEL%
