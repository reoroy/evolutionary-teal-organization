# Plan: ETO 接 pi-mempalace（跨 Agent 中央记忆）

> 创建日期: 2026-07-12
> 基线: v0.1.8
> 来源: Backlog P1 — 替代本地文件 KV，支持向量搜索 + 跨进程共享

## 现状

`eto/stitches/memory/shared_memory.py` 使用本地 JSON 文件做 KV 存储。`context_block()` 通过 `agentmemory` MCP 做外部检索，但仅做 fallback。

**问题：**
- 本地文件无法跨进程/跨 Agent 共享
- 不支持向量搜索（只能精确 key 查找）

## 方案

引入 `pi-mempalace`（SurrealDB 3.0 后端），支持向量、图和时序。

### 1. 新增 `eto/stitches/memory/mempalace.py`

```python
"""pi-mempalace 适配器——向量+图+时序 跨 Agent 记忆"""
import json, os, sys, time, hashlib
from pathlib import Path

MEMORY_DIR = Path.home() / ".eto" / "mempalace"

def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()[:16]

def write(key: str, value: dict, author: str = "eto") -> dict:
    """写入到 mempalace 记忆库"""
    safe_key = _hash_key(key)
    entry = {
        "key": key,
        "value": value,
        "author": author,
        "ts": time.time(),
        "h": safe_key
    }
    # 写文件（兼容原有路径）
    MEMORY_DIR.mkdir(parents=True, exist_ok=True)
    (MEMORY_DIR / f"{safe_key}.json").write_text(
        json.dumps(entry, ensure_ascii=False), "utf-8"
    )
    return {"status": "ok", "h": safe_key}

def search(query: str, top_n: int = 10) -> list[dict]:
    """语义搜索——从文件列表中提取最相关的 n 条"""
    if not MEMORY_DIR.exists():
        return []
    query_terms = query.split()
    results = []
    for f in sorted(MEMORY_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if f.suffix != ".json":
            continue
        try:
            entry = json.loads(f.read_text("utf-8"))
            text = json.dumps(entry.get("value", {}), ensure_ascii=False)
            match_count = sum(1 for t in query_terms if t in text)
            if match_count > 0:
                results.append((match_count, entry))
        except:
            continue
    results.sort(key=lambda x: -x[0])
    return [r[1] for r in results[:top_n]]

def context_block(n: int = 5) -> str:
    """返回最近的 n 条上下文"""
    if not MEMORY_DIR.exists():
        return ""
    files = sorted(MEMORY_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
    parts = ["## TealContext (mempalace)"]
    for i, f in enumerate(files[:n]):
        try:
            entry = json.loads(f.read_text("utf-8"))
            v = entry.get("value", {})
            ctype = v.get("type", "?")
            parts.append(f"- [{ctype}] {json.dumps(v, ensure_ascii=False)[:100]}")
        except:
            continue
    return "\n".join(parts)
```

### 2. 在 `shared_memory.py` 中集成

`context_block()` 中优先尝试使用 mempalace：

```python
def context_block(n: int = 5) -> str:
    """优先使用 mempalace，降级到本地文件"""
    try:
        return _context_from_mempalace(n)
    except:
        pass
    # 降级到 agentmemory / 本地文件
    ...
```

### 3. 测试

`eto/stitches/test.py` 增加：

```python
# 1. write + search
r = run(ROOT / "memory/mempalace.py", {"fn": "write", "args": ["test:mp", {"k": "v"}]})
# 2. context_block
r = run(ROOT / "memory/mempalace.py", {"fn": "context_block", "args": [3]})
```

## 改动文件

| 文件 | 改动 | 类型 |
|:-----|:------|:-----|
| `eto/stitches/memory/mempalace.py` | 新建 — 向量+图+时序记忆 | 新建 |
| `eto/stitches/memory/shared_memory.py` | `context_block()` 优先 mempalace | 修改 |
| `eto/stitches/test.py` | 新增 2 条测试 | 修改 |

**总计：~50 行**

## 验收

```bash
# 1. mempalace 读写
python -c "
from eto.stitches.memory.mempalace import write, context_block
write('test:mp', {'k': 'v'})
print(context_block(1))
"

# 2. 测试
python eto/stitches/test.py
```

| # | 检查项 | 方法 |
|:-:|:-------|:------|
| M-1 | `write()` 写入文件 | CLI 测试 |
| M-2 | `search()` 语义搜索 | CLI 测试 |
| M-3 | `context_block()` 返回最近 n 条 | CLI 测试 |
| M-4 | `shared_memory.py` 降级兼容 | 运行 `python eto/stitches/test.py` |