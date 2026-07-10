# Completion: HITL 认知质量层 — 三 Gate + 双入口

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE
> 日期: 2026-07-10

## 改动

| 文件 | 改动 |
|:-----|:------|
| `eto/stitches/quality/__init__.py` | **新建** — 包标记 |
| `eto/stitches/quality/clarify.py` | **新建** — `detect_vague()` 模糊指令检测 |
| `eto/stitches/quality/review.py` | **新建** — `extract_key_points()` + `summarize_dispatch_result()` |
| `eto/stitches/quality/feedback.py` | **新建** — `save_constraint()` + `get_constraints()` + `inject_constraints()` |
| `eto/mcp_server.py` | 新增 `eto_clarify` / `eto_review` / `eto_feedback` 三个 MCP 工具 |
| `eto/stitches/mcp_dispatch.py` | `dispatch_with_spec()` 调 `inject_constraints()` |
| `eto/extensions/eto.ts` | plan 路由加 Clarify Gate |

## 三 Gate

| Gate | 逻辑 | Pi 入口 | MCP 入口 |
|:-----|:------|:--------|:---------|
| Clarify | `detect_vague()` 模糊词检测 | notify + widget | `eto_clarify` → JSON |
| Review | `extract_key_points()` 摘要提取 | — | `eto_review` → JSON |
| Feedback | `save_constraint()` 约束沉淀 | — | `eto_feedback` → JSON |

约束注入点在 `mcp_dispatch.py` 的 `dispatch_with_spec()` 中，自动生效。

## 验证

```
detect_vague("帮我分析一下")  → 匹配"分析"，3 个建议方向 ✅
detect_vague("写个登录页")    → None（精确指令） ✅
extract_key_points("- 市场增长15%\n- 风险偏低") → ["市场增长15%", "风险偏低"] ✅
```
