"""Teal Runtime: Agent 竞标协议 — 每个 Agent 用 LLM 自评匹配度"""
import json, sys, time
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent

# ── 集体回顾权重调整（FR-E1.4/E1.5 的下游消费）──
# reflection.py 把策略调整写入 shared_memory（collective_reflection:weights），
# 竞标降级路径读它：weights 查表值被回顾调整覆盖。读失败 → 不调整（竞标行为不变）。

def _reflection_adjustments() -> dict:
    """读取集体回顾产出的策略权重调整 {agent: {task_type: new_weight}}"""
    try:
        root = str(_REPO_ROOT)
        if root not in sys.path:
            sys.path.insert(0, root)
        from eto.stitches.memory.shared_memory import read as _read
        entry = _read("collective_reflection:weights") or {}
        adj = entry.get("adjustments", {})
        return adj if isinstance(adj, dict) else {}
    except Exception:
        return {}

def _apply_adjustment(profile: dict) -> dict:
    """把回顾调整应用到 profile 的 weights 副本上（不改入参、不改文件）"""
    adj = _reflection_adjustments()
    agent_adj = adj.get(profile.get("name", ""), {})
    if not agent_adj or not isinstance(agent_adj, dict):
        return profile
    weights = profile.get("weights", {})
    if not isinstance(weights, dict):
        return profile
    p = dict(profile)
    p["weights"] = {**weights, **{k: v for k, v in agent_adj.items() if isinstance(v, (int, float))}}
    return p


# ── LLM 调用（复用 stitch 的 provider 机制）──
OLLAMA_URL = "http://localhost:11434"
MODEL = "qwen2.5-coder:7b"

def _call_llm(system: str, prompt: str) -> str:
    """调 Ollama 生成回复"""
    import urllib.request
    full = f"{system}\n\n{prompt}"
    data = json.dumps({"model": MODEL, "prompt": full, "stream": False,
        "options": {"temperature": 0.2, "num_predict": 256}}).encode("utf-8")
    req = urllib.request.Request(f"{OLLAMA_URL}/api/generate", data=data,
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
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

def run_bidding(task_spec_json: str, profiles_json: str) -> str:
    """
    竞标流程编排。
    task_spec_json: {"type":"code","title":"登录API","description":"..."}
    profiles_json: [{"name":"coder","specialty":"code","label":"编码员","weights":{...}},...]
    返回: {"winner":{profile},"confidence":0.85,"bids":[...],"fallback":boolean}
    """
    task_spec = json.loads(task_spec_json)
    profiles = json.loads(profiles_json)
    # 集体回顾的策略权重调整先行应用（LLM 不可用的 weights 降级路径随之生效）
    profiles = [_apply_adjustment(p) if isinstance(p, dict) else p for p in profiles]
    task_title = task_spec.get("title", "")
    task_desc = task_spec.get("description", "")
    task_type = task_spec.get("type", "code")

    bids = []
    for profile in profiles:
        bid = _evaluate_profile(profile, task_title, task_desc, task_type)
        if bid["confidence"] >= 0.3:
            bids.append(bid)

    if not bids:
        winner = _fallback_select(profiles, task_type)
        return json.dumps({"winner": winner, "confidence": 0.5, "bids": [], "fallback": True}, ensure_ascii=False)

    winner = _select_winner(bids, task_spec)
    return json.dumps({"winner": winner["profile"], "confidence": winner["confidence"],
                        "bids": bids, "fallback": False}, ensure_ascii=False)


def _evaluate_profile(profile: dict, title: str, desc: str, task_type: str) -> dict:
    """
    Agent 用 LLM 自评：看任务描述，自己决定合不合适。
    输出 JSON: {"confidence": 0-1, "reason": "..."}
    走 LLM 失败时降级到 weights 查表。
    """
    label = profile.get("label", profile.get("name", "?"))
    specialty = profile.get("specialty", "")
    weights = profile.get("weights", {})
    base_score = weights.get(task_type, 0) if isinstance(weights, dict) else 0

    system = f"你是一个{label}，擅长{specialty}。评估以下任务你的匹配度。只输出JSON。"
    prompt = f"任务: {title}\n描述: {desc}\n\n输出JSON: {{\"confidence\": 0.0-1.0, \"reason\": \"\"}}"

    raw = _call_llm(system, prompt)
    parsed = _extract_json(raw) if raw else None

    if parsed:
        llm_conf = float(parsed.get("confidence", base_score))
        confidence = min(max(llm_conf, 0), 1)
        reason = parsed.get("reason", "")[:200]
    else:
        # LLM 失败 → 降级到 weights
        confidence = base_score
        reason = f"LLM不可用, weights={base_score}"

    return {
        "agent_id": profile.get("name", "?"),
        "profile": profile,
        "confidence": round(confidence, 2),
        "reason": reason,
        "source": "llm" if parsed else "weights",
    }


def _select_winner(bids: list, task_spec: dict) -> dict:
    """选标评分：confidence 降序"""
    sorted_bids = sorted(bids, key=lambda b: -b["confidence"])
    winner = dict(sorted_bids[0])
    winner["score"] = winner["confidence"]
    return winner


def _fallback_select(profiles: list, task_type: str) -> dict:
    """无人竞标时降级：取 weight 最高"""
    scored = [(p, p.get("weights", {}).get(task_type, 0) if isinstance(p.get("weights"), dict) else 0) for p in profiles]
    scored.sort(key=lambda x: -x[1])
    return scored[0][0] if scored else profiles[0]


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
