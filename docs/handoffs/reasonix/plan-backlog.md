# Backlog: ETO 缝合 Roadmap（待实现）

> 创建日期: 2026-07-04
> 来源: `docs/ETO缝合方案对照表.md` + `docs/teal-runtime-arch.md`
> 状态: 未排序 backlog，按需取用

---

## P0 — 核心增强（已有 plan）

| # | 项目 | 文件 | 状态 |
|:-:|:-----|:-----|:------|
| 1 | **接 VotingAI** — 多策略共识替代 vote.py | `plan-integrate-votingai.md` | 📝 计划就绪 |

---

## P1 — 缝合对照表待接项

### 2. 选举层：接 raft-lite

替换 `eto/stitches/election/elect.py`。

**为什么：** 当前 elect.py 只是 match 权重取最高分，没有真实的 leader 选举。raft-lite 是纯 Python 单文件 Raft 实现，处理 leader 选举 + 日志复制 + 故障检测。

**改动文件：**
| 文件 | 改动 |
|:-----|:------|
| `pyproject.toml` | 添加 `raft-lite>=0.1` |
| `eto/stitches/election/elect.py` | 替换 elect() 为 raft-lite LeaderElection |
| `eto/extensions/eto.ts` | 无改动（调 electCoordinator 签名不变）|

**集成方式：**
```python
from raft_lite import LeaderElection

async def elect(candidates: list[tuple[str, float]]) -> str:
    le = LeaderElection([name for name, _ in candidates])
    leader = le.get_leader() or candidates[0][0]
    return {"leader": leader, "all": candidates}
```

**验收：** `python eto/stitches/test.py` → PASS，elect 返回格式不变。

---

### 3. 共识层替代方案：接 Aragora

