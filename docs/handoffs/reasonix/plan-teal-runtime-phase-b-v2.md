# Plan: Teal Runtime Phase B — LangGraph 多 Agent 工作流（替代 v1）

> 创建日期: 2026-07-04 | 发送者: Claude Code
> 接收者: Reasonix Code
> 基线: Phase A (竞标层) 完成
> 架构: `docs/teal-runtime-arch.md`
> 替代: `plan-teal-runtime-phase-b.md`（自写 workflow.py 方案取消）

---

## 原则

**不自写 workflow 引擎。** LangGraph 已经提供了状态图、条件边、循环、checkpoint。ETO 的工作流编排层只做两件事：

1. **设计图** — Agent 们共同决定"做什么、谁做、怎么做"
2. **配置图** — 把设计映射为 LangGraph StateGraph，每个 node 调 dispatch_with_spec

---

## 方案

### 总览

```
任务到达
  ↓
               ╔═══════════════════════════════════════╗
               ║     Phase 1: 工作流设计 Agent 投票    ║
               ║                                      ║
               ║  LLM coordinator 生成 2-3 种方案      ║
               ║  每个 Agent profile 独立评分方案       ║
               ║  每个 Agent 自选自己的 prompt/skills/  ║
               ║    tools                              ║
               ║  最高分方案胜出                       ║
               ╚═══════════════════════════════════════╝
                         ↓
               ╔═══════════════════════════════════════╗
               ║     Phase 2: 构建 LangGraph           ║
               ║                                      ║
               ║  设计方案 → StateGraph               ║
               ║  每个 step → 一个 node               ║
               ║  节点函数调 dispatch_with_spec       ║
               ║  条件边由 step 定义                   ║
               ╚═══════════════════════════════════════╝
                         ↓
               ╔═══════════════════════════════════════╗
               ║     Phase 3: LangGraph 执行           ║
               ║                                      ║
               ║  graph.invoke(state)                 ║
               ║  每步结果写 agentmemory              ║
               ╚═══════════════════════════════════════╝
```

### Phase 1: 工作流设计（Agent 投票）

每个候选 Agent **独立**做两件事：
- 给整体工作流方案评分（这个流程好不好？）
- 给自己负责的那一步选择 prompt/skills/tools（我怎么做？）

**数据流：**

```json
// 1. LLM coordinator 产出一组方案草案
{
  "proposals": [
    {
      "workflow": "调研→编码→审查",
      "steps": [
        {"assignee": "researcher", "description": "技术方案调研"},
        {"assignee": "coder", "description": "代码实现"},
        {"assignee": "auditor", "description": "安全审查"}
      ]
    },
    {
      "workflow": "编码→审查",
      "steps": [
        {"assignee": "coder", "description": "直接实现"},
        {"assignee": "auditor", "description": "审查"}
      ]
    }
  ]
}

// 2. 每个 Agent 对相关方案投票 + 自选配置
[
  {
    "agent": "coder",
    "proposal_index": 0,
    "vote": 0.85,
    "self_config": {
      "system_prompt": "你是一个Python后端工程师，实现REST API。",
      "skills": ["fastapi", "jwt"],
      "mcp_tools": ["write", "edit"]
    }
  },
  {
    "agent": "coder", 
    "proposal_index": 1,
    "vote": 0.7,
    "self_config": {
      "system_prompt": "快速实现，不需要调研。",
      "skills": ["fastapi"],
      "mcp_tools": ["write"]
    }
  }
]

// 3. 选标：按平均票数最高方案
{
  "winner": 0,
  "steps": [
    {
      "step": 1,
      "agent": "researcher",
      "system_prompt": "研究员的系统提示词",
      "skills": ["tech-research"],
      "mcp_tools": [],
      "condition": null
    },
    {
      "step": 2,
      "agent": "coder",
      "system_prompt": "coder 自选的提示词",
      "skills": ["fastapi", "jwt"],
      "mcp_tools": ["write", "edit"],
      "condition": null
    },
    {
      "step": 3,
      "agent": "auditor",
      "system_prompt": "auditor 自选的提示词", 
      "skills": ["security"],
      "mcp_tools": ["eto_consensus"],
      "condition": {
        "type": "retry",
        "max_retries": 2,
        "on_failure": "goto_step_2"
      }
    }
  ]
}
```

