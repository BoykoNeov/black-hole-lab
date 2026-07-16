@echo off
rem ============================================================
rem  Black Hole Lab launcher
rem  Double-click this file to start the dev server and open
rem  the visualization in your default browser.
rem ============================================================

title Black Hole Lab
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js / npm was not found on your PATH.
  echo   Install Node.js from https://nodejs.org and try again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo   First run - installing dependencies, this may take a minute...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   npm install failed. See the messages above.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo   Starting Black Hole Lab...
echo   A browser tab will open automatically.
echo   Close this window (or press Ctrl+C) to stop the server.
echo.

call npm run dev -- --open

pause
