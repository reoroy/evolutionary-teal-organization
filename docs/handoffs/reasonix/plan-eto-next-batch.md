# Plan: ETO 下一批功能 — 并行执行 + 能力路由 + 故障转移 + 自动学习

> 创建日期: 2026-07-08
> 基线: v0.1.8
> 来源: 代码评审——Phase 2/3 之间待实现的 4 项高价值功能

---

## 任务总览

| # | 功能 | 类型 | 优先级 | 估计 |
|:-:|:-----|:-----|:-------|:-----|
| 1 | **Parallel 模式** — Plan 子任务并行执行 | 快速 | P0 | ~30 行 |
| 2 | **按能力路由** — embedding 匹配取代 hardcode 角色 | 核心 | P0 | ~80 行 |
| 3 | **超时自动重路由** — Agent 故障转移 | 可靠 | P0 | ~60 行 |
| 4 | **自动学习 + 知识蒸馏** — 踩坑记教训，执行历史提炼 skill | 进化 | P1 | ~120 行 |

**执行顺序：** 1 → 2 → 3 → 4，每个完成后可单独验证。

---

## 1. Parallel 模式

### 现状

Plan 执行引擎只支持 `direct`（单步）和 `sequential`（串行多步，depends_on 链）。LangGraph 原生支持 Parallel 分支，但 Plan JSON 没有 `parallel` 类型，执行器也没做并行分支。

### 改动

### 1a. Plan JSON schema 扩展

在 `stitches/comms/a2a.py` 的 Plan 结构中增加 `parallel` 模式：

```python
# 现有类型: direct, sequential
# 新增:
{
  "mode": "parallel",
  "steps": [
    {"id": "research", "agent": "researcher", "task": "调研需求"},
    {"id": "design",   "agent": "coder",      "task": "设计架构"}
  ],
  "join": "synthesize",  # 可选：全部完成后调哪个 Agent 汇总
  "depends_on": []
}
```

### 1b. 执行引擎添加 parallel 分支

在 `a2a.py` 的 `execute_plan()` 中，Plan 循环处加 parallel case：

```python
if step.mode == "parallel":
    # 并行执行所有子步骤
    results = await asyncio.gather(*[
        execute_step(s, plan_context)
        for s in step.steps
    ])
    # 如果有 join 步骤，把结果聚合后调 join Agent
    if step.join:
        context = {"parallel_results": {s.id: r for s, r in zip(step.steps, results)}}
        final = await execute_step({"agent": step.join, "task": "汇总"}, context)
```

利用 `asyncio.gather` 实现——Python 原生支持，零依赖。

### 1c. Coordinator 生成 parallel Plan

在 `workflow.py` 的 `coordinator_design()` 中，当多个子步骤无依赖关系时，prompt 指示生成 `parallel` 模式：

```
当子步骤之间无依赖关系时，使用 mode: "parallel" 替代 sequential。
例如"调研 asyncio + 设计 UI"，两个子任务互不依赖 → parallel。
```

### 验收

```
Input: "同时调研 FastAPI 和写一个 Hello World demo"
Output: Plan 含 parallel 步骤，执行时间 ≈ max(t调研, t写) 而非 t调研 + t写
```

---

## 2. 按能力路由（embedding 匹配）

### 现状

当前路由是 hardcode 角色 + Gewu 分类映射：

```typescript
// eto.ts — matchAgentsForRoute()
if (gewu === "code") agents = ["coder"];
else if (gewu === "research") agents = ["researcher"];
```

Agent 池也不能动态扩展——新 Agent 加不进路由。

### 改动

### 2a. Agent 能力声明

每个 Agent profile 增加 `capabilities` 字段 + embedding 向量（启动时一次性生成）：

```json
{
  "id": "coder-1",
  "platform": "pi",
  "capabilities": ["coding", "debugging", "code_review", "rust", "python"],
  "cap_embedding": [0.12, -0.33, ...],  // 启动时由 embedding 模型生成
  "status": "online",
  "load": 0.3,
  "success_rate": 0.92
}
```

### 2b. 嵌入匹配函数

新增 `stitches/routing/capability_matcher.py`：

```python
import numpy as np

def match_capabilities(task_embedding: list[float], agents: list[dict], top_k: int = 3) -> list[dict]:
    """按 embedding 余弦相似度 × 成功率 × (1 - 负载) 排序"""
    scores = []
    for a in agents:
        cos_sim = cosine_similarity(task_embedding, a["cap_embedding"])
        score = cos_sim * a.get("success_rate", 0.5) * (1 - a.get("load", 0))
        scores.append({"agent": a, "score": score})
    return sorted(scores, key=lambda x: -x["score"])[:top_k]
```

embedding 模型用 `BGE-M3`（已装，568M，本地可跑）或直接复用已有的 embedding 服务。

### 2c. 路由层对接

在 `eto.ts` 的三镜路由输出后：

```typescript
// 旧: const agents = matchAgentsForRoute(route.gewu);
// 新:
const taskEmbedding = await getEmbedding(task);
const candidates = await callStitchAsync(
  "routing", "match_capabilities",
  JSON.stringify(taskEmbedding),
  JSON.stringify(registry.agents)
);
const agents = candidates.slice(0, 3).map(c => c.agent.id);
```

**降级：** embedding 服务不可用时 fallback 到旧的 hardcode 角色路由。

### 验收

```
新 Agent "db-expert" 注册，声明 capabilities: ["sql", "database", "query"]。
输入"优化这个 SQL 查询" → 路由优先选 db-expert 而非 coder。
```

---

## 3. 超时自动重路由

### 现状