如果 VotingAI 不合适，备选 [Aragora](https://github.com/synaptent/aragora)（结构化辩论 + 审计溯源）。

**不同点：**
- Aragora 侧重辩论过程（Agent 互相质疑、修订）
- VotingAI 侧重投票策略（多策略计票）
- Aragora 产出"决策收据"可用于审计

**改动文件：**
| 文件 | 改动 |
|:-----|:------|
| `pyproject.toml` | 添加 `aragora>=0.1` |
| `eto/stitches/consensus/vote.py` | 替换 peer_review 为 Aragora Debate |

---

### 4. 记忆层替代方案：接 pi-mempalace

如果 agentmemory 不合适，备选 [pi-mempalace](https://www.npmjs.com/package/@sinamtz/pi-mempalace)。

**不同点：**
- agentmemory: SQLite + 向量搜索，跨 Agent 中央库
- pi-mempalace: SurrealDB 3.0 HNSW，向量 + 图 + 时序
- 更重，但能力更强

**改动文件：**
| 文件 | 改动 |
|:-----|:------|
| `eto/stitches/memory/shared_memory.py` | context_block 增加 pi-mempalace 后端 |

---

## P2 — Teal Runtime 未完成

### 5. Phase C：路由学习

> 来自 `docs/teal-runtime-arch.md` 协议三

每次 dispatch 结果写 agentmemory，下次同类任务竞标时历史加分。

**改动文件：**
| 文件 | 改动 |
|:-----|:------|
| `eto/stitches/bidding/protocol.py` | `_evaluate_profile()` 查 agentmemory 历史成功率加成 |
| `eto/stitches/learning/router.py` | 新增：学习数据记录 + 查询 |

**关键设计：**
```python
def adjust_with_history(agent_id: str, task_type: str, base_score: float) -> float:
    """从 agentmemory 查询该 Agent 同类任务历史表现，调整置信度"""
    # 1. memory_smart_search(f"dispatch {agent_id} {task_type}")
    # 2. 计算加权成功率
    # 3. base_score += 成功率 × 0.2
    return min(base_score + boost, 1.0)
```

**前提条件：** agentmemory 中有 ≥50 条 dispatch 记录。

---

### 6. 工作流时间注入

当前 `before_agent_start` 正常路由会注入 "当前时间"，但工作流路径（workflow.py dispatch）不走正常路由，被调度的 Agent 拿不到时间。

**修改方案：**
```python
# workflow.py _make_node_fn() 中
def node_fn(state):
    sp = step.get("system_prompt", "")
    # 注入时间
    import os
    tz = os.environ.get("ETO_TIMEZONE", "Asia/Shanghai")
    from datetime import datetime
    sp = f"当前时间: {datetime.now().strftime('%Y/%m/%d %H:%M:%S')}\n\n" + sp
```

**改动文件：**
| 文件 | 改动 |
|:-----|:------|
| `eto/stitches/bidding/workflow.py` | `_make_node_fn()` 每个 node 执行前注入时间 |

---

## P2 — 技能/模式注入

### 9. Fable 模式原生支持

ETO 自动路由到 `fable-mode`（一种工程方法论 + 语域）——当任务类型匹配时注入 fable 系统提示词。

**为什么：** Fable 模式有严格的工程方法（分步验证、测试锚定、沉默期等），适合复杂编码任务。ETO 的路由系统应该能自动识别哪些任务适合 fable 模式，并在 dispatch 时注入对应的 system_prompt。

**集成方式：**

```yaml
# dispatch_spec 预设 — 在 peer 配置中声明
peers:
  coder-fable:
    provider: mcp
    mcp_server: ["python", "-m", "eto.mcp_server"]
    dispatch_spec:
      system_prompt: |
        你运行在 Fable 模式下。
        原则：简单优先、读通再改、测试定锚、平铺好过嵌套。
        步骤：1. 理解需求 2. 设计测试 3. 实现 4. 验证 5. 重构
        沟通：lead with verdict, no filler, call flaws mistakes.
      skills: ["tdd", "refactor"]
      mcp_tools: ["eto_consensus", "eto_memory_read"]
```

**更进一步的方案：**
ETO 在路由阶段判断任务复杂度，自动选择是否启用 fable 模式：

```
简单任务（≤5 步）→ 普通 mode
复杂任务（>5 步 / 涉及重构 / 高风险）→ fable mode, 自动注入 fable 提示词
```

**改动文件：**
| 文件 | 改动 |
|:-----|:------|
| `eto/extensions/eto.ts` | 路由处根据任务复杂度选择 dispatch_spec 预设 |
| `~/.pi/eto-config.json` | 新增 `mode_presets` 段，fable 及其他模式定义 |

**验收：** 复杂编码任务下，Agent 回复开头出现 Fable 风格（先结论再证据、无填充语）。

---

## P3 — 已知小问题

### 7. eto-mesh CLI 中文编码

Windows GBK 终端下 `eto-mesh status` 中文显示乱码。

**改法：** `cmd_join()` 和 `cmd_status()` 中检测 `sys.stdout.encoding`，非 utf-8 时降级到纯 ASCII 输出。

**改动文件：**
| 文件 | 改动 |
|:-----|:------|
| `eto/cli.py` | 输出检测 encoding，非 utf-8 时不用中文 |

---

### 8. 竞标协议 prompt 优化

当前 `vote_on_proposals()` 的 prompt 要求 LLM 输出 JSON，但不同 LLM 输出格式不一致（有时中文 key，有时英文）。

**改法：** 在 prompt 中增加示例输出 + 加一层正则后处理。

**改动文件：**
| 文件 | 改动 |
|:-----|:------|
| `eto/stitches/bidding/protocol.py` | `_extract_json()` 增强，支持更多变体 |

---

## 依赖关系图

```
P0: VotingAI ──→ 共识增强
                    │
P1: raft-lite ────→ 选举增强
                    │
P2: 路由学习 ──────→ 需要 agentmemory 有数据
      │
P2: 工作流时间注入 → 不依赖其他项
      │
P3: 中文编码 ──────→ 独立
P3: prompt 优化 ───→ 独立
```

## 预计总工时

| 项 | 工时估计 |
|:---|:---------|
| 1. VotingAI | 20 min（已有 plan）|
| 2. raft-lite | 15 min |
| 3. Aragora | 20 min（备选）|
| 4. pi-mempalace | 15 min（备选）|
| 5. 路由学习 | 25 min |
| 6. 工作流时间注入 | 5 min |
| 7. 中文编码 | 5 min |
| 8. prompt 优化 | 10 min |
