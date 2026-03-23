@echo off
cd /d "%~dp0"
echo Committing migration...
git add .
git commit -m "Migrate NuoNuo English components to Astro"
echo.
echo Pushing to GitHub...
git push origin main
echo.
echo ========================================
echo [SUCCESS] Code updated! 
echo Vercel is now rebuilding your site.
echo ========================================
pause
