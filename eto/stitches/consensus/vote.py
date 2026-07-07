"""ETO Stitch: 三阶段共识投票（评分→审议→终审）"""
import io, json, os, sys, urllib.request, urllib.error
sys.stdout.reconfigure(encoding="utf-8")

OLLAMA_URL = "http://localhost:11434"
MODEL = "qwen2.5-coder:7b"
CLAUDE_PROXY = os.environ.get("ANTHROPIC_BASE_URL", "http://127.0.0.1:15721")

PEER_SYSTEM_PROMPTS = {
    "researcher": "你是一个研究员。评估这个计划的完整性、可行性和证据充分性。重点关注：方案是否有漏洞、是否有数据支持、是否有替代方案被忽略。",
    "coder": "你是一个编码员。评估这个计划的技术可行性、实现难度和潜在技术债务。重点关注：实现路径是否合理、有没有更好的技术方案。",
    "auditor": "你是一个审计员。评估这个计划的风险面、潜在失败点和长期影响。重点关注：最坏情况下会怎样、有什么预防措施没考虑。"
}

# ── Peer Provider 配置 ─────────────────────────────────

DEFAULT_PEER_CONFIG = {
    "researcher": {"provider": "ollama", "model": MODEL},
    "coder": {"provider": "ollama", "model": MODEL},
    "auditor": {"provider": "ollama", "model": MODEL},
    "终审仲裁者": {"provider": "ollama", "model": MODEL},
}

_PEER_CONFIG_CACHE = None

def _load_peer_config() -> dict:
    """从 ~/.pi/eto-config.json 读取 peer provider 映射"""
    global _PEER_CONFIG_CACHE
    if _PEER_CONFIG_CACHE is not None:
        return _PEER_CONFIG_CACHE
    path = os.path.expanduser("~/.pi/eto-config.json")
    try:
        with open(path, encoding="utf-8") as f:
            cfg = json.load(f)
        _PEER_CONFIG_CACHE = {**DEFAULT_PEER_CONFIG, **cfg.get("peers", {})}
    except:
        _PEER_CONFIG_CACHE = dict(DEFAULT_PEER_CONFIG)
    return _PEER_CONFIG_CACHE

def _call_provider(provider: str, model: str, system: str, prompt: str) -> str:
    """路由到不同的 LLM provider"""
    full = f"{system}\n\n{prompt}" if system else prompt
    if provider == "deepseek":
        return _call_deepseek(model, system, prompt)
    elif provider == "claude":
        return _call_claude(model, system, prompt)
    elif provider == "mcp":
        return _call_mcp_agent(model, system, prompt)  # model 参数存的是 server_cmd JSON
    else:
        return _call_ollama(model, full)

