"""ETO MCP Server — 暴露 ETO 工具供 Claude Code / 其他 Agent 调用"""
import json, sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("eto", instructions="ETO 青色组织多 Agent 编排系统 - 共识评分 / 路由分析 / Peer 配置")

@mcp.tool(description="同侪共识评分：三阶段（评分→审议→终审），返回包含 status/final_score/votes/deliberation/actions 的 JSON")
def eto_consensus(plan: str, peers: list[str] | None = None) -> str:
    from eto.stitches.consensus.vote import peer_review
    result = peer_review(plan, peers or ["researcher", "coder", "auditor"])
    return json.dumps(result, ensure_ascii=False)

@mcp.tool(description="三镜路由：分析任务属于 knowledge/research/code/solution 并返回 direct/plan/consensus 路由")
def eto_route(task: str) -> str:
    t = task.lower()
    if any(k in t for k in ["delete", "remove", "deploy", "销毁", "删除", "部署"]):
        return json.dumps({"gewu": "solution", "route": "consensus", "confidence": 1.0, "layer": "keyword"})
    if any(k in t for k in ["研究", "调研", "分析", "报告", "research", "study"]):
        return json.dumps({"gewu": "research", "route": "plan", "confidence": 0.85, "layer": "keyword"})
    if any(k in t for k in ["写", "代码", "实现", "重构", "制作", "生成", "创建", "设计", "计划", "方案", "write", "code", "implement"]):
        return json.dumps({"gewu": "code", "route": "plan", "confidence": 0.85, "layer": "keyword"})
    if any(k in t for k in ["什么是", "是什么", "what is", "explain", "define"]):
        return json.dumps({"gewu": "knowledge", "route": "direct", "confidence": 0.9, "layer": "keyword"})
    return json.dumps({"gewu": "knowledge", "route": "direct", "confidence": 0.7, "layer": "keyword"})

@mcp.tool(description="读取 peer provider 配置（如有）")
def eto_peer_config() -> str:
    import os
    cfg = {"peers": {"default": {"provider": "ollama", "model": "qwen2.5-coder:7b"}}}
    config_path = Path(os.path.expanduser("~/.pi/eto-config.json"))
    if config_path.exists():
        try:
            data = json.loads(config_path.read_text("utf-8"))
            if "peers" in data:
                cfg["peers"] = data["peers"]
        except: pass
    return json.dumps(cfg, ensure_ascii=False)

@mcp.tool(description="写共享记忆 (pi-team-agents 兼容 KV)")
def eto_memory_write(key: str, value_json: str) -> str:
    """写入一条共享记忆，其他 Agent 可读取"""
    from eto.stitches.memory.shared_memory import write
    import json as _json
    try:
        value = _json.loads(value_json) if isinstance(value_json, str) else value_json
    except:
        value = {"text": value_json}
    write(key, value)
    return f"记忆 '{key}' 已写入"

@mcp.tool(description="读共享记忆")
def eto_memory_read(key: str) -> str:
    """读取一条共享记忆"""
    from eto.stitches.memory.shared_memory import read
    import json as _json
    val = read(key)
    return _json.dumps(val, ensure_ascii=False) if val else f"记忆 '{key}' 不存在"

@mcp.tool(description="列出共享记忆 key")
def eto_memory_list(pattern: str = "") -> str:
    """列出所有共享记忆 key"""
    from eto.stitches.memory.shared_memory import list_keys
    import json as _json
    keys = list_keys(pattern)
    return _json.dumps(keys, ensure_ascii=False)

@mcp.tool(description="检测任务指令是否模糊，返回澄清选项。任何 AI Agent 可调。")
def eto_clarify(task: str) -> str:
    from eto.stitches.quality.clarify import detect_vague
    import json as _json
    result = detect_vague(task)
    return _json.dumps(result or {"vague": False, "task": task}, ensure_ascii=False)

@mcp.tool(description="审查 sub-agent 返回结果，返回结构化摘要供确认。")
def eto_review(agent: str, result_json: str) -> str:
    from eto.stitches.quality.review import summarize_dispatch_result
    import json as _json
    result = _json.loads(result_json)
    return _json.dumps(summarize_dispatch_result(agent, result), ensure_ascii=False)

