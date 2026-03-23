@echo off
cd /d "%~dp0"
echo Setting Git identity...
git config --global user.email "nuonuo@example.com"
git config --global user.name "NuoNuo"
echo.
echo Re-trying commit...
git commit -m "initial commit"
echo.
echo ========================================
echo Local commit successful! 
echo Now ready to push to GitHub.
echo ========================================
pause
