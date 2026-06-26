# Completion: eto 命令改走 Pi TUI

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE
> 日期: 2026-06-25

## 改动

| 文件 | 路径 | 改动 |
|:-----|:------|:------|
| `eto.ps1` | `C:\Users\a7140\AppData\Roaming\npm\eto.ps1` | **重写** — 从 Python 管道改为 Pi TUI |
| `eto.cmd` | `C:\Users\a7140\AppData\Roaming\npm\eto.cmd` | **新建** — CMD 版 Pi TUI 入口 |

### 新 eto.ps1 逻辑

```
1. 设 ANTHROPIC_BASE_URL + ANTHROPIC_API_KEY → 本地代理
2. 找 eto/extensions/eto.ts（从 CWD 解析）
3. 无参数 → node pi/dist/cli.js -e ... --provider anthropic（TUI）
4. 有参数 → node pi/dist/cli.js -e ... --provider anthropic @args（CLI）
```

### 新 eto.cmd

CMD 版，等价的 batch 实现。

## 验证

| 测试 | 结果 |
|:-----|:------|
| `eto --help`（PowerShell） | ✅ 显示 Pi 帮助，不是旧 Python 帮助 |
| `cmd /c "eto --help"` | ✅ 同上，CMD 通路 |
| `eto -p "hi"` | ⏳ 通但慢（ETO 扩展的 Ollama 路由 + 代理双 LLM 调用）|

## 不再调用旧 Python 管道

旧 `core.py` / `tui.py` / `executor.py` 仍然在 `~/.eto/pipelines/` 里，但 `eto` 命令不再走它们了。

## 用法

```powershell
eto              # 进 TUI 交互模式（从项目目录）
eto -p "..."     # 一次性查询
eto --help       # 看 Pi 帮助
```

## 请审计

1. 进项目目录敲 `eto` 回车 → 应启动 Pi TUI
2. `eto -p "写个函数"` → 应回复
3. `eto --help` → 显示 Pi 帮助页，不是旧 "ETO - Teal Organization System"
