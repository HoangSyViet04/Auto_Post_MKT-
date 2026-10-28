@echo off
rem Khoi dong Auto Post MKT. Khong dung duong dan cung: chay tu thu muc chua file nay.
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Chua cai Node.js. Cai Node 24 LTS tu https://nodejs.org roi chay lai.
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0])>=24?0:1)"
if errorlevel 1 (
  echo Node.js qua cu. Can Node 24 LTS tro len ^(https://nodejs.org^).
  pause
  exit /b 1
)
node scripts\launch.ts %*
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" pause
exit /b %CODE%
