# Plan: Teal Runtime Phase A — Agent 竞标层

> 创建日期: 2026-07-04 | 发送者: Claude Code
> 接收者: Reasonix Code
> 基线: ETO Mesh (Step 1-6 完成, v0.5.0+)
> 架构: `docs/teal-runtime-arch.md`

---

## 现状

当前 Agent 匹配逻辑 (`eto/extensions/eto.ts`):

```typescript
const agents = matchAgentsForRoute(route.gewu);
// → 读 profiles.json 的 weights，按关键词过滤评分 ≥ 0.3 的 Agent
// → 硬编码，不能从历史成功学习
// → Agent 自己没机会说"这活我擅长"
```

**问题：** weights 是配置时写的静态值，运行时不会根据实际执行结果调整。Agent 不能自评 fit，协调员没有比选机制。

---

## 方案

### 总览

在现有 stitch 结构下新增竞标层，逐步替换 `matchAgentsForRoute`：

```
  当前                                Phase A 后
                                    
  matchAgentsForRoute               run_bidding(task_spec, profiles)
       ↓                                    ↓
  查权重表 → 排序 → 过滤            每个 Agent 自评 → 生成标书 → 评分 → 选标
                                         ↓
                                    fallback → matchAgentsForRoute（竞标无人应答时）
```

### 1. 新增 `eto/stitches/bidding/protocol.py` (~80 行)

主入口 `run_bidding()`：

```python
"""Teal Runtime: Agent 竞标协议"""
import json, sys, time
from pathlib import Path

def run_bidding(task_spec_json: str, profiles_json: str) -> str:
    """
    竞标流程编排。
    
    task_spec_json: {"type":"code","title":"登录API","description":"..."}
    profiles_json: [{"name":"coder","weights":{"code":0.95,...}},...]
    
    返回: {"winner":{profile},"confidence":0.85,"bids":[...],"fallback":false}
    """
    task_spec = json.loads(task_spec_json)
    profiles = json.loads(profiles_json)
    
    bids = []
    for profile in profiles:
        bid = _evaluate_profile(profile, task_spec)
        if bid["confidence"] >= 0.3:  # 置信度门槛
            bids.append(bid)
    
    if not bids:
        # 无人竞标或全部 confidence < 0.3 → fallback
        winner = _fallback_select(profiles, task_spec)
        return json.dumps({"winner": winner, "confidence": 0.5, "bids": [], "fallback": True})
    
    # 选标
    winner = _select_winner(bids, task_spec)
    return json.dumps({"winner": winner["profile"], "confidence": winner["score"], "bids": bids, "fallback": False})


def _evaluate_profile(profile: dict, task_spec: dict) -> dict:
    """
    Agent 自评：计算 fit 分数。
    
    评分维度：
    - weights[task_type] — 配置权重（0-1）
    - task_keywords — 技能关键词匹配
    
    后续 Phase C 会加入：
    - agentmemory 历史成功率加成
    - 当前负载调整
    """
    task_type = task_spec.get("type", "code")
    weights = profile.get("weights", {})
    base_score = weights.get(task_type, 0) if isinstance(weights, dict) else 0
    
    # 关键词细调
    description = (task_spec.get("title", "") + " " + task_spec.get("description", "")).lower()
    specialty = profile.get("specialty", "").lower()
    keyword_boost = 0.1 if specialty and specialty in description else 0
    
    confidence = min(base_score + keyword_boost, 1.0)
    
    return {
        "agent_id": profile.get("name", "?"),
        "profile": profile,
        "confidence": round(confidence, 2),
        "base_score": base_score,
        "keyword_boost": keyword_boost,
    }


def _select_winner(bids: list, task_spec: dict) -> dict:
    """选标评分：confidence 降序，同分时负载低的优先"""
    sorted_bids = sorted(bids, key=lambda b: (-b["confidence"], b.get("load", 0)))
    return sorted_bids[0]


def _fallback_select(profiles: list, task_spec: dict) -> dict:
    """无人竞标时的降级选择：取 weight 最高的"""
    task_type = task_spec.get("type", "code")
    scored = [(p, p.get("weights", {}).get(task_type, 0) if isinstance(p.get("weights"), dict) else 0) for p in profiles]
    scored.sort(key=lambda x: -x[1])
    return scored[0][0] if scored else profiles[0]


if __name__ == "__main__":
    """Pi stitch 入口"""
    data = json.loads(sys.stdin.read())
    fn = data.get("fn")
    args = data.get("args", [])
    func = globals().get(fn)
    if func:
        try:
            result = func(*args)
            print(result if isinstance(result, str) else json.dumps(result, ensure_ascii=False))
        except Exception as e:
            print(json.dumps({"_error": True, "message": str(e)}))
    else:
        print(json.dumps({"_error": True, "message": f"unknown fn: {fn}"}))
```

### 2. 新建 `eto/stitches/bidding/__init__.py`

```python
# Bidding protocol package
```

### 3. 修改 `eto/extensions/eto.ts` — 路由处接入竞标

