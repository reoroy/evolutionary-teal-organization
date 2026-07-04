# Plan: ETO Mesh Step 6 (v2) — context_block 对接 agentmemory

> 创建日期: 2026-07-04 | 发送者: Claude Code
> 接收者: Reasonix Code
> 基线: Step 1-5 完成
> 替代: `plan-eto-mesh-step6.md`（原 sync_write 方案取消）

---

## 背景

agentmemory MCP Server（Linux :3111）已经提供跨 Agent 中央记忆库，所有 Agent 可读写。ETO 现有的 `context_block()` 却还在读本地 JSONL 文件，绕过了 agentmemory。

用 agentmemory 替换后：

```
Agent A 写记忆 → agentmemory (中央库) → Agent B context_block() → prompt 注入
```

agentmemory 可用工具（当前 Claude Code session 已注册）：

| MCP 工具 | 用途 |
|:---------|:------|
| `memory_recall` | 按类别/时间范围检索 |
| `memory_smart_search` | 语义搜索 |
| `memory_sessions` | 查看活跃会话 |

---

## 方案

重构 `shared_memory.py` 的 `context_block()`，改为先尝试从 agentmemory 拉数据，不可用时降级到本地文件。

### 架构

```
context_block(n=5)
  │
  ├── try: agentmemory (MCP stdio)
  │     → memory_smart_search(query="", limit=n)
  │     → 格式化输出
  │
  └── fallback: 本地 file-based（原逻辑）
        → ~/.eto/shared_memory/*.json
```

### 1. 新增 agentmemory 调用方式

在 `shared_memory.py` 中新增：

```python
import shutil

# agentmemory MCP server 命令（可配）
_AGENTMEMORY_CMD = os.environ.get(
    "ETO_AGENTMEMORY_CMD",
    "agentmemory-mcp"  # 假设 pip install agentmemory 后有此命令
)

def _agentmemory_available() -> bool:
    """检查 agentmemory MCP server 是否可调"""
    cmd = _AGENTMEMORY_CMD.split()
    return shutil.which(cmd[0]) is not None

def _context_from_agentmemory(n: int = 5) -> str | None:
    """通过 MCP 调 agentmemory，返回格式化上下文"""
    try:
        from eto.mcp_client import sync_call_mcp
        cmd = _AGENTMEMORY_CMD.split()
        
        # 调 memory_recall 取最近记忆
        result = sync_call_mcp(cmd, "memory_recall", {
            "category": "eto_context",
            "limit": n,
        })
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
        
        # 备选：smart_search
        result = sync_call_mcp(cmd, "memory_smart_search", {
            "query": "",
            "limit": n,
        })
        if result and result.get("results"):
            results = result["results"]
            parts = ["## TealContext (agentmemory)"]
            for r in results[:n]:
                content = r.get("content", {})
                text = json.dumps(content, ensure_ascii=False)[:200] if isinstance(content, dict) else str(content)[:200]
                parts.append(f"- {text}")
            return "\n".join(parts)
    except:
        pass
    return None
```

### 2. 重构 context_block()

```python
def context_block(n: int = 5) -> str:
    """返回最近 N 条上下文文本（优先 agentmemory，降级本地文件）"""
    # 1. 试 agentmemory
    if _agentmemory_available():
        ctx = _context_from_agentmemory(n)
        if ctx:
            return ctx
    
    # 2. 降级：本地 file-based（原逻辑不变）
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
            # ... 原格式化逻辑不变 ...
        except:
            pass
    return "\n".join(parts) if count > 0 else ""
```

### 3. context_block 保留原格式化逻辑

只改数据来源，不改输出格式。原格式：

```
## TealContext (最近 Agent 活动)
- [peer_score] researcher: score=0.8 ...
- [consensus] approved final=0.65 ...
```

agentmemory 版本输出：

```
## TealContext (agentmemory)
- [2026-07-04 21:00:00] {"type": "peer_score", ...}
```

---

## 改动文件

| 文件 | 改动 | 行数 |
|:-----|:------|:------|
| `eto/stitches/memory/shared_memory.py` | 新增 `_agentmemory_available()` + `_context_from_agentmemory()`，改 `context_block()` | ~50 行 |

**只改一个文件。** 不需要改 mcp_server.py、eto.ts、或其他文件。

### 不做

- ❌ 不改 `write()`/`read()`/`delete()`/`list_keys()` — 本地 KV 仍可用
- ❌ 不删原 `context_block` 的本地降级逻辑
- ❌ 不改 `mcp_server.py`
- ❌ 不改 `eto.ts`

---

## 验证

```bash
# 1. 检查 agentmemory 是否可用
python -c "
from eto.stitches.memory.shared_memory import _agentmemory_available
print('AM可用:', _agentmemory_available())
"

# 2. context_block 能返回内容（agentmemory 或降级）
python -c "
from eto.stitches.memory.shared_memory import context_block
print(context_block(3))
"

# 3. 现有本地 KV 不受影响
python -c "
from eto.stitches.memory.shared_memory import write, read
write('test', {'msg': 'ok'})
print(read('test'))
"

# 4. 清理测试
python -c "
from eto.stitches.memory.shared_memory import delete
delete('test')
"

# 5. 现有测试不破坏
python eto/stitches/test.py
# → 17/17+ PASS
```

---

## 验收标准

| # | 检查项 | 方法 |
|---|--------|------|
| V-1 | `_agentmemory_available()` 返回 bool | 有 agentmemory 时 true，否则 false |
| V-2 | agentmemory 可用时 `context_block()` 返回 agentmemory 数据 | 返回值含 "TealContext (agentmemory)" |
| V-3 | agentmemory 不可用时降级本地文件 | 返回值含 "TealContext (最近 Agent 活动)" |
| V-4 | 原 `write()`/`read()` 不变 | 写后能读 |
| V-5 | 所有 stitch 测试 PASS | `python eto/stitches/test.py` |
