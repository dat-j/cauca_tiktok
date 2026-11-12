@echo off
rem Chay game cau ca: cai thu vien neu thieu -> mo /admin -> chay server.
rem Dong cua so nay (hoac Ctrl+C) de tat server. Bang xep hang duoc luu truoc khi tat.
setlocal
cd /d "%~dp0"
if "%PORT%"=="" set PORT=3000

where node >nul 2>nul
if errorlevel 1 (
  echo [LOI] Chua cai Node.js. Tai ban LTS tai https://nodejs.org roi chay lai file nay.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Dang cai thu vien lan dau ^(npm install^)...
  call npm install
  if errorlevel 1 (
    echo [LOI] npm install that bai. Kiem tra mang roi thu lai.
    pause
    exit /b 1
  )
)

rem Mo trang admin sau 2 giay (doi server khoi dong xong).
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:%PORT%/admin'"

echo Server: http://127.0.0.1:%PORT%/   Admin: http://127.0.0.1:%PORT%/admin
call npm start
echo.
echo Server da dung.
pause
