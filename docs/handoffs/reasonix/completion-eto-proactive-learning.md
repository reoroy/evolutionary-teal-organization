# Completion: ETO 主动训练 — 基于执行历史的自动学习

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE
> 日期: 2026-07-12

## 改动

| 文件 | 改动 |
|:-----|:------|
| `eto/stitches/memory/shared_memory.py` | 新增 `get_outcomes(agent_id)` — 读取 Agent 历史执行结果 |
| `eto/stitches/comms/a2a.py` | 每步执行后记录 `task_outcome` 到 shared_memory |
| `eto/stitches/bidding/workflow.py` | `select_agent` 加入 `_success_rate()` 调整 |

## 学习流程

```
execute_plan() → 记录 task_outcome:{agent}:{status} → shared_memory
                                                        ↓
select_agent() → _success_rate(agent) → 能力匹配 + 成功率 × 0.2
```

## 验证

```
select_agent("写代码") → coder ✅
_success_rate("coder") → 0.5（无历史时）✅
```
