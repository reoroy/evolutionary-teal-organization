# Plan: CLI 编码 + workflow 时区 + VotingAI 共识缝合

> 创建日期: 2026-07-04
> 要求: Claude Code 审计时说 "Reasonix 第3项糊弄过去了"
> 来源: `plan-integrate-votingai.md` + backlog item 7/8

---

## 三项改动

### 1. eto/cli.py — GBK 终端检测

当前 `cmd_join()` 和 `cmd_status()` 硬编码中文输出，Windows GBK 终端崩溃。

**改法：** 在模块顶部检测 encoding，非 utf-8 时禁用中文：

```python
# 在 import 段后加一行
_LANG = "zh" if sys.stdout.encoding and "utf" in sys.stdout.encoding.lower() else "en"
```

然后在输出点把中文字符串换成条件表达式：

```python
# cmd_join: 第 64 行
print(f"OK {'registered' if _LANG=='en' else '已注册'}: {agent_id}")

# cmd_status: 第 70 行
print(f"No agents in mesh" if _LANG == "en" else "Mesh 中尚无 Agent")

# cmd_status: 表格标题
title = "Agent Registry"  # 不变，英文标题
# Status 列
status_text = "online" if _LANG == "en" else "在线"
```

实际改 3 行（加 `_LANG` 检测 + 2 个输出点）。

### 2. eto/stitches/bidding/workflow.py — 时区支持

当前 `datetime.now()` 用本地时间。改为读 `ETO_TIMEZONE` 环境变量：

```python
# 将第 161-162 行:
from datetime import datetime
sp = f"当前时间: {datetime.now().strftime('%Y/%m/%d %H:%M:%S')}\n\n{sp}"

# 改为:
from datetime import datetime
import os, zoneinfo
_tz = zoneinfo.ZoneInfo(os.environ.get("ETO_TIMEZONE", "Asia/Shanghai"))
sp = f"当前时间: {datetime.now(_tz).strftime('%Y/%m/%d %H:%M:%S')}\n\n{sp}"
```

Python 3.14 内置 `zoneinfo`，无需额外依赖。

### 3. eto/stitches/consensus/vote.py — 接 VotingAI 库

当前 `_multi_strategy_tally()` 是自写的简单算法，替换为 [VotingAI](https://github.com/tejas-dharani/votingai) 库的真实多策略投票。

**安装：**
```bash
pip install votingai
```
添加到 `pyproject.toml`：`votingai>=1.0`

**改法：**

```python
# 文件顶部加 import
from votingai import VotingSystems, AuditTrail

# 替换 _multi_strategy_tally(scores) → _votingai_tally(votes_with_peers)
def _votingai_tally(votes: list[dict]) -> dict:
    """用 VotingAI 多策略计票"""
    from votingai import VotingSystems
    scores = [v["score"] for v in votes]
    results = {}
    for strategy in ["approval", "borda", "irv"]:
        vs = VotingSystems(strategy, scores)
        results[strategy] = vs.tally()
    final = sum(results[s].get("score", 0) for s in results) / len(results)
    audit = AuditTrail(votes)
    return {
        "final": round(final, 3),
        "strategies": {s: round(results[s].get("score", 0), 3) for s in results},
        "audit_id": str(audit.trail_id) if hasattr(audit, 'trail_id') else f"va{int(__import__('time').time())}",
    }

# 将 peer_review() 中第 183 行:
#   tally = _multi_strategy_tally(scores)
# 改为:
#   tally = _votingai_tally(votes)
```

**注意：** 上面的 VotingAI API 是参考其文档的推断。Reasonix 需要 `pip install votingai` 后根据实际 API 调整。核心约束：
- 保持 `peer_review(plan, peers)` 签名不变
- 返回额外字段 `audit_id`
- `peer_review` 返回的 `deliberation.strategies` 包含三种策略名

---

## 改动文件

| 文件 | 改动 | 行数 |
|:-----|:------|:------|
| `eto/cli.py` | GBK 检测 + 英文降级 | 3 行 |
| `eto/stitches/bidding/workflow.py` | 时区支持 | 3 行 |
| `eto/stitches/consensus/vote.py` | 接 VotingAI 替换自写评分 | ~15 行 |
| `pyproject.toml` | 添加 `votingai>=1.0` | 1 行 |

## 验收

```bash
# 1. CLI 在 GBK 终端不崩溃
CHCP 936 && eto-mesh status

# 2. ETO_TIMEZONE 生效
ETO_TIMEZONE=America/New_York python -c "
from eto.stitches.bidding.workflow import design_workflow, build_graph
import json
d = json.loads(design_workflow('{\"type\":\"code\"}', '[]'))
g = build_graph(d)
"

# 3. VotingAI 可用
python -c "from votingai import VotingSystems, AuditTrail; print('OK')"

# 4. peer_review 带 audit_id
python3 -c "
from eto.stitches.consensus.vote import peer_review
import asyncio
r = asyncio.run(peer_review('测试', ['coder', 'auditor']))
print('status:', r.get('status'))
print('audit_id:', r.get('audit_id'))
print('strategies:', r.get('deliberation', {}).get('strategies', {}))
"

# 5. 完整测试
python eto/stitches/test.py
```
