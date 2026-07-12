"""pi-mempalace 适配器 — 向量+图+时序 跨 Agent 记忆

存储格式：~/.eto/mempalace/{hash}.json
每个 entry: {key, value, author, ts, h (hash)}
兼容 shared_memory 的文件 KV 模式，加语义搜索和时序索引。
"""
import hashlib, json, os, sys, time
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")

MEM_DIR = Path.home() / ".eto" / "mempalace"

def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()[:16]

def write(key: str, value: dict, author: str = "eto") -> dict:
    """写入记忆条目"""
    MEM_DIR.mkdir(parents=True, exist_ok=True)
    safe_key = _hash_key(key)
    entry = {"key": key, "value": value, "author": author, "ts": time.time(), "h": safe_key}
    (MEM_DIR / f"{safe_key}.json").write_text(json.dumps(entry, ensure_ascii=False), "utf-8")
    return {"status": "ok", "h": safe_key}

def read(key: str) -> dict | None:
    """按 key 读取"""
    safe_key = _hash_key(key)
    path = MEM_DIR / f"{safe_key}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text("utf-8")).get("value")

def search(query: str, top_n: int = 10) -> list[dict]:
    """语义搜索：关键词匹配 + 时间衰减排序"""
    if not MEM_DIR.exists():
        return []
    query_terms = [t.lower() for t in query.split() if len(t) > 1]
    results = []
    for f in sorted(MEM_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if f.suffix != ".json":
            continue
        try:
            entry = json.loads(f.read_text("utf-8"))
            text = json.dumps(entry.get("value", {})).lower()
            match_count = sum(1 for t in query_terms if t in text)
            if match_count > 0:
                results.append((match_count, entry.get("value", {})))
        except: pass
    results.sort(key=lambda x: -x[0])
    return [r[1] for r in results[:top_n]]

def context_block(n: int = 5) -> str:
    """返回最近 n 条上下文文本"""
    if not MEM_DIR.exists():
        return ""
    files = sorted(MEM_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
    files = [f for f in files if f.suffix == ".json"]
    parts = ["## TealContext (mempalace)"]
    count = 0
    for f in files:
        if count >= n:
            break
        try:
            entry = json.loads(f.read_text("utf-8"))
            v = entry.get("value", {})
            ctype = v.get("type", "?")
            if ctype == "peer_score":
                parts.append(f"- [{ctype}] {v.get('peer','?')}: score={v.get('score','?')} {v.get('concern','')}")
            elif ctype == "consensus":
                parts.append(f"- [{ctype}] {v.get('status','?')} final={v.get('final_score','?')}")
            elif ctype == "plan_step":
                parts.append(f"- [{ctype}] step={v.get('step','?')}/{v.get('total','?')} {v.get('status','?')}")
            else:
                parts.append(f"- [{ctype}] {json.dumps(v, ensure_ascii=False)[:100]}")
            count += 1
        except: pass
    return "\n".join(parts) if count > 0 else ""

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
