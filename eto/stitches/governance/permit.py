"""Permission Binding — agent × operation 白名单（requirements FR-D3.1）

配置: ~/.eto/permit.json
{
  "default": "deny",
  "agents": {
    "coder":     ["agent_execute", "eto_*"],
    "researcher": ["*"]
  }
}

语义（安全相关，失败路径必须可定位，禁止静默）：
- 配置文件不存在 → 未启用权限绑定 → 放行（向后兼容：不配置不改变现有行为）。
- 配置文件存在 → 白名单语义，default 缺省为 "deny"（fail-closed）：
  - agent 未列出，且 default != "allow" → 拒绝；
  - 操作不匹配该 agent 的任何 pattern，且 default != "allow" → 拒绝。
- pattern 支持 "*" 整串通配与 "eto_*" 尾通配。
- 配置文件损坏 / agents 字段类型不对 → 拒绝并给出可定位原因（fail-closed）。
- 每次拒绝都向 stderr 输出一条 JSON 事件（验收要求：越权调用被拒且有日志）。
"""
import json, sys, time
sys.stdout.reconfigure(encoding="utf-8")


def _grants_path() -> str:
    from pathlib import Path
    return str(Path.home() / ".eto" / "permit.json")


def _log_event(event: str, **fields):
    """拒绝/异常必须留可观测日志（stderr JSON Lines），不许静默。"""
    payload = {"event": event, "ts": time.time()}
    payload.update(fields)
    print(json.dumps(payload, ensure_ascii=False), file=sys.stderr)


def _load_grants() -> dict | None:
    """读配置。返回 None 表示未配置；损坏时返回 {"_invalid": True, "message": ...}。"""
    from pathlib import Path
    p = Path.home() / ".eto" / "permit.json"
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("顶层必须是 JSON object")
        return data
    except Exception as e:
        return {"_invalid": True, "message": f"permit 配置解析失败 ({p}): {e}"}


def _op_matches(pattern, operation: str) -> bool:
    if not isinstance(pattern, str):
        return False
    if pattern == "*":
        return True
    if pattern.endswith("*"):
        return operation.startswith(pattern[:-1])
    return pattern == operation


def check(agent: str, operation: str) -> dict:
    """检查 agent 是否被允许执行 operation。返回 {"allowed": bool, "reason": str}。

    拒绝时 reason 必须可定位：指出谁、想做什么、配置在哪、允许什么。
    """
    grants = _load_grants()
    if grants is None:
        return {"allowed": True, "reason": "permit 未配置（~/.eto/permit.json 不存在），默认放行", "unconfigured": True}
    if grants.get("_invalid"):
        return {"allowed": False, "reason": f"permit denied: 配置不可用（fail-closed）→ {grants['message']}"}

    default_policy = str(grants.get("default", "deny")).lower()
    agents = grants.get("agents", {})
    if not isinstance(agents, dict):
        return {"allowed": False,
                "reason": f"permit denied: 配置 {_grants_path()} 的 agents 字段必须是 object（{{\"agent名\": [\"操作\", ...]}}）"}

    patterns = agents.get(agent)
    if patterns is None:
        if default_policy == "allow":
            return {"allowed": True, "reason": f"agent '{agent}' 未列白名单，default=allow 放行"}
        listed = ", ".join(sorted(str(a) for a in agents)) or "(白名单为空)"
        return {"allowed": False,
                "reason": (f"permit denied: agent '{agent}' 不在白名单；"
                           f"想执行操作 '{operation}'；配置 {_grants_path()}；"
                           f"已列出的 agent: {listed}；"
                           f"修复：在 agents[\"{agent}\"] 里加操作白名单，或改 default=allow")}

    if not isinstance(patterns, list):
        return {"allowed": False,
                "reason": f"permit denied: 配置 {_grants_path()} 中 agents[\"{agent}\"] 必须是数组（当前类型 {type(patterns).__name__}）"}

    if any(_op_matches(p, operation) for p in patterns):
        return {"allowed": True, "reason": f"agent '{agent}' 允许操作 '{operation}'（匹配白名单）"}

    if default_policy == "allow":
        return {"allowed": True, "reason": f"操作 '{operation}' 不在 agent '{agent}' 白名单，default=allow 放行"}
    return {"allowed": False,
            "reason": (f"permit denied: agent '{agent}' 不允许操作 '{operation}'；"
                       f"该 agent 允许: {', '.join(map(str, patterns))}；"
                       f"配置 {_grants_path()}；"
                       f"修复：往 agents[\"{agent}\"] 里加 '{operation}' 或 '*'")}


def authorize_spec(spec: dict) -> dict:
    """dispatch_spec 级检查：agent=spec["agent"]，operation=spec["tool"]。

    spec 缺 agent 字段且已启用权限绑定 → 拒绝（身份不明不允许放行）。
    """
    if not isinstance(spec, dict):
        return {"allowed": False, "reason": "permit denied: dispatch spec 不是 object，无法鉴权"}
    agent = (spec.get("agent") or "").strip()
    operation = (spec.get("tool") or "").strip()
    if not agent:
        if _load_grants() is None:
            return {"allowed": True, "reason": "permit 未配置，默认放行", "unconfigured": True}
        return {"allowed": False,
                "reason": (f"permit denied: dispatch spec 缺 agent 字段，无法鉴权"
                           f"（已启用权限绑定 {_grants_path()}，身份不明的调用一律拒绝）；"
                           f"修复：dispatch 侧构造 spec 时写入 agent 名")}
    return check(agent, operation)


def log_denial(spec: dict, reason: str):
    """拒绝事件日志：谁、想调什么工具、为什么被拒。"""
    _log_event("permit_denied",
               agent=(spec or {}).get("agent", "") if isinstance(spec, dict) else "",
               tool=(spec or {}).get("tool", "") if isinstance(spec, dict) else "",
               task_id=(spec or {}).get("task_id", "") if isinstance(spec, dict) else "",
               reason=reason)


def get_grants() -> dict:
    """读取当前配置（未配置返回 {"unconfigured": True}）。"""
    grants = _load_grants()
    if grants is None:
        return {"unconfigured": True}
    if grants.get("_invalid"):
        return {"_error": True, "message": grants["message"]}
    return grants


def set_grants(grants_json: str) -> dict:
    """写入配置（供测试/CLI 使用）。坏 JSON 返回 _error，不落盘。"""
    from pathlib import Path
    try:
        data = json.loads(grants_json) if isinstance(grants_json, str) else grants_json
        if not isinstance(data, dict):
            raise ValueError("顶层必须是 JSON object")
    except Exception as e:
        return {"_error": True, "message": f"set_grants: 配置必须是 JSON object → {e}"}
    p = Path.home() / ".eto" / "permit.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")
    _log_event("permit_grants_updated", path=str(p))
    return {"saved": True, "path": str(p)}


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
