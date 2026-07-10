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

netstat -ano | findstr /r /c:"[:.]8765[^0-9]" >nul 2>nul
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
set RELAY_UP=0
for /l %%i in (1,1,20) do (
    if "!RELAY_UP!"=="0" (
        powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:8765/' -UseBasicParsing -TimeoutSec 1; exit 0 } catch { exit 1 }" >nul 2>nul
        if not errorlevel 1 (
            set RELAY_UP=1
        ) else (
            timeout /t 1 /nobreak >nul
        )
    )
)

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
