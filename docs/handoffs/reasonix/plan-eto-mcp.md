# Plan: ETO MCP 集成 — MCP Server + MCP Provider

> 创建日期: 2026-07-04 | 来源: Claude Code
> 执行: Reasonix → 审计: Claude Code

---

## 现状

当前 ETO 的 peer 共识系统只能调 raw LLM API：

```
vote.py → _call_provider()
           ├─ ollama   (Ollama generate API)
           ├─ deepseek (DeepSeek chat API)
           └─ claude   (Anthropic Messages API)
```

问题：

| 问题 | 说明 |
|:-----|:------|
| 只能调 LLM，不能调完整 Agent | 没法让 Reasonix / 其他 Agent 参与共识评分 |
| ETO 自身不暴露服务入口 | Claude Code 不能直接调 ETO 的共识/路由 |
| 每个 provider 是硬编码 API 调用 | 加新 provider 要改代码 |

---

## 方案

### 架构

```
                    ┌──────────────┐
  Claude Code ─────▶│  ETO MCP     │◀───── MCP Client (其他 Agent)
  Reasonix    ─────▶│  Server      │
  其他 Agent  ─────▶│  (stdio)     │
                    └──────┬───────┘
                           │ 内部调 stitches
                    ┌──────▼───────┐
                    │  vote.py     │──▶ ollama
                    │  provider    │──▶ deepseek
                    │  router      │──▶ claude
                    │              │──▶ **mcp** ← 新增
                    └──────────────┘
```

两个新增：

### A — ETO MCP Server（暴露 ETO）
文件：`eto/mcp_server.py`

用 `mcp.server.fastmcp.FastMCP` 创建 stdio 模式的 MCP Server，暴露工具：

| 工具名 | 作用 | 参数 |
|:-------|:-----|:------|
| `eto_consensus` | 同侪共识评分 | plan, peers |
| `eto_route` | 三镜路由分类 | task |
| `eto_peer_config` | 读取 peer provider 映射 | 无 |

启动：`python -m eto.mcp_server`，通过 stdio 通信。

### B — MCP Provider（调其他 Agent）
在 `vote.py` 的 `_call_provider()` 中新增 `mcp` 类型。

当 peer 配置为 `{"provider": "mcp", "mcp_server": {...}}` 时，启动 MCP Client 连接目标 MCP Server，调用其工具来评分。

新增文件：`eto/mcp_client.py` — MCP 客户端工具函数

```python
async def call_mcp_tool(server_cmd: list[str], tool: str, args: dict) -> str:
    """连接到 stdio MCP Server 并调用工具"""
```

由于 vote.py 是同步的（被 subprocess 调用），在 `_call_provider` 中用 `asyncio.run()` 包装。

### C — 注册到 .mcp.json
让 Claude Code 能发现并调用 ETO MCP Server。

---

### 改动文件

| 文件 | 改动 | 类型 |
|:-----|:------|:------|
| `eto/mcp_server.py` | 新建：FastMCP Server，暴露 eto_consensus/eto_route/eto_peer_config | **新文件** |
| `eto/mcp_client.py` | 新建：`call_mcp_tool()` 异步函数，连接 stdio MCP 调工具 | **新文件** |
| `eto/stitches/consensus/vote.py` | `_call_provider()` 新增 `mcp` 分支；新增 `_call_mcp_peer()` | 修改 |
| `.mcp.json` | 注册 ETO MCP Server（command: python, args: -m eto.mcp_server） | 修改 |
| `eto/bootstrap/config_template.py` | peers 段增加 mcp 示例注释 | 修改 |

---

### 关键实现细节

#### mcp_server.py

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("eto", instructions="ETO 青色组织多 Agent 编排系统")

@mcp.tool(description="同侪共识评分：三阶段（评分→审议→终审）")
def eto_consensus(plan: str, peers: list[str] | None = None) -> str:
    from eto.stitches.consensus.vote import peer_review
    import json
    return json.dumps(peer_review(plan, peers or ["researcher", "coder", "auditor"]), ensure_ascii=False)

@mcp.tool(description="三镜路由：分析任务分类")
def eto_route(task: str) -> str:
    # 关键词路由简化版
    ...

@mcp.tool(description="获取 peer provider 配置")
def eto_peer_config() -> str:
    ...

def main():
    mcp.run(transport="stdio")
```

#### mcp_client.py

```python
import asyncio, json
from mcp.client.stdio import stdio_client
from mcp import StdioServerParameters

async def call_mcp_tool(server_cmd: list[str], tool: str, args: dict) -> dict | None:
    """连接 stdio MCP Server 并调用工具"""
    params = StdioServerParameters(command=server_cmd[0], args=server_cmd[1:])
    try:
        async with stdio_client(params) as (read, write):
            from mcp.client.session import ClientSession
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool(tool, args)
                if result.content:
                    text = "".join(c.text for c in result.content if c.type == "text")
                    return json.loads(text) if text else None
    except: return None

def sync_call_mcp(server_cmd: list[str], tool: str, args: dict) -> dict | None:
    """同步包装，供 vote.py 的 _call_provider 调用"""
    return asyncio.run(call_mcp_tool(server_cmd, tool, args))
```

#### vote.py 改动

在 `_call_provider()` 中添加分支：

```python
def _call_provider(provider: str, model: str, system: str, prompt: str) -> str:
    if provider == "mcp":
        return _call_mcp_peer(model, system, prompt)  # model 参数存的是 server_cmd 的 json
    ...
```

Peer 配置格式：

```json
{
  "peers": {
    "coder": {
      "provider": "mcp",
      "mcp_server": ["python", "-m", "some_agent_mcp_server"],
      "mcp_tool": "agent_review"
    }
  }
}
```

#### .mcp.json 新增

```json
{
  "mcpServers": {
    "eto": {
      "command": "python",
      "args": ["-m", "eto.mcp_server"]
    }
  }
}
```

---

### 验收标准

| # | 检查项 | 验证方式 |
|---|--------|----------|
| MCP-1 | ETO MCP Server 启动并响应 tools/list | `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python -m eto.mcp_server` 返回工具列表 |
| MCP-2 | eto_consensus tool 返回有效结果 | MCP 调 eto_consensus("test") 返回含 status/final_score 的 JSON |
| MCP-3 | eto_route tool 返回路由结果 | MCP 调 eto_route("写个程序") 返回 gewu=code |
| MCP-4 | vote.py mcp provider 路径不崩溃 | 配置 mcp provider，_call_provider 不抛异常（不要求真的 MCP 服务在运行） |
| MCP-5 | .mcp.json 格式正确 | JSON 解析通过 |
| MCP-6 | 全部测试仍然 PASS | `python eto/stitches/test.py` 11/11 |

---

### 实施顺序

```
Step 1 → eto/mcp_server.py              — FastMCP Server，3 个 tool
Step 2 → eto/mcp_client.py              — call_mcp_tool + sync 包装
Step 3 → vote.py 加 mcp provider 分支     — _call_provider + _call_mcp_peer
Step 4 → .mcp.json + config_template     — 注册 + 示例
Step 5 → 跑 test.py 验证                  — 保证 11/11 PASS
```

总计约 25 分钟。
