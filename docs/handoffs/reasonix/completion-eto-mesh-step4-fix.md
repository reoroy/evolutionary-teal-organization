# Completion: ETO Mesh Step 4 Fix — dispatch_spec 参数透传

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE
> 日期: 2026-07-04

## 改动

| 文件 | 改动 |
|:-----|:------|
| `eto/stitches/mcp_dispatch.py` | +3 行: `args.update(spec.get("params", {}))` |
| `eto/extensions/eto.ts` | +1 行: `if (ds.params) spec.params = ds.params` |

## 效果

MCP 调用现在可透传任意参数。配置示例：

```json
{
  "hermes": {
    "provider": "mcp",
    "mcp_server": ["python", "-m", "eto.mcp_server"],
    "mcp_tool": "eto_consensus",
    "dispatch_spec": {
      "params": {
        "plan": "删除生产数据库",
        "peers": ["researcher", "coder", "auditor"]
      }
    }
  }
}
```

## 验证

```
Stitcher test: 17/17 PASS ✅
```
