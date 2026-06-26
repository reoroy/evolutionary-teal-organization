# Plan: eto 命令指向打过补丁的入口

> 发送者: Claude Code
> 接收者: Reasonix
> 状态: READY
> 优先级: P0

## 需求

敲 `eto` 就进打过补丁的 TUI（走代理、加载 ETO 扩展），和 `run-eto.ps1` 效果一样。

## 现状

`eto` 命令在 `C:\Users\a7140\bin\eto`，是一个 bash 脚本：

```bash
#!/usr/bin/env bash
export PI_CONFIG_DIR=".eto"
PI_DIR="/c/Users/a7140/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent"
exec node "$PI_DIR/dist/cli.js" "$@"
```

它没设代理环境变量、没加载 ETO 扩展。

## 任务

### 方案 A（推荐）：改 eto 脚本注入环境变量

```bash
#!/usr/bin/env bash
export PI_CONFIG_DIR=".eto"
export ANTHROPIC_BASE_URL="http://127.0.0.1:15721"
export ANTHROPIC_API_KEY="PROXY_MANAGED"
PI_DIR="/c/Users/a7140/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent"
exec node "$PI_DIR/dist/cli.js" -e "$(dirname $0)/../eto/extensions/eto.ts" "$@"
```

关键改动：
- 加 `ANTHROPIC_BASE_URL` 和 `ANTHROPIC_API_KEY`
- 加 `-e eto/extensions/eto.ts`
- 扩展路径用 `$(dirname $0)/../eto/extensions/eto.ts`（相对于脚本位置）
- 保留 `"$@"` 让用户仍可传额外参数

### 方案 B：建 eto.ps1

PowerShell 版入口，和方案 A 等价的 PS 脚本：

```powershell
#!/usr/bin/env pwsh
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:15721"
$env:ANTHROPIC_API_KEY = "PROXY_MANAGED"
$piDir = "$env:APPDATA\npm\node_modules\@earendil-works\pi-coding-agent"
& node "$piDir\dist\cli.js" -e "$PSScriptRoot\..\eto\extensions\eto.ts" @args
```

### 验证

```bash
# 方案 A
eto           # → ETO TUI，打字有回复（走代理）
eto "hi"      # → 一次性回复

# 方案 B
.\eto.ps1     # → 同上
```

## 不做

- ❌ 不改 `run-eto.cmd`/`run-eto.ps1`（它们继续作为 pi 命令的直接入口）

## 文件引用

| 文件 | 改动 |
|:-----|:------|
| `C:\Users\a7140\bin\eto` | 注入环境变量 + 加 `-e` 扩展加载 |
| `C:\Users\a7140\bin\eto.cmd` | 可能有对应的 cmd 版，同样改 |
| `eto.ps1`（可选，项目根） | **新建** |
