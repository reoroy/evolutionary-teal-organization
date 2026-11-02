"""Feedback Loop — 用户反馈沉淀为 routing 约束（存 shared_memory）"""
import json, sys, time
sys.stdout.reconfigure(encoding="utf-8")

CONSTRAINTS_KEY = "routing:constraints"

def _log_skip(reason: str, spec: dict | None = None):
    """约束注入被跳过时留下可观测的痕迹（issue #1 P0-6：不许静默）"""
    payload = {"event": "constraints_skipped", "reason": reason, "ts": time.time()}
    if spec is not None:
        payload["tool"] = spec.get("tool", "")
    print(json.dumps(payload, ensure_ascii=False), file=sys.stderr)

def save_constraint(agent: str, constraint: str) -> dict:
    """写入 routing 约束到 shared_memory"""
    if not (agent or "").strip():
        return {"_error": True, "message": "save_constraint: agent 名不能为空，约束无处归属"}
    from eto.stitches.memory.shared_memory import write, read
    existing = read(CONSTRAINTS_KEY) or []
    entry = {"agent": agent, "constraint": constraint, "ts": time.time()}
    existing.append(entry)
    write(CONSTRAINTS_KEY, existing, author="feedback")
    return {"saved": True, "agent": agent, "constraint": constraint}

def get_constraints(agent: str) -> list[str]:
    """读取该 Agent 的所有约束"""
    from eto.stitches.memory.shared_memory import read
    all_c = read(CONSTRAINTS_KEY) or []
    return [c["constraint"] for c in all_c if c.get("agent") == agent]

def inject_constraints(spec: dict) -> dict:
    """将约束注入 dispatch_spec 的 system_prompt。

    agent 名以 spec["agent"] 为准（由 dispatch 侧显式传入，eto.ts
    tryDispatchToMCPAgent / bidding workflow 构造 spec 时写入）；
    不再从 tool 名反推——tool 恒为 agent_execute 时反推结果必是空串，
    约束永远注入不到（issue #1 P0-6）。
    """
    agent = (spec.get("agent") or "").strip() if isinstance(spec, dict) else ""
    if not agent:
        _log_skip("missing agent field", spec if isinstance(spec, dict) else None)
        return spec
    constraints = get_constraints(agent)
    if constraints:
        sp = spec.get("system_prompt", "") or ""
        sp += "\n\n**用户历史反馈约束：**\n" + "\n".join(f"- {c}" for c in constraints)
        spec["system_prompt"] = sp
    return spec

if __name__ == "__main__":
    data = json.loads(sys.stdin.read())
    fn = data.get("fn")
    args = data.get("args", [])
    func = globals().get(fn)
    if func:
        result = func(*args)
        print(json.dumps(result, ensure_ascii=False))
    else:
        print(json.dumps({"_error": True, "message": f"unknown fn: {fn}"}))
