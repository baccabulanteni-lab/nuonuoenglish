@echo off
cd /d "%~dp0"
echo Final Commit: Syncing dependencies and Tailwind 4 fix...
git add .
git commit -m "Final Fix: Install missing markdown dependencies and sync Tailwind 4 config"
echo.
echo Pushing final code...
git push origin main
echo.
echo ========================================
echo [COMPLETE] All fixes pushed!
echo Vercel is deploying your final application.
echo ========================================
pause
