# Plan: HITL 认知质量层 — 双平台（Pi + MCP）

> 创建日期: 2026-07-10 | 来源: Hermes Agent + Claude Code 重写
> 基线: v0.1.8
> 设计原则: 逻辑层不依赖平台，MCP 工具返回结构化 JSON（任何 AI Agent 兼容）

---

## 现状

ETO 的"人在回路"只有智子安检（规则拦截），缺三个东西：

| 缺口 | 表现 |
|:-----|:------|
| 指令模糊 | "分析一下"直接 dispatch，Agent 猜你要什么 |
| 人不看结果 | 三阶段评分跑完你扫一眼就过了 |
| 反馈不沉淀 | 这次说"要数据不要宏观分析"，下次还是一样 |

## 方案：三 Gate + 双入口

```
三镜路由 ──→ [Clarify Gate] ──→ 协调员设计 ──→ dispatch ──→ [Review Gate] ──→ 结果
                     │                          ↑                          │
                     └── 模糊指令拦截 ───────────┘   结果摘要+确认 ←───────┘
                                                                        │
                                                                  [Feedback Loop]
                                                                        │
                                                              约束写入 shared_memory
```

每个 Gate 都是**无 LLM 的**（纯规则 + KV），逻辑共享，交互分平台。

### 1. Clarify Gate — 指令澄清

**逻辑（共享）：** `eto/stitches/quality/clarify.py`

```python
_VAGUE_WORDS = ["分析", "优化", "研究", "看看", "搞一下", "弄一下",
                "fix", "improve", "optimize", "look into", "check"]

def detect_vague(task: str) -> dict | None:
    """检测模糊指令，返回澄清选项"""
    t = task.lower()
    hits = [w for w in _VAGUE_WORDS if w in t]
    if not hits:
        return None
    return {
        "vague": True,
        "matched": hits,
        "task": task,
        "suggestions": _suggestions_for(hits[0]),
    }

def _suggestions_for(word: str) -> list[str]:
    """按模糊词返回预选方向"""
    db = {
        "分析": ["分析市场/行业", "分析代码质量", "分析数据/报表"],
        "优化": ["优化性能", "优化代码结构", "优化部署流程"],
        "研究": ["研究技术方案", "研究竞品", "研究可行性"],
        "看看": ["看看当前状态", "看看报告", "看看代码"],
    }
    return db.get(word, [f"明确{word}的具体范围"])
```

**交互入口 1 — Pi 终端（`eto.ts`）：**
- 路由命中 plan 后，先调 `detect_vague(task)`
- 如果返回非空 → `ctx.ui.notify` + `ctx.ui.confirm` 弹选项
- 用户确认后才继续协调员设计

**交互入口 2 — MCP 工具（`mcp_server.py`）：**
```python
@mcp.tool(description="检测任务指令是否模糊，返回澄清选项")
def eto_clarify(task: str) -> str:
    """输入任务指令，输出结构化澄清选项。任何 MCP 兼容的 AI Agent 可调。"""
    result = detect_vague(task)
    return json.dumps(result or {"vague": False, "task": task}, ensure_ascii=False)
```

**交互入口 3 — JSON 协议（其他 AI Agent 通用）：**
`eto_clarify` 返回 JSON 格式，任何 Agent 可以自己渲染：

```json
{
  "vague": true,
  "matched": ["分析"],
  "task": "帮我分析一下",
  "suggestions": ["分析市场/行业", "分析代码质量", "分析数据/报表"]
}
```

### 2. Review Gate — 看完才能走

**逻辑（共享）：** `eto/stitches/quality/review.py`

```python
def extract_key_points(text: str, max_points: int = 3) -> list[str]:
    """提取重点摘要（规则提取非 LLM）：取 bullet / numbered list / 前 200 字"""
    lines = text.split("\n")
    points = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("-") or stripped.startswith("*"):
            points.append(stripped.lstrip("-* "))
        elif stripped and stripped[0].isdigit() and ". " in stripped[:4]:
            points.append(stripped.split(". ", 1)[1])
    if not points:
        points.append(text[:200])
    return points[:max_points]

def summarize_dispatch_result(agent: str, result: dict) -> dict:
    """结构化的审查摘要"""
    raw = json.dumps(result, ensure_ascii=False) if isinstance(result, dict) else str(result)
    return {
        "agent": agent,
        "summary": extract_key_points(raw),
        "raw_length": len(raw),
    }
```

**交互入口 1 — Pi 终端：**
- dispatch 返回后调用 `summarize_dispatch_result()`
- 打印摘要 + 输入确认：`"已确认理解结果？(y/N)"`
- 不确认不往下走

**交互入口 2 — MCP 工具：**
```python
@mcp.tool(description="审查 sub-agent 返回结果，返回结构化摘要供确认")
def eto_review(agent: str, result_json: str) -> str:
    """输入 Agent 名 + 返回 JSON，输出审查摘要。"""
    result = json.loads(result_json)
    return json.dumps(summarize_dispatch_result(agent, result), ensure_ascii=False)
```

**交互入口 3 — 其他 Agent：**
`eto_review` 返回 JSON，Agent 可以展示要点并等待用户确认。

### 3. Feedback Loop — 拒绝变规则

**逻辑（共享）：** `eto/stitches/quality/feedback.py`

