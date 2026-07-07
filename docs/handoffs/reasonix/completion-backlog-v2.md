# Completion: Backlog — Fable 模式 + 剩余功能

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE
> 日期: 2026-07-04

## 改动

| 项 | 文件 | 改动 |
|:---|:-----|:------|
| Fable 模式 | `eto/extensions/eto.ts` | `isComplexTask()` + `FABLE_PROMPT` + plan 路由注入 |
| 时间注入 | 之前已做 | `ETO_TIMEZONE` 支持 |

## 已砍（未实现）

| 项 | 理由 |
|:---|:------|
| raft-lite | 当前 elect.py 16 行，够用 |
| Aragora | 完整 Agent 运行时，ETO 插不进去 |
| pi-mempalace | 备选，当前 agentmemory 够用 |
| 路由学习 | 需要 ≥50 条 agentmemory 记录 |

## 剩余 backlog

```python
# 路由学习 — 等 agentmemory 数据够再开
# def adjust_with_history(agent_id, task_type, base_score):
#     history = memory_smart_search(f"dispatch {agent_id} {task_type}")
#     if len(history) >= 50:
#         boost = success_rate * 0.2
#         return min(base_score + boost, 1.0)
```

## Fable 模式

复杂编码任务（含重构/架构/安全等关键词）自动注入 Fable 提示词：

```
[Mode: Fable]
原则：简单优先、读通再改、测试定锚
步骤：1.理解需求 2.设计测试 3.实现 4.验证 5.重构
```

## 验证

```
pi --version → 0.80.3 ✅
isComplexTask("重构用户模块") → true ✅
```
