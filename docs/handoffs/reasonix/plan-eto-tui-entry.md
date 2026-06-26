# Plan: ETO 交互式 TUI 入口

> 发送者: Claude Code
> 接收者: Reasonix
> 状态: READY
> 优先级: P0 — ETO 现在只有 `-p "prompt"` 一次性模式，不是正常 CLI 用法

## 需求

`run-eto.cmd` 要启动 Pi 的交互式 TUI 界面（不传 `-p`），让用户像敲 `claude` 一样进入对话模式。

## 任务

### 1. 验证交互模式

确认 `pi --provider anthropic`（不带 `-p`）能启动 TUI：

```bash
set ANTHROPIC_BASE_URL=http://127.0.0.1:15721
set ANTHROPIC_API_KEY=PROXY_MANAGED
pi -e eto/extensions/eto.ts --provider anthropic
```

期望：进入全屏 TUI，ETO 通知出现，可输入 prompt 对话。

### 2. 更新 run-eto.cmd

去掉 `-p "hi"`，让脚本启动 TUI 会话。

### 3. 更新 Makefile

`run-proxy` target 去掉 `-p "$(M)"` 硬编码，改为：
- 无 `M` 变量 → TUI 模式
- 有 `M` 变量 → 一次性的 `-p` 模式

### 4. 更新 verify-eto.cmd

验证脚本保持不变（它用 `-p` 做静默测试）。

## 期望效果

```bash
# 敲这个进入交互式 TUI
run-eto.cmd
# → Pi TUI 启动，ETO 加载，直接开始对话

# 一次性查询仍然可用
make run-proxy M="写个flask API"
```

## 不接受

- ❌ 不要改 Pi provider 代码（v2 已经 patch 好了）
- ❌ 不要改 ETO 扩展逻辑
- ❌ 不要建 eto 独立入口（等 fork 再搞）

## 文件引用

| 文件 | 改动 |
|:-----|:------|
| `run-eto.cmd` | 删 `-p "hi"` |
| `Makefile` | `run-proxy` target 支持 M= 可选 |
| `verify-eto.cmd` | 不改 |
