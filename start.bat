@echo off
setlocal
cd /d "%~dp0"

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

timeout /t 2 /nobreak >nul

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
