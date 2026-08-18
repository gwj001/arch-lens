@echo off
setlocal
REM ============================================================================
REM  arch-lens 独立实例验证启动脚本
REM
REM  在独立端口（默认 3081，避开主服务 3080）前台启动一个 DSH Web 实例，
REM  通过 profiles/web 补丁层加载 arch-lens 本地构建产物
REM  （packages/*/lib 下的新产物，无需重启你的主服务即可验证）。
REM
REM  运行方式：
REM     双击本脚本 或 在命令行执行:  verify-dsh-web.cmd [port] [harnessDir]
REM     例: verify-dsh-web.cmd 3082
REM
REM  前台运行：关闭本窗口即停止实例（进程随窗口终止）。
REM  验证步骤：
REM     1) 窗口出现 "dsh web: http://127.0.0.1:3081" 即启动成功；
REM     2) 浏览器打开 http://127.0.0.1:3081 ；
REM     3) 页面右下角出现 arch-lens 悬浮机器人 = 插件加载成功；
REM     4) 验证完关闭窗口，再重启你的主服务。
REM ============================================================================

set "PORT=%~1"
if "%PORT%"=="" set "PORT=3081"
set "HARNESS=%~2"
if "%HARNESS%"=="" set "HARNESS=D:\dev\project\agent\deepseek\deepseek-harness"

if not exist "%HARNESS%\package.json" (
    echo [verify] 找不到 harness 仓库: %HARNESS%
    echo [verify] 可用第二个参数指定，例如: verify-dsh-web.cmd 3081 D:\path\to\deepseek-harness
    pause
    exit /b 1
)

echo.
echo [verify] 独立实例:  http://127.0.0.1:%PORT%
echo [verify] harness :  %HARNESS%
echo [verify] arch-lens 产物: D:\dev\project\agent\deepseek\plugin\arch-lens\packages\*\lib
echo [verify] 前台运行中 —— 关闭本窗口即停止实例。
echo.

pushd "%HARNESS%"
pnpm dsh web --port %PORT%
set "EXITCODE=%ERRORLEVEL%"
popd

echo.
echo [verify] 实例已退出 (exit code %EXITCODE%)
echo [verify] 若窗口关闭后端口 %PORT% 仍被占用，请在任务管理器结束残留的 node 进程。
pause
exit /b %EXITCODE%
