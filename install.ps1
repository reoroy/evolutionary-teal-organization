#!/usr/bin/env pwsh
# ETO Installer — 一键安装 + 初始化
$GH_REPO = "https://github.com/reoroy/evolutionary-teal-organization"

Write-Host "`n=== ETO Plugin Installer ===`n" -ForegroundColor Cyan

Write-Host "[1/3] Checking Pi CLI..." -ForegroundColor Cyan
try { Get-Command pi -ErrorAction Stop | Out-Null } catch {
    Write-Host "  FAIL: Pi CLI not found." -ForegroundColor Red
    Write-Host "  Install Pi first: npm install -g @earendil-works/pi-coding-agent" -ForegroundColor Yellow
    exit 1
}
Write-Host "  OK" -ForegroundColor Green

Write-Host "[2/3] Cloning ETO..." -ForegroundColor Cyan
$target = Join-Path $env:USERPROFILE "eto"
if (Test-Path "$target\.git") {
    Write-Host "  Already cloned at $target" -ForegroundColor Gray
} else {
    $null = git clone $GH_REPO $target 2>piped-to-null
    if ($LASTEXITCODE -ne 0) { Write-Host "  FAIL: git clone failed" -ForegroundColor Red; exit 1 }
    Write-Host "  OK" -ForegroundColor Green
}

Write-Host "[3/3] Installing ETO..." -ForegroundColor Cyan
Push-Location $target

# Install Python package
pip install -e eto/ 2>piped-to-null
if ($LASTEXITCODE -ne 0) { Write-Host "  WARNING: pip install failed" -ForegroundColor Yellow }

# Register Pi extension
pi install "$target\eto\extensions\eto.ts" 2>piped-to-null
if ($LASTEXITCODE -ne 0) { Write-Host "  FAIL: pi install failed" -ForegroundColor Red; exit 1 }

# Bootstrap (profiles + config)
python3 -c "import sys; sys.path.insert(0,'.'); from eto.bootstrap import run; run()" 2>piped-to-null

Pop-Location
Write-Host "  OK" -ForegroundColor Green

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " ETO 安装完成！" -ForegroundColor Green
Write-Host " 启动 pi 后直接描述任务即可。          " -ForegroundColor Gray
Write-Host " 如需卸载: ./uninstall.ps1             " -ForegroundColor Gray
Write-Host "========================================" -ForegroundColor Cyan
