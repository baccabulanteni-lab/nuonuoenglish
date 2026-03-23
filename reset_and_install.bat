@echo off
cd /d "%~dp0"
echo [1/3] Cleaning up old dependencies...
if exist package-lock.json del /f /q package-lock.json
if exist node_modules rmdir /s /q node_modules
echo.
echo [2/3] Installing stable Astro 5 version and all components...
echo (This may take 1-2 minutes, please wait)
call npm install astro@^5.18.1 @astrojs/react@^4.2.1 @astrojs/tailwind@^5.1.5 clsx lucide-react motion react react-dom react-markdown remark-gfm rehype-raw tailwind-merge tailwindcss --save --legacy-peer-deps
echo.
echo [3/3] ========================================
echo [SUCCESS] Dependencies reset to STABLE!
echo Last Step: Please run 'push_stable.bat' to deploy.
echo ========================================
pause
