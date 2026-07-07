# Plan: raft-lite + Fable 完善 + CLI 编码 + prompt 优化

> 创建日期: 2026-07-04
> 来源: `docs/handoffs/reasonix/plan-backlog.md` item #1, #3, #6, #7
> 基线: v0.1.8

---

## 四项改动

### 1. raft-lite Leader 选举

**现状：** `eto/stitches/election/elect.py` 16 行按权重排序取最高分，没有真实选举。

**改法：** 用 [raft-lite](https://github.com/nikwl/raft-lite)（纯 Python 单文件 Raft）替换。

```python
"""ETO Stitch: Raft Leader 选举（raft-lite）"""
import json, sys
from raft_lite import RaftNode

_raft_node = None

def _get_node(peers: list[str]) -> RaftNode:
    global _raft_node
    if _raft_node is None:
        _raft_node = RaftNode(
            node_id="eto-coordinator",
            peers=[{"id": p} for p in peers],
            election_timeout=150,
            heartbeat_interval=50,
        )
        _raft_node.start()
    return _raft_node

def elect(candidates: list[tuple[str, float]]) -> dict:
    if not candidates:
        return {"leader": "researcher", "all": []}
    peers = [name for name, _ in candidates]
    try:
        node = _get_node(peers)
        leader = node.get_leader()
        if leader and leader in peers:
            return {"leader": leader, "all": candidates, "method": "raft"}
    except: pass
    candidates.sort(key=lambda x: -x[1])
    return {"leader": candidates[0][0], "all": candidates, "method": "fallback"}
```

**改动：** `pyproject.toml` +1 行，`elect.py` ~20 行

---

### 2. Fable 模式完善

当前 `isComplexTask()` 已有重构/架构/迁移等 13 个关键词。完善方向：

**a) 扩充关键词：** 补齐 Fable 原始项目的分类。加到 `eto/extensions/eto.ts` 的 `signals` 数组：

```diff
- const signals = ["重构", "架构", "迁移", "优化", "安全", "并发", "分布式", "refactor", "migrate", "optimize", "security", "concurrent", "distributed"];
+ const signals = ["重构", "架构", "迁移", "优化", "安全", "并发", "分布式",
+   "调试", "性能", "兼容", "降级", "回滚", "容错", "熔断",
+   "refactor", "migrate", "optimize", "security", "concurrent", "distributed",
+   "debug", "performance", "compat", "rollback", "fault", "circuit"];
```

**b) 注入位置：** 当前只在 plan 路由的 code gewu 下注入。改为在 plan 路由的所有 gewu 下都检查复杂度，不仅限于 code。

```diff
- if (route.gewu === "code" && isComplexTask(task)) {
+ if (isComplexTask(task)) {
```

**改动：** `eto/extensions/eto.ts` ~3 行

---

### 3. CLI 中文编码 — GBK 终端兼容

`eto-mesh status` / `eto-mesh join` 在 Windows GBK 终端输出中文会崩溃（UnicodeEncodeError）。

**改法：** 在 `eto/cli.py` 顶部检测 stdout encoding，非 utf-8 时用英文：

```python
# 在 import 段后加
_USE_EN = not (sys.stdout.encoding and "utf" in sys.stdout.encoding.lower())
```

然后在输出点替换：

```python
# cmd_join() — 约第 64 行
print(f"{'OK registered' if _USE_EN else 'OK 已注册'}: {agent_id}")

# cmd_status() — 约第 70 行  
print('No agents in mesh' if _USE_EN else 'Mesh 中尚无 Agent')
```

**改动：** `eto/cli.py` ~5 行

---

### 4. prompt 优化 — _extract_json 增强

`vote_on_proposals()` 的 LLM 输出有时用中文 key（方案0、方案1），有时用英文（score、my_step）。当前 `_extract_json` 能处理一部分但不够健壮。

**改法：** 在 `eto/stitches/bidding/protocol.py` 的 `_extract_json` 后加一层标准化：

```python
def _normalize_vote(raw: dict) -> dict:
    """标准化 LLM 投票输出：中文 key → 英文"""
    if not raw:
        return {"score": 0, "my_step": "", "self_config": {}}
    # 方案0 → proposal_index: 0
    for k, v in list(raw.items()):
        if "方案" in str(k) and isinstance(v, dict):
            v["agent"] = raw.get("agent", "")
            return v
    return raw
```

在 `vote_on_proposals()` 中调用 `_extract_json` 后过一层标准化。

**改动：** `eto/stitches/bidding/protocol.py` ~15 行

---

## 改动汇总

| # | 文件 | 改动 | 行数 |
|:-:|:-----|:------|:----:|
| 1 | `pyproject.toml` | 添加 `raft-lite>=0.1` | 1 |
| 1 | `eto/stitches/election/elect.py` | 替换为 raft-lite | ~20 |
| 2 | `eto/extensions/eto.ts` | isComplexTask 扩充 + 注入放宽 | ~3 |
| 3 | `eto/cli.py` | GBK 检测 + 英文降级 | ~5 |
| 4 | `eto/stitches/bidding/protocol.py` | _normalize_vote 标准化 | ~15 |

---

## 验收

```bash
# 1. raft-lite 可用
python -c "from raft_lite import RaftNode; print('OK')"

# 2. elect 签名不变
python -c "
from eto.stitches.election.elect import elect
r = elect([('coder',0.9), ('researcher',0.7)])
print('leader:', r.get('leader'))
print('method:', r.get('method', 'fallback'))
"

# 3. Fable 关键词扩充后可触发重构以外的任务
# 4. CLI 在 GBK 终端不崩溃
# 5. 测试
python eto/stitches/test.py
```

| # | 检查项 | 方法 |
|:-:|:-------|:------|
| A-1 | `raft_lite` 可导入 | `from raft_lite import RaftNode` |
| A-2 | `elect()` 返回 `{leader, all, method}` | 格式兼容 |
| A-3 | raft-lite 不可用时降级 | method="fallback" |
| A-4 | Fable 关键词增加了 | isComplexTask 覆盖更多场景 |
| A-5 | Fable 不限 code gewu | plan 路由全部触发 |
| A-6 | GBK 终端不崩溃 | `eto-mesh status` 在 CHCP 936 下跑通 |
| A-7 | _normalize_vote 处理中文 key | 中文方案名 → 标准 dict |
| A-8 | 17/17 测试 PASS | `python eto/stitches/test.py` |
