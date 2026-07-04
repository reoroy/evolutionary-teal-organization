# Completion: Teal Runtime Phase A — Agent 竞标层

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE
> 日期: 2026-07-04

## 改动

| 文件 | 改动 |
|:-----|:------|
| `eto/stitches/bidding/__init__.py` | **新建** — 包标记 |
| `eto/stitches/bidding/protocol.py` | **新建** — `run_bidding()` + 评分/选标/降级 |
| `eto/extensions/eto.ts` | 新增 `tryBidding()`，plan 路由竞标优先 |

## 行为变化

```
之前: 任务 → matchAgentsForRoute(weights) → 固定 Agent
之后: 任务 → run_bidding() → 每个 Agent 自评 → 选标
                              ↕ 无人竞标时
                         matchAgentsForRoute (fallback)
```

## 验证

| 测试 | 结果 |
|:-----|:------|
| code 任务 → coder 中标 | ✅ |
| research 任务 → researcher 中标 | ✅ |
| solution 任务 → auditor 中标 | ✅ |
| 空竞标 → fallback | ✅ |
| Stitcher 17/17 PASS | ✅ |
