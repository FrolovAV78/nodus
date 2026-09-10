@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Нужны Node.js 20+ и npm. Поставьте с https://nodejs.org
  pause
  exit /b 1
)
echo - npm install
call npm install
echo - build UI
call npm run build -w web
set PORT=8787
set DATA_DIR=%cd%\data
set WEB_DIST=%cd%\web\dist
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
echo.
echo Open http://localhost:8787
echo Login admin / changeme
echo.
call npm run start -w server
