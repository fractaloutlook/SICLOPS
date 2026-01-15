@echo off
REM TypeScript Compilation Test Tool
REM Usage: tsCompileTest.bat [optional-file-path]
REM Example: tsCompileTest.bat
REM Example: tsCompileTest.bat src/agent.ts

if "%~1"=="" (
    REM No file specified - check entire project
    echo Checking TypeScript compilation for entire project...
    npx tsc --noEmit
    if %ERRORLEVEL% EQU 0 (
        echo.
        echo ✅ TypeScript compilation successful - no errors found
        exit /b 0
    ) else (
        echo.
        echo ❌ TypeScript compilation failed - see errors above
        exit /b 1
    )
) else (
    REM Specific file provided - check just that file
    echo Checking TypeScript compilation for: %~1
    npx tsc --noEmit "%~1"
    if %ERRORLEVEL% EQU 0 (
        echo.
        echo ✅ File compiles successfully: %~1
        exit /b 0
    ) else (
        echo.
        echo ❌ File has compilation errors: %~1
        exit /b 1
    )
)
