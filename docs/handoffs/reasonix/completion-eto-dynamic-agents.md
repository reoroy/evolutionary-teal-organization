# Completion: ETO 动态 Agent 协作 — LangGraph 运行时图构建

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE
> 日期: 2026-07-12

## 改动

| 文件 | 改动 |
|:-----|:------|
| `eto/stitches/registry.py` | 新增 `get_available_agents()` — 3 内置 + registry peers |
| `eto/stitches/bidding/workflow.py` | 新增 `select_agent()` + `generate_steps()` + `build_dynamic_graph()` |
| `eto/stitches/test.py` | 新增 3 条测试（select_agent / generate_steps / registry） |

## 新能力

| 函数 | 作用 |
|:-----|:------|
| `get_available_agents()` | 返回所有可用 Agent（3 内置 + 注册表） |
| `select_agent(task, agents)` | 按能力匹配选择最合适的 Agent |
| `generate_steps(task)` | 根据任务关键词动态生成步骤 |
| `build_dynamic_graph(task)` | 动态构建 LangGraph: 选 Agent → 生成步骤 → 建图 |

## Agent 选择

```
select_agent("写一个登录页", [coder, researcher])
  → coder（能力匹配 "写"/"code"）
```

## 步骤生成

```
generate_steps("调研方案，写代码，审查安全")
  → [调研, 编码, 审查]（3 步）
generate_steps("hello")
  → [执行]（1 步兜底）
```

## 验证

```
select_agent("写代码") → coder ✅
generate_steps(复杂任务) → 3 步 ✅
get_available_agents() → ≥3 ✅
build_dynamic_graph() → dynamic + 3 steps ✅
```
