"""Mock MCP Server for tests — 暴露一个 agent_review 工具，返回固定评分。

用真实 MCP stdio 协议（FastMCP）实现，用来验证 vote.py 的
`provider: "mcp"` peer 能真的拿到非空评分（issue #15 / issue #1 P0-5）。

协议细节（FastMCP JSONRPC over stdio）：
- server 端：`python tests/mock_agent_mcp_server.py`（本目录）
- client 端：`eto/mcp_client.py` 的 sync_call_mcp
"""

import json
import sys


def main() -> None:
    # 极简 JSONRPC over stdio: 每行一个请求，回一行响应。
    # 不依赖 mcp 包，任何 Python >= 3.10 都能跑（CI demo job 不装第三方包）。
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue
        method = req.get("method", "")
        req_id = req.get("id")
        if method == "initialize":
            resp = {
                "jsonrpc": "2.0", "id": req_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "mock-agent", "version": "0.1.0"},
                },
            }
        elif method == "notifications/initialized":
            continue  # 通知不回包
        elif method == "tools/list":
            resp = {
                "jsonrpc": "2.0", "id": req_id,
                "result": {
                    "tools": [{
                        "name": "agent_review",
                        "description": "peer 评分 mock 工具",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "system": {"type": "string"},
                                "prompt": {"type": "string"},
                            },
                        },
                    }]
                },
            }
        elif method == "tools/call":
            params = req.get("params", {})
            if params.get("name") != "agent_review":
                resp = _error_resp(req_id, -32602, f"unknown tool: {params.get('name')}")
            else:
                args = params.get("arguments", {})
                prompt = args.get("prompt", "")
                # 固定评分：只在 prompt 非空时给分，模拟真实 peer 行为
                score = 0.88 if prompt else 0.0
                resp = {
                    "jsonrpc": "2.0", "id": req_id,
                    "result": {
                        "content": [{"type": "text", "text": json.dumps({
                            "score": score,
                            "concern": "mock concern",
                            "suggestion": "mock suggestion",
                        }, ensure_ascii=False)}],
                        "isError": False,
                    },
                }
        elif method == "ping":
            resp = {"jsonrpc": "2.0", "id": req_id, "result": {}}
        else:
            resp = _error_resp(req_id, -32601, f"method not found: {method}")
        sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def _error_resp(req_id, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


if __name__ == "__main__":
    main()