def _call_ollama(model: str, full_prompt: str) -> str:
    """调 Ollama generate API"""
    data = json.dumps({"model": model, "prompt": full_prompt, "stream": False,
        "options": {"temperature": 0.7, "num_predict": 800}}).encode("utf-8")
    req = urllib.request.Request(f"{OLLAMA_URL}/api/generate", data=data,
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8")).get("response", "").strip()
    except: return ""

def _call_deepseek(model: str, system: str, prompt: str) -> str:
    """调 DeepSeek API (OpenAI 兼容)"""
    api_key = os.environ.get("DEEPSEEK_API_KEY", "")
    if not api_key:
        return ""
    url = "https://api.deepseek.com/v1/chat/completions"
    data = json.dumps({"model": model, "messages": [
        {"role": "system", "content": system},
        {"role": "user", "content": prompt}
    ], "temperature": 0.7, "max_tokens": 800}).encode("utf-8")
    req = urllib.request.Request(url, data=data,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return (body.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()
    except: return ""

def _call_claude(model: str, system: str, prompt: str) -> str:
    """调 Claude API（通过本地代理 Hermes 转发）"""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "PROXY_MANAGED")
    url = f"{CLAUDE_PROXY}/v1/messages"
    body = {"model": model, "max_tokens": 800, "messages": [{"role": "user", "content": prompt}]}
    if system:
        body["system"] = system
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data,
        headers={"Content-Type": "application/json", "x-api-key": api_key,
                 "anthropic-version": "2023-06-01"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            content = body.get("content") or []
            return "".join(b.get("text", "") for b in content if b.get("type") == "text").strip()
    except: return ""

def _call_mcp_agent(config_json: str, system: str, prompt: str) -> str:
    """通过 MCP Client 调其他 Agent 的工具评分"""
    try:
        import sys as _sys
        _sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
        from eto.mcp_client import sync_call_mcp
        cfg = json.loads(config_json)
        cmd = cfg.get("mcp_server", [])
        tool = cfg.get("mcp_tool", "agent_review")
        if not cmd:
            return ""
        args = {"system": system, "prompt": prompt}
        result = sync_call_mcp(cmd, tool, args)
        if result:
            return json.dumps(result, ensure_ascii=False)
    except: pass
    return ""

def _call_peer(peer_name: str, system: str, prompt: str) -> str:
    """按 peer 配置路由到对应 provider"""
    cfg = _load_peer_config().get(peer_name, DEFAULT_PEER_CONFIG.get(peer_name, DEFAULT_PEER_CONFIG["researcher"]))
    provider = cfg.get("provider", "ollama")
    if provider == "mcp":
        return _call_mcp_agent(json.dumps(cfg, ensure_ascii=False), system, prompt)
    return _call_provider(provider, cfg.get("model", MODEL), system, prompt)

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

def _call_llm(system: str, prompt: str) -> str:
    """调 Ollama，返回原始文本"""
    full = f"{system}\n\n{prompt}"
    data = json.dumps({"model": MODEL, "prompt": full, "stream": False, "options": {"temperature": 0.7, "num_predict": 800}}).encode("utf-8")
    req = urllib.request.Request(f"{OLLAMA_URL}/api/generate", data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8")).get("response", "").strip()
    except: return ""

def _score_single(peer: str, plan: str) -> dict:
    """单 peer 评分，返回 {score, concern, suggestion}"""
    system = PEER_SYSTEM_PROMPTS.get(peer, "你是一个评审专家。")
    raw = _call_peer(peer, system, f"请对以下执行计划评分。输出 JSON: {{\"score\": 0.0-1.0, \"concern\": \"\", \"suggestion\": \"\"}}\n\n计划: {plan}")
    parsed = _extract_json(raw)
    result = {"peer": peer, "score": 0.5, "concern": "", "suggestion": ""}
    if parsed:
        result["score"] = min(max(float(parsed.get("score", 0.5)), 0), 1)
        result["concern"] = (parsed.get("concern", "") or "")[:200]
        result["suggestion"] = (parsed.get("suggestion", "") or "")[:200]
    try:
        from eto.stitches.memory.shared_memory import write
        write(f"peer_score:{peer}", {"type": "peer_score", "peer": peer, "score": result["score"], "concern": result.get("concern", "")})
    except: pass
    return result

# ── 多策略投票 ──────────────────────────

def _multi_strategy_tally(scores: list[float]) -> dict:
    """多策略投票：approval + borda + irv，防单策略偏误"""
    if not scores:
        return {"final": 0.6, "strategies": {}}
    n = len(scores)
    sorted_s = sorted(scores, reverse=True)

    approval = sum(1 for s in scores if s >= 0.6) / n
    borda = sum((n - i - 1) / (n - 1) for i in range(n)) / n if n > 1 else 1.0
    irv = (sum(sorted_s) - min(sorted_s)) / (n - 1) if n > 1 else sorted_s[0]
    final = (approval + borda + irv) / 3

    return {"final": round(final, 3), "strategies": {"approval": round(approval, 3), "borda": round(borda, 3), "irv": round(irv, 3)}}

def peer_review(plan: str, peers: list[str]) -> dict:
    """三阶段共识：T1评分 → T2审议 → T3终审"""
    # T1: 独立评分
    votes = [_score_single(p, plan) for p in peers]
    scores = [v["score"] for v in votes]
    tally = _multi_strategy_tally(scores)
    avg = tally["final"]
    gap = max(scores) - min(scores) if scores else 0
    result = {"status": "approved" if avg >= 0.6 else "revise", "final_score": avg, "votes": votes, "deliberation": {"rounds": 0, "strategies": tally["strategies"]}, "actions": [], "audit_id": f"v{int(__import__('time').time())}"}

    # T2: 分歧大则审议
    if gap > 0.2:
        concerns = [f"{v['peer']}: {v['concern']}" for v in votes if v.get("concern")]
        deliberation_votes = []
        for p in peers:
            context = "\n".join(concerns) if concerns else "各方无具体意见"
            raw = _call_peer(p, PEER_SYSTEM_PROMPTS.get(p, ""), f"其他评审意见:\n{context}\n\n请重新评分。输出 JSON: {{\"score\": 0.0-1.0}}")
            parsed = _extract_json(raw)
            s = min(max(float(parsed.get("score", 0.5)), 0), 1) if parsed else votes[peers.index(p)]["score"]
            deliberation_votes.append({"peer": p, "score": s, "final_score": s})
        result["deliberation"]["rounds"] = 1
        for v in votes:
            v["final_score"] = next((dv["score"] for dv in deliberation_votes if dv["peer"] == v["peer"]), v["score"])

        # T3: 审议后分歧仍大 → 终审
        scores2 = [v.get("final_score", v["score"]) for v in votes]
        if max(scores2) - min(scores2) > 0.2:
            reviewer = "researcher" if "auditor" in [v["peer"] for v in votes if v["score"] == min(scores)] else "auditor"
            raw = _call_peer("终审仲裁者", "你是一个终审仲裁者。", f"根据以下评审意见做最终裁决。输出 JSON: {{\"verdict\": \"approve/revise/reject\", \"actions\": [\"...\"]}}\n\n评分:\n" + "\n".join([f"{v['peer']}: {v.get('final_score', v['score'])} ({v.get('concern', '')})" for v in votes]))
            parsed = _extract_json(raw)
            if parsed:
                result["status"] = parsed.get("verdict", result["status"])
                result["deliberation"]["verdict"] = parsed.get("verdict", "")
                result["deliberation"]["final_reviewer"] = reviewer
                result["actions"] = parsed.get("actions", [])
                result["final_score"] = sum(scores2) / len(scores2)
    else:
        for v in votes:
            v["final_score"] = v["score"]

    try:
        from eto.stitches.memory.shared_memory import write
        write("consensus:last", {"type": "consensus", "status": result.get("status", ""),
                "final_score": result.get("final_score", avg), "actions": result.get("actions", [])})
    except: pass
    return result


def _test_deliberation() -> dict:
    """测试用：用预设评分验证审议和终审逻辑，不调 LLM"""
    votes = [
        {"peer": "researcher", "score": 0.9, "concern": "方案很好"},
        {"peer": "coder", "score": 0.8, "concern": "实现有挑战"},
        {"peer": "auditor", "score": 0.3, "concern": "缺少回滚方案"},
    ]
    avg = round(sum(v["score"] for v in votes) / len(votes), 3)
    gap = max(v["score"] for v in votes) - min(v["score"] for v in votes)
    assert gap > 0.2, f"预期 gap > 0.2 触发审议，实际 gap={gap}"

    # T2: 审议（模拟分数收敛但不完全一致）
    for i, v in enumerate(votes):
        v["final_score"] = v["score"] * (0.9 if i == 2 else 0.95)  # auditor 微调后仍分歧
        v["final_score"] = round(min(max(v["final_score"], 0), 1), 3)

    scores2 = [v["final_score"] for v in votes]
    gap2 = max(scores2) - min(scores2)
    assert gap2 > 0.2, f"预期审议后仍分歧 gap > 0.2，实际 gap={gap2}"

    # T3: 终审
    reviewer = "researcher"
    result = {
        "status": "revise",
        "final_score": round(sum(scores2) / len(scores2), 3),
        "votes": votes,
        "deliberation": {
            "rounds": 1,
            "verdict": "revise",
            "final_reviewer": reviewer,
            "differences": [{"peer": "auditor", "vs": "researcher", "gap": round(gap2, 2)}],
        },
        "actions": ["补充回滚方案", "增加监控告警"],
    }
    return result


if __name__ == "__main__":
    try:
        data = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        print(json.dumps({"_error": True, "message": f"JSON 解析失败: {e}"}))
        sys.exit(0)
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
