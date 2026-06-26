# Plan: eto 命令改走 Pi TUI

> 发送者: Claude Code
> 接收者: Reasonix
> 状态: READY
> 优先级: P0

## 背景

`eto` 命令当前是一个 npm 包装器，指向旧版 Python 管道：

```powershell
$pipelines = Join-Path $env:USERPROFILE ".eto\pipelines"
if ($args.Count -eq 0) {
    python3 (Join-Path $pipelines "tui.py")  # ❌ GBK 崩溃
} else {
    python3 (Join-Path $pipelines "core.py") $args  # ❌ hardcode --provider ollama
}
```

旧 Python 管道有两个致命问题：
1. `tui.py` 的 box-drawing 字符在 Windows GBK 终端下崩溃
2. `executor.py` 硬编码 `--provider ollama`，不通

## 方案

把 `eto.ps1` 和 `eto.cmd` 这两个 npm 包装器改为走 Pi TUI（已 patch 好、走代理的版本）。

### 新 eto.ps1

```powershell
#!/usr/bin/env pwsh
# ETO CLI — Pi TUI with ETO extension + proxy
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:15721"
$env:ANTHROPIC_API_KEY = "PROXY_MANAGED"
$piDir = "$env:APPDATA\npm\node_modules\@earendil-works\pi-coding-agent"
$ext = Join-Path (Split-Path $PSScriptRoot) "eto\extensions\eto.ts"
if ($args.Count -eq 0) {
    & node "$piDir\dist\cli.js" -e "$ext" --provider anthropic
} else {
    & node "$piDir\dist\cli.js" -e "$ext" --provider anthropic $args
}
```

### 新 eto.cmd（CMD 版）

```batch
@echo off
set ANTHROPIC_BASE_URL=http://127.0.0.1:15721
set ANTHROPIC_API_KEY=PROXY_MANAGED
node "%APPDATA%\npm\node_modules\@earendil-works\pi-coding-agent\dist\cli.js" -e "%~dp0..\eto\extensions\eto.ts" --provider anthropic %*
```

### 改动要点

- 去掉 `python3` 管道调用
- 加上 `ANTHROPIC_BASE_URL`、`ANTHROPIC_API_KEY` 环境变量
- 加上 `-e eto/extensions/eto.ts`
- 加上 `--provider anthropic`
- 保留 `$args` / `%*` 让 `eto "hi"` 一次性模式仍然可用
- ETO 扩展路径：用 `PSScriptRoot` / `%~dp0` 推导到项目根

### 扩展路径

`eto.ps1` 在 `C:\Users\a7140\AppData\Roaming\npm\eto.ps1`（npm 全局目录）。
ETO 扩展在项目根 `eto/extensions/eto.ts`。

注意 `PSScriptRoot` 在 npm 包装器中的值是 npm 全局目录 `C:\Users\a7140\AppData\Roaming\npm`，所以 `..\eto\extensions\eto.ts` 能到项目根——**前提是项目在工作目录**。

更稳妥：改成传递给 pi 的执行目录：

```powershell
$etoProject = "C:\Users\a7140\Nutstore\1\工坊\项目\evolutionary-teal-organization"
$ext = Join-Path $etoProject "eto\extensions\eto.ts"
```

但这样路径硬编码了。推荐用第一个方案（相对路径），因为用户大概率在此项目目录开终端。

## 验证

```powershell
# TUI 模式
eto
# → Pi TUI 启动, ETO 通知出现

# CLI 模式
eto "写一个函数"
# → 一次性回复

# 确认不走 Python 旧管道
eto --help
# → 应该显示 Pi 的帮助，不是 Python 的帮助
```

## 不做

- ❌ 不改 Python 代码（tui.py / core.py / executor.py 不动）
- ❌ 不删旧文件（它们还在，只是不走了）

## 文件引用

| 文件 | 改动 |
|:-----|:------|
| `C:\Users\a7140\AppData\Roaming\npm\eto.ps1` | 重写为 Pi TUI 入口 |
| `C:\Users\a7140\AppData\Roaming\npm\eto.cmd` | 重写为 Pi TUI 入口（CMD 版） |
