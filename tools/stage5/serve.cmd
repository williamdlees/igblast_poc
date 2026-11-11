@echo off
setlocal
node tools\stage5\server.cjs
exit /b %errorlevel%
