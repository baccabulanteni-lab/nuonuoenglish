@echo off
cd /d "%~dp0"
echo Pushing STABLE Version...
git add .
git commit -m "Deploy: Reset to stable Astro 5 and sync all components"
echo.
echo Pushing final code...
git push origin main
echo.
echo ========================================
echo [COMPLETE] All fixes pushed!
echo Vercel will now deploy the STABLE version.
echo ========================================
pause
