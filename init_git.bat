@echo off
cd /d "%~dp0"
echo Initializing Git...
git init
echo Adding files...
git add .
echo Committing...
git commit -m "initial commit"
echo.
echo ========================================
echo Done! Please go to GitHub now.
echo ========================================
pause
