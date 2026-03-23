@echo off
setlocal enabledelayedexpansion

:: 尝试在当前路径和系统路径寻找 git
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 找不到 git 命令。请确保您已经完成了 Git 的安装。
    echo 如果您刚刚安装完，请尝试重启电脑或重新打开此脚本。
    pause
    exit /b
)

echo [1/3] 正在初始化 Git 仓库...
git init

echo [2/3] 正在添加文件到仓库...
git add .

echo [3/3] 正在提交代码...
git commit -m "first commit"

echo.
echo ======================================================
echo 恭喜！Git 本地初始化已完成。
echo.
echo 下步操作：
echo 1. 去 GitHub 创建一个名为 nuonuoenglish 的新仓库。
echo 2. 将网页上的三行 push 命令复制到我的对话框，我来教您怎么做。
echo ======================================================
pause