在 `matchAgentsForRoute` 函数旁新增 `tryBidding()`：

```typescript
async function tryBidding(task: string, gewu: string): Promise<{ winner: AgentProfile; confidence: number } | null> {
  const taskSpec = JSON.stringify({ type: gewu, title: task, description: task });
  const profiles = JSON.stringify(AGENT_PROFILES.map(p => ({
    name: p.name, specialty: p.specialty, weights: p.weights,
  })));
  const result = await callStitchAsync("bidding.protocol", "run_bidding", taskSpec, profiles);
  if (!result || "_error" in result || result.fallback) return null;
  const winner = AGENT_PROFILES.find(p => p.name === result.winner?.name);
  return winner ? { winner, confidence: result.confidence as number } : null;
}
```

然后在 `before_agent_start` 的 plan 路由段（~746 行），替换：

```typescript
if (route.route === "plan") {
    ctx.ui.notify(`📝 Agent 匹配中...`, "info");
    const agents = matchAgentsForRoute(route.gewu);  // ← 替换这行
```

改为：

```typescript
if (route.route === "plan") {
    ctx.ui.notify(`📝 竞标中...`, "info");
    const bidResult = await tryBidding(task, route.gewu);
    const agents = bidResult ? [bidResult.winner] : matchAgentsForRoute(route.gewu);
    const bidSuffix = bidResult ? ` (竞标 ${(bidResult.confidence * 100).toFixed(0)}%)` : " (关键词降级)";
```

影响范围：

| 行号范围 | 改动 |
|:---------|:------|
| ~746-749 | `matchAgentsForRoute` → `tryBidding` + fallback |
| ~750 | agentNames 显示竞标置信度 |
| ~746 之后 | notify 消息从"Agent 匹配中"改为"竞标中" |

#### 不做

- ❌ 不改 consensus 逻辑
- ❌ 不改 execPlan — 竞标只影响 Agent 选择，不影响执行
- ❌ 不改智子安检
- ❌ 不改其他路由（direct / consensus）

---

## 改动文件

| 文件 | 改动 | 类型 |
|:-----|:------|:------|
| `eto/stitches/bidding/__init__.py` | 包标记 | 新建 |
| `eto/stitches/bidding/protocol.py` | 竞标流程 (`run_bidding` / `_evaluate_profile` / `_select_winner`) | 新建 |
| `eto/extensions/eto.ts` | 新增 `tryBidding()`，plan 路由处替换 `matchAgentsForRoute` | 修改 |

---

## 配置文件（不需要改）

当前 profiles.json weights 已可用作竞标输入：

```json
{
  "researcher": {"research": 0.9, "knowledge": 0.7},
  "coder": {"code": 0.95, "solution": 0.5},
  "auditor": {"solution": 0.9, "code": 0.4}
}
```

竞标时 task 的 gewu（如 "code"）自动映射到 weights key。无需新增配置。

---

## 验证

```bash
# 1. 直接调 run_bidding
python -c "
from eto.stitches.bidding.protocol import run_bidding
import json
profiles = json.dumps([
  {'name':'coder','specialty':'code','weights':{'code':0.95,'solution':0.5}},
  {'name':'researcher','specialty':'research','weights':{'research':0.9,'knowledge':0.7}},
  {'name':'auditor','specialty':'solution','weights':{'solution':0.9,'code':0.4}},
])
# code 任务 → coder 应中标
r1 = run_bidding(json.dumps({'type':'code','title':'写个API','description':''}), profiles)
print('code任务:', r1)

# research 任务 → researcher 应中标
r2 = run_bidding(json.dumps({'type':'research','title':'调研K8s','description':''}), profiles)
print('research任务:', r2)

# solution 任务 → auditor 应中标
r3 = run_bidding(json.dumps({'type':'solution','title':'评估风险','description':''}), profiles)
print('solution任务:', r3)
"

# 2. 空竞标（应有 fallback）
python -c "
from eto.stitches.bidding.protocol import run_bidding
r = run_bidding('{\"type\":\"unknown\"}', '[]')
print('空竞标:', 'fallback=True' in r or 'fallback' in r)
"

# 3. stitch 测试
python eto/stitches/test.py
# → 17/17 PASS
```

---

## 验收标准

| # | 检查项 | 方法 |
|---|--------|------|
| P-1 | `run_bidding()` 存在且可调用 | import + call |
| P-2 | code 任务 → coder 中标 | 验证 winner.name === "coder" |
| P-3 | research 任务 → researcher 中标 | 验证 winner.name === "researcher" |
| P-4 | solution 任务 → auditor 中标 | 验证 winner.name === "auditor" |
| P-5 | 无竞标时 fallback | fallback=true 返回 |
| P-6 | eto.ts plan 路由显示竞标结果 | notify 出现"竞标"字样 |
| P-7 | 17/17 stitch 测试 PASS | `python eto/stitches/test.py` |
| P-8 | 关键词路由兼容（竞标不干涉 direct/consensus） | direct 和 consensus 路由输出不变 |
