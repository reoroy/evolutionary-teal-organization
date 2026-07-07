"""Teal Runtime: LangGraph 多 Agent 工作流 — 方案投票 + 动态建图 + dispatch"""
import json, sys
from pathlib import Path
from typing import TypedDict, List
from langgraph.graph import StateGraph, END
sys.stdout.reconfigure(encoding="utf-8")

OLLAMA_URL = "http://localhost:11434"
MODEL = "qwen2.5-coder:7b"

def _call_llm(system: str, prompt: str) -> str:
    import urllib.request
    data = json.dumps({"model": MODEL, "prompt": f"{system}\n\n{prompt}", "stream": False, "options": {"temperature": 0.3, "num_predict": 1024}}).encode("utf-8")
    req = urllib.request.Request(f"{OLLAMA_URL}/api/generate", data=data, headers={"Content-Type": "application/json"}, method="POST")
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

# ── Phase 1: 方案设计 + Agent 投票 ──────────────

def generate_proposals(task_spec_json: str, profiles_json: str) -> str:
    """LLM 产出 2-3 个方案草案"""
    task_spec = json.loads(task_spec_json)
    profiles = json.loads(profiles_json)
    title = task_spec.get("title", "")
    desc = task_spec.get("description", "")
    agent_list = "\n".join(f"- {p['name']} ({p['label']}): 擅长{p['specialty']}" for p in profiles)
    system = "你是一个项目协调员。设计2-3种不同的多Agent协作方案。输出JSON。"
    prompt = f"""任务: {title}
描述: {desc}
可用Agent:
{agent_list}
输出 JSON:
{{"proposals":[{{"workflow":"名称","steps":[{{"assignee":"agent名","description":"做什么"}}]}}]}}
至少2个方案，各有不同侧重点。"""
    raw = _call_llm(system, prompt)
    parsed = _extract_json(raw) if raw else None
    if parsed and "proposals" in parsed:
        return json.dumps(parsed, ensure_ascii=False)
    return json.dumps({"proposals": [{"workflow": "direct", "steps": [{"assignee": "coder", "description": title or desc}]}]})

def vote_on_proposals(proposals_json: str, profile_json: str) -> str:
    """单个 Agent 对方案投票 + 自选配置"""
    proposals = json.loads(proposals_json) if isinstance(proposals_json, str) else proposals_json
    profile = json.loads(profile_json) if isinstance(profile_json, str) else profile_json
    name = profile.get("name", "?")
    label = profile.get("label", "?")

    system = f"你是一个{label}({name})。评估以下方案中哪些步骤适合你。以JSON数组格式输出。"
    prompt_lines = [f"方案列表:"]
    for i, p in enumerate(proposals.get("proposals", [])):
        prompt_lines.append(f"\n方案{i}: {p.get('workflow','')}")
        for s in p.get("steps", []):
            prompt_lines.append(f"  - step: {s.get('description','')} → {s.get('assignee','')}")
    prompt_lines.append(f"\n输出JSON数组，每个元素对应一个方案的评分：")
    prompt_lines.append(f"[{{\"proposal_index\":0,\"score\":0-1,\"my_step\":\"你的角色名(空字符串表示没你)\",\"self_config\":{{\"system_prompt\":\"你自己选的提示词\",\"skills\":[],\"mcp_tools\":[]}}}}]")
    prompt_lines.append(f"如果你在方案中没有被分配步骤，score=0，my_step为空字符串。")

    raw = _call_llm(system, "\n".join(prompt_lines))
    parsed = _extract_json(raw) if raw else None
    if isinstance(parsed, dict):
        # LLM 有时返回 {"votes": [...]} 包装格式
        parsed = parsed.get("votes", parsed)
    if isinstance(parsed, list):
        for item in parsed:
            item["agent"] = name
        return json.dumps(parsed, ensure_ascii=False)
    return json.dumps([{"agent": name, "proposal_index": 0, "score": 0, "my_step": "", "self_config": {"system_prompt": "", "skills": [], "mcp_tools": []}}])

def design_workflow(task_spec_json: str, profiles_json: str) -> str:
    """完整工作流设计流程：出方案 → 各 Agent 投票 → 选标"""
    proposals_json = generate_proposals(task_spec_json, profiles_json)
    proposals = json.loads(proposals_json)

    # 各 Agent 独立投票（每个 Agent 返回数组，每个方案一条）
    raw_votes = []
    for profile in json.loads(profiles_json):
        v = json.loads(vote_on_proposals(proposals_json, json.dumps(profile)))
        if isinstance(v, list):
            raw_votes.extend(v)  # flat: [{agent,proposal_index,score,my_step,self_config}, ...]
        else:
            raw_votes.append(v)

    # 选标：统计每个方案的平均分
    num_proposals = len(proposals.get("proposals", []))
    proposal_scores = [0.0] * num_proposals
    proposal_counts = [0] * num_proposals
    for v in raw_votes:
        idx = v.get("proposal_index", 0)
        score = v.get("score", 0)
        if isinstance(score, (int, float)) and 0 <= idx < num_proposals:
            proposal_scores[idx] += score
            proposal_counts[idx] += 1
    winner_idx = 0
    best_avg = 0
    for i in range(num_proposals):
        avg = proposal_scores[i] / proposal_counts[i] if proposal_counts[i] > 0 else 0
        if avg > best_avg:
            best_avg = avg
            winner_idx = i

    # 合并 self_config：找到中标方案中每个 Agent 的自选配置
    config_by_agent = {}
    for v in raw_votes:
        if v.get("proposal_index") == winner_idx and v.get("my_step"):
            agent = v.get("my_step", "")
            sc = v.get("self_config", {})
            if agent and isinstance(sc, dict):
                config_by_agent[agent] = sc

    # 将 self_config 合并到中标方案的 step 中
    steps = proposals["proposals"][winner_idx]["steps"] if proposals["proposals"] else []
    enriched_steps = []
    for s in steps:
        assignee = s.get("assignee", "")
        cfg = config_by_agent.get(assignee, {})
        enriched_steps.append({
            "step": len(enriched_steps) + 1,
            "agent": assignee,
            "description": s.get("description", ""),
            "system_prompt": cfg.get("system_prompt", f"执行: {s.get('description','')}"),
            "skills": cfg.get("skills", []),
            "mcp_tools": cfg.get("mcp_tools", []),
            "condition": {"type": "retry", "max_retries": 1} if assignee == "auditor" else None,
        })

    return json.dumps({"proposals": proposals["proposals"], "votes": raw_votes, "winner": winner_idx, "steps": enriched_steps, "fallback": len(enriched_steps) == 0}, ensure_ascii=False)

