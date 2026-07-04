# ETO MCP — 青色组织多 Agent 编排

> 让任何 AI Agent 通过 MCP 协议调用 ETO 的共识评分、路由分析和 Peer 配置。

## 名称

**ETO MCP** (或简称 `eto-mcp`)

## 安装

```json
// 加到你的 MCP 配置文件 (claude_desktop_config.json / .mcp.json 等)
{
  "mcpServers": {
    "eto-mcp": {
      "command": "python",
      "args": ["-m", "eto.mcp_server"]
    }
  }
}
```

## 前提

```bash
pip install -e /path/to/eto     # 或 pip install eto
```

## 暴露的工具

| 工具 | 作用 | 调用示例 |
|:-----|:------|:---------|
| `eto_consensus` | 三阶段共识评分（评分→审议→终审） | `{"plan": "格式化硬盘", "peers": ["researcher","coder","auditor"]}` |
| `eto_route` | 三镜路由分类 | `{"task": "写一个Python程序"}` |
| `eto_peer_config` | 读取 Peer Provider 配置 | `{}` |

## 快速测试

```bash
python -m eto.mcp_server
# 然后用 MCP Inspector 或 echo 测试：
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python -m eto.mcp_server
```

## 作为 Peer 注册到 ETO

在 `~/.pi/eto-config.json` 中配置 peers 使用 MCP：

```json
{
  "peers": {
    "reasonix": {
      "provider": "mcp",
      "model": "[\"python\", \"-m\", \"reasonix_mcp_server\"]"
    }
  }
}
```
