# Plan: Phase 5 — 真实多 Agent 共识系统（已审计更新）

> 创建日期: 2026-07-02 | 更新: 2026-07-04（Claude Code 审计后修正）
> 执行: Reasonix → 审计: Claude Code

---

## 现状

当前共识系统的问题：

| 层面 | 当前 | 问题 |
|------|------|------|
| peer 区分 | 所有 peer 用同一个模型 `qwen2.5-coder:7b`，在 prompt 里只改角色名 | 没区分度 |
| 评分 | 一轮评分，简单平均 | 被高异常值拉走，auditor 的 0.2 被 coder 的 0.9 平均掉 |
| 分歧处理 | 评分 < 0.6 → reject，≥ 0.6 → approve | 没有审议讨论 |
| consensus route handler | `eto.ts:615` 的 `route=consensus` 分支只输出提示文本，不调 `peer_review` | 危险操作无真实共识 |
| registerTool 入口 | `eto.ts:636` 的 `eto_consensus` 工具调了 `peerConsensus` 但只传 2 个 peer，同样不做审议 | 工具入口也一样空洞 |
| 返回类型 | Python 返回 `{status, avg_score, votes}`，TypeScript 用 `r?.avg_score` | 需要对齐到新格式 |

---

## 方案

### 核心流程（三阶段）

```
T1: 独立评分（隔离）
  各 peer（researcher/coder/auditor）各自独立调用 LLM
  参数：role-specific system prompt + 执行计划
  输出：{score, concern, suggestion}

T2: 审议（如果分歧大）
  把 T1 所有 peer 的输出汇总
  分歧 max-min > 0.3 → 进入审议
  各 peer 看到其他人的意见，可以调整评分
  最大 2 轮审议，防止无限循环

T3: 终审（分歧仍然大）
  分歧 max-min > 0.3 → auditor 做终审
  如果 auditor 自己就是分歧方 → 降级为 researcher 终审
  终审决定：approve / revise / reject
  输出最终结果 + 改进行动项
```

### 注意：三个 peer 仍用同一模型

所有 peer 都用 `qwen2.5-coder:7b`，只通过 role-specific system prompt 区分。这是当前架构的限制（单 LLM 端点），用不同模型需要等 Pi 的 provider 路由支持。可以接受。

---

### 改动文件

| 文件 | 改动 |
|------|------|
| `eto/stitches/consensus/vote.py` | 重写 peer_review：角色提示词 + 三阶段流程 |
| `eto/stitches/test.py` | 新增共识三阶段测试（先写，TDD） |
| `eto/extensions/eto.ts` | 三处改动（见下） |

---

### vote.py 改动

```python
# 角色提示词
PEER_SYSTEM_PROMPTS = {
    "researcher": "你是一个研究员。评估这个计划的完整性、可行性和证据充分性。重点关注：方案是否有漏洞、是否有数据支持、是否有替代方案被忽略。",
    "coder": "你是一个编码员。评估这个计划的技术可行性、实现难度和潜在技术债务。重点关注：实现路径是否合理、有没有更好的技术方案。",
    "auditor": "你是一个审计员。评估这个计划的风险面、潜在失败点和长期影响。重点关注：最坏情况下会怎样、有什么预防措施没考虑。"
}

def peer_review(plan: str, peers: list[str]) -> dict:
    """T1: 独立评分"""
    ...

def _deliberation_round(votes: list[dict]) -> list[dict]:
    """T2: 审议循环（分歧 > 0.3 触发，最多 2 轮）"""
    ...

def _final_review(votes: list[dict]) -> str:
    """T3: auditor 终审，返回 verdict"""
    ...  # approve / revise / reject
```

### 三阶段返回值格式（TypeScript 侧也对齐）

```json
{
  "status": "approved",
  "final_score": 0.72,
  "votes": [
    {"peer": "researcher", "score": 0.85, "concern": null, "final_score": 0.85},
    {"peer": "coder", "score": 0.72, "concern": "实现复杂度偏高", "final_score": 0.72},
    {"peer": "auditor", "score": 0.55, "concern": "缺少回滚方案", "final_score": 0.55}
  ],
  "deliberation": {
    "rounds": 1,
    "differences": [{ "peer": "auditor", "vs": "researcher", "gap": 0.3 }],
    "final_reviewer": "researcher",
    "verdict": "approved with conditions: 需补充回滚方案后执行"
  },
  "actions": ["补充回滚方案", "增加监控告警"]
}
```

---

### eto.ts 改动（三处）

**改动 A — `before_agent_start` 的 consensus route handler（原 ~615 行）**

当前代码只输出提示文本要求用户手动回复，改为调用真实的 `peerConsensus`：

