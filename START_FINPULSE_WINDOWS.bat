@echo off
setlocal
cd /d "%~dp0"
echo.
echo Starting FinPulse.AI...
if not exist "node_modules" (
  echo Installing Node packages first...
  call npm.cmd ci
  if errorlevel 1 goto :error
)
start "" "http://localhost:3000"
call npm.cmd start
goto :eof
:error
echo FinPulse could not start. Check that Node.js 24 is installed.
pause
