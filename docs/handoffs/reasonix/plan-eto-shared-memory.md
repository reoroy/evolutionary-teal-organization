# Plan: ETO 共享记忆 — TealContext

> 创建日期: 2026-07-04 | 来源: Claude Code
> 执行: Reasonix → 审计: Claude Code

---

## 现状

Agent 之间不共享任何上下文：

```
Agent A (_call_peer) → 评分 → 返回 → 丢弃
Agent B (_call_peer) → 评分 → 返回 → 丢弃
共识结果 → 返回给用户 → 不保存
```

每个 `_call_llm` / `_call_peer` 是孤立的，不知道前一个 agent 说了什么。

已有的记忆相关代码：

| 文件 | 作用 | 不是 |
|:-----|:------|:------|
| `eto/stitches/memory/skill_store.py` | skill 经验持久化（JSONL） | agent 间上下文共享 |
| `~/.eto/memory/` 目录 | skills.jsonl + metrics.jsonl + onboarding.json | 没有 teal_context |

---

## 方案

### 不造轮子：基于 pi-team-agents 的共享内存模式

参考 [pi-team-agents](https://github.com/Jabbslad/pi-team-agents) 的共享内存设计（JSON 文件 + 目录锁 + KV 结构），ETO 用 Python 实现兼容层，让 Python stitches 和 TypeScript extension 共享同一份上下文。

### 存储格式（与 pi-team-agents 兼容）

```
~/.eto/shared_memory/
├── _lock/              ← 目录锁（原子操作，防并发）
├── last_peer_score     ← KV 文件，内容为 JSON
└── last_consensus
```

每个 KV 文件内容：

```json
{"key":"peer_score:researcher","value":{"peer":"researcher","score":0.85,"concern":""},"ts":"2026-07-04T16:00:00","ttl":3600}
```

这种设计下，如果后续装 pi-team-agents，两边可以读写同一份数据。

### 新增文件

| 文件 | 作用 |
|:-----|:------|
| `eto/stitches/memory/shared_memory.py` | 类 pi-team-agents 的 KV 共享内存（JSON 文件 + 锁）|

### 改动文件

| 文件 | 改动 |
|:------|:------|
| `eto/stitches/consensus/vote.py` | 评分/共识后写 shared_memory |
| `eto/stitches/comms/a2a.py` | 执行后写 shared_memory |
| `eto/extensions/eto.ts` | 执行前读 shared_memory 注入 prompt |

### shared_memory.py

```python
"""Shared Memory — KV 共享上下文（兼容 pi-team-agents 模式）"""
import json, os, time, tempfile
from pathlib import Path

MEM_DIR = Path.home() / ".eto" / "shared_memory"
LOCK_DIR = MEM_DIR / "_lock"

def _lock():
    LOCK_DIR.mkdir(parents=True, exist_ok=True)
    # 目录创建是原子的，作为锁
    lock_path = LOCK_DIR / f"lock_{os.getpid()}"
    try:
        lock_path.mkdir()
        return lock_path
    except FileExistsError:
        return None

def _unlock(lock_path):
    if lock_path and lock_path.exists():
        lock_path.rmdir()

def write(key: str, value: dict, ttl: int = 3600):
    """写共享 KV"""
    MEM_DIR.mkdir(parents=True, exist_ok=True)
    lock = _lock()
    try:
        entry = {"key": key, "value": value, "ts": time.time(), "ttl": ttl}
        (MEM_DIR / key).write_text(json.dumps(entry, ensure_ascii=False), "utf-8")
    finally:
        _unlock(lock)

def read(key: str) -> dict | None:
    """读 KV，过期返回 None"""
    path = MEM_DIR / key
    if not path.exists():
        return None
    try:
        entry = json.loads(path.read_text("utf-8"))
        if time.time() - entry.get("ts", 0) > entry.get("ttl", 3600):
            path.unlink(missing_ok=True)
            return None
        return entry.get("value")
    except: return None

def recent_context(n: int = 5) -> str:
    """返回最近的 N 个上下文用于 prompt 注入"""
    if not MEM_DIR.exists():
        return ""
    files = sorted(MEM_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
    files = [f for f in files if f.name != "_lock"]
    lines = []
    for f in files[:n]:
        try:
            entry = json.loads(f.read_text("utf-8"))
            v = entry.get("value", {})
            lines.append(f"- [{v.get('type','?')}] {v.get('peer','')}: {v.get('concern','') or v.get('status','') or str(v.get('score',''))}")
        except: pass
    if not lines:
        return ""
    return "## TealContext (最近 agent 活动)\n" + "\n".join(lines)
```

### 注入点

**vote.py `_score_single()`** — 评分后追加：

```python
# 每次评分后写共享上下文
from eto.stitches.memory.teal_context import append
append({"type": "peer_score", "peer": peer, "task_hash": hash(plan) % 1000000,
        "score": result["score"], "concern": result.get("concern", "")})
```

**vote.py `peer_review()`** — 共识后追加：

```python
append({"type": "consensus", "task_hash": hash(plan) % 1000000,
        "status": result["status"], "final_score": avg,
        "actions": result.get("actions", [])})
```

**a2a.py `execute_plan()`** — 每步执行后追加：

```python
append({"type": "plan_step", "coordinator": "...", "step": step, "status": "done"})
```

**eto.ts `execPlan()`** — 执行前注入上下文：

```typescript
// 调用 Python 读 teal_context
const ctxOut = execSync(`python3 -c "from eto.stitches.memory.teal_context import context_block; print(context_block(5))"`, {encoding:"utf-8", timeout:5000});
const tealCtx = ctxOut.trim();
if (tealCtx) prompt = tealCtx + "\n\n" + prompt;
```

### 验收标准

| # | 检查项 | 验证方式 |
|---|--------|----------|
| SM-1 | teal_context.py 读写正常 | `append({"type":"test"})` → `recent(5)` 返回该条 |
| SM-2 | context_block 返回格式化文本 | 含 "## TealContext" 标题 |
| SM-3 | vote.py 评分后写上下文 | 跑一次 peer_review → teal_context.jsonl 有新增行 |
| SM-4 | a2a.py 执行后写上下文 | 跑一次 execute_plan → jsonl 有 plan_step 行 |
| SM-5 | eto.ts 执行前注入上下文 | `context_block(5)` 被拼入 prompt |
| SM-6 | 全部测试仍然 PASS | `python eto/stitches/test.py` 13/13 |

### 实施顺序

```
Step 1 → eto/stitches/memory/teal_context.py  — 读写 + context_block
Step 2 → vote.py 注入（_score_single + peer_review）
Step 3 → a2a.py 注入（execute_plan）
Step 4 → eto.ts 注入（execPlan）
Step 5 → test.py 加 context 测试 + 验证 13/13
```

总计约 20 分钟。
