@echo off
rem dsh-web.cmd — start the DSH web service with console output AND a
rem durable log copy at %USERPROFILE%\.dsh\dsh-web.log (for post-restart
rem forensics). Usage: dsh-web.cmd [extra args...] (e.g. --port 8080)
setlocal
set "LOG=%USERPROFILE%\.dsh\dsh-web.log"
powershell -NoProfile -Command "node --import tsx/esm apps/cli/src/bin.ts web %* 2>&1 | Tee-Object -FilePath '%LOG%'"
endlocal
