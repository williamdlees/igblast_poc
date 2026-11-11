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
if not defined VSROOT set "VSROOT=C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools"
if not defined VSINSTALLER set "VSINSTALLER=C:\Program Files (x86)\Microsoft Visual Studio\Installer"
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
set "STAGE2_BUILD=%STAGE2_REPO%\build-stage2-native"
set "PATH=%STAGE2_TOOLS%\conda-build\Library\bin;%STAGE2_TOOLS%\conda-build;%PATH%"
set "PATH=%VSINSTALLER%;%PATH%"
call "%VSROOT%\VC\Auxiliary\Build\vcvars64.bat"
if errorlevel 1 exit /b %errorlevel%
cmake -S "%NCBI_SOURCE%\src" -B "%STAGE2_BUILD%" -G Ninja "-DCMAKE_MAKE_PROGRAM=%STAGE2_TOOLS%\conda-build\Library\bin\ninja.exe" "-DNCBI_DATATOOL:FILEPATH=%NCBI_DATATOOL%" "-DCMAKE_C_COMPILER=%STAGE2_TOOLS%\emsdk\upstream\bin\clang-cl.exe" "-DCMAKE_CXX_COMPILER=%STAGE2_TOOLS%\emsdk\upstream\bin\clang-cl.exe" "-DCMAKE_C_COMPILER_LAUNCHER=%STAGE2_TOOLS%\conda-build\Library\bin\cmake.exe;-E;env" "-DCMAKE_CXX_COMPILER_LAUNCHER=%STAGE2_TOOLS%\conda-build\Library\bin\cmake.exe;-E;env" "-DNCBI_ThirdParty_SQLITE3:PATH=%STAGE2_TOOLS%\native-sqlite-3.50.4" -DNCBI_COMPONENT_LocalZCF_DISABLED=ON "-DCMAKE_C_FLAGS=/DWIN32 /D_WINDOWS" "-DCMAKE_CXX_FLAGS=/DWIN32 /D_WINDOWS /GR /EHsc /clang:-msse4.2" -DCMAKE_EXE_LINKER_FLAGS=/machine:x64 -DCMAKE_BUILD_TYPE=ReleaseDLL -DCMAKE_CXX_STANDARD=20 "-DNCBI_PTBCFG_PROJECT_TARGETS=makeblastdb;igblastn"
if errorlevel 1 exit /b %errorlevel%
if "%STAGE2_CLEAN_BUILD%"=="1" cmake --build "%STAGE2_BUILD%" --target clean
if errorlevel 1 exit /b %errorlevel%
cmake --build "%STAGE2_BUILD%" --target makeblastdb igblastn --parallel %STAGE2_JOBS%
exit /b %errorlevel%
