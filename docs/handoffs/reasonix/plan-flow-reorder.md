# Plan: 重排流程 — 先 Raft 选协调员，再 LangGraph 编排

> 创建日期: 2026-07-04
> 基线: v0.1.8
> 来源: 审计发现 工作流路径没走 Raft 选举

---

## 现状

当前 plan 路由的流程：

```
design_workflow()    ← Agent 集体投票决定流程
  └── 多步 → execute_workflow()    ← LangGraph 执行
  └── 单步 → tryBidding() → execPlan()
                               └── electCoordinator(Raft)  ← 选举只在降级路径
                               └── peerConsensus
```

Raft 选举被 bypass 了——工作流路径直接让 Agent 们集体投票，没经过协调员。

## 目标流程

```
electCoordinator(Raft)     ← 先选协调员
  └── coordinator_design() ← 协调员独自设计工作流（不投票）
        └── 多步 → execute_workflow(LangGraph)
        └── 单步 → execPlan()  ← 此时已有协调员
```

## 改动

### 1. eto.ts — plan 路由重排

当前（~783-812 行）：

```typescript
if (route.route === "plan") {
    // 1. 先试工作流编排
    const wfResult = await callStitchAsync("bidding.workflow", "design_workflow", ...);
    // 2. 降级：竞标或关键词
    const bidResult = await tryBidding(task, route.gewu);
    const agents = bidResult ? [bidResult.winner] : matchAgentsForRoute(route.gewu);
    const plan = await execPlan(task, route);
```

改为：

```typescript
if (route.route === "plan") {
    // 1. 先选协调员（Raft）
    ctx.ui.notify(`🗳️ 选举协调员...`, "info");
    const candidates: [string, number][] = [
        ["researcher", route.gewu === "research" ? 0.9 : 0.5],
        ["coder", route.gewu === "code" ? 0.9 : 0.5],
        ["auditor", route.gewu === "solution" ? 0.9 : 0.5],
    ];
    const coordinator = await electCoordinator(candidates);
    ctx.ui.notify(`👤 协调员: ${coordinator}`, "info");

    // 2. 协调员设计工作流
    ctx.ui.notify(`📋 协调员编排中...`, "info");
    const wfResult = await callStitchAsync("bidding.workflow", "coordinator_design",
        JSON.stringify({ type: route.gewu, title: task, description: task, coordinator }),
        JSON.stringify(AGENT_PROFILES));

    let workflowSteps: any[] | null = null;
    if (wfResult && !("_error" in wfResult) && !(wfResult as any).fallback) {
        workflowSteps = (wfResult as any).steps as any[];
    }

    if (workflowSteps && workflowSteps.length > 1) {
        // 3a. 多步工作流 → LangGraph 执行
        const execResult = await callStitchAsync("bidding.workflow", "execute_workflow",
            JSON.stringify(wfResult), task);
        // ... 显示结果
        return { systemPrompt: `## ETO 工作流\n协调员: ${coordinator}\n...` };
    }

    // 3b. 单步 → 降级到 execPlan（已有协调员）
    ctx.ui.notify(`📝 执行中...`, "info");
    const agents = matchAgentsForRoute(route.gewu);
    const plan = await execPlan(task, route);
    // ...
```

### 2. workflow.py — 新增 coordinator_design()

将 `design_workflow()` 替换/拆分为 `coordinator_design()`：

```python
def coordinator_design(task_spec_json: str, profiles_json: str) -> str:
    """
    协调员设计工作流（不经过多 Agent 投票）。
    
    task_spec_json 含 coordinator 字段指明谁是协调员。
    协调员的角色 prompt 不同——以"你是指挥官"身份出计划。
    其他 Agent profile 作为资源池供协调员分配。
    """
    spec = json.loads(task_spec_json)
    profiles = json.loads(profiles_json)
    coordinator = spec.get("coordinator", "coder")
    
    # 构建协调员专属 prompt
    agent_pool = "\n".join(
        f"- {p['name']} ({p['label']}): 擅长{p.get('specialty','')} — {p.get('description','')}"
        for p in profiles
    )
    
    system = f"你是指挥官({coordinator})。根据任务和可用Agent，制定最优协作计划。输出JSON。"
    prompt = f"""任务: {spec.get('title','')}
描述: {spec.get('description','')}
类型: {spec.get('type','code')}

可用 Agent:
{agent_pool}

输出 JSON:
{{"workflow":"名称","steps":[
  {{"step":1,"agent":"agent名","description":"做什么","system_prompt":"给这个Agent的提示词","skills":[],"mcp_tools":[]}}
]}}
简单任务只输出 1 步。"""
    
    raw = _call_llm(system, prompt)
    parsed = _extract_json(raw) if raw else None
    if parsed and "steps" in parsed and len(parsed["steps"]) > 0:
        return json.dumps({"workflow": parsed.get("workflow", "auto"), "steps": parsed["steps"], "coordinator": coordinator, "fallback": False}, ensure_ascii=False)
    return json.dumps({"workflow": "direct", "steps": [], "coordinator": coordinator, "fallback": True}, ensure_ascii=False)
```

**改动原则：**
- ✅ 保留 `design_workflow()` 不动（将来可能其他场景用）
- ✅ 只新增 `coordinator_design()`
- ✅ LangGraph 执行部分（`build_graph` / `execute_workflow` / `_make_node_fn`）不变

---

## 改动文件

| 文件 | 改动 | 行数 |
|:-----|:------|:------|
| `eto/stitches/bidding/workflow.py` | 新增 `coordinator_design()` | ~30 行 |
| `eto/extensions/eto.ts` | plan 路由重排：先 electCoordinator → 再设计工作流 | ~15 行 |

---

## 验收

```bash
# 1. coordinator_design 存在
python -c "from eto.stitches.bidding.workflow import coordinator_design; print('OK')"

# 2. 协调员出计划
python -c "
from eto.stitches.bidding.workflow import coordinator_design
import json
r = json.loads(coordinator_design(
    json.dumps({'type':'code','title':'JWT登录','description':'实现登录API','coordinator':'coder'}),
    json.dumps([{'name':'researcher','label':'研究员','specialty':'research','description':'调研'},
                {'name':'coder','label':'编码员','specialty':'code','description':'编码'},
                {'name':'auditor','label':'审计员','specialty':'solution','description':'审计'}])))
print('coordinator:', r.get('coordinator'))
print('steps:', len(r.get('steps', [])))
"

# 3. 测试
python eto/stitches/test.py
```

| # | 检查项 | 方法 |
|:-:|:-------|:------|
| F-1 | plan 路由先显示"选举协调员" | notify 出现"🗳️ 选举协调员" |
| F-2 | 协调员 ID 传入 coordinator_design | 调用参数含 coordinator 字段 |
| F-3 | 工作流路径走 Raft 选举 | electCoordinator 在工作流之前 |
| F-4 | 设计工作流失败时降级 execPlan | fallback 处理 |
| F-5 | 17/17 测试 PASS | `python eto/stitches/test.py` |
