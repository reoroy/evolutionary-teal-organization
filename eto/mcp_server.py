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

def main():
    mcp.run(transport="stdio")

if __name__ == "__main__":
    main()
