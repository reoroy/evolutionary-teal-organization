"""ETO Stitch: 分发任务到 MCP Agent

治理门（requirements FR-D3）在真正的 dispatch 路径上强制执行：
- permit: agent × tool 白名单，越权直接拒绝并留日志；
- budget: task_id 级工具调用次数帽，超限拒绝并留日志。
两者任一拒绝时返回 {"_error": True, "_governance": True, "code": ...,
"message": 可定位原因}，绝不静默截断或降级放行。
"""
import json, sys
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")

def _governance_denied(spec: dict, kind: str, code: str, reason: str) -> dict:
    """治理拒绝：统一错误形状 + stderr 日志（可定位，不静默）。"""
    payload = {"event": "governance_denied", "kind": kind, "code": code, "reason": reason,
               "agent": (spec or {}).get("agent", ""), "tool": (spec or {}).get("tool", ""),
               "task_id": (spec or {}).get("task_id", "")}
    print(json.dumps(payload, ensure_ascii=False), file=sys.stderr)
    return {"_error": True, "_governance": True, "code": code, "message": reason}

def _apply_governance(spec: dict) -> dict | None:
    """dispatch 前治理检查。返回 None 表示放行，否则返回拒绝结果。"""
    # stitch 入口以脚本方式运行时 sys.path[0] 是 eto/stitches/，
    # 先补上仓库根目录才能 import eto.*（与下方 dispatch 体内的做法一致）
    _root = str(Path(__file__).resolve().parent.parent.parent)
    if _root not in sys.path:
        sys.path.insert(0, _root)
    try:
        from eto.stitches.governance import permit
        verdict = permit.authorize_spec(spec)
        if not verdict.get("allowed"):
            return _governance_denied(spec, "permit", "PERMIT_DENIED", verdict.get("reason", ""))
    except Exception as e:
        return _governance_denied(spec, "permit", "PERMIT_ERROR",
                                  f"permit 检查异常（fail-closed）: {type(e).__name__}: {e}")
    try:
        from eto.stitches.governance import budget
        verdict = budget.authorize_spec(spec)
        if not verdict.get("allowed"):
            return _governance_denied(spec, "budget", "BUDGET_EXCEEDED", verdict.get("reason", ""))
    except Exception as e:
        return _governance_denied(spec, "budget", "BUDGET_ERROR",
                                  f"budget 检查异常（fail-closed）: {type(e).__name__}: {e}")
    return None

def dispatch(server_cmd_json: str, tool: str, task: str) -> dict:
    import sys as _sys
    _sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
    from eto.mcp_client import sync_call_mcp
    cmd = json.loads(server_cmd_json)
    result = sync_call_mcp(cmd, tool, {"task": task, "system": f"执行以下任务:\n{task}"})
    return result or {}

def dispatch_with_spec(spec_json: str) -> dict:
    """完整 dispatch_spec 调度：支持自定义 system_prompt/skills/mcp_tools/response_format/timeout

    治理门在工具调用之前执行（FR-D3 要求真实 dispatch 路径强制）。
    """
    spec = json.loads(spec_json)
    # ── 治理门：权限绑定 + 任务预算（先于一切实际调用）──
    denied = _apply_governance(spec)
    if denied is not None:
        return denied
    server_cmd = spec.get("server_cmd", [])
    tool = spec.get("tool", "agent_execute")
    task = spec.get("task", "")
    args = {"task": task}
    if spec.get("system_prompt"):
        args["system"] = spec["system_prompt"]
    else:
        args["system"] = f"执行以下任务:\n{task}"
    if spec.get("skills"):
        args["skills"] = spec["skills"]
    if spec.get("mcp_tools"):
        args["mcp_tools"] = spec["mcp_tools"]
    if spec.get("response_format"):
        args["response_format"] = spec["response_format"]
    if spec.get("params"):
        args.update(spec["params"])
    # 注入历史反馈约束（按 spec["agent"] 匹配；缺失时 feedback 侧记录并跳过）
    try:
        from eto.stitches.quality.feedback import inject_constraints
        spec = inject_constraints(spec)
        if spec.get("system_prompt"):
            args["system"] = spec["system_prompt"]
    except Exception as e:
        print(json.dumps({"event": "inject_constraints_failed", "error": str(e)}), file=sys.stderr)
    import sys as _sys
    _sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
    from eto.mcp_client import sync_call_mcp
    result = sync_call_mcp(server_cmd, tool, args)
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
