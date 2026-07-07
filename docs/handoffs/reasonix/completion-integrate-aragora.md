# Completion: 接 Aragora — 不可行

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: 不可行
> 日期: 2026-07-04

## 结论

Aragora 的 `DebateProtocol` 是纯配置对象，真正的评分逻辑在 `Arena.run()` 内建的 Agent 运行时中——ETO 无法将自己的 `_call_peer()` 注入。全量接 Aragora 等于放弃 ETO 现有的 peer 评分机制，改用 Aragora 自己的 Agent runtime。

## 现有实现已覆盖需求

| plan 要求 | 当前 `_multi_strategy_tally` |
|:----------|:-----------------------------|
| 多策略投票 | ✅ approval + borda + irv |
| 审计 ID | ✅ `audit_id` (时间戳) |
| 阈值 0.6 | ✅ `status: "approved" if avg >= 0.6` |
| 多轮审议 | ✅ T1评分 → T2审议 → T3终审 |
| 加权评分 | ✅ 3 策略平均 |

## 建议

保持当前自写实现。如要换库，需要找提供**纯计票算法**而非**完整 Agent 运行时**的投票库。
