@echo off
setlocal EnableExtensions DisableDelayedExpansion
echo ============================================================
echo GraXpert Photoshop Panel Diagnostic
echo ============================================================
echo.
echo Script folder:
echo "%~dp0"
echo.
echo APPDATA:
echo "%APPDATA%"
echo.
echo Extension source:
echo "%~dp0GraXpert-Photoshop-Panel"
echo.
if exist "%~dp0GraXpert-Photoshop-Panel\CSXS\manifest.xml" (
    echo [OK] manifest.xml found.
) else (
    echo [ERROR] manifest.xml NOT found.
)
echo.
echo Installed extension:
echo "%APPDATA%\Adobe\CEP\extensions\GraXpert-Photoshop-Panel"
if exist "%APPDATA%\Adobe\CEP\extensions\GraXpert-Photoshop-Panel\CSXS\manifest.xml" (
    echo [OK] Installed manifest.xml found.
) else (
    echo [INFO] Installed manifest.xml not found.
)
echo.
echo CEP PlayerDebugMode:
for %%V in (9 10 11 12 13 14 15) do (
    "%SystemRoot%\System32\reg.exe" query "HKCU\Software\Adobe\CSXS.%%V" /v PlayerDebugMode 2>nul | "%SystemRoot%\System32\findstr.exe" /R /C:"PlayerDebugMode *REG_SZ *1$" >nul
    if errorlevel 1 (
        echo [MISSING] CSXS.%%V PlayerDebugMode=1
    ) else (
        echo [OK] CSXS.%%V PlayerDebugMode=1
    )
)
echo.
where GraXpert-win64.exe >nul 2>&1
if errorlevel 1 (
    echo [INFO] GraXpert-win64.exe is not available on PATH.
    echo        Set its full path in the panel.
) else (
    echo [OK] GraXpert-win64.exe found on PATH.
)
echo.
pause
endlocal
