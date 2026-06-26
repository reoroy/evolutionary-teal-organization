# Completion: 路由信息显示在对话区

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE
> 日期: 2026-06-25

## 改动

| 文件 | 改动 |
|:-----|:------|
| `eto/extensions/eto.ts` | `before_agent_start` 返回值改为 `routeLines` 数组 + 原 systemPrompt |

## 关键变化

**之前：** systemPrompt 末尾追加密 `[ETO Plan]` 或 `[ETO] 路由`。路由信息只靠 `ctx.ui.notify()` 在 TUI 状态栏显示。

**之后：** systemPrompt 开头插入完整路由摘要块，始终出现在对话区：

```
📋 ETO 分析中...
🔍 三镜路由: code → plan [keyword 85%]
👤 协调员: coder
🤝 共识: 通过
📝 3 步计划生成

[ETO Plan]
...

(原 systemPrompt)
```

三种路由：
- **direct** → 3 行摘要 + 原 systemPrompt
- **plan** → 5 行摘要 + Plan 内容 + 原 systemPrompt
- **consensus** → 4 行摘要（含"需审批"）+ 原 systemPrompt

## 保留 notify

原有 `ctx.ui.notify()` 调用不动——TUI 状态栏和对话区各显示一份，互补不替代。

## 请审计

查看 `eto/extensions/eto.ts` 的 `before_agent_start` handler，确认 routeLines 构建 + 返回逻辑正确。
