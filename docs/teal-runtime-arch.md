# Teal Runtime — 自组织多 Agent 运行时架构

> 版本: v0.1 (草案)
> 基座: ETO Mesh (Agent Registry + dispatch_spec + agentmemory)
> 目标: 从"硬编码调度"演进为"自组织协作"

---

## 现状 vs 目标

```
当前 ETO:                       目标 Teal Runtime:
                                
用户 ──→ 三镜路由                 用户 ──→ 发布任务
         │                                │
         ├─ direct → 问答                  ├─ 广播到 Agent Network
         ├─ plan → 固定 Agent              ├─ Agent 竞标
         └─ consensus → 评分              ├─ 协调员选标
                                           ├─ 多轮审议修订
                                           ├─ 执行 + 跟踪
                                           └─ 学习 → 影响下次路由
```

当前架构的所有决策都是预先配置的——路由规则写在 GEWU_MAP 里，Agent 角色写在 profiles.json 里。Teal Runtime 把这些都变成运行时协商。

---

## 三个核心协议

### 协议一：能力声明与竞标 (Capability Bidding)

取代当前的 `matchAgentsForRoute(gewu)`——后者只是查权重表做关键词匹配。

#### 竞标流程

```
1. PUBLISH    协调员向 Mesh 广播 TaskSpec
2. BID        Agent 收到后自评 → 返回标书
3. SELECT     协调员选标 → 公布中标者
4. EXECUTE    中标者执行 → 报告结果
5. SETTLE     结果写回 agentmemory → 影响未来竞标
```

#### TaskSpec 消息格式

```json
{
  "task_id": "t-20260704-001",
  "type": "code",
  "title": "实现用户登录 API",
  "description": "POST /api/login，JWT 签发",
  "constraints": {
    "max_steps": 10,
    "required_capabilities": ["backend", "auth"],
    "timeout": 300000
  },
  "context": {
    "shared_memory_keys": ["auth_design", "api_spec"]
  }
}
```

#### 标书 (Bid) 格式

```json
{
  "agent_id": "coder-alpha",
  "task_id": "t-20260704-001",
  "confidence": 0.85,
  "estimated_steps": 5,
  "evidence": {
    "similar_tasks_completed": 12,
    "avg_success_rate": 0.92,
    "last_success": "2026-07-03",
    "relevant_skills": ["rest-api-design", "jwt-auth"]
  },
  "capacity": {
    "current_load": 1,
    "max_concurrent": 3
  }
}
```

#### 选标算法

协调员收到所有标书后，按综合评分排序：

```
score = confidence × 0.4
      + (1 / estimated_steps) × 0.2
      + success_rate × 0.3
      - (current_load / max_concurrent) × 0.1
```

最高分中标。平票时负载低的优先。

#### 不接活处理

| 场景 | 行为 |
|:-----|:------|
| 无 Agent 竞标 | 协调员降级为直接分配（fallback 到当前路由逻辑）|
| 唯一竞标者 | 直接中标，不比较 |
| 所有标书 confidence < 0.3 | 视为无人敢接，协调员拆解任务后重新广播 |

---

### 协议二：审议式共识 (Deliberative Consensus)

取代当前的 `peer_review()`——后者是三阶段单轮评分，没有迭代修订。

#### 流程

```
一轮：提交提案
  Agent A: 发布执行方案
  Agent B, C: 审查 + 质疑
  
二轮：修订
  Agent A: 回应质疑，修订方案
  Agent B, C: 再审查
  
三轮：终审
  所有 Agent: 最终评分
  协调员: 汇总 → 通过 / 退回 / 拆解
```

#### 消息格式

```json
// 提案
{
  "type": "proposal",
  "task_id": "t-20260704-001",
  "agent_id": "coder-alpha",
  "version": 2,
  "plan": "1. 建表 2. 写 handler 3. 加 JWT 4. 测试",
  "risks": ["JWT secret 管理需运维配合"],
  "revision_notes": "已根据 B 的质疑补充了回滚方案"
}

// 质疑
{
  "type": "challenge",
  "task_id": "t-20260704-001",
  "agent_id": "auditor-beta",
  "target_version": 1,
  "concern": "没有考虑 rate limiting",
  "severity": "medium",
  "suggestion": "API 网关层统一加，或 handler 内用令牌桶"
}

// 终审评分
{
  "type": "final_vote",
  "task_id": "t-20260704-001",
  "votes": [
    {"agent": "coder-alpha", "score": 0.8, "verdict": "approved"},
    {"agent": "auditor-beta", "score": 0.65, "verdict": "approved_with_conditions", "conditions": ["加 rate limit"]},
    {"agent": "researcher-gamma", "score": 0.9, "verdict": "approved"}
  ],
  "final": "approved_with_conditions"
}
```

#### 中止条件

| 条件 | 动作 |
|:-----|:------|
| 所有 Agent 评分 ≥ 0.7 | 通过，执行 |
| 有 Agent 评分 < 0.4 | 退回，Agent A 重新修订 |
| 修订 ≥ 3 轮仍未通过 | 协调员拆解任务为更小的子任务 |
| 总耗时 > timeout | 协调员强制裁决（通过 / 取消） |

