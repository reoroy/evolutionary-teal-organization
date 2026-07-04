"""Shared Memory — 兼容 pi-team-agents 的 KV 共享上下文

存储: ~/.eto/shared_memory/{key}.json
格式: {"key":"...", "value":{...}, "author":"...", "ts": timestamp, "ttl": seconds}

TypeScript 端 (pi-team-agents) 和 Python 端 (ETO stitches) 读写同一份数据。
MCP Server 通过 eto_memory_write/read 暴露给外部 Agent。
"""
import json, os, sys, time
from pathlib import Path

MEM_DIR = Path.home() / ".eto" / "shared_memory"

def write(key: str, value: dict, author: str = "eto", ttl: int = 86400):
    """写共享 KV"""
    MEM_DIR.mkdir(parents=True, exist_ok=True)
    entry = {"key": key, "value": value, "author": author, "ts": time.time(), "ttl": ttl}
    # 用 key 做文件名，兼容 pi-team-agents 的 flat KV 模式
    safe_key = key.replace("/", "_").replace("\\", "_")
    (MEM_DIR / f"{safe_key}.json").write_text(json.dumps(entry, ensure_ascii=False), "utf-8")

def read(key: str, default: dict | None = None) -> dict | None:
    """读 KV，过期返回 default"""
    safe_key = key.replace("/", "_").replace("\\", "_")
    path = MEM_DIR / f"{safe_key}.json"
    if not path.exists():
        return default
    try:
        entry = json.loads(path.read_text("utf-8"))
        if time.time() - entry.get("ts", 0) > entry.get("ttl", 86400):
            path.unlink(missing_ok=True)
            return default
        return entry.get("value")
    except:
        return default

def list_keys(pattern: str = "") -> list[str]:
    """列出所有 KV key"""
    if not MEM_DIR.exists():
        return []
    keys = []
    for f in sorted(MEM_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if f.suffix == ".json":
            try:
                entry = json.loads(f.read_text("utf-8"))
                if not pattern or pattern in entry.get("key", ""):
                    keys.append(entry["key"])
            except:
                pass
    return keys

def delete(key: str):
    """删除 KV"""
    safe_key = key.replace("/", "_").replace("\\", "_")
    path = MEM_DIR / f"{safe_key}.json"
    if path.exists():
        path.unlink()

def context_block(n: int = 5) -> str:
    """返回最近 N 条上下文文本，供 prompt 注入"""
    if not MEM_DIR.exists():
        return ""
    files = sorted(MEM_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
    files = [f for f in files if f.suffix == ".json"]
    parts = ["## TealContext (最近 Agent 活动)"]
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
                val_str = json.dumps(v, ensure_ascii=False)[:100]
                parts.append(f"- [{ctype}] {val_str}")
            count += 1
        except:
            pass
    return "\n".join(parts) if count > 0 else ""

if __name__ == "__main__":
    """作为 Pi stitch 被 eto.ts 调用的入口"""
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
        print(json.dumps({"_error": True, "message": f"unknown fn: {fn}"}))
