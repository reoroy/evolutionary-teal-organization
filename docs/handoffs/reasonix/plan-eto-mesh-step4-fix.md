# Plan: ETO Mesh Step 4 Fix — dispatch_spec 参数透传

> 创建日期: 2026-07-04 | 发送者: Claude Code
> 接收者: Reasonix Code
> 基线: Step 4 完成，dispatch_with_spec 已就绪

---

## 问题

当前 `dispatch_with_spec(spec_json)` 构造的 MCP args 固定为：

```python
args = {"task": task, "system": ..., "skills": ..., "mcp_tools": ..., "response_format": ...}
```

但 MCP 工具各有自己的参数签名，不使用 `task` 作为参数名：

| MCP 工具 | 期望参数 | 当前行为 |
|:---------|:---------|:---------|
| `eto_route` | `task` | ✅ 工作 |
| `eto_consensus` | `plan`, `peers` | ❌ 只传了 task |
| `eto_memory_write` | `key`, `value_json` | ❌ 只传了 task |
| `eto_memory_read` | `key` | ❌ 只传了 task |

## 方案

在 dispatch_spec 中加 `params` 字段，允许调用方直接指定任意 MCP 参数。

### 1. mcp_dispatch.py

在 `dispatch_with_spec()` 中，将 `spec.params` 合并入 args：

```python
# 在现有 args 组装之后，调用 sync_call_mcp 之前
if spec.get("params"):
    args.update(spec["params"])
```

### 2. eto.ts

在 `tryDispatchToMCPAgent` 的 spec 组装中透传 `params`：

```typescript
if (ds.params) spec.params = ds.params;
```

### 3. 配置示例

`~/.pi/eto-config.json` peers 段：

```json
{
  "hermes": {
    "provider": "mcp",
    "mcp_server": ["python", "-m", "eto.mcp_server"],
    "mcp_tool": "eto_consensus",
    "dispatch_spec": {
      "system_prompt": "你是一个严格的安全审计员",
      "params": {
        "plan": "删除生产数据库",
        "peers": ["researcher", "coder", "auditor"]
      }
    }
  }
}
```

## 改动

| 文件 | 改动 | 行数 |
|:-----|:------|:-----|
| `eto/stitches/mcp_dispatch.py` | `dispatch_with_spec()` 加 `args.update(spec.get("params", {}))` | +3 行 |
| `eto/extensions/eto.ts` | `tryDispatchToMCPAgent` 加 `if (ds.params) spec.params = ds.params` | +1 行 |

## 验证

```bash
python -c "
from eto.stitches.mcp_dispatch import dispatch_with_spec
import json

# 用 params 传指定参数
r = dispatch_with_spec(json.dumps({
  'server_cmd': ['python', '-m', 'eto.mcp_server'],
  'tool': 'eto_consensus',
  'task': '',
  'system_prompt': 'test',
  'params': {'plan': '删除数据库', 'peers': ['coder', 'auditor']}
}))
print('consensus via params:', json.dumps(r, ensure_ascii=False)[:200])
"

python eto/stitches/test.py  # 17/17 PASS
```
