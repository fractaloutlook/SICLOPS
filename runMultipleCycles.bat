@echo off
REM Run Multiple Agent Cycles with Enhanced Logging
REM Usage: runMultipleCycles.bat [number-of-cycles] [optional-comment]
REM Example: runMultipleCycles.bat 5
REM Example: runMultipleCycles.bat 10 "Focus on testing"

setlocal enabledelayedexpansion

if "%~1"=="" (
    set CYCLES=3
    echo No cycle count provided, defaulting to 3 cycles
) else (
    set CYCLES=%~1
)

set COMMENT=%~2
set START_TIME=%date% %time%
set SUMMARY_FILE=data\logs\multi-cycle-summary-%date:~-4%%date:~-10,2%%date:~-7,2%-%time:~0,2%%time:~3,2%%time:~6,2%.md
set SUMMARY_FILE=%SUMMARY_FILE: =0%

echo ================================================================
echo   SICLOPS Multi-Cycle Runner
echo ================================================================
echo.
echo Running %CYCLES% cycle(s) starting at %START_TIME%
echo Summary will be saved to: %SUMMARY_FILE%
if not "%COMMENT%"=="" echo Comment: %COMMENT%
echo.
echo ================================================================
echo.

REM Initialize summary file
echo # Multi-Cycle Run Summary > "%SUMMARY_FILE%"
echo. >> "%SUMMARY_FILE%"
echo **Start Time:** %START_TIME% >> "%SUMMARY_FILE%"
echo **Cycles:** %CYCLES% >> "%SUMMARY_FILE%"
if not "%COMMENT%"=="" echo **Comment:** %COMMENT% >> "%SUMMARY_FILE%"
echo. >> "%SUMMARY_FILE%"
echo --- >> "%SUMMARY_FILE%"
echo. >> "%SUMMARY_FILE%"

REM Run cycles
for /L %%i in (1,1,%CYCLES%) do (
    echo.
    echo ----------------------------------------------------------------
    echo  CYCLE %%i of %CYCLES%
    echo ----------------------------------------------------------------
    echo.

    echo ## Cycle %%i >> "%SUMMARY_FILE%"
    echo. >> "%SUMMARY_FILE%"

    if "%COMMENT%"=="" (
        npm start
    ) else (
        npm start -- --comment "%COMMENT%"
    )

    if !ERRORLEVEL! NEQ 0 (
        echo.
        echo WARNING: Cycle %%i encountered an error
        echo **Status:** ERROR encountered >> "%SUMMARY_FILE%"
        echo. >> "%SUMMARY_FILE%"
        goto :summary
    )

    echo **Status:** COMPLETED >> "%SUMMARY_FILE%"
    echo. >> "%SUMMARY_FILE%"

    REM Short pause between cycles
    if %%i LSS %CYCLES% (
        echo.
        echo Pausing 2 seconds before next cycle...
        timeout /t 2 /nobreak > nul
    )
)

:summary
set END_TIME=%date% %time%
echo.
echo ================================================================
echo.
echo Multi-cycle run complete
echo Start:  %START_TIME%
echo End:    %END_TIME%
echo Summary: %SUMMARY_FILE%
echo.

echo --- >> "%SUMMARY_FILE%"
echo. >> "%SUMMARY_FILE%"
echo **End Time:** %END_TIME% >> "%SUMMARY_FILE%"
echo. >> "%SUMMARY_FILE%"
echo Check individual cycle logs in `data/logs/cycles/` for detailed output. >> "%SUMMARY_FILE%"

endlocal
