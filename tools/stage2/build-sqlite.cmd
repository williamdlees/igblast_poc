@echo off
setlocal
if not defined STAGE2_TOOLS (
  echo Set STAGE2_TOOLS to the isolated toolchain directory.
  exit /b 2
)
if not defined VSROOT set "VSROOT=C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools"
if not defined VSINSTALLER set "VSINSTALLER=C:\Program Files (x86)\Microsoft Visual Studio\Installer"
set "SQLITE_SOURCE=%STAGE2_TOOLS%\sqlite-3.50.4\sqlite-amalgamation-3500400"
if not exist "%SQLITE_SOURCE%\sqlite3.c" (
  echo Extract the verified SQLite amalgamation into "%SQLITE_SOURCE%".
  exit /b 2
)
call "%STAGE2_TOOLS%\emsdk\emsdk_env.bat"
if errorlevel 1 exit /b %errorlevel%
if not exist "%SQLITE_SOURCE%\include" mkdir "%SQLITE_SOURCE%\include"
copy /y "%SQLITE_SOURCE%\sqlite3.h" "%SQLITE_SOURCE%\include\sqlite3.h" >nul
if errorlevel 1 exit /b %errorlevel%
emcc -O2 -pthread -DSQLITE_THREADSAFE=1 -DSQLITE_ENABLE_COLUMN_METADATA -c "%SQLITE_SOURCE%\sqlite3.c" -o "%SQLITE_SOURCE%\sqlite3.o"
if errorlevel 1 exit /b %errorlevel%
emar rcs "%SQLITE_SOURCE%\libsqlite3.a" "%SQLITE_SOURCE%\sqlite3.o"
if errorlevel 1 exit /b %errorlevel%
set "PATH=%VSINSTALLER%;%PATH%"
call "%VSROOT%\VC\Auxiliary\Build\vcvars64.bat"
if errorlevel 1 exit /b %errorlevel%
if not exist "%STAGE2_TOOLS%\native-sqlite-3.50.4\include" mkdir "%STAGE2_TOOLS%\native-sqlite-3.50.4\include"
if not exist "%STAGE2_TOOLS%\native-sqlite-3.50.4\lib\ReleaseDLL" mkdir "%STAGE2_TOOLS%\native-sqlite-3.50.4\lib\ReleaseDLL"
copy /y "%SQLITE_SOURCE%\sqlite3.h" "%STAGE2_TOOLS%\native-sqlite-3.50.4\include\sqlite3.h" >nul
if errorlevel 1 exit /b %errorlevel%
"%STAGE2_TOOLS%\emsdk\upstream\bin\clang-cl.exe" /O2 /MD /DSQLITE_THREADSAFE=1 /DSQLITE_ENABLE_COLUMN_METADATA /c "%SQLITE_SOURCE%\sqlite3.c" /Fo"%SQLITE_SOURCE%\sqlite3.obj"
if errorlevel 1 exit /b %errorlevel%
"%VSROOT%\VC\Tools\Llvm\x64\bin\llvm-lib.exe" /OUT:"%STAGE2_TOOLS%\native-sqlite-3.50.4\lib\ReleaseDLL\sqlite3.lib" "%SQLITE_SOURCE%\sqlite3.obj"
exit /b %errorlevel%
