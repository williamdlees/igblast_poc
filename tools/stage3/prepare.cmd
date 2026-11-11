@echo off
setlocal
set "STAGE3_DIR=%~dp0"

if not exist "%STAGE3_DIR%node_modules\pyodide\pyodide.js" (
  npm ci --prefix "%STAGE3_DIR%"
  if errorlevel 1 exit /b %errorlevel%
)

if not exist "%STAGE3_DIR%receptor_utils-src\.git" (
  git clone --filter=blob:none https://github.com/williamdlees/receptor_utils.git "%STAGE3_DIR%receptor_utils-src"
  if errorlevel 1 exit /b %errorlevel%
)
git -C "%STAGE3_DIR%receptor_utils-src" fetch origin f6bfb03f00358babc07bf6ec20899e85528887ce
if errorlevel 1 exit /b %errorlevel%
git -C "%STAGE3_DIR%receptor_utils-src" checkout --detach f6bfb03f00358babc07bf6ec20899e85528887ce
if errorlevel 1 exit /b %errorlevel%

if not exist "%STAGE3_DIR%assets" mkdir "%STAGE3_DIR%assets"
python -m pip wheel --no-deps --wheel-dir "%STAGE3_DIR%assets" "%STAGE3_DIR%receptor_utils-src"
if errorlevel 1 exit /b %errorlevel%
node "%STAGE3_DIR%download-pyodide-packages.cjs"
if errorlevel 1 exit /b %errorlevel%
echo Pyodide 0.27.7 and receptor_utils commit f6bfb03f00358babc07bf6ec20899e85528887ce are prepared.
