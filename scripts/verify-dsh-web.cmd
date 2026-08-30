@echo off
setlocal
REM  arch-lens standalone DSH web instance on a separate port (default 3081),
REM  for smoke-testing new built artifacts without touching the main service.
REM  When to use and verification steps: see scripts\scripts.md (verify-dsh-web).
REM  Harness dir resolution: argv[2] > %%DSH_HARNESS_DIR%% > sibling probe
REM  (..\..\deepseek-harness next to this repo) > error.
REM  Usage: verify-dsh-web.cmd [port] [harnessDir]

set "ROOT=%~dp0.."
set "PORT=%~1"
if "%PORT%"=="" set "PORT=3081"
set "HARNESS=%~2"
if "%HARNESS%"=="" if not "%DSH_HARNESS_DIR%"=="" set "HARNESS=%DSH_HARNESS_DIR%"
if "%HARNESS%"=="" if exist "%ROOT%\..\..\deepseek-harness\package.json" set "HARNESS=%ROOT%\..\..\deepseek-harness"
if "%HARNESS%"=="" (
    echo [verify] harness dir not found; pass it as argv: verify-dsh-web.cmd 3081 ^<harnessDir^>
    echo [verify] or set the DSH_HARNESS_DIR environment variable.
    pause
    exit /b 1
)
if not exist "%HARNESS%\package.json" (
    echo [verify] harness repo not found: %HARNESS%
    pause
    exit /b 1
)

echo.
echo [verify] standalone instance : http://127.0.0.1:%PORT%
echo [verify] harness              : %HARNESS%
echo [verify] arch-lens artifacts  : %ROOT%\packages\*\lib
echo [verify] foreground run - close this window to stop the instance.
echo.

pushd "%HARNESS%"
pnpm dsh web --port %PORT%
set "EXITCODE=%ERRORLEVEL%"
popd

echo.
echo [verify] instance exited (exit code %EXITCODE%)
echo [verify] if port %PORT% stays busy after closing, kill the leftover node process.
pause
exit /b %EXITCODE%
