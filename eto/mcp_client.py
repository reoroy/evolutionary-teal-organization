"""ETO MCP Client — 调其他 Agent 的 MCP Server"""
import asyncio, concurrent.futures, json
from mcp.client.stdio import stdio_client
from mcp import StdioServerParameters

async def call_mcp_tool(server_cmd: list[str], tool: str, args: dict) -> dict | None:
    """连接 stdio MCP Server 并调用工具

    连接/调用失败会向上抛异常（由调用方分类处理），不再吞掉返回 None。
    只有「工具正常执行但无返回内容」才返回 None。
    """
    params = StdioServerParameters(command=server_cmd[0], args=server_cmd[1:])
    async with stdio_client(params) as (read, write):
        from mcp.client.session import ClientSession
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(tool, args)
            if result.content:
                text = "".join(c.text for c in result.content if c.type == "text")
                return json.loads(text) if text else None
    return None

def _run_in_private_loop(coro):
    """在私有线程的事件循环里跑协程。

    FastMCP 的同步工具在服务端事件循环线程上直接执行（不走线程池），
    此时 asyncio.run() 会抛 "cannot be called from a running event loop"。
    用独立线程 + 独立循环绕开，保证嵌套 MCP 调用（server 调 server）可用。
    """
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
        return ex.submit(asyncio.run, coro).result()

def sync_call_mcp(server_cmd: list[str], tool: str, args: dict) -> dict | None:
    """同步包装，供 vote.py 的 _call_provider 调用（自动感知事件循环）"""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(call_mcp_tool(server_cmd, tool, args))
    return _run_in_private_loop(call_mcp_tool(server_cmd, tool, args))
