@echo off
setlocal
for %%I in ("%~dp0..\..\..\..") do set "STAGE2_REPO=%%~fI"
if not defined STAGE2_TOOLS (
  echo Set STAGE2_TOOLS to the isolated toolchain directory.
  exit /b 2
)
set "PATH=%STAGE2_TOOLS%\conda-build\Library\bin;%STAGE2_TOOLS%\conda-build;%PATH%"
call "%STAGE2_TOOLS%\emsdk\emsdk_env.bat"
if errorlevel 1 exit /b %errorlevel%
node "%~dp0run.cjs" > "%STAGE2_REPO%\browser-stage2.log" 2>&1
if errorlevel 1 (
  type "%STAGE2_REPO%\browser-stage2.log"
  exit /b 1
)
type "%STAGE2_REPO%\browser-stage2.log"
call "%~dp0run-native.cmd"
exit /b %errorlevel%
