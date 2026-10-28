@echo off
rem Cap nhat Auto Post MKT an toan (sao luu truoc, khong xoa du lieu). Dong ung dung truoc khi chay.
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Chua cai Node.js. Cai Node 24 LTS tu https://nodejs.org roi chay lai.
  pause
  exit /b 1
)
node scripts\update.ts %*
set "CODE=%ERRORLEVEL%"
pause
exit /b %CODE%
