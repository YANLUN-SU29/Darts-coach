@echo off
cd /d "%~dp0"
set PORT=8765
echo.
echo  DartLab - http://localhost:%PORT%/index.html
echo  Keep this window open while using DartLab. Close it to stop the server.
echo.
rem open the browser 2 seconds later, after the server is up
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:%PORT%/index.html"
where py >nul 2>nul
if %errorlevel%==0 (
  py -m http.server %PORT% --bind 127.0.0.1
  goto end
)
where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server %PORT% --bind 127.0.0.1
  goto end
)
echo  Python not found. You can also open index.html directly in Chrome or Edge.
:end
pause