```python
CONSTRAINTS_KEY = "routing:constraints"

def save_constraint(agent: str, constraint: str) -> dict:
    """写入 routing 约束到 shared_memory"""
    from eto.stitches.memory.shared_memory import write, read
    existing = read(CONSTRAINTS_KEY) or []
    entry = {"agent": agent, "constraint": constraint, "ts": time.time()}
    existing.append(entry)
    write(CONSTRAINTS_KEY, existing, author="feedback")
    return {"saved": True, "agent": agent, "constraint": constraint}

def get_constraints(agent: str) -> list[str]:
    """读取该 Agent 的所有约束，用于注入 dispatch_spec"""
    from eto.stitches.memory.shared_memory import read
    all_c = read(CONSTRAINTS_KEY) or []
    return [c["constraint"] for c in all_c if c.get("agent") == agent]

def inject_constraints(spec: dict) -> dict:
    """将约束注入 dispatch_spec 的 system_prompt"""
    agent = spec.get("tool", "").replace("agent_execute", "")
    constraints = get_constraints(agent)
    if constraints:
        sp = spec.get("system_prompt", "")
        sp += "\n\n**用户历史反馈约束：**\n" + "\n".join(f"- {c}" for c in constraints)
        spec["system_prompt"] = sp
    return spec
```

**交互入口 1 — Pi 终端：**
- Review Gate 拒绝时弹：`"保存为约束？下次自动加上？(y/N)"`
- y → 调 `save_constraint()` → 写 shared_memory

**交互入口 2 — MCP 工具：**
```python
@mcp.tool(description="保存用户反馈为 routing 约束，下次 dispatch 自动注入")
def eto_feedback(agent: str, constraint: str) -> str:
    return json.dumps(save_constraint(agent, constraint), ensure_ascii=False)
```

**约束注入点：** `eto/stitches/mcp_dispatch.py` 的 `dispatch_with_spec()` 中，调 MCP 前加：

```python
# 注入历史约束
from eto.stitches.quality.feedback import inject_constraints
spec = inject_constraints(spec)
```

---

## 改动文件

| 文件 | 改动 | 行数 | 类型 |
|:-----|:------|:----:|:-----|
| `eto/stitches/quality/__init__.py` | 包标记 | 1 | 新建 |
| `eto/stitches/quality/clarify.py` | `detect_vague()` + `_suggestions_for()` | ~35 | 新建 |
| `eto/stitches/quality/review.py` | `extract_key_points()` + `summarize_dispatch_result()` | ~30 | 新建 |
| `eto/stitches/quality/feedback.py` | `save_constraint()` + `get_constraints()` + `inject_constraints()` | ~35 | 新建 |
| `eto/mcp_server.py` | 新增 `eto_clarify` / `eto_review` / `eto_feedback` 三个 tool | ~15 | 修改 |
| `eto/stitches/mcp_dispatch.py` | `dispatch_with_spec()` 调 `inject_constraints()` | ~3 | 修改 |
| `eto/extensions/eto.ts` | Pi 交互入口：Clarify Gate + Review Gate + Feedback Loop | ~30 | 修改 |

**总计：~150 行**

---

## 交互矩阵

| Gate | Python 逻辑 | Pi (eto.ts) | MCP (mcp_server.py) | 其他 Agent |
|:-----|:-----------|:-------------|:---------------------|:------------|
| Clarify | `detect_vague()` | notify 弹选项 + confirm | `eto_clarify` → JSON | 读 `eto_clarify` JSON |
| Review | `summarize_dispatch_result()` | 打印摘要 + y/N 确认 | `eto_review` → JSON | 读 `eto_review` JSON |
| Feedback | `save_constraint()` | y/N 存约束 | `eto_feedback` → JSON | 读 `eto_feedback` JSON |
| 约束注入 | `inject_constraints()` | dispatch 时自动 | dispatch 时自动 | dispatch 时自动 |

---

## 不做的

| 不做什么 | 原因 |
|:---------|:------|
| 不做 LLM 检测 | 关键词规则够用，零 token |
| 不做 Web UI | Pi + MCP 双入口覆盖全部场景 |
| 不改共识系统 | 共识是 Agent 审 Agent，这个是人审 Agent 的结果 |
| 不新增 pip 依赖 | `shared_memory` 已有的 KV 就够 |
| 不写死交互模板 | MCP 工具返回 JSON，Agent 自己决定怎么展示 |

---

## 验收

```bash
# 1. 模糊词检测
python -c "
from eto.stitches.quality.clarify import detect_vague
print(detect_vague('帮我分析一下'))
print(detect_vague('写个登录页'))
"

# 2. 要点提取
python -c "
from eto.stitches.quality.review import extract_key_points
print(extract_key_points('- 市场增长15%\n- 风险偏低'))
"

# 3. 约束读写
python -c "
from eto.stitches.quality.feedback import save_constraint, get_constraints
save_constraint('researcher', '优先提供数据')
print(get_constraints('researcher'))
"

# 4. MCP 工具
python -c "
from eto.mcp_server import eto_clarify
print(eto_clarify('分析一下'))
"

# 5. 测试
python eto/stitches/test.py
```

| # | 检查项 | 方法 |
|:-:|:-------|:------|
| H-1 | `detect_vague()` 返回结构化选项 | CLI 测试 |
| H-2 | Pi 终端在路由到 plan 时弹 clarify | 运行 `pi -p "分析一下"` |
| H-3 | `eto_clarify` MCP 工具返回 JSON | MCP 调用验证 |
| H-4 | `extract_key_points()` 提取 bullet/list | CLI 测试 |
| H-5 | Pi 终端在 dispatch 后弹 review | 运行确认 |
| H-6 | `save_constraint()` 写入 shared_memory | 读 shared_memory 验证 |
| H-7 | 约束自动注入 dispatch_with_spec | dispatch 后检查 system_prompt |
| H-8 | 17/17 测试 PASS | `python eto/stitches/test.py` |
