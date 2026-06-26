"""ETO Stitch: VotingAI 共识投票层（Step 4 - 真实 peer 评分）"""
import json, sys, urllib.request, urllib.error

OLLAMA_URL = "http://localhost:11434"
MODEL = "qwen2.5-coder:7b"

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

def _score_peer(peer: str, plan: str) -> tuple[float, str]:
    prompt = f"Rate this plan as {peer}. Output JSON: {{\"score\": 0.0-1.0, \"concern\": \"\"}}\nPlan: {plan}"
    data = json.dumps({"model": MODEL, "prompt": prompt, "stream": False, "options": {"temperature": 0.2, "num_predict": 256}}).encode("utf-8")
    req = urllib.request.Request(f"{OLLAMA_URL}/api/generate", data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            out = json.loads(resp.read().decode("utf-8")).get("response", "{}").strip()
        parsed = _extract_json(out)
        if parsed:
            score = float(parsed.get("score", 0.5))
            concern = parsed.get("concern", "") or ""
            return min(max(score, 0), 1), concern
    except: pass
    return 0.5, ""

def peer_review(plan: str, peers: list[str]) -> dict:
    """同侪共识评分：每位 peer 独立评分"""
    results = []
    for p in peers:
        score, concern = _score_peer(p, plan)
        results.append({"peer": p, "score": score, "concern": concern[:100] if concern else None})
    avg = round(sum(r["score"] for r in results) / len(results), 3) if results else 0.6
    return {"status": "approved" if avg >= 0.6 else "需调整", "avg_score": avg, "votes": results}

if __name__ == "__main__":
    try:
        data = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        print(json.dumps({"_error": True, "message": f"JSON 解析失败: {e}"}))
        sys.exit(0)

    fn = data.get("fn")
    args = data.get("args", [])

    func = globals().get(fn)
    if func is None:
        print(json.dumps({"_error": True, "message": f"未知函数: {fn}"}))
        sys.exit(0)

    try:
        result = func(*args)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"_error": True, "message": str(e)}))
        sys.exit(0)
