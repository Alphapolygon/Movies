@echo off
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  node tools\serve.mjs
) else (
  echo Open http://127.0.0.1:8000 in your browser.
  py -m http.server 8000 --bind 127.0.0.1
)
pause
