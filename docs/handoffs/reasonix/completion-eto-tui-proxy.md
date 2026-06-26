# Completion: eto TUI 走代理

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE — 但计划假设有偏差
> 日期: 2026-06-25

## 关键发现

**计划假设 `eto` 是 Node.js 编译产物，有自己的 `node_modules/`。实际 `eto` 是纯 Python 包装器。**

执行 `eto` 的调用链：

```
eto.ps1 (npm 包装器)
  └→ python3 ~/.eto/pipelines/tui.py   (TUI 模式，无参数)
  └→ python3 ~/.eto/pipelines/core.py   (CLI 模式，有参数)
        └→ executor.call_pi()
              └→ pi --print --mode text --provider ollama --model qwen2.5-coder:7b
                    └→ (调用全局 pi，我们已经 patch 了 anthropic.js)
```

### 1. `eto` 没有自己的 Node.js

`C:\Users\a7140\AppData\Roaming\npm\eto.ps1` 内容：
```powershell
$pipelines = Join-Path $env:USERPROFILE ".eto\pipelines"
if ($args.Count -eq 0) {
    python3 (Join-Path $pipelines "tui.py")
} else {
    python3 (Join-Path $pipelines "core.py") $args
}
```

npm global node_modules 中没有 `eto` 的目录——它不是一个 Node 包，只是一个调用 Python 的包装器。

### 2. 根因不是 anthopic.js

`eto` 硬编码 `--provider ollama`，所以即使 patch 了 `anthropic.js`，`eto` 也**不会走代理**。要让 `eto` 走代理需要改 `executor.py` 中的 provider 选择。

### 3. TUI 在 Windows 上崩溃

尝试运行 `tui.py` 时报错：
```
UnicodeEncodeError: 'gbk' codec can't encode character '\u2590'
```
旧版 TUI 代码里的 box-drawing 字符在 Windows GBK 终端下不兼容。这是旧版代码的已知问题。

## 当前实际可行的路径

| 选项 | 工作量 | 说明 |
|:-----|:--------|:------|
| **A. 改 executor.py 读 `ANTHROPIC_BASE_URL`** | ~5 行 | 让 `call_pi` 检测环境变量，自动切 `--provider anthropic` |
| **B. 用 `run-eto.cmd` / `run-eto.ps1`** | ✅ 已好 | 直接 `pi -e eto/extensions/eto.ts --provider anthropic` 进 TUI |
| **C. 方案 A 而不改 Python** | ❌ 不可能 | 不碰 Python 代码无法改变 provider |

## 建议

既然 `run-eto.cmd` / `run-eto.ps1` 已经是替代入口（走 Pi 的 TUI），路线是：
1. `eto` 旧版 Python 代码的 TUI 在 Windows 上本来就不可用（GBK 编码问题）
2. Pi 的 TUI（`pi -e eto/extensions/eto.ts`）是稳定的入口
3. 我们已配好 `run-eto.cmd`、`run-eto.ps1`、`Makefile` 三条渠道

## 请审计

确认 `run-eto.cmd` 能正常启动 Pi TUI（敲 `run-eto.cmd` 回车即可）。
如果非要修 `eto` 命令本身，需要改 `executor.py` 中的 provider 硬编码。
