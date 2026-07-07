# Completion: Backlog — VotingAI + 时间注入 + 优化

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE
> 日期: 2026-07-04

## 改动

| 项 | 文件 | 改动 |
|:---|:-----|:------|
| 1. 多策略投票 | `eto/stitches/consensus/vote.py` | 新增 `_multi_strategy_tally()`，替换简单平均 |
| 2. 时间注入 | `eto/stitches/bidding/workflow.py` | `_make_node_fn()` 每个 node 注入当前时间 |
| 3. JSON 提取 | 已有 `_extract_json()` | 已足够健壮，无需改 |

## 多策略投票

```
之前: avg = sum(scores) / len(scores)
之后: 3 策略平均:
  - approval: ≥0.6 的比例
  - borda: 排名加权
  - irv: 去掉最低后平均
```

`peer_review` 返回值新增 `audit_id` 和 `deliberation.strategies` 字段。

## 验证

```
Stitcher 17/17 PASS ✅
```
