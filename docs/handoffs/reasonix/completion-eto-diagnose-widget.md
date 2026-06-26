# Completion: 诊断 widget

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE
> 日期: 2026-06-25

## 诊断结果

### setWidget 在 Pi v0.79.8 是否实现？

**✅ 是的，TUI 交互模式有完整实现。**

| 模式 | 文件 | 状态 |
|:-----|:------|:------|
| 交互模式 TUI | `interactive-mode.js:1387` | ✅ `setExtensionWidget()` 完整实现 |
| RPC 模式 | `rpc-mode.js:122` | ✅ 有实现 |
| Print/runner 模式 | `runner.js:98` | ⚠️ 空桩 `() => {}`（合理，print 无 UI）|

### setExtensionWidget 做了什么

```
content = ["📋 ETO | code → plan", "📝 3步计划"]
  → Container { Text, Text }     // 包裹成 TUI 组件
  → extensionWidgetsAbove Map    // 存入 key="eto-route"
  → renderWidgets()              // 刷新 TUI 显示
```

- 默认位置：`aboveEditor`（编辑器上方）
- 最大行数：`MAX_WIDGET_LINES = 10`（足够）
- 传 `undefined` 清除 widget

### 所以 widget 代码没错

代码本身是正确的。如果用户看不到 widget，可能的原因：

1. **`eto` 不是走交互模式** — 检查 `eto.ps1` 有没有误传 `-p` 或 `--print`
2. **扩展路径不对** — `eto.ps1` 的绝对路径扩展找不到，fallback 也没找到
3. **TUI 渲染时机** — `before_agent_start` 在 TUI 就绪前触发

### 建议检查

```bash
# 确认扩展加载
eto --help | findstr "eto"
# 输出应包含 Pi 的帮助，说明扩展已加载

# 手动敲
eto -e C:\...\eto\extensions\eto.ts --provider anthropic
# 进 TUI，输入任务，看编辑器上方有无 widget
```

## 不需要改动

`setWidget → setStatus` 的回退方案暂时不需要——widget 本身有实现。先确认 eto 包装器是否正常进入 TUI 模式。

## 请审计

检查 `eto.ps1` 是否在无参数时进入 TUI 模式（不应有 `-p` 或 `--print`）。
