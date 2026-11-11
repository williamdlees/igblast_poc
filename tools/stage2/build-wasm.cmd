@echo off
setlocal
for %%I in ("%~dp0..\..") do set "STAGE2_REPO=%%~fI"
if not defined STAGE2_TOOLS (
  echo Set STAGE2_TOOLS to the isolated toolchain directory.
  exit /b 2
)
if not defined NCBI_SOURCE (
  echo Set NCBI_SOURCE to the patched NCBI source checkout.
  exit /b 2
)
if not defined NCBI_DATATOOL set "NCBI_DATATOOL=%STAGE2_TOOLS%\host-tools\datatool.exe"
if not defined STAGE2_JOBS set "STAGE2_JOBS=4"
for /f %%H in ('git -C "%NCBI_SOURCE%" rev-parse HEAD') do set "NCBI_REV=%%H"
if not "%NCBI_REV%"=="f83dd16a0c30899da66d4f6902b5a9ed36c9d433" (
  echo NCBI_SOURCE must be checked out at the pinned commit.
  exit /b 2
)
git -C "%NCBI_SOURCE%" apply --reverse --check "%STAGE2_REPO%\patches\ncbi-stage2.patch" >nul 2>&1
if errorlevel 1 (
  echo The Stage 2 patch is not applied cleanly to NCBI_SOURCE.
  exit /b 2
)
set "STAGE2_BUILD=%STAGE2_REPO%\build-wasm-pthreads"
set "PATH=%STAGE2_TOOLS%\conda-build\Library\bin;%STAGE2_TOOLS%\conda-build;%PATH%"
call "%STAGE2_TOOLS%\emsdk\emsdk_env.bat"
if errorlevel 1 exit /b %errorlevel%
cmake -S "%NCBI_SOURCE%\src" -B "%STAGE2_BUILD%" -G Ninja "-DCMAKE_MAKE_PROGRAM=%STAGE2_TOOLS%\conda-build\Library\bin\ninja.exe" "-DNCBI_DATATOOL:FILEPATH=%NCBI_DATATOOL%" "-DCMAKE_TOOLCHAIN_FILE=%STAGE2_TOOLS%\emsdk\upstream\emscripten\cmake\Modules\Platform\Emscripten.cmake" "-DCMAKE_CROSSCOMPILING_EMULATOR=%STAGE2_TOOLS%\emsdk\node\24.19.0_64bit\node.exe" -DCMAKE_BUILD_TYPE=Release "-DCMAKE_C_COMPILER_LAUNCHER=%STAGE2_TOOLS%\conda-build\Library\bin\cmake.exe;-E;env" "-DCMAKE_CXX_COMPILER_LAUNCHER=%STAGE2_TOOLS%\conda-build\Library\bin\cmake.exe;-E;env" "-DNCBI_COMPILER_FLAGS_SSE:STRING=" -DNCBI_COMPONENT_LocalZCF_DISABLED=ON -DCMAKE_C_FLAGS=-pthread "-DCMAKE_CXX_FLAGS=-pthread -fexceptions" -DCMAKE_CXX_STANDARD=20 "-DCMAKE_EXE_LINKER_FLAGS=-pthread -fexceptions -sPTHREAD_POOL_SIZE=4 -Wl,--error-limit=0" "-DSQLite3_INCLUDE_DIR:PATH=%STAGE2_TOOLS%\sqlite-3.50.4\sqlite-amalgamation-3500400" "-DSQLite3_LIBRARY:FILEPATH=%STAGE2_TOOLS%\sqlite-3.50.4\sqlite-amalgamation-3500400\libsqlite3.a" "-DNCBI_PTBCFG_PROJECT_TARGETS=makeblastdb;igblastn"
if errorlevel 1 exit /b %errorlevel%
if "%STAGE2_CLEAN_BUILD%"=="1" cmake --build "%STAGE2_BUILD%" --target clean
if errorlevel 1 exit /b %errorlevel%
cmake --build "%STAGE2_BUILD%" --target makeblastdb igblastn --parallel %STAGE2_JOBS%
exit /b %errorlevel%
