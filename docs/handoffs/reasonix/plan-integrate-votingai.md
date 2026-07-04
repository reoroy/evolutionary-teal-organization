# Plan: 缝合 VotingAI — 多策略共识替代自写 vote.py

> 创建日期: 2026-07-04 | 发送者: Claude Code
> 接收者: Reasonix Code
> 来源: `docs/ETO缝合方案对照表.md` — 共识层待接项

---

## 现状

当前 `vote.py` 的 `peer_review()` 三阶段评分实现有硬伤：

| 问题 | 表现 |
|:-----|:------|
| 评分算法 | 简单平均，没有正规投票理论 |
| 分歧审议 | 手动 if-else 判断分歧 >0.2，逻辑脆弱 |
| 防作弊 | 无 — Agent 可以随意报分 |
| 审计 | 只记录最终 score，没有票证 |
| 多轮 | 最多 3 轮，轮次判断硬编码 |

## 方案

用 [VotingAI](https://github.com/tejas-dharani/votingai) 替换自写 `vote.py` 的评分核心。VotingAI 自带 5 种投票策略 + 加密验票 + 拜占庭容错 + 审计日志。

### 集成方式

```
当前:                    集成后:

vote.py                     vote.py
  peer_review()              peer_review()
    → 自写评分                → VotingAI.cast_vote() / tally_votes()
    → if-else 分歧判断        → 自动多策略
    → 手动轮次控制            → 加密验票 + 审计日志
```

VotingAI 集成不是全盘替换——ETO 的 peer_review 作为编排层，投票计算交给 VotingAI：

1. 构建 Voter（每个 peer 是一个 voter）
2. 用 `VotingSystems`（SSV / MSV / IRV / Borda / Approval）做多策略投票
3. 用 `AuditTrail` 记录票证
4. 结果映射回 ETO 的 `{status, final_score, votes, deliberation, actions}` 格式

### 1. pip 安装

```bash
pip install votingai
```

添加到 `pyproject.toml`：

```
votingai>=1.0
```

### 2. 重构 consensus/vote.py

```python
import json, sys
from votingai import VotingSystems, AuditTrail
from votingai.voter import Voter

async def peer_review(plan: str, peers: list[str] | None = None) -> dict:
    """三阶段共识（VotingAI 核心）"""
    peers = peers or ["researcher", "coder", "auditor"]
    voter_pool = {name: Voter(name) for name in peers}
    
    for name, voter in voter_pool.items():
        score = await _call_peer(name, plan)
        voter.cast_vote("approval", score)
    
    results = {}
    for strategy in ["approval", "borda", "irv"]:
        vs = VotingSystems(strategy, list(voter_pool.values()))
        results[strategy] = vs.tally()
    
    final_score = sum(results[s]["score"] for s in results) / len(results)
    audit = AuditTrail(list(voter_pool.values()))
    
    verdict = "approved" if final_score >= 0.6 else "revise"
    
    return {
        "status": verdict,
        "final_score": round(final_score, 2),
        "votes": [{"peer": name, "score": vote["score"]} for name, vote in results.get("approval", {}).get("votes", {}).items()],
        "deliberation": {"strategies": list(results.keys()), "rounds": 1},
        "actions": [],
        "audit_id": audit.trail_id if hasattr(audit, 'trail_id') else None,
    }
```

**注意：** 上面的代码是伪代码，Reasonix 需要根据 VotingAI 的实际 API 调整。核心约束：

- ✅ 保留 `peer_review(plan, peers)` 签名（向后兼容）
- ✅ 返回格式不变：`{status, final_score, votes, deliberation, actions}`
- ✅ `audit_id` 新增字段到返回中
- ✅ 多策略评分（approval + borda + irv）取平均
- ✅ 加密验票（VotingAI 原生支持）

### 3. 向后兼容

| 调用方 | 改动 | 需要改 |
|:-------|:------|:-------|
| `eto.ts` — `peerConsensus()` | 无 — 调的是 `callStitchAsync("consensus.vote", "peer_review", ...)` | 不需要 |
| `eto.ts` — `eto_consensus` 工具 | 无 — 同样调 peer_review | 不需要 |
| `mcp_server.py` — `eto_consensus()` | 无 — 同样调 peer_review | 不需要 |
| `test.py` | 更新预期值 | ✅ 需要 |

### 4. 不做的

- ❌ 不改 ETO 的路由流程
- ❌ 不改 eto.ts 的 consensus 调用
- ❌ 不改 MCP 工具接口
- ❌ 不改 `election/elect.py`（那是后面 raft-lite 的事）

---

## 改动文件

| 文件 | 改动 |
|:-----|:------|
| `pyproject.toml` | 添加 `votingai>=1.0` 依赖 |
| `eto/stitches/consensus/vote.py` | 用 VotingAI 替换评分核心 |
| `eto/stitches/test.py` | 更新 consensus 测试的预期返回值 |

---

## 验证

```bash
# 1. VotingAI 可用
python -c "from votingai import VotingSystems, AuditTrail; print('OK')"

# 2. peer_review 返回格式不变
python3 -c "
from eto.stitches.consensus.vote import peer_review
import asyncio
r = asyncio.run(peer_review('测试方案', ['coder', 'auditor']))
print('status:', r.get('status'))
print('final_score:', r.get('final_score'))
print('audit_id:', r.get('audit_id'))
"

# 3. 完整测试
python eto/stitches/test.py
# → 17/17 PASS
```

---

## 验收标准

| # | 检查项 | 方法 |
|:--|--------|------|
| V-1 | `votingai` 可导入 | `from votingai import VotingSystems` |
| V-2 | `peer_review(plan, peers)` 签名不变 | eto.ts 调用不报错 |
| V-3 | 返回含 `status` + `final_score` + `votes` + `deliberation` + `actions` | 检查字段 |
| V-4 | 新增 `audit_id` 字段 | 返回中含 audit_id |
| V-5 | 多策略评分（≥2种） | deliberation.strategies 长度 ≥2 |
| V-6 | 17/17 测试 PASS | `python eto/stitches/test.py` |
| V-7 | 现有 MCP eto_consensus 工具不受影响 | 通过 MCP 调 consensus 返回正确 |
