@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo Node.js was not found on your PATH. Please install it from https://nodejs.org
    echo and re-run start.bat.
    pause
    exit /b 1
)

rem Only a LISTENING socket on 8765 is a real conflict — TIME_WAIT remnants
rem from a previous session linger for ~2 minutes and must not block startup.
netstat -ano | findstr "LISTENING" | findstr /r /c:"[:.]8765[^0-9]" >nul 2>nul
if not errorlevel 1 (
    echo.
    echo Port 8765 is already in use - the relay may already be running.
    echo Please close the other MeetingMind Relay window ^(or whatever else
    echo is using port 8765^) and re-run start.bat.
    pause
    exit /b 1
)

if not exist node_modules\ws (
    echo Installing relay dependency ^(ws^)...
    call npm install ws
    if errorlevel 1 (
        echo.
        echo npm install failed. Is Node.js installed? https://nodejs.org
        pause
        exit /b 1
    )
)

echo Starting ASR relay on ws://localhost:8765 ...
start "MeetingMind Relay" cmd /k node relay.js

rem Poll the relay's HTTP endpoint (~10s max) instead of a blind sleep,
rem so we only open Chrome once the relay is actually accepting requests.
rem ONE PowerShell invocation with an internal retry loop. Spawning
rem PowerShell repeatedly is very slow on corporate machines (each launch
rem gets scanned by endpoint security), curl.exe can be blocked outright by
rem policy, and Invoke-WebRequest can hang on a corporate proxy — so use a
rem raw TCP connect to 127.0.0.1 (the relay's bind address): no proxy, no
rem curl, a single process for the whole ~15s poll window.
set RELAY_UP=0
powershell -NoProfile -Command "$ok=$false; for($i=0; $i -lt 15 -and -not $ok; $i++){ try { $c = New-Object Net.Sockets.TcpClient; $t = $c.BeginConnect('127.0.0.1', 8765, $null, $null); if ($t.AsyncWaitHandle.WaitOne(1000) -and $c.Connected) { $ok = $true } $c.Close() } catch {} if (-not $ok) { Start-Sleep -Seconds 1 } }; if ($ok) { exit 0 } else { exit 1 }"
if not errorlevel 1 set RELAY_UP=1

if "%RELAY_UP%"=="0" (
    echo.
    echo The relay did not respond on http://localhost:8765 within ~10 seconds.
    echo Check the "MeetingMind Relay" console window for errors.
    pause
    exit /b 1
)

rem Open via http://localhost (NOT file://) so Chrome remembers the mic
rem permission across meetings instead of re-prompting every time.
set APP_URL=http://localhost:8765/
echo Opening MeetingMind in Chrome...
where chrome >nul 2>nul
if %errorlevel%==0 (
    start chrome "%APP_URL%"
) else if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%APP_URL%"
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%APP_URL%"
) else if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
    start "" "%LocalAppData%\Google\Chrome\Application\chrome.exe" "%APP_URL%"
) else (
    echo Chrome not found in common locations - opening with your default browser instead.
    start "" "%APP_URL%"
)

endlocal