```typescript
// 替换 ~615-624 行
if (route.route === "consensus") {
  ctx.ui.notify(`🤝 共识审议中...`, "info");
  const result = await peerConsensus(task, ["researcher", "coder", "auditor"]);
  const score = result?.final_score ?? 0;
  ctx.ui.notify(`🤝 共识: ${result?.status} (${(score * 100).toFixed(0)}%)`, "info");
  
  if (result?.status === "approved") {
    const actions = result?.actions?.join("; ") || "";
    routeLines.push(`## 共识结果: 通过 (${(score * 100).toFixed(0)}%)`);
    if (actions) routeLines.push(`改进行动: ${actions}`);
    widgetLines.push(`🤝 共识通过 ${(score * 100).toFixed(0)}%`);
    ctx.ui.setWidget("eto-route", widgetLines);
    writeMetric(route.route, "consensus", true, 1);
    return { systemPrompt: routeLines.join("\n") + "\n\n" + (event.systemPrompt || "") };
  }
  routeLines.push(`## 共识结果: ${result?.status === "revise" ? "需修改" : "否决"}`);
  routeLines.push(`问题: ${result?.actions?.join("; ") || "方案不可行"}`);
  widgetLines.push(`🤝 共识: ${result?.status}`);
  ctx.ui.setWidget("eto-route", widgetLines);
  writeMetric(route.route, "consensus", false, 1);
  return { systemPrompt: routeLines.join("\n") + "\n\n" + (event.systemPrompt || "") };
}
```

**改动 B — `peerConsensus` 函数（~244 行）**

返回类型需要对齐新格式。当前 `callStitchAsync` 的返回值已经是 JSON，改一下 TypeScript 的类型断言：

```typescript
// peerConsensus 返回值已是 dict，直接返回
// TypeScript 侧不需要改调用逻辑，但 registerTool 侧需要解析新字段
```

**改动 C — `registerTool("eto_consensus")`（~636 行）**

当前传 `["researcher", "auditor"]` 只有 2 个 peer，改为 3 个，并解析新返回格式的 `final_score`：

```typescript
pi.registerTool({
  name: "eto_consensus", label: "ETO Consensus",
  description: "同侪共识评分（三阶段：评分→审议→终审）",
  parameters: Type.Object({ plan: Type.String({ description: "执行方案" }) }),
  async execute(toolCallId, params) {
    const r = await peerConsensus(params.plan, ["researcher", "coder", "auditor"]);
    const score = r?.final_score ?? 0.6;
    return { content: [{ type: "text", text: JSON.stringify({ status: score >= 0.6 ? "通过" : "需调整", final_score: score, votes: r?.votes, deliberation: r?.deliberation }) }], details: {} };
  },
});
```

---

### test.py 改动

在现有 `eto/stitches/test.py` 末尾追加测试：

```python
# ── Phase 5: 共识三阶段测试 ──

# 测试分歧检测（模拟 auditor 低分）
r = run(ROOT / "consensus/vote.py", {"fn": "peer_review", "args": ["高危操作", ["researcher", "coder", "auditor"]]})
p = ok(r) and '"deliberation"' in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} consensus deliberation 含 deliberation 字段")
all_ok = all_ok and p

# 测试终审分歧解决
r = run(ROOT / "consensus/vote.py", {"fn": "peer_review", "args": ["极端高风险操作", ["researcher", "coder", "auditor"]]})
p = ok(r) and '"verdict"' in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} consensus final verdict 含 verdict 字段")
all_ok = all_ok and p

# 测试 actions 输出
r = run(ROOT / "consensus/vote.py", {"fn": "peer_review", "args": ["简单任务", ["researcher", "coder", "auditor"]]})
p = ok(r) and '"actions"' in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} consensus actions 含 actions 字段")
all_ok = all_ok and p
```

---

### 验收标准

| # | 检查项 | 验证方式 |
|---|--------|----------|
| P5-1 | 三个 peer 使用不同 system prompt | `PEER_SYSTEM_PROMPTS` 字典含 3 个角色 |
| P5-2 | 分歧检测（max-min > 0.3 触发审议） | 返回结果含 `deliberation` 字段 |
| P5-3 | 审议循环 ≤ 2 轮 | `deliberation.rounds ≤ 2` |
| P5-4 | 分歧仍大 → auditor 终审 | 返回结果含 `verdict` 字段 |
| P5-5 | eto.ts consensus route handler 调用 peer_review | route=consensus 时 systemPrompt 含 "共识结果" |
| P5-6 | registerTool 也调 3 peer 共识 | 注册工具的 content 含 `final_score` 和 `votes` |
| P5-7 | 测试覆盖三阶段 | `python eto/stitches/test.py` 三行 consensus PASS |

---

### 实施顺序

```
Step 1 → test.py: 先加共识三阶段测试（TDD，验证验收标准 P5-2/3/4/7） — 5 min
Step 2 → vote.py: 角色提示词 + 三阶段流程                              — 15 min
Step 3 → eto.ts: 三处改动（A route handler / B peerConsensus / C registerTool） — 10 min
```

总计约 30 分钟。
