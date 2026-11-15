@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "NODE_EXE="
where node >nul 2>nul && set "NODE_EXE=node"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

if not defined NODE_EXE (
  echo.
  echo 没有找到 Node.js。
  echo 请安装 Node.js 18 或更新版本，或者把 node.exe 的路径写进 NODE_EXE 环境变量。
  echo.
  pause
  exit /b 1
)

echo 使用 Node: %NODE_EXE%
echo.
"%NODE_EXE%" server.js

echo.
echo 服务已停止。
pause
