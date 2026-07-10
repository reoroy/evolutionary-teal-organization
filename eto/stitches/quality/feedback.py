"""Feedback Loop — 用户反馈沉淀为 routing 约束（存 shared_memory）"""
import json, sys, time
sys.stdout.reconfigure(encoding="utf-8")

CONSTRAINTS_KEY = "routing:constraints"

def save_constraint(agent: str, constraint: str) -> dict:
    """写入 routing 约束到 shared_memory"""
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
    """将约束注入 dispatch_spec 的 system_prompt"""
    agent = spec.get("tool", "").replace("agent_execute", "")
    constraints = get_constraints(agent)
    if constraints:
        sp = spec.get("system_prompt", "")
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
