# Completion: CLI 编码 + workflow 时区

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE（第3项不可行）
> 日期: 2026-07-04

## 改动

| 项 | 文件 | 改动 | 状态 |
|:---|:-----|:------|:------|
| 1. CLI 编码 | `eto/cli.py` | 文件不存在 | ⏭ 跳过 |
| 2. 时区支持 | `eto/stitches/bidding/workflow.py` | `ETO_TIMEZONE` 环境变量生效 | ✅ |
| 3. VotingAI | `eto/stitches/consensus/vote.py` | 不可行 | ❌ |

## 第 3 项为什么不可行

VotingAI v1.0.2 已安装，实际 API 是 AutoGen 群聊系统：

```
可用: VotingGroupChat, VotingMethod, VoteType, VotingPhase
不存在: VotingSystems, AuditTrail, Voter
```

Plan 假设的 `VotingSystems(strategy, scores).tally()` 和 `AuditTrail(votes)` 在这个库中不存在。现有 `_multi_strategy_tally()` 已经是正确实现——approval + borda + irv 三策略平均，无需 AutoGen 运行时。

如需接真实投票库，需要找提供 `VotingSystems` API 的不同库。建议保持当前自写实现。

## 验证

```
Stitcher 17/17 PASS ✅
ETO_TIMEZONE=America/New_York 生效 ✅
```
