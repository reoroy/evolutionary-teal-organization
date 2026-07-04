# Plan: ETO Mesh Step 6 — 共享记忆 MCP 同步

> 创建日期: 2026-07-04 | 发送者: Claude Code
> 接收者: Reasonix Code
> 基线: Step 1-5 完成，`~/.eto/registry.json` 可用
> 父 Plan: `plan-eto-mesh.md` (Phase 4)

---

## 现状

`shared_memory.py` 的 `write()` 只写本地 `~/.eto/shared_memory/`，其他 Agent 看不到新数据。

```
Agent A ──write("key", value)──→ ~/.eto/shared_memory/key.json
                                   ↑
Agent B ──read("key") ────────────╯  (只有 B 自己写的 key)
```

Agent A 写的东西 Agent B 看不到，除非两边的 shared_memory 是同一个 NFS 目录（实际不是）。

## 方案

在 `shared_memory.py` 新增 `sync_write()`，写本地 + 广播到所有已知 peer。

```
Agent A ──sync_write("key", value)──→ 写本地 shared_memory
                                          │
                                      读取 registry.json
                                          │
                              ┌───────────┼───────────┐
                              ↓           ↓           ↓
                         Agent B    Agent C    Agent D (self, skip)
                              │
                           MCP: eto_memory_sync
                              │
                          写本地 shared_memory/key.json
```

### 1. shared_memory.py — 新增 sync_write()

```python
def sync_write(key: str, value: dict, author: str = "eto", ttl: int = 86400):
    """写本地 + 广播到已知 peers"""
    # 1. 写本地（复用现有逻辑）
    write(key, value, author, ttl)
    
    # 2. 读取 registry 发现 peers
    reg_path = Path.home() / ".eto" / "registry.json"
    peers = []
    try:
        reg = json.loads(reg_path.read_text("utf-8"))
        my_id = reg.get("agents", {}).get(list(reg.get("agents", {}).keys())[0], {}).get("id", "")
        for aid, info in reg.get("agents", {}).items():
            if aid != my_id:  # 跳过自己
                peers.append(info)
    except:
        pass
    
    # 3. 广播到每个 peer
    for peer in peers:
        _send_to_peer(peer, key, value, author)

def _send_to_peer(peer: dict, key: str, value: dict, author: str):
    """向单个 peer 发送 sync"""
    mcp_endpoint = peer.get("mcp_endpoint", "python -m eto.mcp_server")
    cmd = mcp_endpoint.split()
    try:
        from eto.mcp_client import sync_call_mcp
        sync_call_mcp(cmd, "eto_memory_sync", {
            "key": key,
            "value_json": json.dumps(value, ensure_ascii=False),
            "author": author,
        })
    except:
        pass  # peer 不在线就跳过
```

**改动原则**：保留现有 `write()` 不动，只新增 `sync_write()` + `_send_to_peer()`。`write()` 仍可用于本地写入，`sync_write()` 用于需要 Mesh 同步的场景。

### 2. mcp_server.py — 新增 eto_memory_sync tool

```python
@mcp.tool(description="接收其他 Agent 同步的共享记忆")
def eto_memory_sync(key: str, value_json: str, author: str = "eto") -> str:
    """从 mesh peer 接收记忆同步"""
    from eto.stitches.memory.shared_memory import write
    try:
        value = json.loads(value_json)
    except:
        value = {"text": value_json}
    write(key, value, author=author)
    return f"synced: {key}"
```

### 3. 调用链

| 场景 | 函数 | 效果 |
|:-----|:------|:------|
| 普通本地写 | `write()` | 不变，仅本地 |
| 需要 Mesh 同步 | `sync_write()` | 写本地 + 广播所有 peer |
| 接收同步 | MCP `eto_memory_sync` | 写本地（但不广播，防循环） |

---

## 改动文件

| 文件 | 改动 | 行数 |
|:-----|:------|:------|
| `eto/stitches/memory/shared_memory.py` | 新增 `sync_write()` + `_send_to_peer()` | ~30 行 |
| `eto/mcp_server.py` | 新增 `eto_memory_sync` tool | ~12 行 |

### 具体改动

#### shared_memory.py — 在 `write()` 后追加

```python
def sync_write(key: str, value: dict, author: str = "eto", ttl: int = 86400):
    """写本地 + 广播到 registry 中所有已知 peers"""
    write(key, value, author, ttl)
    reg_path = Path.home() / ".eto" / "registry.json"
    try:
        reg = json.loads(reg_path.read_text("utf-8"))
        agents = reg.get("agents", {})
        my_id = None
        for aid, info in agents.items():
            if info.get("status") == "online":
                my_id = aid
                break
        for aid, info in agents.items():
            if aid == my_id:
                continue
            _send_to_peer(info, key, value, author)
    except:
        pass

def _send_to_peer(peer: dict, key: str, value: dict, author: str):
    mcp_cmd = peer.get("mcp_endpoint", "python -m eto.mcp_server").split()
    try:
        from eto.mcp_client import sync_call_mcp
        sync_call_mcp(mcp_cmd, "eto_memory_sync", {
            "key": key,
            "value_json": json.dumps(value, ensure_ascii=False),
            "author": author,
        })
    except:
        pass  # 对端不在线 ∈ 正常
```

#### mcp_server.py — 在 `eto_memory_write` 后追加

```python
@mcp.tool(description="接收 mesh peer 同步的共享记忆（不广播回）")
def eto_memory_sync(key: str, value_json: str, author: str = "eto") -> str:
    from eto.stitches.memory.shared_memory import write
    try:
        value = json.loads(value_json)
    except:
        value = {"text": value_json}
    write(key, value, author=author)
    return f"synced: {key}"
```

### 不做

- ❌ 不改 `eto.ts` — 同步由 Python stitch 自动触发
- ❌ 不改其他文件
- ❌ 不引入新依赖

---

## 验证

```bash
# 1. 本地写 + 广播（无 peer 时只写本地，不崩溃）
python -c "
from eto.stitches.memory.shared_memory import sync_write
sync_write('test-sync', {'msg': 'hello mesh'}, author='eto-test')
print('写完成')
"

# 2. 验证本地写入
python -c "
from eto.stitches.memory.shared_memory import read
print(read('test-sync'))
"

# 3. MCP 端接收同步
python -c "
from eto.mcp_server import eto_memory_sync
import json
r = eto_memory_sync('test-sync', json.dumps({'from': 'peer'}), author='peer-1')
print(r)
"

# 4. 清理
python -c "
from eto.stitches.memory.shared_memory import delete
delete('test-sync')
"

# 5. 现有测试不破坏
python eto/stitches/test.py
# → 17/17 PASS
```

---

## 验收标准

| # | 检查项 | 方法 |
|---|--------|------|
| Y-1 | `sync_write()` 存在且可调用 | `python -c "from eto.stitches.memory.shared_memory import sync_write"` |
| Y-2 | 无 peer 时只写本地，不崩溃 | registry 空时调用 sync_write |
| Y-3 | `eto_memory_sync` MCP tool 存在 | MCP 启动后 `ListTools` 返回包含该工具 |
| Y-4 | sync 写入 key 后本地可读 | sync_write → read 验证 |
| Y-5 | 17/17 stitch 测试 PASS | `python eto/stitches/test.py` |
| Y-6 | 原 `write()` 不受影响 | `write()` 仍只写本地 |
