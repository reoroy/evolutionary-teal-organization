"""ETO Stitch: 分发任务到 MCP Agent"""
import json, sys
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")

def dispatch(server_cmd_json: str, tool: str, task: str) -> dict:
    import sys as _sys
    _sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
    from eto.mcp_client import sync_call_mcp
    cmd = json.loads(server_cmd_json)
    result = sync_call_mcp(cmd, tool, {"task": task, "system": f"执行以下任务:\n{task}"})
    return result or {}

if __name__ == "__main__":
    data = json.loads(sys.stdin.read())
    fn = data.get("fn")
    args = data.get("args", [])
    func = globals().get(fn)
    if func:
        try:
            result = func(*args)
            print(json.dumps(result, ensure_ascii=False))
        except Exception as e:
            print(json.dumps({"_error": True, "message": str(e)}))
    else:
        print(json.dumps({"_error": True, "message": f"未知函数: {fn}"}))