@mcp.tool(description="保存用户反馈为 routing 约束，下次 dispatch 自动注入。")
def eto_feedback(agent: str, constraint: str) -> str:
    from eto.stitches.quality.feedback import save_constraint
    import json as _json
    return _json.dumps(save_constraint(agent, constraint), ensure_ascii=False)

@mcp.tool(description="查询文件编辑状态，返回 {file, editor, ts}")
def eto_file_status(file: str) -> str:
    from eto.stitches.memory.shared_memory import file_status
    import json as _json
    result = file_status(file)
    return _json.dumps(result, ensure_ascii=False)

@mcp.tool(description="发布文件编辑状态（多 Agent 协调）")
def eto_file_update(file: str, editor: str = "default", file_hash: str = "") -> str:
    from eto.stitches.memory.shared_memory import file_update
    import json as _json
    return _json.dumps(file_update(file, editor, file_hash), ensure_ascii=False)

@mcp.tool(description="解除文件锁（编辑完成后调用）")
def eto_file_release(file: str) -> str:
    from eto.stitches.memory.shared_memory import file_release
    import json as _json
    return _json.dumps({"released": file_release(file)}, ensure_ascii=False)

@mcp.tool(description="执行一步 Agent 任务：把 task+system_prompt 路由到已配置的 peer provider（ollama/deepseek/claude/mcp），返回 {status, agent, output}；无可用 provider 时 status=failed 并给出原因，绝不返回空 ok")
def agent_execute(task: str, system: str = "", skills: list[str] | None = None, mcp_tools: list[str] | None = None, response_format: str = "") -> str:
    """LangGraph 工作流每步调用的执行入口。

    真实执行走 consensus/vote.py 的 peer provider 路由（复用 ~/.pi/eto-config.json
    的 ollama/deepseek/claude/mcp 配置），而不是让工作流自己吞掉空输出。
    provider 不可用/返回空时明确 status=failed + reason，调用方据此标 failed。
    """
    from eto.stitches.consensus.vote import _call_provider, _load_peer_config
    agent = "coder"  # 默认执行 peer；工作流按 step.agent 在 spec.params 里覆盖
    cfg = _load_peer_config().get(agent, {})
    provider = cfg.get("provider", "ollama")
    # mcp provider 的 "model" 参数承载完整 peer 配置 JSON（见 vote._call_provider）
    model = json.dumps(cfg, ensure_ascii=False) if provider == "mcp" else cfg.get("model", "")
    full_system = system or f"执行以下任务:\n{task}"
    if skills:
        full_system += "\n\n可用 skills: " + ", ".join(skills)
    if mcp_tools:
        full_system += "\n\n可用 MCP 工具: " + ", ".join(mcp_tools)
    try:
        output = _call_provider(provider, model, full_system, task)
    except Exception as e:
        return json.dumps({"status": "failed", "agent": agent, "output": "", "reason": f"provider {provider} 抛出异常: {e}"}, ensure_ascii=False)
    # A provider failure now travels as a marked string, not as "". Checking `not output` alone
    # would let the marker through as a normal `status: ok` output — the workflow would then record
    # a step whose entire "answer" is an error blob.
    from eto.stitches.consensus.vote import _FALLBACK_MARK, _parse_provider_error
    # `dsh` peer 在无宿主端点时回落本机模型：剥掉标记，别让内部前缀漏进工作流输出。
    if isinstance(output, str) and output.startswith(_FALLBACK_MARK):
        output = output[len(_FALLBACK_MARK):]
    failure = _parse_provider_error(output)
    if failure is not None:
        return json.dumps({"status": "failed", "agent": agent, "output": "",
                           "reason": f"provider {failure.get('provider')}/{failure.get('model')} 不可用: {failure.get('reason')}"}, ensure_ascii=False)
    if not output:
        return json.dumps({"status": "failed", "agent": agent, "output": "", "reason": f"provider {provider} 返回空输出（服务未启动或不可用）"}, ensure_ascii=False)
    return json.dumps({"status": "ok", "agent": agent, "output": output}, ensure_ascii=False)

def main():
    mcp.run(transport="stdio")

if __name__ == "__main__":
    main()
