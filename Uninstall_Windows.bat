@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul

echo ============================================================
echo GraXpert Photoshop Panel Uninstaller v0.9.1
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

for %%I in ("%APPDATA%\Adobe\CEP\extensions") do set "CEP_ROOT=%%~fI"
for %%I in ("%APPDATA%\Adobe\CEP\extensions\GraXpert-Photoshop-Panel") do set "DST=%%~fI"
for %%I in ("%APPDATA%\Adobe\CEP\extensions\GraXpert-Photoshop-Panel\..") do set "DST_PARENT=%%~fI"

set "REGEXE=%SystemRoot%\System32\reg.exe"
set "TASKLISTEXE=%SystemRoot%\System32\tasklist.exe"
set "FINDEXE=%SystemRoot%\System32\find.exe"

if /I not "%DST_PARENT%"=="%CEP_ROOT%" (
    echo [ERROR] Refusing to remove an unexpected destination path:
    echo         %DST%
    goto :fail
)
if /I "%DST%"=="%CEP_ROOT%" (
    echo [ERROR] Refusing to remove the CEP extensions root.
    goto :fail
)

for %%T in ("%REGEXE%" "%TASKLISTEXE%" "%FINDEXE%") do (
    if not exist "%%~T" (
        echo [ERROR] Required Windows tool was not found:
        echo         %%~T
        goto :fail
    )
)

"%TASKLISTEXE%" /FI "IMAGENAME eq Photoshop.exe" 2>nul | "%FINDEXE%" /I "Photoshop.exe" >nul
if not errorlevel 1 (
    echo [ERROR] Photoshop is currently running.
    echo         Close Photoshop completely, then run this uninstaller again.
    goto :fail
)

echo [1/2] Removing the panel installation folder...
if exist "%DST%" (
    rmdir /S /Q "%DST%" 2>nul
    if exist "%DST%" (
        echo [ERROR] Could not remove the panel installation folder:
        echo         %DST%
        goto :fail
    )
    echo [OK] Panel installation folder removed.
) else (
    echo [SKIP] The panel installation folder is not present.
)

echo.
echo PlayerDebugMode is shared by all unsigned CEP extensions.
echo Keep it if you use another unsigned CEP panel.
set "REMOVE_DEBUG=N"
if /I "%~1"=="/remove-debug" set "REMOVE_DEBUG=Y"
if /I "%~1"=="/keep-debug" set "REMOVE_DEBUG=N"
if "%~1"=="" set /P "REMOVE_DEBUG=Remove shared PlayerDebugMode values? [y/N]: "

if /I "%REMOVE_DEBUG%"=="Y" (
    echo.
    echo [2/2] Removing and verifying CEP PlayerDebugMode values...
    set "REG_FAILED="
    for %%V in (9 10 11 12 13 14 15) do (
        call :remove_debug_value %%V
        if errorlevel 1 set "REG_FAILED=1"
    )
    if defined REG_FAILED (
        echo [ERROR] One or more PlayerDebugMode values could not be removed.
        goto :fail
    )
) else (
    echo [2/2] Keeping shared CEP PlayerDebugMode values.
)

echo.
echo [OK] Uninstall and verification completed.
echo User files in Documents and temporary diagnostic files were not removed.
echo.
pause
endlocal & exit /b 0

:fail
echo.
echo Uninstall failed. Review the [ERROR] message above.
echo.
pause
endlocal & exit /b 1

:remove_debug_value
"%REGEXE%" query "HKCU\Software\Adobe\CSXS.%~1" /v PlayerDebugMode >nul 2>&1
if errorlevel 1 (
    echo [SKIP] CSXS.%~1 PlayerDebugMode is not present.
    exit /b 0
)
"%REGEXE%" delete "HKCU\Software\Adobe\CSXS.%~1" /v PlayerDebugMode /f >nul 2>&1
if errorlevel 1 (
    echo [ERROR] CSXS.%~1 PlayerDebugMode could not be removed.
    exit /b 1
)
"%REGEXE%" query "HKCU\Software\Adobe\CSXS.%~1" /v PlayerDebugMode >nul 2>&1
if not errorlevel 1 (
    echo [ERROR] CSXS.%~1 PlayerDebugMode removal verification failed.
    exit /b 1
)
echo [OK] CSXS.%~1 PlayerDebugMode removed.
exit /b 0
