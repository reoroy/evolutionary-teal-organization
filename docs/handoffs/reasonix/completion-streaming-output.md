# Completion: ETO 流式输出

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE
> 日期: 2026-06-25

## 改动

| 文件 | 改动 |
|:-----|:------|
| `eto/extensions/eto.ts` | `before_agent_start` hook 加 6 行 `ctx.ui.notify()` |

## 流式输出序列

用户输入任务后，TUI 逐行输出：

```
📋 ETO 分析中...
🔍 三镜路由: code → plan  [keyword 85%]
👤 协调员: coder
📝 生成执行计划...
🤝 共识: 通过
📝 3 步计划生成
```

分支：
- **direct 路由** → 只显示 分析 + 三镜路由 + 协调员，然后直达
- **plan 路由** → 完整 6 步流
- **consensus 路由** → 显示 `🤝 需多 Agent 共识审批`

## 验证

```bash
eto -p "写一个函数"
# → TUI 应逐行显示 ETO 路由过程
#
# eto -p "什么是青色组织"
# → direct 路由，显示 3 行后直达回复
```

## 请审计

检查 `eto/extensions/eto.ts` 中 `before_agent_start` handler 的 notify 链。
