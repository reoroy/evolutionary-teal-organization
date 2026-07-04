# Plan: ETO Mesh Step 4 — dispatch_spec 完整支持

> 创建日期: 2026-07-04 | 发送者: Claude Code
> 接收者: Reasonix Code
> 基线: v0.5.0 (Step 3 完成后)
> 父 Plan: `plan-eto-mesh.md` (Phase 3)

---

## 现状

当前 MCP dispatch 只传 task 字符串：

```
eto.ts ──→ mcp_dispatch.dispatch(cmdJson, tool, task) ──→ MCP Agent
```

调用的 MCP Agent 只能收到 `{"task": "...", "system": "执行以下任务: ..."}`，不能自定义：
- ❌ 不能指定 `system_prompt`（始终是固定模板）
- ❌ 不能加载 skills
- ❌ 不能暴露特定 tools
- ❌ 不能控制 response_format
- ❌ 不能设 timeout

但 `mcp_client.py` 的 `call_mcp_tool()` 已经支持传入任意 `args: dict` — 瓶颈不在 client，在 stitch 和 eto.ts 没传递完整 spec。

现有配置 `~/.pi/eto-config.json` 中 peers 段结构：
```json
{
  "peers": {
    "hermes": {
      "provider": "mcp",
      "mcp_server": ["python", "-m", "eto.mcp_server"],
      "mcp_tool": "agent_execute"
    }
  }
}
```

---

## 方案

### 总览

三步改动：

```
Step 4a: mcp_dispatch.py 新增 dispatch_with_spec()
Step 4b: eto.ts tryDispatchToMCPAgent 读取 dispatch_spec 配置
Step 4c: 更新配置示例，路径不变
```

### 4a. mcp_dispatch.py — 新增 dispatch_with_spec()

```python
def dispatch_with_spec(spec_json: str) -> dict:
    """
    完整 dispatch_spec 调度。

    spec_json (JSON string):
    {
        "target": "hermes-linux",       # 目标 Agent ID
        "server_cmd": ["python", ...],  # MCP server 命令
        "tool": "agent_execute",        # MCP tool 名称
        "task": "执行...",              # 任务内容
        "system_prompt": "你是一个...", # 自定义系统提示
        "skills": ["sentinel-rules"],   # 目标加载的技能
        "mcp_tools": ["eto_consensus"], # 暴露给目标的工具
        "response_format": "json",      # 响应格式
        "timeout": 30000                # 超时毫秒
    }
    """
    spec = json.loads(spec_json)
    server_cmd = spec.get("server_cmd", [])
    tool = spec.get("tool", "agent_execute")
    task = spec.get("task", "")
    
    # 构建完整的调用参数
    args = {"task": task}
    if spec.get("system_prompt"):
        args["system"] = spec["system_prompt"]
    else:
        args["system"] = f"执行以下任务:\n{task}"
    if spec.get("skills"):
        args["skills"] = spec["skills"]
    if spec.get("mcp_tools"):
        args["mcp_tools"] = spec["mcp_tools"]
    if spec.get("response_format"):
        args["response_format"] = spec["response_format"]
    
    # 调用 MCP
    import sys as _sys
    _sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
    from eto.mcp_client import sync_call_mcp
    
    result = sync_call_mcp(server_cmd, tool, args)
    return result or {}
```

**改动原则：** 保留现有 `dispatch()` 不动（向后兼容），只新增 `dispatch_with_spec()`。

### 4b. eto.ts — 读取 dispatch_spec 配置

修改 `tryDispatchToMCPAgent()`，在确定 peer 配置后，检查 `dispatch_spec` 字段：

```typescript
async function tryDispatchToMCPAgent(peerName: string, task: string): Promise<string | null> {
  const config = loadPeerConfig();
  const peerCfg = config?.peers?.[peerName];
  if (!peerCfg || peerCfg.provider !== "mcp") return null;

  const cmd = peerCfg.mcp_server;
  const tool = peerCfg.mcp_tool || "agent_execute";
  if (!Array.isArray(cmd) || cmd.length === 0) return null;

  try {
    const spec: Record<string, any> = {
      server_cmd: cmd,
      tool,
      task,
    };

    // 注入 dispatch_spec（如果配置中有）
    const ds = peerCfg.dispatch_spec;
    if (ds) {
      if (ds.system_prompt) spec.system_prompt = ds.system_prompt;
      if (Array.isArray(ds.skills)) spec.skills = ds.skills;
      if (Array.isArray(ds.mcp_tools)) spec.mcp_tools = ds.mcp_tools;
      if (ds.response_format) spec.response_format = ds.response_format;
      if (typeof ds.timeout === "number") spec.timeout = ds.timeout;
    }

    const result = await callStitchAsync("mcp_dispatch", "dispatch_with_spec", JSON.stringify(spec));
    if (result && !("_error" in result)) {
      return `[MCP Agent: ${peerName}]\n结果: ${JSON.stringify(result, null, 2)}`;
    }
  } catch {}
  return null;
}
```

