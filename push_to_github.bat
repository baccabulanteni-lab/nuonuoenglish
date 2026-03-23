@echo off
cd /d "%~dp0"
echo Connecting to GitHub...
git remote add origin https://github.com/baccabulanteni-lab/nuonuoenglish.git 2>nul
if %errorlevel% neq 0 (
    git remote set-url origin https://github.com/baccabulanteni-lab/nuonuoenglish.git
)

echo Setting main branch...
git branch -M main

echo Pushing code (This may take a moment)...
git push -u origin main

echo.
echo ========================================
echo [SUCCESS] Your code is now on GitHub!
echo ========================================
echo Next steps:
echo 1. Login to Vercel.com
echo 2. Click "Add New" -> "Project"
echo 3. Import "nuonuoenglish"
echo ========================================
pause
