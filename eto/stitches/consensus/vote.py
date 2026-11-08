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

#: 融合（MoA 式）默认配置：**每个 peer 走不同架构**，值随可用额度轮换。
#: 架构差异越大效果越好 —— 本地 Qwen 密集 × 云端 GLM MoE × 云端 DeepSeek 系。
#: `dsh` 是虚拟供应商：经插件端点回落到 DSH 宿主的 llm 服务，模型串是 `provider/model`。
#: 覆盖方式：~/.pi/eto-config.json 的 {"peers": {"coder": {"provider": "...", "model": "..."}}}
#: 局域网里那台 8GB 显存的机器（跑 35B-A3B MoE）。
#:
#: **默认留空**，不硬编码 IP：这个文件也会在 CI runner 和别人的机器上跑，那里没有这台机器，
#: 写死地址会让调用一直等到超时（实测 CI 卡 15 分钟）。设 ETO_OLLAMA_REMOTE 才启用远端 peer。
OLLAMA_REMOTE = os.environ.get("ETO_OLLAMA_REMOTE", "")

#: 三个 peer 必须是**不同架构**，否则投票只是单模型自一致性（见
#: docs/eto-work-usable-2026-11.md 引的算力归一化实验）。
#:
#: 注意：不要用本机原有的 `qwen3-8b-arb`。它的 Modelfile 只有 `TEMPLATE {{ .Prompt }}`，
#: 没有 chat 模板，实测会把 JSON 当正文吐出来（「你好」→ {"code":200,...}）——
#: 之前「所有 peer 无响应」的真正原因就是它，不是服务故障。
DEFAULT_PEER_CONFIG = {
    # gemma3:4b：85 tok/s，无 thinking 干扰，最稳的快速视角。
    # host 为空 = 走本机 OLLAMA_URL；设了 ETO_OLLAMA_REMOTE 才指向局域网那台 8GB 机器。
    "researcher": {"provider": "ollama", "model": "gemma3:4b", "host": OLLAMA_REMOTE},
    # 35B-A3B MoE：稀疏激活，是真正的第三个架构，且不烧云端额度。
    "coder": {"provider": "ollama", "model": "qwen3.6-35b-a3b:8g",
              "host": OLLAMA_REMOTE, "think": False},
    # 云端 DeepSeek flash：充值后已恢复。便宜、快，是第四个独立架构。
    "auditor": {"provider": "dsh", "model": "deepseek-official/deepseek-flash"},
    # 智谱 GLM 作为备用：DeepSeek 额度耗尽时可切回来（或加进 peer 名单做四源）。
    "终审仲裁者": {"provider": "ollama", "model": "gemma3:4b", "host": OLLAMA_REMOTE},
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

#: 前缀：dsh 端点缺失时回落到本机模型，值为回落模型的原文。
_FALLBACK_MARK = "__ETO_DSH_FALLBACK__"


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


def _call_dsh(model: str, system: str, prompt: str) -> str:
    """通过 DSH 宿主的 /api/llm 端点调用任意已配置 provider（虚拟供应商）。

    model 形如 "loomy/glm-5.3-flash"：斜杠前是 provider，之后是模型 id。
    端点地址由插件通过 ETO_DSH_ENDPOINT 注入（webServer 端口是 OS 分配的）。
    失败返回 _provider_error 结构，绝不返回空串——那会让上层把「没连上」当成「答了低分」。
    """
    endpoint = os.environ.get("ETO_DSH_ENDPOINT", "").rstrip("/")
    if not endpoint:
        # 插件把当前宿主端点写在这里（端口每次启动都变）。文件优先于环境变量缺失：
        # runner 是每次调用新起的子进程，所以改文件立刻生效，不必等 DSH 重启。
        try:
            with open(os.path.expanduser("~/.eto/dsh-endpoint"), encoding="utf-8") as f:
                endpoint = f.read().strip().rstrip("/")
        except OSError:
            endpoint = ""
    if not endpoint:
        # 离线场景（CLI / 测试 / cron）没有宿主端点：回落本机模型，让评审仍然能出结果。
        # 这一回落**必须留痕**：返回值前缀标记，_score_single 会把 provider 记成
        # ollama(fallback)，台账里就能看出这一轮没做成多架构融合。
        logger.warning("dsh 端点缺失，peer=%s 回落本机模型 %s（本轮未融合）", _MCP_CURRENT_PEER, MODEL)
        return _FALLBACK_MARK + _call_ollama(MODEL, f"{system}\n\n{prompt}" if system else prompt)
    provider, _, model_id = model.partition("/")
    if not model_id:
        return _provider_error("dsh", model, f"model 必须形如 provider/model，收到 {model!r}")
    body = json.dumps({
        "provider": provider,
        "model": model_id,
        "system": system,
        "prompt": prompt,
        "maxTokens": 800,
        "timeoutMs": 120_000,
    }).encode("utf-8")
    req = urllib.request.Request(endpoint + "/llm", data=body, method="POST",
                                 headers={"Content-Type": "application/json", "x-dsh-eto": "1"})
    try:
        with urllib.request.urlopen(req, timeout=130) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        logger.error("dsh 调用失败 peer=%s model=%s: %s: %s", _MCP_CURRENT_PEER, model, type(e).__name__, e)
        return _provider_error("dsh", model, f"{type(e).__name__}: {e}")
    if payload.get("_error"):
        logger.error("dsh 端点报错 peer=%s model=%s: %s", _MCP_CURRENT_PEER, model, payload.get("error"))
        return _provider_error("dsh", model, str(payload.get("error"))[:200])
    text = str(payload.get("_text") or "").strip()
    if text == "":
        return _provider_error("dsh", model, "宿主返回空文本")
    return text


def _call_provider(provider: str, model: str, system: str, prompt: str, cfg: dict | None = None) -> str:
    """路由到不同的 LLM provider"""
    full = f"{system}\n\n{prompt}" if system else prompt
    if provider == "deepseek":
        return _call_deepseek(model, system, prompt)
    elif provider == "claude":
        return _call_claude(model, system, prompt)
    elif provider == "mcp":
        return _call_mcp_agent(model, system, prompt)  # model 参数存的是 server_cmd JSON
    elif provider == "dsh":
        # 虚拟供应商：把调用回落到 DSH 宿主的 llm 服务，那里能路由到任意已配置 provider。
        # model 形如 "loomy/glm-5.3-flash"（provider/model），这样每个 peer 可以是不同架构。
        return _call_dsh(model, system, prompt)
    else:
        peer_cfg = cfg or {}
        return _call_ollama(model, full,
                            host=str(peer_cfg.get("host") or ""),
                            think=bool(peer_cfg.get("think")))

def _call_ollama(model: str, full_prompt: str, host: str = "", think: bool = False) -> str:
    """调 Ollama，走 /api/chat。

    为什么不是 /api/generate：带 thinking 的模型（qwen3.x / qwen3.6）在 generate 下会把
    整段 num_predict 预算烧在思考上、response 为空；chat 会分开返回 thinking 与 content。
    `think` 必须显式传（False 也传）——只省略不生效，实测 1500 token 时 thinking 占 2295 字。

    `host` 允许把一个 peer 指到局域网里另一台机器：8GB 显存那台跑 35B-A3B 的 MoE，
    总参 34.7B、每 token 只激活 3B，实测 41 tok/s，且不烧云端额度。
    """
    base = (host or OLLAMA_URL).rstrip("/")

    def ask(use_think: bool, budget: int) -> tuple[str, int]:
        """一次调用，返回 (正文, thinking 字数)。thinking 与 content 天然分在两个字段里，
        所以「开着 think 但不污染正文」不需要额外清洗 —— 只要不把 thinking 拼进返回值。"""
        body = {
            "model": model,
            "messages": [{"role": "user", "content": full_prompt}],
            "stream": False,
            "think": bool(use_think),
            "options": {"temperature": 0.7, "num_predict": budget},
        }
        req = urllib.request.Request(f"{base}/api/chat", data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=180) as resp:
            message = (json.loads(resp.read().decode("utf-8")) or {}).get("message") or {}
        return (message.get("content") or "").strip(), len(message.get("thinking") or "")

    try:
        text, thought = ask(think, 1600)
        # 开着 think 时，正文可能因预算被思考吃光而为空。**自动补救**而不是直接判失败：
        # 先把预算翻倍再试一次（thinking 的长度事先不可知），仍为空才降级为关 think。
        if text == "" and think:
            text, thought = ask(True, 4000)
        if text == "" and think:
            logger.warning("ollama peer=%s model=%s 开 think 两次均无正文（thinking=%d 字），改关 think 重试",
                           _MCP_CURRENT_PEER, model, thought)
            text, thought = ask(False, 1600)
        if text == "":
            return _provider_error("ollama", model, "模型返回空文本（预算可能全被 thinking 吃掉）")
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
    return _call_provider(provider, cfg.get("model", MODEL), system, prompt, cfg)

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
    if isinstance(raw, str) and raw.startswith(_FALLBACK_MARK):
        raw = raw[len(_FALLBACK_MARK):]
        fallback = True
    else:
        fallback = False

    failure = _parse_provider_error(raw)
    if failure is not None:
        logger.error("peer=%s provider=%s/%s 无响应: %s", peer, failure.get("provider"), failure.get("model"), failure.get("reason"))
        return {
            "peer": peer,
            "score": None,
            "provider": failure.get("provider"),
            "model": failure.get("model"),
            "concern": f"[{peer}] provider {failure.get('provider')}/{failure.get('model')} 无响应: {failure.get('reason')}"[:300],
            "suggestion": "",
            "provider_error": True,
        }

    parsed = _extract_json(raw)
    peer_cfg = _load_peer_config().get(peer, DEFAULT_PEER_CONFIG.get(peer, DEFAULT_PEER_CONFIG["researcher"]))
    result = {"peer": peer, "score": 0.5, "concern": "", "suggestion": "",
              "provider": "ollama(fallback)" if fallback else peer_cfg.get("provider", "ollama"),
              "model": MODEL if fallback else peer_cfg.get("model", MODEL)}
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

def _source_of(vote: dict) -> str:
    """真实来源标识：dsh 取 model 前缀，其余用 provider 名（回落与本体同源）。"""
    provider = str(vote.get("provider", "")).replace("(fallback)", "")
    model = str(vote.get("model", ""))
    if provider == "dsh" and "/" in model:
        return model.split("/", 1)[0]
    return provider


SYNTHESIS_PROMPT = (
    "下面是多个不同架构的模型对同一份计划的独立评审意见。请把它们**融合成一段**可执行的结论：\n"
    "- 只写各方都指向的、或至少两方提到的核心风险（不要罗列所有细节）\n"
    "- 如果有互相冲突的判断，明确指出冲突点\n"
    "- 最后给一句「最该先做什么」\n"
    "不超过 120 字，不要复述原文，不要客套。"
)


def _synthesize(plan: str, votes: list) -> str | None:
    """把多个 peer 的意见融合成一段结论（MoA 的聚合器角色，走本机模型，免费）。

    聚合失败返回 None —— 台账照常显示每个 peer 的原文，不因聚合失败丢掉整份评审。
    """
    usable = [v for v in votes if v.get("score") is not None]
    if len(usable) < 2:
        return None
    lines = []
    for v in usable:
        lines.append(f"[{v['peer']} score={v['score']}] concern: {v.get('concern', '')} | suggestion: {v.get('suggestion', '')}")
    prompt = SYNTHESIS_PROMPT + "\n\n计划:\n" + plan[:1200] + "\n\n各方意见:\n" + "\n".join(lines)
    try:
        raw = _call_ollama(MODEL, prompt)
    except Exception as e:
        logger.warning("融合聚合失败（保留各 peer 原文）: %s: %s", type(e).__name__, e)
        return None
    failure = _parse_provider_error(raw)
    if failure is not None:
        logger.warning("融合聚合失败: %s", failure.get("reason"))
        return None
    text = (raw or "").strip()
    if not text:
        return None
    # 本地小模型常把结论包成 JSON；取其中的文本字段，避免台账里显示一段转义 JSON。
    if text.startswith("{"):
        try:
            inner = json.loads(text)
            for key in ("conclusion", "synthesis", "text", "summary", "result"):
                if isinstance(inner.get(key), str) and inner[key].strip():
                    return inner[key].strip()[:800]
        except json.JSONDecodeError:
            pass
    return text[:800]


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
        # 融合层：各 peer 实际走的 provider/model，以及聚合器给出的统一结论。
        "fusion": {
            "sources": [{"peer": v["peer"], "provider": v.get("provider", "?"), "model": v.get("model", "?")} for v in votes],
            # 计数口径：`dsh` 只是传输层，真实来源在 model 前缀里（deepseek-official/…）；
            # 回落不是另一个架构（ollama(fallback) 与 ollama 同源）。
            "distinct_providers": len({_source_of(v) for v in votes if v.get("provider")}),
            "aggregator": f"ollama/{MODEL}",
        },
        "synthesis": _synthesize(plan, votes),
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


# ── 会诊模式（mode="advise"）：不评分，只给建议/分歧/风险 ──────────────────
# 与 `peer_review` 的「评分卡」不同：advise 是「会诊层」的输出，主模型拿到后
# 可以直接采用来继续执行，而不是看一个分数。复用 `_call_peer`/`_parse_provider_error`
# 的 provider 通道与降级语义，但**不改变** `peer_review` 的融合算法（PR #56）。

ADVISE_INSTRUCTION = (
    "请对下面的方案给出会诊建议（不要评分）。只输出一个 JSON 对象："
    '{"suggestion": "具体怎么做、最该先做什么（一句话）", "risk": "最大的风险（一句话）", "disagreement": "你与上述做法不同的地方，没有就填空串"}'
)

ADVISE_SYNTHESIS_PROMPT = (
    "下面是多个不同架构的模型对同一方案的会诊建议。请融合成一段可直接执行的建议：\n"
    "- 先给「最该先做什么」，再给必须规避的风险\n"
    "- 如果有互相冲突的做法，明确指出分歧点\n"
    "不超过 120 字，不要评分，不要客套。"
)


def _advise_single(peer: str, plan: str) -> dict:
    """单 peer 会诊建议，返回 {advice, risk, disagreement}（不评分）。"""
    system = PEER_SYSTEM_PROMPTS.get(peer, "你是一个评审专家。")
    raw = _call_peer(peer, system, ADVISE_INSTRUCTION + "\n\n方案:\n" + plan)
    fallback = False
    if isinstance(raw, str) and raw.startswith(_FALLBACK_MARK):
        raw = raw[len(_FALLBACK_MARK):]
        fallback = True

    peer_cfg = _load_peer_config().get(peer, DEFAULT_PEER_CONFIG.get(peer, DEFAULT_PEER_CONFIG["researcher"]))
    result = {
        "peer": peer,
        "provider": "ollama(fallback)" if fallback else peer_cfg.get("provider", "ollama"),
        "model": MODEL if fallback else peer_cfg.get("model", MODEL),
        "advice": "",
        "risk": "",
        "disagreement": "",
    }
    failure = _parse_provider_error(raw)
    if failure is not None:
        logger.error("peer=%s provider=%s/%s 无响应: %s", peer, failure.get("provider"), failure.get("model"), failure.get("reason"))
        result["advice"] = f"[{peer}] provider {failure.get('provider')}/{failure.get('model')} 无响应: {failure.get('reason')}"[:300]
        result["degraded"] = True
        return result
    parsed = _extract_json(raw)
    if parsed is None:
        logger.error("peer=%s 回复无法解析为会诊 JSON（前 120 字）: %r", peer, raw[:120])
        result["advice"] = f"[{peer}] 回复无法解析为会诊 JSON: {raw[:120]}"
        result["degraded"] = True
        return result
    result["advice"] = (parsed.get("suggestion", "") or "")[:300]
    result["risk"] = (parsed.get("risk", "") or "")[:300]
    result["disagreement"] = (parsed.get("disagreement", "") or "")[:300]
    return result


def _synthesize_advise(plan: str, votes: list) -> str:
    """把多个 peer 的会诊建议融合成一段可直接执行的建议（走本机模型，免费）。"""
    usable = [v for v in votes if v.get("advice") and not v.get("degraded")]
    if len(usable) < 2:
        return (usable[0]["advice"] if usable else "")
    lines = []
    for v in usable:
        lines.append(f"[{v['peer']}] 建议: {v.get('advice','')} | 风险: {v.get('risk','')} | 分歧: {v.get('disagreement','')}")
    prompt = ADVISE_SYNTHESIS_PROMPT + "\n\n方案:\n" + plan[:1200] + "\n\n各方建议:\n" + "\n".join(lines)
    try:
        raw = _call_ollama(MODEL, prompt)
    except Exception as e:
        logger.warning("会诊聚合失败（保留各 peer 原文）: %s: %s", type(e).__name__, e)
        return ""
    failure = _parse_provider_error(raw)
    if failure is not None:
        logger.warning("会诊聚合失败: %s", failure.get("reason"))
        return ""
    text = (raw or "").strip()
    if not text:
        return ""
    if text.startswith("{"):
        try:
            inner = json.loads(text)
            for key in ("conclusion", "synthesis", "advice", "text", "summary", "result"):
                if isinstance(inner.get(key), str) and inner[key].strip():
                    return inner[key].strip()[:800]
        except json.JSONDecodeError:
            pass
    return text[:800]


def peer_advise(plan: str, peers: list[str]) -> dict:
    """会诊模式：不评分，只给「建议怎么做 + 分歧 + 风险」，主模型可直接采用。

    与 `peer_review` 同源但不共享评分卡结构：输出无 `final_score` / `status` 语义，
    只有 `mode="advise"` + `synthesis` + 各 peer 的建议/风险/分歧。
    """
    votes = [_advise_single(p, plan) for p in peers]
    degraded = [v for v in votes if v.get("degraded")]
    usable = [v for v in votes if not v.get("degraded")]

    advice = [f"[{v['peer']}] {v.get('advice','')}".strip() for v in usable if v.get("advice")]
    risks = [v.get("risk", "").strip() for v in usable if v.get("risk", "").strip()]
    disagreements = [v.get("disagreement", "").strip() for v in usable if v.get("disagreement", "").strip()]

    result = {
        "mode": "advise",
        "status": "advised",
        "synthesis": _synthesize_advise(plan, usable) if len(usable) >= 2 else (usable[0]["advice"] if usable else ""),
        "advice": advice,
        "risks": risks,
        "disagreements": disagreements,
        "votes": votes,
        "fusion": {
            "sources": [{"peer": v["peer"], "provider": v.get("provider", "?"), "model": v.get("model", "?")} for v in votes],
            "distinct_providers": len({_source_of(v) for v in votes if v.get("provider")}),
            "aggregator": f"ollama/{MODEL}",
        },
        "audit_id": f"v{int(__import__('time').time())}",
    }
    if degraded:
        result["degraded"] = True
        result["degraded_peers"] = [v["peer"] for v in degraded]
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
