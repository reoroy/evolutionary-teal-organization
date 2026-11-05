"""ETO Stitch: 三阶段共识投票（评分→审议→终审）"""
import io, json, os, sys, urllib.request, urllib.error
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")

import logging
logger = logging.getLogger("eto.stitches.consensus.vote")

OLLAMA_URL = "http://localhost:11434"
# `qwen2.5-coder:7b` was the historical default but is not installed on this machine, so every peer
# silently degraded. Prefer a model that actually exists locally; override per-peer in
# ~/.pi/eto-config.json when a different one is wanted.
MODEL = os.environ.get("ETO_OLLAMA_MODEL", "qwen3-8b-arb:latest")
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

#: Marker prefix for a provider failure that must travel as data, not as an empty string.
#: `_score_single` recognises it and marks the vote degraded instead of keeping a default 0.5.
_PROVIDER_ERROR = "__ETO_PROVIDER_ERROR__"


def _provider_error(provider: str, model: str, reason: str) -> str:
    """Encode a provider failure so the caller can tell it apart from a real (empty) answer."""
    return _PROVIDER_ERROR + json.dumps(
        {"provider": provider, "model": model, "reason": reason}, ensure_ascii=False)


def _parse_provider_error(raw: str) -> dict | None:
    """Return the decoded failure, or None when `raw` is a genuine model reply."""
    if not isinstance(raw, str) or not raw.startswith(_PROVIDER_ERROR):
        return None
    try:
        return json.loads(raw[len(_PROVIDER_ERROR):])
    except (json.JSONDecodeError, TypeError):
        return {"provider": "?", "model": "?", "reason": f"unparsable provider error: {raw[:120]}"}


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
            text = json.loads(resp.read().decode("utf-8")).get("response", "").strip()
        if text == "":
            return _provider_error("ollama", model, "模型返回空文本")
        return text
    except Exception as e:
        # 传输失败必须可区分：返回 "" 会让上层把「没连上」当成「模型答了 0.5 分」。
        logger.error("ollama 调用失败 peer=%s model=%s: %s: %s", _MCP_CURRENT_PEER, model, type(e).__name__, e)
        return _provider_error("ollama", model, f"{type(e).__name__}: {e}")

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
            text = (body.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()
        if text == "":
            return _provider_error("deepseek", model, "模型返回空文本")
        return text
    except Exception as e:
        logger.error("deepseek 调用失败 peer=%s model=%s: %s: %s", _MCP_CURRENT_PEER, model, type(e).__name__, e)
        return _provider_error("deepseek", model, f"{type(e).__name__}: {e}")

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
            text = "".join(b.get("text", "") for b in content if b.get("type") == "text").strip()
        if text == "":
            return _provider_error("claude", model, "模型返回空文本")
        return text
    except Exception as e:
        logger.error("claude 调用失败 peer=%s model=%s: %s: %s", _MCP_CURRENT_PEER, model, type(e).__name__, e)
        return _provider_error("claude", model, f"{type(e).__name__}: {e}")

def _call_mcp_agent(config_json: str, system: str, prompt: str) -> str:
    """通过 MCP Client 调其他 Agent 的工具评分

    失败分类：
    - 可降级（server 启动失败 / 工具调用失败 / 返回空）：记录日志，返回 ""，评分退回默认 0.5
    - 必须上报（配置非法：config_json 不是合法 JSON、缺少 mcp_server）：
      返回 `_error` JSON，让调用方（_call_peer → _score_single → stdout）看到通道坏了
    """
    peer = _MCP_CURRENT_PEER  # 由 _call_peer 设置，用于日志定位
    server_cmd = None
    try:
        try:
            cfg = json.loads(config_json)
        except (json.JSONDecodeError, TypeError) as e:
            # 必须上报：配置本身非法，不是运行环境问题
            logger.error("mcp peer=%s config invalid: %s (%s)", peer, type(e).__name__, e)
            return json.dumps({"_error": True, "stage": "config",
                "peer": peer, "message": f"MCP peer 配置非法: {e}"}, ensure_ascii=False)
        server_cmd = cfg.get("mcp_server", [])
        tool = cfg.get("mcp_tool", "agent_review")
        if not cmd_valid(server_cmd):
            # 必须上报：配置声明了 mcp provider 却没有可用的 server 命令
            logger.error("mcp peer=%s missing mcp_server (config=%s)", peer, config_json[:200])
            return json.dumps({"_error": True, "stage": "config",
                "peer": peer, "message": "MCP peer 配置缺少 mcp_server"}, ensure_ascii=False)

        # vote.py 在 eto/stitches/consensus/ 下，比 mcp_dispatch.py 深一层：
        # 需要 4 级 parent 才是仓库根（含 eto 包）。原代码只退 3 级，
        # 即使补了 Path 导入也会 ModuleNotFoundError: No module named 'eto'。
        sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
        from eto.mcp_client import sync_call_mcp
        args = {"system": system, "prompt": prompt}
        result = sync_call_mcp(server_cmd, tool, args)
        if result:
            return json.dumps(result, ensure_ascii=False)
        # 可降级：工具跑了但没返回内容
        logger.warning("mcp peer=%s server=%s tool=%s returned empty", peer, server_cmd, tool)
    except Exception as e:
        # 可降级：server 启动失败 / 连接失败 / 工具抛错 —— 记录 peer、server_cmd、异常类型
        logger.warning("mcp peer=%s server=%s failed: %s: %s",
            peer, server_cmd, type(e).__name__, e)
    return ""

def cmd_valid(cmd) -> bool:
    """mcp_server 命令数组合法性：非空 list 且元素都是 str"""
    return isinstance(cmd, list) and len(cmd) > 0 and all(isinstance(x, str) for x in cmd)

_MCP_CURRENT_PEER = "(unknown)"  # _call_peer 进入时设置，供 _call_mcp_agent 日志定位

def _call_peer(peer_name: str, system: str, prompt: str) -> str:
    """按 peer 配置路由到对应 provider"""
    global _MCP_CURRENT_PEER
    _MCP_CURRENT_PEER = peer_name
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
    """调 Ollama，返回原始文本；失败时返回 _error 结构（不静默）。"""
    full = f"{system}\n\n{prompt}"
    data = json.dumps({"model": MODEL, "prompt": full, "stream": False, "options": {"temperature": 0.7, "num_predict": 800}}).encode("utf-8")
    req = urllib.request.Request(f"{OLLAMA_URL}/api/generate", data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = json.loads(resp.read().decode("utf-8")).get("response", "").strip()
        if text == "":
            return _provider_error("ollama", MODEL, "模型返回空文本")
        return text
    except Exception as e:
        logger.error("ollama(_call_llm) 失败 model=%s: %s: %s", MODEL, type(e).__name__, e)
        return _provider_error("ollama", MODEL, f"{type(e).__name__}: {e}")

def _score_single(peer: str, plan: str) -> dict:
    """单 peer 评分，返回 {score, concern, suggestion}"""
    system = PEER_SYSTEM_PROMPTS.get(peer, "你是一个评审专家。")
    raw = _call_peer(peer, system, f"请对以下执行计划评分。输出 JSON: {{\"score\": 0.0-1.0, \"concern\": \"\", \"suggestion\": \"\"}}\n\n计划: {plan}")

    # A provider failure is DATA, not a score. Before this branch existed, a dead Ollama looked
    # exactly like a peer that answered 0.5 — the "fake success" the panel used to report.
    failure = _parse_provider_error(raw)
    if failure is not None:
        logger.error("peer=%s provider=%s/%s 无响应: %s", peer, failure.get("provider"), failure.get("model"), failure.get("reason"))
        return {
            "peer": peer,
            "score": None,
            "concern": f"[{peer}] provider {failure.get('provider')}/{failure.get('model')} 无响应: {failure.get('reason')}"[:300],
            "suggestion": "",
            "provider_error": True,
        }

    parsed = _extract_json(raw)
    result = {"peer": peer, "score": 0.5, "concern": "", "suggestion": ""}
    if parsed is None:
        # The model answered, but not with the JSON we asked for. That is still a degraded vote —
        # keeping 0.5 here would be indistinguishable from a real middling score.
        logger.error("peer=%s 回复无法解析为评分 JSON（前 120 字）: %r", peer, raw[:120])
        result["concern"] = f"[{peer}] 模型回复无法解析为评分 JSON: {raw[:120]}"
        result["provider_error"] = True
        result["score"] = None
    if parsed:
        if parsed.get("_error"):
            # provider 判定为「必须上报」的失败：带在 concern 里冒出来，不再静默退回默认分
            result["concern"] = f"[{peer}] provider 错误: {parsed.get('message', 'unknown')}"[:200]
            result["provider_error"] = True
        else:
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

    # A vote with score=None is a degraded peer (provider down / unparsable reply). Excluding it
    # from the tally is what stops three dead peers from averaging into a confident-looking 0.333.
    usable = [v for v in votes if v.get("score") is not None]
    degraded = [v for v in votes if v.get("score") is None]

    if not usable:
        # Nothing real came back. Say so — `ok: true` with a fake score is what caused the panel
        # to show a green check on a review no model ever performed.
        logger.error("共识评审全部 %d 个 peer 均无有效评分", len(votes))
        return {
            "status": "degraded",
            "final_score": None,
            "votes": votes,
            "deliberation": {"rounds": 0, "strategies": {}},
            "actions": ["所有 peer 均未返回有效评分；请检查 provider 是否可用（ollama 是否在运行）"],
            "degraded": True,
            "degraded_peers": [v["peer"] for v in degraded],
            "audit_id": f"v{int(__import__('time').time())}",
        }

    scores = [v["score"] for v in usable]
    tally = _multi_strategy_tally(scores)
    avg = tally["final"]
    gap = max(scores) - min(scores) if len(scores) > 1 else 0
    result = {
        "status": "approved" if avg >= 0.6 else "revise",
        "final_score": avg,
        "votes": votes,
        "deliberation": {"rounds": 0, "strategies": tally["strategies"]},
        "actions": [],
        "audit_id": f"v{int(__import__('time').time())}",
    }
    if degraded:
        # Partial degradation: the score is real but incomplete. Surface which peers are missing
        # so the reader knows the verdict rests on fewer opinions than requested.
        result["degraded"] = True
        result["degraded_peers"] = [v["peer"] for v in degraded]
        result["actions"].append(
            f"{len(degraded)}/{len(votes)} 个 peer 无有效评分（{', '.join(v['peer'] for v in degraded)}），"
            f"结论仅基于其余 {len(usable)} 个")

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
