# Completion: ETO 路由持久显示——Pi TUI Widget

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE
> 日期: 2026-06-25

## 改动

| 文件 | 改动 |
|:-----|:------|
| `eto/extensions/eto.ts` | `before_agent_start` 加 4 行 `ctx.ui.setWidget()` |

## Widget 生命周期

```
用户输入 → setWidget("eto-route", undefined)  清除旧 widget
        → 路由分析
        → setWidget("eto-route", widgetLines)  设置新 widget
        → LLM 回复
        → widget 保持到下一次用户输入（自动覆盖）
```

三种路由的 widget 内容：

| 路由 | widget 行 |
|:-----|:----------|
| **plan** | `📋 ETO | code → plan \| coder \| keyword 85%` |
| | `📝 3步计划 \| 共识: 通过` |
| **direct** | `📋 ETO | knowledge → direct \| researcher \| LLM 92%` |
| **consensus** | `📋 ETO | solution → consensus \| auditor \| keyword 100%` |
| | `🤝 需共识审批` |

## 保留原有输出

- `ctx.ui.notify()` 保留（TUI 状态栏辅助）
- systemPrompt routeLines 保留（对话上下文）
- widget 是新加的一层——**三者并行**，互补不替代

## 请审计

检查 `eto/extensions/eto.ts` 中 setWidget 的 4 处调用：
1. handler 开头清除
2. plan 分支设置
3. consensus 分支设置
4. direct 分支设置
