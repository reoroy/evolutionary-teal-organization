# Plan: Teal Runtime Phase B — 多 Agent 工作流编排

> 创建日期: 2026-07-04 | 发送者: Claude Code
> 接收者: Reasonix Code
> 基线: Phase A (竞标层) 完成
> 架构: `docs/teal-runtime-arch.md`

---

## 现状

Phase A 让 Agent 竞标任务，但中标后所有工作由单个 Agent 完成：

```
Task → 竞标 → coder 中标 → coder 用固定 prompt 干全部活
```

但很多任务天然需要多角色协作——调研 + 编码 + 审查。当前流程不会自动产生协作计划。

## 方案

新增工作流编排层：LLM 根据任务描述 + 可用 Agent Profile，生成多步协作计划，然后用现有 dispatch_spec 逐条执行。

```
                    ┌──────────────────────────────────┐
                    │   generate_workflow()            │
                    │   (LLM + Agent profiles)         │
                    └──────────┬───────────────────────┘
                               ↓
                    Workflow Plan (JSON)
                    ┌─────────────────────┐
                    │ Step 1: researcher  │ ← dispatch_spec(research_prompt, skills...)
                    │ Step 2: coder       │ ← dispatch_spec(code_prompt, tools...)
                    │ Step 3: auditor     │ ← dispatch_spec(audit_prompt...)
                    └─────────────────────┘
                               ↓
                    execute_workflow() via existing dispatch_with_spec
```

### 1. 工作流计划格式

```json
{
  "workflow": "调研→实现→审查",
  "task": "实现用户登录 API",
  "steps": [
    {
      "step": 1,
      "agent": "researcher",
      "description": "调研 JWT 认证方案",
      "system_prompt": "你是一个研究员。调研 JWT 认证的最佳实践，输出技术方案文档。",
      "params": { "task": "JWT 认证方案调研" }
    },
    {
      "step": 2,
      "agent": "coder",
      "description": "实现登录 API",
      "system_prompt": "你是一个编码员。按研究员的方案实现登录 API。",
      "skills": ["rest-api"],
      "params": { "task": "实现 POST /api/login" }
    },
    {
      "step": 3,
      "agent": "auditor",
      "description": "安全审查",
      "system_prompt": "你是一个审计员。审查登录 API 的安全性。",
      "mcp_tools": ["eto_consensus"],
      "params": { "task": "安全审查登录 API", "plan": "审查实现代码" }
    }
  ]
}
```

### 2. workflow.py — 新增 `eto/stitches/bidding/workflow.py`