Agent 超时或崩溃后，任务直接失败——没有备用 Agent 顶上。

### 改动

### 3a. Registry 心跳超时标记

在 `extensions/eto.ts` 的 Registry 心跳更新处，增加超时检查：

```typescript
// 每次心跳更新后检查
const now = Date.now();
for (const [id, agent] of registry.agents) {
  if (agent.status === "online" && (now - agent.lastSeen) > 30000) {
    agent.status = "timeout";
    ctx.ui.notify(`⚠️ Agent ${id} 心跳超时，标记下线`, "warn");
  }
}
```

### 3b. 执行引擎超时 + 重试

在 `a2a.py` 的 `execute_step()` 中：

```python
async def execute_step(step, context, retry_count=0):
    agent = find_agent(step["agent"])
    if not agent or agent.status == "timeout":
        # 找替补
        fallback = find_fallback(step["task"], exclude=[step["agent"]])
        if fallback:
            step["agent"] = fallback.id
            ctx.ui.notify(f"🔄 {step['agent']} 超时，转给 {fallback.id}")
            return await execute_step(step, context)  # 无 retry 计数：新 Agent 重新试
    
    try:
        result = await asyncio.wait_for(
            call_agent(agent, step["task"]), timeout=15.0)
        return result
    except asyncio.TimeoutError:
        if retry_count < 2:
            fallback = find_fallback(step["task"], exclude=[step["agent"]])
            if fallback:
                step["agent"] = fallback.id
                return await execute_step(step, context, retry_count + 1)
        raise
```

### 3c. Fallback 策略

`find_fallback()` 复用 2c 的 `capability_matcher`，排除已失败的 Agent，从候选列表中选下一个。

### 验收

```
启动两个 Agent：coder-1（在线）、coder-2（在线）。
发任务 → coder-1 被选 → 手动 kill coder-1 → 15s 内自动切换 coder-2 继续执行。
```

---

## 4. 自动学习 + 知识蒸馏

### 现状

ETO 没有从执行历史中学习的能力——每次路由/选举都是"无记忆"地从头决策。

### 改动

### 4a. 失败模式记录

在 `shared_memory.py` 添加自动记录：

```python
# 共识/执行完成后自动调用
def record_outcome(task_type: str, route: str, success: bool,
                   error: str = "", agents: list[str] = None):
    """记录执行结果到 agentmemory"""
    memory_save({
        "type": "eto_outcome",
        "task_type": task_type,
        "route": route,
        "success": success,
        "error": error[:200],
        "agents": agents or [],
        "timestamp": datetime.now().isoformat()
    })
```

### 4b. 踩坑自动学习

在 `record_outcome` 中，当 `success=False` 且 error 含特定模式时：

```python
# 记录"坑"到 agentmemory，标记为 lesson
def record_lesson(task: str, error: str, resolution: str):
    """踩坑记录——未来类似任务自动注入"""
    memory_save({
        "type": "eto_lesson",
        "trigger_pattern": extract_keywords(task),
        "error": error,
        "resolution": resolution,
        "count": 1,
        "promoted": False
    })
    
    # 同类错误出现 3 次 → 自动升级为智子规则
    similar = memory_recall(f"eto_lesson {extract_keywords(error)}", limit=10)
    if sum(1 for s in similar if s.get("error") == error) >= 3:
        promote_to_sentinel_rule(error, resolution)  # 自动生成智子规则
```

### 4c. 知识蒸馏（执行历史 → skill）

新增 `stitches/learning/distill.py`：

```python
async def distill_skill(execution_history: list[dict]) -> str | None:
    """从执行历史中提炼可复用的 skill"""
    # 条件：同类型任务执行 ≥ 5 次，成功率 > 80%
    # 动作：调 LLM 总结通用模式 → 生成 SKILL.md → 写入 ~/.eto/skills/
    # 输出：skill 名称（或 None 如果还不够材料）
```

触发机制：每次 `record_outcome` 后检查，或每 10 次执行批量跑一次。

### 4d. context_block 注入 lessons

在 `context_block()` 中增加 lessons 注入：

```python
# 每次路由前，查 related lessons
lessons = memory_recall(f"eto_lesson {task_keywords}", limit=3)
if lessons:
    prompt_context += "\n## 历史教训\n" + "\n".join(
        f"- ❌ {l['error']} → ✅ {l['resolution']}" for l in lessons
    )
```

### 验收

```
1. 共识拒绝了某个操作 → 记录失败
2. 同样操作被拒绝 3 次 → 自动生成智子规则
3. 10 次同类任务成功 → 自动生成 skill 文件
4. 新任务触发时，相关历史教训自动注入 prompt
```

---

## 执行顺序

```
第 1 步 (并行 30min):  parallel 模式 → a2a.py + workflow.py
         ↓
第 2 步 (并行 60min):  按能力路由 → capability_matcher.py + eto.ts
         ↓
第 3 步 (并行 45min):  超时重路由 → eto.ts + a2a.py
         ↓
第 4 步 (并行 90min):  自动学习 + 知识蒸馏 → shared_memory.py + distill.py + eto.ts
```

每步完成后可单独验证。1 → 2 之间有依赖（重路由需要能力匹配的 fallback），其他可调整顺序。

---

## 不改动的文件

| 文件 | 原因 |
|:-----|:------|
| `install.sh` / `install.cmd` / `install.ps1` | 不涉及依赖变更 |
| `Makefile` | 不涉及发布流程 |
| `docs/` 下非 plan 的文档 | 功能完成后统一更新 |
| `cli.py` (eto-mesh) | 暂不涉及 |