@echo off
setlocal
REM  arch-lens Remote contract check: repo @Remote wires vs the inlined codec
REM  table of the standalone client bundle. Runs on this repo alone, no harness
REM  path required. When to run and how to sync: see scripts\scripts.md.

set "ROOT=%~dp0.."

if not exist "%ROOT%\scripts\check-contract.mjs" (
    echo [check-contract] missing %ROOT%\scripts\check-contract.mjs
    pause
    exit /b 2
)

echo [check-contract] repo: %ROOT%
echo.
node "%ROOT%\scripts\check-contract.mjs"
set "EXIT=%ERRORLEVEL%"

echo.
if "%EXIT%"=="0" (
    echo [check-contract] RESULT: in sync - safe to continue / publish.
) else (
    echo [check-contract] RESULT: OUT OF SYNC - run `pnpm build` in the repo and re-check.
)
echo.
pause
exit /b %EXIT%