```python
"""Teal Runtime: 多 Agent 工作流编排"""

import json, sys
from pathlib import Path

OLLAMA_URL = "http://localhost:11434"
MODEL = "qwen2.5-coder:7b"

def _call_llm(system: str, prompt: str) -> str:
    """调 Ollama 生成回复"""
    import urllib.request
    data = json.dumps({"model": MODEL, "prompt": f"{system}\n\n{prompt}",
        "stream": False, "options": {"temperature": 0.3, "num_predict": 1024}}).encode("utf-8")
    req = urllib.request.Request(f"{OLLAMA_URL}/api/generate", data=data,
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8")).get("response", "").strip()
    except: return ""

def _extract_json(text: str) -> dict | None:
    import re
    for m in re.finditer(r'```(?:json)?\s*\n?(.*?)\n?```', text, re.DOTALL):
        try: return json.loads(m.group(1).strip())
        except: pass
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        try: return json.loads(text[start:end+1])
        except: pass
    return None


def generate_workflow(task_spec_json: str, profiles_json: str) -> str:
    """
    LLM 生成多 Agent 协作计划。

    task_spec_json: {"type":"code","title":"实现登录API","description":"需要调研+编码+审查"}
    profiles_json: [{"name":"coder","label":"编码员","specialty":"code","description":"..."}, ...]

    返回: {"workflow":"...", "steps":[...], "fallback":false}
          或 {"workflow":"direct","steps":[{"agent":"coder",...}], "fallback":true}  ← LLM 不可用时
    """
    task_spec = json.loads(task_spec_json)
    profiles = json.loads(profiles_json)
    title = task_spec.get("title", "")
    desc = task_spec.get("description", "")
    task_type = task_spec.get("type", "code")

    # 构建 Agent 能力列表
    agent_list = "\n".join(
        f"- {p.get('name')} ({p.get('label')}): 擅长{p.get('specialty')} — {p.get('description', '')}"
        for p in profiles
    )

    system = "你是一个项目协调员。根据任务和可用Agent，设计最优的多Agent协作流程。每个步骤指定由谁做什么。输出JSON。"

    prompt = f"""任务: {title}
描述: {desc}
类型: {task_type}

可用 Agent:
{agent_list}

请设计协作计划。考虑：
1. 什么任务需要多步协作（调研→实现→审查）？
2. 什么任务单 Agent 就能完成？
3. 每步用什么提示词最合适？

输出 JSON 格式:
{{"workflow":"简短名称","steps":[
  {{"step":1,"agent":"agent名","description":"做什么","system_prompt":"给这个Agent的提示词"}},
  ...
]}}

如果是简单任务只需要一个 Agent, steps 数组只放一项。"""

    raw = _call_llm(system, prompt)
    parsed = _extract_json(raw) if raw else None

    if parsed and "steps" in parsed and len(parsed["steps"]) > 0:
        return json.dumps({
            "workflow": parsed.get("workflow", "auto"),
            "steps": parsed["steps"],
            "fallback": False,
        }, ensure_ascii=False)

    # LLM 不可用 → 简单降级：单 Agent 完成全部
    return json.dumps({
        "workflow": "direct",
        "steps": [{"step": 1, "agent": "coder", "description": title or task_type,
            "system_prompt": f"执行以下任务:\n{title}\n{desc}"}],
        "fallback": True,
    }, ensure_ascii=False)


def execute_workflow(workflow_json: str) -> str:
    """
    执行工作流：逐条 dispatch 到对应 Agent。

    workflow_json: {"workflow":"...","steps":[...]}
    返回: {"workflow":"...","step_results":[...],"total_steps":N}
    """
    wf = json.loads(workflow_json)
    steps = wf.get("steps", [])
    results = []

    for step in steps:
        agent = step.get("agent", "coder")
        system_prompt = step.get("system_prompt", f"执行步骤 {step.get('step')}")
        params = step.get("params", {})
        task = params.get("task", "") or step.get("description", "")

        # 用现有 dispatch 机制执行
        step_result = _dispatch_step(agent, system_prompt, task)
        results.append({
            "step": step.get("step"),
            "agent": agent,
            "status": "ok" if step_result else "failed",
            "output": (step_result or "")[:500],
        })

    return json.dumps({
        "workflow": wf.get("workflow", "auto"),
        "step_results": results,
        "total_steps": len(results),
        "success": all(r["status"] == "ok" for r in results),
    }, ensure_ascii=False)


def _dispatch_step(agent: str, system_prompt: str, task: str) -> str | None:
    """
    向单个 Agent 派发任务。
    根据 Agent 名称从 MCP config 找 endpoint，走 dispatch_with_spec。
    找不到 MCP endpoint 时返回 None（调用方处理降级）。
    """
    # 读 peer config
    config_path = Path.home() / ".pi" / "eto-config.json"
    if not config_path.exists():
        return None
    try:
        config = json.loads(config_path.read_text("utf-8"))
        peer_cfg = config.get("peers", {}).get(agent)
        if not peer_cfg or peer_cfg.get("provider") != "mcp":
            return None
        from eto.stitches.mcp_dispatch import dispatch_with_spec
        spec = json.dumps({
            "server_cmd": peer_cfg.get("mcp_server", []),
            "tool": peer_cfg.get("mcp_tool", "agent_execute"),
            "task": task,
            "system_prompt": system_prompt,
            "params": {},
        })
        result = dispatch_with_spec(spec)
        return json.dumps(result, ensure_ascii=False)
    except:
        return None


if __name__ == "__main__":
    """Pi stitch 入口"""
    data = json.loads(sys.stdin.read())
    fn = data.get("fn")
    args = data.get("args", [])
    func = globals().get(fn)
    if func:
        try:
            result = func(*args)
            print(result if isinstance(result, str) else json.dumps(result, ensure_ascii=False))
        except Exception as e:
            print(json.dumps({"_error": True, "message": str(e)}))
    else:
        print(json.dumps({"_error": True, "message": f"unknown fn: {fn}"}))
```

### 3. eto.ts — 在 plan 路由接入 workflow

在 `before_agent_start` 的 plan 路由段（当前 ~746 行），当前逻辑：

```typescript
if (route.route === "plan") {
    ctx.ui.notify(`📝 竞标中...`, "info");
    const bidResult = await tryBidding(task, route.gewu);
    const agents = bidResult ? [bidResult.winner] : matchAgentsForRoute(route.gewu);
```

改为：

