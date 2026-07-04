"""ETO MCP Client — 调其他 Agent 的 MCP Server"""
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
