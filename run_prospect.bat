@echo off
REM RubberForm Prospecting Engine — Windows Task Scheduler Script
REM Schedule this via Windows Task Scheduler to run daily at 7am

cd /d "%~dp0"

echo ============================================
echo RubberForm Prospecting Engine
echo Run: %date% %time%
echo ============================================

REM Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found. Install from https://nodejs.org
    exit /b 1
)

REM Install deps if needed
if not exist node_modules (
    echo Installing dependencies...
    npm install
)

REM Run the prospecting engine
node prospect.js --rep all

echo.
echo Run complete at %time%
echo ============================================
pause
