# Plan: 接 Aragora — 结构化辩论共识替代 vote.py

> 创建日期: 2026-07-04
> 来源: `docs/ETO缝合方案对照表.md` → 共识层
> 替代方案: VotingAI (API 不兼容)、LLM Council (CLI 工具非库)

---

## 为什么选 Aragora

[aragora](https://github.com/synaptent/aragora) v2.9.0 已验证，API 匹配 ETO 需求：

| ETO 需求 | Aragora 对应 |
|:---------|:-------------|
| 多 peer 独立评分 | `DebateProtocol(consensus='weighted')` |
| 审议论 | 内置多轮 debate，支持质疑/修订 |
| 审计 | `receipt` 输出决策收据 |
| 可配置共识阈值 | `consensus_threshold` 参数 |
| 拜占庭容错 | `byzantine_fault_tolerance` 参数 |

已安装（`pip install aragora` 成功），无额外依赖。

---

## 改动方案：薄包装不改 Aragora

ETO 的 `peer_review(plan, peers)` 作为薄包装调 `DebateProtocol`，返回格式不变。

```python
from aragora import DebateProtocol, Arena

async def peer_review(plan: str, peers: list[str] | None = None) -> dict:
    peers = peers or ["researcher", "coder", "auditor"]
    
    # 构建 Arena (Aragora 执行器)
    arena = Arena(
        agents=peers,
        environment=Environment(
            name="eto-consensus",
            description="ETO 同侪共识",
        ),
    )
    
    # 配置辩论
    debate = DebateProtocol(
        topology="star",
        rounds=3,                    # T1 → T2 → 终审 = 3 轮
        consensus="weighted",        # 加权评分
        consensus_threshold=0.6,     # 与当前 ETO 一致
        enable_settlement_tracking=True,
    )
    
    # 执行
    result = await arena.run(
        debate=debate,
        task=plan,
    )
    
    status = "approved" if result.confidence >= 0.6 else "revise"
    
    return {
        "status": status,
        "final_score": round(result.confidence, 2),
        "votes": result.history[-1] if result.history else [],
        "deliberation": {
            "rounds": result.rounds_completed,
            "verdict": status,
        },
        "actions": [],
        "audit_id": result.debate_id,
    }
```

**核心约束：**
- ✅ 保持 `peer_review(plan, peers)` 签名不变
- ✅ 返回格式不变：`{status, final_score, votes, deliberation, actions}`
- ✅ 新增 `audit_id`（Aragora 原生 `debate_id`）
- ✅ 3 轮映射到 T1→T2→终审

---

## 改动文件

| 文件 | 改动 |
|:-----|:------|
| `eto/stitches/consensus/vote.py` | 替换 `_multi_strategy_tally` + `peer_review` 内容 |
| `pyproject.toml` | 添加 `aragora>=2.9`（已有 `Pydantic` 等依赖满足） |

## 不做

- ❌ 不改 eto.ts / mcp_server.py（签名不变）
- ❌ 不改 test.py（`_test_deliberation` 可保留或删除）
- ❌ 配置 Aragora 全部 150+ 参数，只用 ETO 需要的

---

## 验收

```bash
# 1. Aragora 可用
python -c "from aragora import DebateProtocol, Arena; print('OK')"

# 2. peer_review 签名不变
python -c "
from eto.stitches.consensus.vote import peer_review
import asyncio
r = asyncio.run(peer_review('测试方案', ['coder', 'auditor']))
print('status:', r.get('status'))
print('final_score:', r.get('final_score'))
print('audit_id:', r.get('audit_id'))
"

# 3. 完整测试
python eto/stitches/test.py
```
