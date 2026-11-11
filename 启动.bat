@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem 指尖分类 · 一键启动脚本（Windows）
rem 摄像头在 file:// 下无法使用，必须通过 http:// 访问。

set PY=
where python >nul 2>nul && set PY=python
if not defined PY ( where py >nul 2>nul && set PY=py )
if not defined PY (
  echo [错误] 没有找到 Python。请先安装 Python 3，安装时勾选 "Add to PATH"。
  echo 或者手动在本目录执行：python -m http.server 8000
  pause
  exit /b 1
)

set PORT=8000
:findport
netstat -an | findstr ":%PORT% " >nul 2>nul
if %errorlevel%==0 (
  set /a PORT+=1
  goto findport
)

echo ========================================
echo   指尖分类 · 本地启动
echo   端口：%PORT%
echo   地址：http://localhost:%PORT%
echo   不要关闭本窗口，关闭即停止服务
echo ========================================
echo.

start "" "http://localhost:%PORT%"
%PY% -m http.server %PORT%

pause
