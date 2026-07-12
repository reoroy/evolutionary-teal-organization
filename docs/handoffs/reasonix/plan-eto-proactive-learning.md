# Plan: ETO 主动训练 — 基于执行历史的自动学习

> 创建日期: 2026-07-12
> 基线: v0.1.8
> 来源: 路由学习 — 每次执行后自动记录结果，逐步优化路由决策

## 现状

当前每个任务的路由和 Agent 选择是**无记忆的**——每次执行都从头开始，不记得之前的成功/失败经验。

**问题：**
- 同一个类型的任务，如果之前失败了，下次还会选同样的 Agent
- 没有从执行历史中学习的机制

## 方案

### 1. 自动记录执行结果

在 `a2a.py` 的 `execute_plan()` 中，每步执行后记录到 `shared_memory`：

```python
# 每次执行后记录
try:
    from eto.stitches.memory.shared_memory import write
    write(f"task_outcome:{step['agent']}", {
        "type": "task_outcome",
        "task": task,
        "status": "ok" if result else "fail",
        "ts": time.time()
    })
except: pass
```

### 2. 计算历史成功率

在 `eto.ts` 的路由阶段，根据历史记录调整候选 Agent 的评分：

```typescript
const outcomes = await callStitchAsync("memory", "get_outcomes", "coder");
// outcomes = [{status: "ok", ts: ...}, {status: "fail", ...}]
// successRate = ok / total
```

### 3. 路由时注入成功权重

`select_agent()` 在匹配能力后，用成功率调整最终选择：

```python
def select_agent(task, available_agents):
    scored = [(a["id"], _match_capability(a, task)) for a in available_agents]
    for item in scored:
        item[1] += get_success_rate(item[0]) * 0.2  # 成功率加分
    return scored[0][0]
```

## 改动

| 文件 | 改动 | 类型 |
|:-----|:------|:-----|
| `eto/stitches/comms/a2a.py` | 每步执行后记录 `task_outcome` | 修改 |
| `eto/stitches/memory/shared_memory.py` | 新增 `get_outcomes()` 读取历史 | 修改 |
| `eto/stitches/bidding/workflow.py` | `select_agent` 注入成功率 | 修改 |
| `eto/stitches/test.py` | 新增 2 条测试 | 修改 |

**总计：~40 行**

## 验收

```bash
# 1. 模拟执行结果
python -c "
from eto.stitches.memory.shared_memory import write, get_outcomes
write('task_outcome:coder', {'status': 'ok'}, 'test')
print(get_outcomes('coder'))
"

# 2. 成功率计算
python -c "
from eto.stitches.bidding.workflow import select_agent, get_available_agents
agents = get_available_agents()
print(select_agent('写一个登录页', agents))
"

# 3. 测试
python eto/stitches/test.py
```

| # | 检查项 | 方法 |
|:-:|:-------|:------|
| L-1 | 每步执行后记录 `task_outcome` | CLI 测试 |
| L-2 | `get_outcomes()` 读取历史 | CLI 测试 |
| L-3 | `select_agent` 考虑成功率 | 测试用例 |
| L-4 | 11 条测试全部 PASS | `python eto/stitches/test.py` |