# Plan: PowerShell 兼容 + ETO 默认走代理

> 发送者: Claude Code
> 接收者: Reasonix
> 状态: READY
> 优先级: P0 — 用户是 PowerShell 用户，cmd 脚本跑不了

## 背景

用户 PowerShell 环境下：
- `run-eto.cmd` — 不识别（.cmd 在 PS 里要 `cmd /c` 或绝对路径）
- `eto` 命令存在（Fork 编译产物），但默认 provider 是 Ollama（不通）
- `run-eto.cmd` 走代理（`--provider anthropic` + 环境变量），这条路径是通的

## 任务

### 1. 创建 run-eto.ps1

PowerShell 版本，等价于 `run-eto.cmd`：

```powershell
# run-eto.ps1
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:15721"
$env:ANTHROPIC_API_KEY = "PROXY_MANAGED"
pi -e eto/extensions/eto.ts --provider anthropic
```

验证：用户可直接 `.\run-eto.ps1` 回车进 TUI。

### 2. 验证「eto 命令走代理」能否直接跑

检查 `/tmp/eto-fork/` 编译产物中的 `eto` 命令是否支持 `--provider anthropic` + 环境变量：

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:15721 ANTHROPIC_API_KEY=PROXY_MANAGED eto --provider anthropic
```

如果能跑，说明问题只是默认 provider，配个别名或 config 就行。

### 3. 如果不能直接跑

如果 eto 命令自己没走通（没有 patch anthropic provider 那份代码），就写一个 `eto-proxy.ps1`：

```powershell
# eto-proxy.ps1 — 用 eto 二进制进 TUI，走代理
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:15721"
$env:ANTHROPIC_API_KEY = "PROXY_MANAGED"
eto --provider anthropic
```

### 4. 如果 eto 二进制也不支持 --provider anthropic

（意味着编译时没包含 patch），那就确认 `run-eto.ps1` 是唯一入口，加个 `make run-win` target。

## 不接受

- ❌ 不要重新编译 eto fork（涉及 Linux 编译环境）
- ❌ 不要改 `run-eto.cmd`（CMD 用户仍然可用）

## 文件引用

| 文件 | 改动 |
|:-----|:------|
| `run-eto.ps1` | **新建** |
| `eto-proxy.ps1` | **可能新建**（取决于 eto 二进制是否支持）|
| `Makefile` | 可能加 `run-win` target |