### Phase 2: 构建 LangGraph

从设计方案动态构建 LangGraph StateGraph：

```python
from typing import TypedDict, List, Literal
from langgraph.graph import StateGraph, END

class StepResult(TypedDict):
    agent: str
    status: str
    output: str
    retries: int

class WorkflowState(TypedDict):
    task: str
    task_type: str
    steps: list               # 设计方案中的 steps
    step_results: List[StepResult]
    current_step: int
    overall_status: str
    error: str

def build_graph(workflow_design: dict) -> StateGraph:
    """根据设计方案动态构建 LangGraph"""
    steps = workflow_design["steps"]
    graph = StateGraph(WorkflowState)
    
    # 为每个 step 创建一个 node
    for i, step in enumerate(steps):
        node_id = f"step_{i}_{step['agent']}"
        graph.add_node(node_id, _make_node_fn(step))
    
    # 添加边
    for i, step in enumerate(steps):
        node_id = f"step_{i}_{step['agent']}"
        if i == 0:
            graph.set_entry_point(node_id)
        if i < len(steps) - 1:
            next_id = f"step_{i+1}_{steps[i+1]['agent']}"
            # 如果有条件边（如 retry）
            if step.get("condition") and step["condition"]["type"] == "retry":
                graph.add_conditional_edges(
                    node_id,
                    _make_router(step["condition"], node_id, next_id),
                    {node_id: node_id, next_id: next_id, END: END}
                )
            else:
                graph.add_edge(node_id, next_id)
        else:
            graph.add_edge(node_id, END)
    
    return graph.compile()

def _make_node_fn(step: dict):
    """为每个 step 创建节点执行函数"""
    def node_fn(state: WorkflowState) -> WorkflowState:
        agent = step["agent"]
        system_prompt = step["system_prompt"]
        skills = step.get("skills", [])
        tools = step.get("mcp_tools", [])
        
        # 调 dispatch_with_spec
        try:
            from eto.stitches.mcp_dispatch import dispatch_with_spec
            import json
            spec = json.dumps({
                "server_cmd": ["python", "-m", "eto.mcp_server"],
                "tool": "agent_execute",
                "task": state["task"],
                "system_prompt": system_prompt,
                "skills": skills,
                "mcp_tools": tools,
            })
            result = dispatch_with_spec(spec)
            state["step_results"].append({
                "agent": agent,
                "status": "ok",
                "output": json.dumps(result, ensure_ascii=False)[:500] if result else "",
                "retries": 0,
            })
        except Exception as e:
            state["step_results"].append({
                "agent": agent, "status": "failed",
                "output": str(e), "retries": 0,
            })
        
        state["current_step"] += 1
        return state
    
    return node_fn

def _make_router(condition: dict, current_node: str, next_node: str):
    """创建条件边路由"""
    def router(state: WorkflowState) -> str:
        last = state["step_results"][-1] if state["step_results"] else {}
        if last.get("status") == "failed" and last.get("retries", 0) < condition.get("max_retries", 1):
            last["retries"] = last.get("retries", 0) + 1
            return current_node  # 重试
        if last.get("status") == "failed":
            return END  # 超过重试次数
        return next_node  # 正常进入下一步
    return router
```

### Phase 3: 执行

```python
def execute_workflow_design(workflow_design: dict, task: str) -> dict:
    """构建图 → 执行 → 返回结果"""
    graph = build_graph(workflow_design)
    initial = WorkflowState(
        task=task,
        task_type="code",
        steps=workflow_design["steps"],
        step_results=[],
        current_step=0,
        overall_status="running",
        error="",
    )
    final = graph.invoke(initial)
    success = all(r["status"] == "ok" for r in final["step_results"])
    return {"step_results": final["step_results"], "success": success}
```

---

## 改动文件

