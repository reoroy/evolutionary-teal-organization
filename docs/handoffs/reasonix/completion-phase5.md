# Completion: Phase 5 — 真实多 Agent 共识系统

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE
> 日期: 2026-07-02

## 改动

| 文件 | 改动 |
|:-----|:------|
| `eto/stitches/consensus/vote.py` | 三阶段共识：角色提示词 + 评分→审议→终审 |
| `eto/stitches/test.py` | 新增 2 个共识三阶段测试 |
| `eto/extensions/eto.ts` | consensus route handler + registerTool 改用 3 peer |

## 三阶段流程

```
T1: 各 peer 用角色提示词独立评分（researcher/coder/auditor）
T2: 分歧 max-min > 0.3 → 审议循环，≤2 轮
T3: 分歧仍大 → 终审仲裁，输出 verdict + actions
```

## 返回格式

```json
{
  "status": "approved",
  "final_score": 0.72,
  "votes": [{"peer": "researcher", "score": 0.85, ...}],
  "deliberation": {"rounds": 1, "verdict": "approve", ...},
  "actions": ["补充回滚方案"]
}
```

## 推送到 GitHub

`git push origin main` 待执行（需先 pull 同步）。