#### 相比当前 consensus 的差异

| 维度 | 当前 (peer_review) | Teal 审议 |
|:-----|:-------------------|:----------|
| 轮次 | 单轮 | 多轮迭代（最多 3 轮） |
| 互动 | Agent 不交流 | Agent 可以质疑/回应 |
| 评分 | 固定公式 | 单 Agent 可附加条件 |
| 超时 | 无 | 有（可配） |

---

### 协议三：路由学习 (Routing Learning)

取代当前的硬编码 GEWU_MAP + keywordRoute。

#### 学习数据

每次 dispatch 完成后，记录：

```json
{
  "task_id": "t-20260704-001",
  "task_type": "code",
  "task_keywords": ["login", "api", "jwt"],
  "selected_agent": "coder-alpha",
  "bidders": ["coder-alpha", "coder-beta"],
  "bid_details": [
    {"agent": "coder-alpha", "confidence": 0.85, "estimated": 5},
    {"agent": "coder-beta", "confidence": 0.7, "estimated": 8}
  ],
  "actual_steps": 4,
  "actual_duration_ms": 120000,
  "success": true,
  "revisions_needed": 1,
  "final_score": 0.85
}
```

存储在 agentmemory 中，作为组织经验。

#### 路由时查询

当新任务到达时，协调员先在 agentmemory 中搜索相似历史：

```
# 伪代码
similar = agentmemory.smart_search(task.description, category="dispatch_record")
for each similar record:
  agent_scores[record.selected_agent] += record.success ? 1 : -0.5
  agent_scores[record.selected_agent] += record.final_score * 0.3

# 高分的 Agent 在竞标阶段获得初始加分
bid.confidence += agent_scores[bid.agent_id] * 0.1
```

#### 冷启动

| 阶段 | 路由策略 |
|:-----|:---------|
| 前 10 次 dispatch | 无历史数据，用当前 keywordRoute（不竞价，直接分配）|
| 10-50 次 | 混合：30% 概率探索（直接分配），70% 概率利用（竞标）|
| 50 次+ | 竞标 + 历史加分 |

---

## 与现有 ETO 架构的关系

### 不改变的部分

```
eto/extensions/eto.ts
  ├── 三镜路由入口（触发点保留，逻辑替换）
  ├── 智子安检（不变）
  ├── Agent Registry（不变）
  └── /agents 命令（不变）

eto/stitches/consensus/vote.py（不变，作为审议的终审工具）
eto/stitches/election/elect.py（不变，作为选标出平局时的裁决）
```

### 改变的部分

```
新增:
  eto/stitches/bidding/
    ├── protocol.py      — 竞标流程编排
    └── scorer.py        — 选标评分算法

  eto/stitches/deliberation/
    └── session.py       — 多轮审议会话管理

  eto/stitches/learning/
    └── router.py        — 基于 agentmemory 的路由学习

修改:
  eto/extensions/eto.ts
    └── before_agent_start
        └── routeTask() → 改为触发竞标流程（不再硬编码路由）
```

### 执行路径对比

```
当前:
routeTask(task) → keywordRoute → matchAgentsForRoute → execPlan

Teal Runtime:
routeTask(task) → smart_search(agentmemory) → get_bid_adjustments
               → broadcast_task(task) → collect_bids → select_winner
               → deliberative_review(proposal) → execute
               → write_result_to_agentmemory
```

---

## 边界条件

| 场景 | 处理 |
|:-----|:------|
| 只有一个 Agent | 跳过竞标，直接分配 |
| Agent 中途离线 | registry 无心跳 → 不在竞标列表 |
| 所有标书不可接受 | 协调员降级为直接分配 |
| 审议陷入死循环 | 3 轮上限 → 协调员强制裁决 |
| 组织记忆为空（冷启动） | keywordRoute fallback |
| 恶意竞标（虚高 confidence） | 真实结果写回后 confidence 自动修正 |

---

## 实施建议

不建议一次性替换全部路由逻辑。渐进式：

**Phase A — 竞标层（最小可行）**
- 保留现有 keywordRoute 作为 fallback
- 新增 bidding/protocol.py，先只在一个路由（如 "code"）上跑竞标
- 其他路由仍走旧逻辑
- 验证竞标是否比 keyword 匹配效果好

**Phase B — 审议层**
- 现有 consensus/vote.py 不改，新增 deliberation/session.py 做多轮包装
- 只在高风险操作（路由=consensus 时）启用审议
- 低风险任务继续单轮评分

**Phase C — 学习层**
- 等 agentmemory 里积累了 50+ 条 dispatch 记录后再启用
- 先只影响 confidence 微调，不直接影响路由选择

---

## 展望

这套协议做完后，ETO 的 Agent Network 将具备：

- **自选择**：Agent 自己判断接不接活，而不是被分配
- **自修正**：方案经同行审议修订，而不是单次评分
- **自进化**：路由偏好从历史成功中学习，而不是硬编码

实现"青色组织"的三个特征：自管理、完整性、进化目标。
