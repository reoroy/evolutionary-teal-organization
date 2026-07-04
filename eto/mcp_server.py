"""ETO MCP Server — 暴露核心功能给其他 Agent（Claude Code / Reasonix 等）调用

启动：python -m eto.mcp_server
注册到 .mcp.json 后，Claude Code 可直接调 ETO 工具。
"""
import json, sys

def _run_consensus(plan: str, peers: list[str] | None = None) -> str:
    from eto.stitches.consensus.vote import peer_review
    return json.dumps(peer_review(plan, peers or ["researcher", "coder", "auditor"]), ensure_ascii=False)

def _run_route(task: str) -> str:
    """三镜路由 — 从 eto.ts 复用的简化版关键词路由"""
    task_lower = task.lower()
    research_kw = ["什么是", "研究", "分析", "调研", "调查", "research", "analysis", "study"]
    code_kw = ["写", "实现", "编码", "开发", "bug", "修复", "重构", "code", "implement", "fix", "refactor"]
    highrisk_kw = ["删除", "部署", "销毁", "rm -rf", "drop", "delete.*database", "生产环境"]
    gewu = "knowledge"
    if any(k in task_lower for k in highrisk_kw):
        return json.dumps({"gewu": "solution", "route": "consensus", "coordinator": "auditor"})
    if any(k in task_lower for k in code_kw):
        gewu = "code"
    elif any(k in task_lower for k in research_kw):
        gewu = "research"
    route = "plan" if any(k in task_lower for k in ["写", "实现", "implement", "create", "build"]) else "direct"
    coordinator = "coder" if gewu == "code" else "researcher"
    return json.dumps({"gewu": gewu, "route": route, "coordinator": coordinator})

MCP_TOOLS = {
    "eto_consensus": {"fn": _run_consensus, "desc": "同侪共识评分（三阶段：评分→审议→终审）。参数: plan(str), peers(list[str]|null)"},
    "eto_route": {"fn": _run_route, "desc": "三镜路由：分析任务分类。参数: task(str)"},
}

if __name__ == "__main__":
    """MCP stdio 协议: 从 stdin 读 JSON-RPC，写 stdout"""
    import sys
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        msg_id = msg.get("id")
        method = msg.get("method", "")
        params = msg.get("params", {})

        if method == "initialize":
            print(json.dumps({"jsonrpc": "2.0", "id": msg_id, "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "eto", "version": "0.5.0"}
            }}), flush=True)
        elif method == "tools/list":
            tools = [{"name": k, "description": v["desc"],
                      "inputSchema": {"type": "object", "properties": {
                          "plan" if "plan" in v["desc"] else "task": {"type": "string"}
                      }, "required": ["plan" if "plan" in v["desc"] else "task"]}}
                     for k, v in MCP_TOOLS.items()]
            print(json.dumps({"jsonrpc": "2.0", "id": msg_id, "result": {"tools": tools}}), flush=True)
        elif method == "tools/call":
            tool_name = params.get("name", "")
            args = params.get("arguments", {})
            tool = MCP_TOOLS.get(tool_name)
            if tool:
                try:
                    result = tool["fn"](**args)
                    print(json.dumps({"jsonrpc": "2.0", "id": msg_id, "result": {
                        "content": [{"type": "text", "text": result}]
                    }}), flush=True)
                except Exception as e:
                    print(json.dumps({"jsonrpc": "2.0", "id": msg_id, "error": {
                        "code": -32603, "message": str(e)
                    }}), flush=True)
            else:
                print(json.dumps({"jsonrpc": "2.0", "id": msg_id, "error": {
                    "code": -32601, "message": f"未知工具: {tool_name}"
                }}), flush=True)
        elif method == "notifications/initialized":
            pass  # 忽略
        else:
            print(json.dumps({"jsonrpc": "2.0", "id": msg_id, "error": {
                "code": -32601, "message": f"不支持的方法: {method}"
            }}), flush=True)
