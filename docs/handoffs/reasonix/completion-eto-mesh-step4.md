# Completion: ETO Mesh Step 4 — dispatch_spec 完整支持

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE
> 日期: 2026-07-04

## 改动

| 文件 | 改动 |
|:-----|:------|
| `eto/stitches/mcp_dispatch.py` | 新增 `dispatch_with_spec()`（~35 行） |
| `eto/extensions/eto.ts` | `tryDispatchToMCPAgent` 改用 dispatch_with_spec + 读取 dispatch_spec |

## 能力

`dispatch_with_spec(spec_json)` 支持自定义：

| 参数 | 类型 | 默认 |
|:-----|:------|:------|
| `system_prompt` | string | "执行以下任务: {task}" |
| `skills` | string[] | 无 |
| `mcp_tools` | string[] | 无 |
| `response_format` | string | 无 |
| `timeout` | number | 无 |

向后兼容：不配 `dispatch_spec` 时降级为原始行为。

## 验证

```
Stitcher test: 17/17 PASS ✅
```
