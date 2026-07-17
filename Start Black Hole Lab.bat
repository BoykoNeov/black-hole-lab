@echo off
rem ============================================================
rem  Black Hole Lab launcher
rem  Double-click this file to open the visualization in your
rem  default browser, starting a dev server only if one is not
rem  already running.
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

rem ---- Reuse a server that is already serving THIS lab --------
rem  Every double-click used to start another one and leave it running: vite
rem  cannot have a port that is busy, so it climbs to the next free one rather
rem  than failing, and nothing ever stops the old server. They stacked up 16
rem  deep that way, each holding a full geodesic raymarcher open in any tab
rem  still pointed at it.
rem
rem  The port cannot say whose server it is. Vite climbs past other projects
rem  too, so 5173 is quite possibly a different app entirely - find-server.mjs
rem  asks each port what it is serving and matches only this lab. Reusing an
rem  old server is safe rather than a bet on its age: vite transforms from disk
rem  on every request, so it serves the code as it is now however long it has
rem  been up.
set "LAB_URL="
for /f "usebackq delims=" %%u in (`node tools\find-server.mjs 2^>nul`) do set "LAB_URL=%%u"

if defined LAB_URL (
  echo.
  echo   Black Hole Lab is already running at %LAB_URL%
  echo   Opening that, instead of starting a second server.
  echo.
  echo   It serves the current code even if it has been up a while.
  echo   To start fresh instead, close the window running it first.
  echo.
  start "" "%LAB_URL%"
  timeout /t 4 >nul 2>nul
  exit /b 0
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
