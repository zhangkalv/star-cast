@echo off
chcp 65001 >nul
cd /d "%~dp0"
set LOG=%TEMP%\starcast-dev-%RANDOM%.log
echo [%date% %time%] starting starcast dev >> "%LOG%" 2>nul
echo 日志: %LOG%
call npm run dev >> "%LOG%" 2>&1