```typescript
if (route.route === "plan") {
    // 1. 先试工作流编排（多步协作计划）
    ctx.ui.notify(`📋 工作流编排中...`, "info");
    const wfResult = await callStitchAsync("bidding.workflow", "generate_workflow",
        JSON.stringify({ type: route.gewu, title: task, description: task }),
        JSON.stringify(AGENT_PROFILES.map(p => ({
            name: p.name, label: p.label, specialty: p.specialty, description: p.description, weights: p.weights,
        }))));
    
    let workflowSteps: any[] | null = null;
    if (wfResult && !("_error" in wfResult) && !wfResult.fallback) {
        workflowSteps = (wfResult as any).steps as any[];
        ctx.ui.notify(`🔄 工作流: ${(wfResult as any).workflow || "auto"} (${workflowSteps.length} 步)`, "info");
    }

    // 2. 有 workflow → 逐条 dispatch；否则竞标/关键词
    if (workflowSteps && workflowSteps.length > 1) {
        // 多步 workflow 执行
        const execResult = await callStitchAsync("bidding.workflow", "execute_workflow", JSON.stringify(wfResult));
        const exec = execResult as any;
        const stepLines = (exec?.step_results || []).map((r: any, i: number) =>
            `  >> Step ${i+1} (${r.agent}): ${r.status}`
        ).join("\n");
        ctx.ui.notify(`✅ 工作流完成 (${exec?.total_steps || 0} 步):\n${stepLines}`, "info");
        // inject system prompt — 显示结果，不做事
        return { systemPrompt: `## ETO 工作流执行结果\n${stepLines}\n\n请向用户汇报结果。` };
    }

    // 3. 降级：单 Agent 竞标或关键词匹配（原逻辑）
    ctx.ui.notify(`📝 竞标中...`, "info");
    const bidResult = await tryBidding(task, route.gewu);
    const agents = bidResult ? [bidResult.winner] : matchAgentsForRoute(route.gewu);
    const bidSuffix = bidResult ? ` (竞标 ${(bidResult.confidence * 100).toFixed(0)}%)` : " (关键词降级)";
```

**关键逻辑：**

| 条件 | 走哪条路 |
|:-----|:---------|
| workflow 生成成功 + 多步 | 走 workflow 编排 |
| workflow 生成失败/单步 | 降级到竞标 → 关键词匹配 |
| 没有 MCP peer | `_dispatch_step` 返回 null → `execute_workflow` 标记 failed |

---

## 改动文件

| 文件 | 改动 | 类型 |
|:-----|:------|:------|
| `eto/stitches/bidding/workflow.py` | `generate_workflow()` + `execute_workflow()` + `_dispatch_step()` | 新建 |
| `eto/extensions/eto.ts` | plan 路由优先 workflow，降级竞标 | 修改 |

### 不做

- ❌ 不改 consensus/vote.py
- ❌ 不改 election/elect.py
- ❌ 不改 mcp_dispatch.py（直接用现有 dispatch_with_spec）
- ❌ 不改 mcp_server.py

---

## 验证

```bash
# 1. generate_workflow 生成计划
python -c "
from eto.stitches.bidding.workflow import generate_workflow
import json
profiles = json.dumps([
    {'name':'researcher','label':'研究员','specialty':'research','description':'知识调研','weights':{'research':0.9}},
    {'name':'coder','label':'编码员','specialty':'code','description':'代码实现','weights':{'code':0.95}},
    {'name':'auditor','label':'审计员','specialty':'solution','description':'质量审查','weights':{'solution':0.9}},
])
r = generate_workflow(json.dumps({'type':'code','title':'实现登录API','description':'需要调研JWT+编码+安全审查'}), profiles)
print(r[:500])
"

# 2. 简单任务应生成单步计划
python -c "
from eto.stitches.bidding.workflow import generate_workflow
r = generate_workflow('{\"type\":\"knowledge\",\"title\":\"什么是Rust\",\"description\":\"简单问答\"}', '[{\"name\":\"researcher\",\"label\":\"研究员\",\"specialty\":\"research\",\"description\":\"\",\"weights\":{}}]')
print('单步:', 'steps' in r)
"

# 3. LLM 不可用时降级
python -c "
from eto.stitches.bidding.workflow import generate_workflow
r = generate_workflow('{\"type\":\"unknown\"}', '[]')
print('降级:', 'fallback' in r)
"

# 4. stitch 测试
python eto/stitches/test.py
```

---

## 验收标准

| # | 检查项 | 方法 |
|---|--------|------|
| W-1 | `generate_workflow()` 返回有效 workflow JSON | steps 数组非空 |
| W-2 | 复杂任务生成多步计划（≥2 steps） | 调研+编码类任务验证 |
| W-3 | 简单任务生成 1 步计划 | 知识问答类验证 |
| W-4 | LLM 不可用时降级单步 | fallback=true |
| W-5 | `execute_workflow()` 返回 step_results | 结果含每步状态 |
| W-6 | eto.ts plan 路由显示工作流信息 | notify 出现"工作流"字样 |
| W-7 | 17/17 stitch 测试 PASS | `python eto/stitches/test.py` |
