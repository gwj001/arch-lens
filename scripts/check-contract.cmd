@echo off
setlocal
REM ============================================================================
REM  arch-lens contract consistency check (double-clickable)
REM
REM  Compares this repo's @Remote wire names against the archLens method table
REM  baked into the harness build (packages/api/remotes/lib/client.js).
REM  If they differ:
REM    LAG  = harness bundle lacks methods -> stock harness installs crash with
REM           "archLens.<method> is not a function"
REM    STALE= harness bundle still carries removed methods (harmless but the
REM           copy is not synced)
REM  Run this after ANY Remote method-set change (add/rename/remove).
REM
REM  Usage: check-contract.cmd [harnessDir]
REM ============================================================================

set "ROOT=%~dp0.."
set "HARNESS=%~1"
if "%HARNESS%"=="" set "HARNESS=D:\dev\project\agent\deepseek\deepseek-harness"

if not exist "%ROOT%\scripts\check-contract.mjs" (
    echo [check-contract] missing %ROOT%\scripts\check-contract.mjs
    pause
    exit /b 2
)
if not exist "%HARNESS%\packages\api\remotes\lib\client.js" (
    echo [check-contract] harness bundle not found: %HARNESS%\packages\api\remotes\lib\client.js
    echo [check-contract] pass the harness dir as argv: check-contract.cmd D:\path\to\deepseek-harness
    pause
    exit /b 2
)

echo [check-contract] repo   : %ROOT%
echo [check-contract] harness: %HARNESS%
echo.

node "%ROOT%\scripts\check-contract.mjs" "%HARNESS%"
set "EXIT=%ERRORLEVEL%"

echo.
if "%EXIT%"=="0" (
    echo [check-contract] RESULT: in sync - safe to continue / publish.
) else (
    echo [check-contract] RESULT: OUT OF SYNC - follow the steps printed above
    echo                     ^(sync the harness copy, run pnpm build:lib there,
    echo                     restart dsh web, then re-run this check^).
)
echo.
pause
exit /b %EXIT%
