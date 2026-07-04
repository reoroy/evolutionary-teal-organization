# Completion: Teal Runtime Phase B (v2) — LangGraph 工作流

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE
> 日期: 2026-07-04

## 改动

| 文件 | 改动 |
|:-----|:------|
| `eto/stitches/bidding/workflow.py` | 重写为 LangGraph 版本 |
| `eto/extensions/eto.ts` | plan 路由调用 `design_workflow` + `execute_workflow(design, task)` |
| `pyproject.toml` | 加 `langgraph>=0.2.0` |

## 流程

```
任务 → design_workflow()
         ├── generate_proposals() — LLM 出 2-3 方案
         ├── vote_on_proposals() — 各 Agent 独立投票 + 自选配置
         └── 选标 + 合并 self_config
         ↓
build_graph() → LangGraph StateGraph
         ↓
execute_workflow() → graph.invoke()
         ├── 节点调 dispatch_with_spec
         ├── 条件边 (auditor 失败 → 重试)
         └── 结果写 agentmemory
```

## 验证

```
Stitcher 17/17 PASS ✅
LangGraph import OK ✅
```
