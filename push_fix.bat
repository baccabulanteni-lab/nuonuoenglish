@echo off
cd /d "%~dp0"
echo Committing fix...
git add .
git commit -m "Fix: Switch to Tailwind 4 Vite plugin to resolve Vercel build conflict"
echo.
echo Pushing fix...
git push origin main
echo.
echo ========================================
echo [SUCCESS] Fix pushed!
echo Vercel is now rebuilding. Please wait.
echo ========================================
pause
