@echo off
setlocal
for %%I in ("%~dp0..\..\..\..") do set "STAGE2_REPO=%%~fI"
if not defined STAGE2_TOOLS (
  echo Set STAGE2_TOOLS to the isolated toolchain directory.
  exit /b 2
)
set "STAGE2_BUILD=%STAGE2_REPO%\build-stage2-native"
set "STAGE2_BIN=%STAGE2_REPO%\bin"
if not defined VSROOT set "VSROOT=C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools"
if not defined VSINSTALLER set "VSINSTALLER=C:\Program Files (x86)\Microsoft Visual Studio\Installer"
set "PATH=%VSINSTALLER%;%PATH%"
call "%VSROOT%\VC\Auxiliary\Build\vcvars64.bat"
if errorlevel 1 exit /b %errorlevel%
set "PATH=%STAGE2_TOOLS%\conda-build\Library\bin;%STAGE2_TOOLS%\conda-build;%STAGE2_TOOLS%\emsdk\upstream\bin;%STAGE2_TOOLS%\emsdk\node\24.19.0_64bit;%STAGE2_REPO%\bin;%PATH%"
set "DB=%STAGE2_BUILD%\db"
if not exist "%DB%\internal_data\human" mkdir "%DB%\internal_data\human"
pushd "%DB%"
if errorlevel 1 exit /b 1
if not exist "V.nin" call :builddb V V-matched.fasta
if errorlevel 1 (popd & exit /b 1)
if not exist "D.nin" call :builddb D D.fasta
if errorlevel 1 (popd & exit /b 1)
if not exist "J.nin" call :builddb J J.fasta
if errorlevel 1 (popd & exit /b 1)
for %%F in (V.*) do copy /y "%%F" "internal_data\human\human_%%F" >nul
"%STAGE2_BIN%\igblastn.exe" -query "%STAGE2_REPO%\research\tests\fixtures\stage2\query.fasta" -germline_db_V V -germline_db_D D -germline_db_J J -custom_internal_data "%STAGE2_REPO%\research\tests\fixtures\stage2\Homo_sapiens_IGH.ndm" -auxiliary_data "%STAGE2_REPO%\research\tests\fixtures\stage2\Homo_sapiens_IGH.aux" -organism human -domain_system imgt -ig_seqtype Ig -outfmt 19 -num_threads 1 -out "%STAGE2_BUILD%\native-airr.tsv"
if errorlevel 1 (
  popd
  exit /b 1
)
popd
node "%STAGE2_REPO%\research\tools\stage2\harness\compare.cjs" "%STAGE2_BUILD%\native-airr.tsv" "%STAGE2_REPO%\browser-airr.tsv"
exit /b %errorlevel%

:builddb
"%STAGE2_BIN%\makeblastdb.exe" -in "%STAGE2_REPO%\research\tests\fixtures\stage2\%2" -dbtype nucl -blastdb_version 4 -parse_seqids -out %1
exit /b %errorlevel%
