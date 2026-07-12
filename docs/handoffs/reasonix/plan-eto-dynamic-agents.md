# Plan: ETO 动态 Agent 协作 — LangGraph 运行时图构建

> 创建日期: 2026-07-12
> 基线: v0.1.8
> 来源: 当前 workflow.py 是静态图，步骤在编译时确定。需要动态构造图和选择 Agent。

## 现状

`workflow.py` 的 `execute_workflow()` 使用 `StateGraph` 构建固定图，每个 step 通过 `dispatch_with_spec()` 分发任务。步骤数量和方法在调用前就已确定。

**问题：**
- 每个 step 的 agent 是硬编码的（"coder", "researcher", "auditor"）
- 图的拓扑是静态的，不能根据任务复杂度动态扩展
- 没有能力匹配，只是角色匹配

## 方案

### 1. 动态 Agent 选择

当前每个 step 的 `assignee` 是固定的。改为运行时根据任务类型和 Agent 能力动态选择。

```python
def select_agent(task: str, available_agents: list[dict]) -> str:
    """根据任务类型和 Agent 能力，动态选择最合适的 Agent"""
    # 优先级：精确匹配 > 模糊匹配 > 默认
    for agent in available_agents:
        if task_match(agent["capabilities"], task):
            return agent["id"]
    return available_agents[0]["id"]
```

### 2. 动态图构建

每次执行工作流前，根据任务复杂度动态生成步骤：

```python
def build_dynamic_graph(task: str, available_agents: list[dict]) -> StateGraph:
    """根据任务复杂度动态生成图"""
    steps = generate_steps(task, available_agents)
    graph = StateGraph(WorkflowState)
    for i, step in enumerate(steps):
        graph.add_node(f"step_{i}", _make_node_fn(step))
    for i in range(len(steps) - 1):
        graph.add_edge(f"step_{i}", f"step_{i+1}")
    graph.set_entry_point("step_0")
    graph.add_edge("step_1", END)  # 最后一步连到 END
    return graph.compile()
```

### 3. Agent 注册表

`registry.py` 提供 `get_available_agents()` 方法，返回当前可用的 Agent 列表。

```python
def get_available_agents() -> list[dict]:
    """返回所有可用的 Agent，按能力分组"""
    agents = {}
    for agent in get_peers():
        agents[agent["id"]] = agent
    return list(agents.values())
```

## 改动

| 文件 | 改动 | 类型 |
|:-----|:------|:-----|
| `eto/stitches/registry.py` | 新增 `get_available_agents()` | 修改 |
| `eto/stitches/bidding/workflow.py` | 动态图构建 + Agent 选择 | 修改 |
| `eto/stitches/test.py` | 新增 3 条测试 | 修改 |

**总计：~60 行**

## 验收

```bash
# 1. 获取可用 Agent
python -c "from eto.stitches.registry import get_available_agents; print(get_available_agents())"

# 2. 动态图构建
python -c "from eto.stitches.bidding.workflow import build_dynamic_graph; print(build_dynamic_graph('写一个登录页', get_available_agents()))"

# 3. 测试
python eto/stitches/test.py
```

| # | 检查项 | 方法 |
|:-:|:-------|:------|
| D-1 | `get_available_agents()` 返回可用 Agent | CLI 测试 |
| D-2 | `build_dynamic_graph()` 动态构建图 | 运行验证 |
| D-3 | Agent 选择基于能力匹配 | 测试用例 |
| D-4 | 图正确连接（entry → 每步 → END） | 图结构验证 |
| D-5 | 5/5 测试 PASS | `python eto/stitches/test.py` |