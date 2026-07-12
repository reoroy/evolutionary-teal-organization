"""Shared Memory — 兼容 pi-team-agents 的 KV 共享上下文

存储: ~/.eto/shared_memory/{key}.json
格式: {"key":"...", "value":{...}, "author":"...", "ts": timestamp, "ttl": seconds}

TypeScript 端 (pi-team-agents) 和 Python 端 (ETO stitches) 读写同一份数据。
MCP Server 通过 eto_memory_write/read 暴露给外部 Agent。
"""
import json, os, shutil, sys, time
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

def get_outcomes(agent_id: str) -> list[dict]:
    """读取某 Agent 的所有历史执行结果"""
    all_entries = []
    if not MEM_DIR.exists():
        return []
    for f in MEM_DIR.iterdir():
        if f.suffix != ".json":
            continue
        try:
            entry = json.loads(f.read_text("utf-8"))
            v = entry.get("value", {})
            if v.get("type") == "task_outcome" and v.get("agent") == agent_id:
                all_entries.append(v)
        except: pass
    return all_entries

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

# ── 文件级状态协调（多 Agent 协作）───────────────────────
FILE_STATES_DIR = Path.home() / ".eto" / "file_states"

def file_status(file: str) -> dict | None:
    """查询文件的最新编辑状态。返回 {editor, hash, ts} 或 None"""
    safe = file.replace("/", "_").replace("\\", "_")
    path = FILE_STATES_DIR / f"{safe}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text("utf-8"))
    except:
        return None

def file_update(file: str, editor: str, hash: str = "") -> dict:
    """发布文件编辑状态。返回 {status: "ok", file, editor, ts}"""
    FILE_STATES_DIR.mkdir(parents=True, exist_ok=True)
    safe = file.replace("/", "_").replace("\\", "_")
    path = FILE_STATES_DIR / f"{safe}.json"
    entry = {"file": file, "editor": editor, "hash": hash, "ts": time.time()}
    path.write_text(json.dumps(entry, ensure_ascii=False), "utf-8")
    return {"status": "ok", "file": file, "editor": editor, "ts": entry["ts"]}

def file_release(file: str) -> bool:
    """解除文件锁"""
    safe = file.replace("/", "_").replace("\\", "_")
    path = FILE_STATES_DIR / f"{safe}.json"
    if path.exists():
        path.unlink()
        return True
    return False

def file_list() -> list[dict]:
    """列出所有文件的当前状态"""
    if not FILE_STATES_DIR.exists():
        return []
    result = []
    for f in sorted(
        FILE_STATES_DIR.iterdir(),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    ):
        if f.suffix == ".json":
            try:
                result.append(json.loads(f.read_text("utf-8")))
            except:
                pass
    return result

_AGENTMEMORY_CMD = os.environ.get("ETO_AGENTMEMORY_CMD", "agentmemory-mcp").split()

def _agentmemory_available() -> bool:
    """检查 agentmemory MCP server 是否可调"""
    return shutil.which(_AGENTMEMORY_CMD[0]) is not None

def _context_from_agentmemory(n: int = 5) -> str | None:
    """通过 MCP 调 agentmemory，返回格式化上下文"""
    try:
        from eto.mcp_client import sync_call_mcp
        result = sync_call_mcp(_AGENTMEMORY_CMD, "memory_recall", {"category": "eto_context", "limit": n})
        if result and result.get("memories"):
            memories = result["memories"]
            parts = ["## TealContext (agentmemory)"]
            for m in memories[:n]:
                content = m.get("content", {})
                if isinstance(content, str):
                    try: content = json.loads(content)
                    except: pass
                text = json.dumps(content, ensure_ascii=False)[:200] if isinstance(content, dict) else str(content)[:200]
                ts = m.get("created_at", "")[:19].replace("T", " ") if m.get("created_at") else ""
                parts.append(f"- [{ts}] {text}")
            return "\n".join(parts)

        result = sync_call_mcp(_AGENTMEMORY_CMD, "memory_smart_search", {"query": "", "limit": n})
        if result and result.get("results"):
            results = result["results"]
            parts = ["## TealContext (agentmemory)"]
            for r in results[:n]:
                content = r.get("content", {})
                text = json.dumps(content, ensure_ascii=False)[:200] if isinstance(content, dict) else str(content)[:200]
                parts.append(f"- {text}")
            return "\n".join(parts)
    except: pass
    return None

def context_block(n: int = 5) -> str:
    """返回最近 N 条上下文文本（优先 mempalace → agentmemory → 本地文件）"""
    try:
        from eto.stitches.memory.mempalace import context_block as _mp_ctx
        return _mp_ctx(n)
    except: pass
    if _agentmemory_available():
        ctx = _context_from_agentmemory(n)
        if ctx:
            return ctx

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
