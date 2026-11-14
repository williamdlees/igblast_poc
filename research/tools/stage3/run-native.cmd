@echo off
setlocal
for %%I in ("%~dp0..\..\..") do set "STAGE3_REPO=%%~fI"
python "%~dp0capture_ogrdb.py" --source "%~dp0receptor_utils-src" --fixture "%STAGE3_REPO%\research\tests\fixtures\stage3\ogrdb" --output "%~dp0results\native"
exit /b %errorlevel%