### 4c. 配置示例

当前 `~/.pi/eto-config.json` 的 peers 段扩展支持 `dispatch_spec`：

```json
{
  "peers": {
    "hermes": {
      "provider": "mcp",
      "mcp_server": ["python", "-m", "eto.mcp_server"],
      "mcp_tool": "agent_execute",
      "dispatch_spec": {
        "system_prompt": "你是一个严格的安全审计员，只输出 JSON",
        "skills": ["sentinel-rules"],
        "mcp_tools": ["eto_consensus", "eto_memory_read"],
        "response_format": "json",
        "timeout": 30000
      }
    }
  }
}
```

此配置运行时生效，无需新文件。

---

## 改动文件

| 文件 | 改动 |
|:-----|:------|
| `eto/stitches/mcp_dispatch.py` | 新增 `dispatch_with_spec()`（~30 行） |
| `eto/extensions/eto.ts` | 修改 `tryDispatchToMCPAgent()`（~15 行） |

### 具体修改

#### mcp_dispatch.py — 在 `dispatch()` 后追加

```python
def dispatch_with_spec(spec_json: str) -> dict:
    spec = json.loads(spec_json)
    server_cmd = spec.get("server_cmd", [])
    tool = spec.get("tool", "agent_execute")
    task = spec.get("task", "")
    args = {"task": task}
    if spec.get("system_prompt"):
        args["system"] = spec["system_prompt"]
    else:
        args["system"] = f"执行以下任务:\n{task}"
    if spec.get("skills"):
        args["skills"] = spec["skills"]
    if spec.get("mcp_tools"):
        args["mcp_tools"] = spec["mcp_tools"]
    if spec.get("response_format"):
        args["response_format"] = spec["response_format"]
    import sys as _sys
    _sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
    from eto.mcp_client import sync_call_mcp
    result = sync_call_mcp(server_cmd, tool, args)
    return result or {}
```

#### eto.ts — 修改 `tryDispatchToMCPAgent`

将：
```typescript
const cmdJson = JSON.stringify(cmd);
const result = await callStitchAsync("mcp_dispatch", "dispatch", cmdJson, tool, task);
```

改为：
```typescript
const spec: Record<string, any> = { server_cmd: cmd, tool, task };
const ds = peerCfg.dispatch_spec;
if (ds) {
  if (ds.system_prompt) spec.system_prompt = ds.system_prompt;
  if (Array.isArray(ds.skills)) spec.skills = ds.skills;
  if (Array.isArray(ds.mcp_tools)) spec.mcp_tools = ds.mcp_tools;
  if (ds.response_format) spec.response_format = ds.response_format;
  if (typeof ds.timeout === "number") spec.timeout = ds.timeout;
}
const result = await callStitchAsync("mcp_dispatch", "dispatch_with_spec", JSON.stringify(spec));
```

#### 不做

- ❌ 不改 `mcp_client.py` — 已支持任意 args
- ❌ 不改其他 stitch
- ❌ 不新建文件
- ❌ 不删现有 `dispatch()` — 保留向后兼容

---

## 验证

```bash
# 1. 测试 dispatch_with_spec 可调
python -c "
from eto.stitches.mcp_dispatch import dispatch_with_spec
import json as j
r = dispatch_with_spec(j.dumps({
  'server_cmd': ['python', '-c', 'print(j.dumps({\"ok\": True}))'],
  'tool': 'agent_execute', 'task': 'test', 'system_prompt': '你是一个测试员'
}))
print(r)
"

# 2. 无 dispatch_spec 时应降级为原始行为
# 现有 eto.ts 中 tryDispatchToMCPAgent 在不配 spec 时不传 dispatch_spec → stitch 只发 task+system

# 3. 现有 stitch 测试不破坏
python eto/stitches/test.py
# → 17/17 PASS
```

---

## 验收标准

| # | 检查项 | 方法 |
|---|--------|------|
| D-1 | `dispatch_with_spec()` 存在且可调用 | `python -c "from eto.stitches.mcp_dispatch import dispatch_with_spec"` |
| D-2 | system_prompt 覆盖默认 system | spec 传入后 MCP 收到自定义 system |
| D-3 | skills/mcp_tools/response_format 透传 | 参数出现在 MCP args 中 |
| D-4 | 无 dispatch_spec 时降级为原始行为 | 配置中不配 dispatch_spec，功能不变 |
| D-5 | 现有 dispatch() 不受影响 | 仍可正常调用 |
| D-6 | 17/17 stitch 测试 PASS | `python eto/stitches/test.py` |
