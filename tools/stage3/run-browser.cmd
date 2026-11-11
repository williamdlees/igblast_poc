@echo off
setlocal
for %%I in ("%~dp0..\..") do set "STAGE3_REPO=%%~fI"
if not exist "%STAGE3_REPO%\tests\fixtures\stage3\ogrdb\manifest.json" (
  echo Capture OGRDB API responses first with:
  echo python tools\stage3\capture_ogrdb.py --capture
  exit /b 2
)
node "%~dp0harness\run-browser.cjs"
exit /b %errorlevel%
