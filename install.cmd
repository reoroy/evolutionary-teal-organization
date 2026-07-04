@echo off
chcp 65001 >nul

echo === ETO Plugin Installer ===
echo.

echo [1/3] Checking Pi CLI...
where pi >nul 2>&1
if errorlevel 1 (
    echo FAIL: Pi CLI not found.
    echo Install Pi first: npm install -g @earendil-works/pi-coding-agent
    pause & exit /b 1
)
echo OK

echo [2/3] Cloning ETO...
set "ETO_DIR=%USERPROFILE%\eto"
if exist "%ETO_DIR%\.git" (
    echo Already cloned at %ETO_DIR%
) else (
    git clone https://github.com/reoroy/evolutionary-teal-organization "%ETO_DIR%" >nul 2>&1
    if errorlevel 1 (echo FAIL: git clone failed; pause & exit /b 1)
    echo OK
)

echo [3/3] Installing ETO...
cd /d "%ETO_DIR%"

REM Install Python package (needed for bootstrap + MCP server)
pip install -e eto/ >nul 2>&1
if errorlevel 1 (echo   WARNING: pip install failed, run manually: pip install -e "%ETO_DIR%\eto\")

REM Register Pi extension
pi install "%ETO_DIR%\eto\extensions\eto.ts" >nul 2>&1
if errorlevel 1 (echo   WARNING: pi install failed; pause & exit /b 1)

REM Bootstrap (profiles + config)
python3 -c "import sys; sys.path.insert(0,'.'); from eto.bootstrap import run; run()" >nul 2>&1
echo OK

echo.
echo ========================================
echo  ETO 安装完成！
echo  首次启动 pi 将引导你选择 LLM Provider。
echo  如需卸载: run uninstall.cmd
echo ========================================
echo.
pause
