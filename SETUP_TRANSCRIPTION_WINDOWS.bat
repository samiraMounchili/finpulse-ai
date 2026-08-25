@echo off
setlocal
cd /d "%~dp0"
echo.
echo FinPulse automatic video transcription setup
echo --------------------------------------------
where py >nul 2>nul || (
  echo Python Launcher was not found. Install Python 3.12 from python.org, then run this file again.
  pause
  exit /b 1
)
py -3.12 --version >nul 2>nul || (
  echo Python 3.12 was not found. Install Python 3.12, then run this file again.
  pause
  exit /b 1
)
if not exist ".venv-transcribe\Scripts\python.exe" (
  echo Creating the FinPulse Python environment...
  py -3.12 -m venv .venv-transcribe
)
echo Installing video and speech-to-text tools...
.venv-transcribe\Scripts\python.exe -m pip install -U -r requirements-transcribe.txt
if errorlevel 1 (
  echo Setup did not finish successfully.
  pause
  exit /b 1
)
echo.
echo Done. Automatic public-video transcription is ready.
echo The first video may take longer while the speech model is downloaded.
pause
