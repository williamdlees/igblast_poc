@echo off
setlocal
node research\tools\stage5\server.cjs
exit /b %errorlevel%