# ── Phase 2 & 3: LangGraph 构建 + 执行 ──────────

class StepResult(TypedDict):
    agent: str
    status: str
    output: str
    retries: int

class WorkflowState(TypedDict):
    task: str
    task_type: str
    steps: list
    step_results: List[StepResult]
    current_step: int
    overall_status: str
    error: str

def _make_node_fn(step: dict):
    def node_fn(state: WorkflowState) -> WorkflowState:
        sp = step.get("system_prompt", "")
        from datetime import datetime
        import os, zoneinfo
        _tz = zoneinfo.ZoneInfo(os.environ.get("ETO_TIMEZONE", "Asia/Shanghai"))
        sp = f"当前时间: {datetime.now(_tz).strftime('%Y/%m/%d %H:%M:%S')}\n\n{sp}"
        skills = step.get("skills", [])
        tools = step.get("mcp_tools", [])

        # 只传上一步关键摘要（防上下文膨胀）
        prev = state.get("step_results", [])
        if prev:
            last = prev[-1]
            out = (last.get("output") or "")[:80]
            sp = f"[上一步 {last.get('agent','?')}]: {out}\n\n{sp}"

        try:
            from eto.stitches.mcp_dispatch import dispatch_with_spec
            spec = json.dumps({"server_cmd": ["python", "-m", "eto.mcp_server"], "tool": "agent_execute", "task": state["task"], "system_prompt": sp, "skills": skills, "mcp_tools": tools, "params": {}})
            result = dispatch_with_spec(spec)
            output = json.dumps(result, ensure_ascii=False)[:500] if result else ""
            state["step_results"].append({"agent": step["agent"], "status": "ok", "output": output, "retries": 0})

            # 写 shared_memory — 后续步骤/其他 Agent 可读
            try:
                from eto.stitches.memory.shared_memory import write as _write
                _write(f"wf_{id(state)}_{step.get('step',0)}_{step['agent']}", {"type": "workflow_step", "agent": step["agent"], "output": output, "step": step.get("step", 0), "task": state["task"]}, author="workflow")
            except: pass
        except Exception as e:
            state["step_results"].append({"agent": step["agent"], "status": "failed", "output": str(e), "retries": 0})
        state["current_step"] += 1
        return state
    return node_fn

def _make_router(condition: dict, current_node: str, next_node: str):
    def router(state: WorkflowState) -> str:
        last = state["step_results"][-1] if state["step_results"] else {}
        if last.get("status") == "failed" and last.get("retries", 0) < condition.get("max_retries", 1):
            last["retries"] = last.get("retries", 0) + 1
            return current_node
        if last.get("status") == "failed":
            return END
        return next_node
    return router

def build_graph(workflow_design: dict) -> StateGraph:
    steps = workflow_design["steps"]
    graph = StateGraph(WorkflowState)
    for i, step in enumerate(steps):
        graph.add_node(f"step_{i}", _make_node_fn(step))
    for i, step in enumerate(steps):
        nid = f"step_{i}"
        if i == 0:
            graph.set_entry_point(nid)
        if i < len(steps) - 1:
            nxt = f"step_{i+1}"
            cond = step.get("condition")
            if cond and cond["type"] == "retry":
                graph.add_conditional_edges(nid, _make_router(cond, nid, nxt), {nid: nid, nxt: nxt, END: END})
            else:
                graph.add_edge(nid, nxt)
        else:
            graph.add_edge(nid, END)
    return graph.compile()

def execute_workflow(workflow_design_json: str, task: str) -> str:
    wf = json.loads(workflow_design_json) if isinstance(workflow_design_json, str) else workflow_design_json
    graph = build_graph(wf)
    initial = WorkflowState(task=task, task_type="code", steps=wf["steps"], step_results=[], current_step=0, overall_status="running", error="")
    final = graph.invoke(initial)
    success = all(r["status"] == "ok" for r in final["step_results"])

    # 写工作流完成 summary 到 shared_memory
    try:
        from eto.stitches.memory.shared_memory import write as _write
        _write(f"wf_complete_{id(graph)}", {
            "type": "workflow_complete", "task": task,
            "total_steps": len(final["step_results"]), "success": success,
            "step_summary": [{"agent": r["agent"], "status": r["status"]} for r in final["step_results"]],
        }, author="workflow", ttl=86400)
    except: pass

    return json.dumps({"step_results": final["step_results"], "success": success, "total_steps": len(final["step_results"])}, ensure_ascii=False)

if __name__ == "__main__":
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