| 文件 | 改动 | 类型 |
|:-----|:------|:------|
| `eto/stitches/bidding/workflow.py` | 替换为 LangGraph 版本：Agent 投票设计方案 + 动态建图 + 执行 | 重写 |
| `pyproject.toml` | 添加 `langgraph>=0.2.0` 依赖 | 修改 |
| `eto/extensions/eto.ts` | plan 路由接入新的 workflow | 修改 |

### workflow.py 结构（~150 行）

```
workflow.py
├── generate_proposals()    — LLM 产出 2-3 个方案草案
├── vote_on_proposals()     — 每个 Agent 独立投票 + 自选配置
├── select_winner()         — 按平均票数选最优方案
├── build_graph()           — 方案 → LangGraph StateGraph
├── execute_workflow()      — invoke graph → 返回结果
└── _make_node_fn()         — node 工厂（调 dispatch_with_spec）
```

**投票接口：**

```python
def vote_on_proposals(proposals_json: str, profile_json: str) -> str:
    """
    单个 Agent 对方案投票 + 自选配置。
    
    proposals_json: {"proposals": [{"workflow":"...","steps":[...]}, ...]}
    profile_json: {"name":"coder","label":"编码员","specialty":"code"}
    
    返回: {"agent":"coder","votes":[{"proposal_index":0,"score":0.85,"self_config":{...}},...]}
    """
    # 用 LLM（角色扮演此 Agent）+ 历史 agentmemory 参考
    # 给每个方案打分 0-1，并为自己选 prompt/skills/tools
```

### eto.ts 改动

在 plan 路由中，当前竞标逻辑之前插入 workflow 尝试：

```typescript
// 1. 试 workflow 设计（多 Agent 投票决定流程）
const wfDesign = await callStitchAsync("bidding.workflow", "design_workflow",
    JSON.stringify({ type: route.gewu, title: task, description: task }),
    JSON.stringify(AGENT_PROFILES));

if (wfDesign && !("_error" in wfDesign) && wfDesign.winner >= 0) {
    // 有 workflow 方案 → 执行
    const wfResult = await callStitchAsync("bidding.workflow", "execute_workflow",
        JSON.stringify(wfDesign), task);
    // 显示结果...
    return { systemPrompt: `## 工作流执行结果\n...` };
}

// 2. 降级：竞标（原 Phase A 逻辑）
```

---

## 依赖

```bash
pip install langgraph
```

添加到 `pyproject.toml` `[project.dependencies]`：

```
langgraph>=0.2.0
```

验证安装：

```bash
python -c "from langgraph.graph import StateGraph; print('OK')"
```

---

## 验证

```bash
# 1. LangGraph 可用
python -c "from langgraph.graph import StateGraph; print('OK')"

# 2. 工作流设计（端到端）
python -c "
from eto.stitches.bidding.workflow import design_workflow
import json
profiles = json.dumps([
    {'name':'researcher','label':'研究员','specialty':'research','description':'调研'},
    {'name':'coder','label':'编码员','specialty':'code','description':'编码'},
    {'name':'auditor','label':'审计员','specialty':'solution','description':'审计'},
])
r = design_workflow('{\"type\":\"code\",\"title\":\"JWT登录\",\"description\":\"需要调研+实现+审查\"}', profiles)
r = json.loads(r)
print('方案数:', len(r.get('proposals', [])))
print('中标方案:', r.get('winner'))
print('步骤:', len(r.get('steps', [])))
"

# 3. stitch 测试
python eto/stitches/test.py
```

---

## 验收标准

| # | 检查项 | 方法 |
|---|--------|------|
| L-1 | `langgraph` 可用 | `from langgraph.graph import StateGraph` |
| L-2 | `generate_proposals()` 产出 ≥2 个方案 | 复杂任务测试 |
| L-3 | 每个 Agent 投票含 self_config | 投票含 system_prompt + skills + tools |
| L-4 | 工作流支持条件边（retry） | audit 失败 → 跳回 coder |
| L-5 | LangGraph 图可执行 | `graph.invoke()` 返回结果 |
| L-6 | eto.ts plan 路由优先 workflow | notify 出现"工作流" |
| L-7 | 17/17 stitch 测试 PASS | `python eto/stitches/test.py` |
