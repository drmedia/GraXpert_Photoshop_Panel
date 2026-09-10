@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul

echo ============================================================
echo GraXpert Photoshop Panel Installer v0.9.2
echo ============================================================
echo.

if not defined APPDATA (
    echo [ERROR] The APPDATA environment variable is not available.
    goto :fail
)
if not defined SystemRoot (
    echo [ERROR] The SystemRoot environment variable is not available.
    goto :fail
)

for %%I in ("%~dp0GraXpert-Photoshop-Panel") do set "SRC=%%~fI"
for %%I in ("%APPDATA%\Adobe\CEP\extensions") do set "CEP_ROOT=%%~fI"
for %%I in ("%APPDATA%\Adobe\CEP\extensions\GraXpert-Photoshop-Panel") do set "DST=%%~fI"
for %%I in ("%APPDATA%\Adobe\CEP\extensions\GraXpert-Photoshop-Panel\..") do set "DST_PARENT=%%~fI"

set "REGEXE=%SystemRoot%\System32\reg.exe"
set "XCOPYEXE=%SystemRoot%\System32\xcopy.exe"
set "FCEXE=%SystemRoot%\System32\fc.exe"
set "FINDSTREXE=%SystemRoot%\System32\findstr.exe"
set "TASKLISTEXE=%SystemRoot%\System32\tasklist.exe"
set "FINDEXE=%SystemRoot%\System32\find.exe"

if /I not "%DST_PARENT%"=="%CEP_ROOT%" (
    echo [ERROR] Refusing to use an unexpected destination path:
    echo         %DST%
    goto :fail
)
if /I "%DST%"=="%CEP_ROOT%" (
    echo [ERROR] Refusing to use the CEP extensions root as the destination.
    goto :fail
)

if not exist "%SRC%\CSXS\manifest.xml" (
    echo [ERROR] Extension source folder was not found:
    echo         %SRC%
    goto :fail
)

for %%T in ("%REGEXE%" "%XCOPYEXE%" "%FCEXE%" "%FINDSTREXE%" "%TASKLISTEXE%" "%FINDEXE%") do (
    if not exist "%%~T" (
        echo [ERROR] Required Windows tool was not found:
        echo         %%~T
        goto :fail
    )
)

"%TASKLISTEXE%" /FI "IMAGENAME eq Photoshop.exe" 2>nul | "%FINDEXE%" /I "Photoshop.exe" >nul
if not errorlevel 1 (
    echo [ERROR] Photoshop is currently running.
    echo         Close Photoshop completely, then run this installer again.
    goto :fail
)

echo [1/4] Checking the CEP extensions folder...
if not exist "%CEP_ROOT%" mkdir "%CEP_ROOT%" >nul 2>&1
if not exist "%CEP_ROOT%" (
    echo [ERROR] Could not create the CEP extensions folder:
    echo         %CEP_ROOT%
    goto :fail
)

echo [2/4] Removing the previous installation...
if exist "%DST%" rmdir /S /Q "%DST%" 2>nul
if exist "%DST%" (
    echo [ERROR] Could not remove the previous installation.
    echo         %DST%
    echo         Check whether an Adobe process is still using its files.
    goto :fail
)

echo [3/4] Copying and verifying extension files...
mkdir "%DST%" >nul 2>&1
if not exist "%DST%" (
    echo [ERROR] Could not create the extension destination folder:
    echo         %DST%
    goto :fail
)

set "COPY_INCOMPLETE=1"
"%XCOPYEXE%" "%SRC%\*" "%DST%\" /E /I /H /K /Y >nul
if errorlevel 1 (
    echo [ERROR] Extension file copy failed.
    goto :fail
)

set "COPY_FAILED="
for %%F in ("CSXS\manifest.xml" "client\index.html" "client\style.css" "client\main.js" "client\gradient-editor-window.html" "client\neutral-editor-window.html" "client\sample-editor-window.css" "client\sample-editor-window.js" "host\host.jsx") do (
    call :verify_file "%%~F"
    if errorlevel 1 set "COPY_FAILED=1"
)
if defined COPY_FAILED (
    echo [ERROR] One or more installed files failed verification.
    goto :fail
)
set "COPY_INCOMPLETE="

echo [4/4] Enabling and verifying CEP debug mode...
set "REG_FAILED="
for %%V in (9 10 11 12 13 14 15) do (
    call :enable_and_verify_debug %%V
    if errorlevel 1 set "REG_FAILED=1"
)
if defined REG_FAILED (
    echo [ERROR] Extension files were installed, but CEP debug mode setup failed.
    echo         Run Diagnose_Install.bat and check your registry permissions.
    goto :fail
)

echo.
echo [OK] Installation and verification completed.
echo      %DST%
echo.
echo Start Photoshop and open:
echo Window ^> Extensions ^(Legacy^) ^> GraXpert
echo.
pause
endlocal & exit /b 0

:fail
if defined COPY_INCOMPLETE if exist "%DST%" rmdir /S /Q "%DST%" 2>nul
echo.
echo Installation failed. Review the [ERROR] message above.
echo.
pause
endlocal & exit /b 1

:verify_file
if not exist "%DST%\%~1" (
    echo [ERROR] Installed file is missing: %~1
    exit /b 1
)
"%FCEXE%" /B "%SRC%\%~1" "%DST%\%~1" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Installed file does not match the source: %~1
    exit /b 1
)
echo [OK] File verified: %~1
exit /b 0

:enable_and_verify_debug
"%REGEXE%" add "HKCU\Software\Adobe\CSXS.%~1" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
if errorlevel 1 (
    echo [ERROR] CSXS.%~1 PlayerDebugMode could not be written.
    exit /b 1
)
"%REGEXE%" query "HKCU\Software\Adobe\CSXS.%~1" /v PlayerDebugMode 2>nul | "%FINDSTREXE%" /R /C:"PlayerDebugMode *REG_SZ *1$" >nul
if errorlevel 1 (
    echo [ERROR] CSXS.%~1 PlayerDebugMode verification failed.
    exit /b 1
)
echo [OK] CSXS.%~1 PlayerDebugMode=1
exit /b 0
