# Plan: Stitcher 层硬化

> 发送者: Claude Code
> 接收者: Reasonix
> 状态: READY
> 优先级: P1 — 当前 ETO 唯一可独立推进的编码任务

## 背景

ETO 的 Python Stitcher 层（`eto/stitches/`）是 eto.ts 扩展调用的胶水代码，负责：
- `comms/a2a.py` — 多步 Plan 执行（@本地 Ollama）
- `consensus/vote.py` — 同侪共识评分（@本地 Ollama）
- `election/raft_lead.py` — 协调员选举（纯排序）

当前代码可工作（test.py 全部通过），但有 5 个问题需要修复：

## 任务清单

### 1. 删除死引用（README.md）

`stitches/README.md` 引用了不存在的包：
- `raft-lite` → 不存在（`election/raft_lead.py` 只是按分数排序，不是 Raft）
- `maestro` → 不存在（comms/a2a.py 自己做顺序执行，不需要 DAG 框架）
- `protolink` / `votingai` → 已装但未使用，单 Agent 场景硬塞进去得不偿失

**要求：** 把 README.md 从「安装指南」改为「当前架构说明」，如实记录每层代码做了什么，不虚构依赖。

### 2. 重命名 raft_lead.py

`election/raft_lead.py` 名为 raft 但实际只是 `sorted(score, reverse=True)[0]`。这在 2026-06-25 复盘中被标记为死胡同。改名以示诚实。

**要求：**
- `election/raft_lead.py` → `election/elect.py`
- 函数签名不变（仍叫 `elect`）
- 更新 eto.ts 中 `callStitch("election.raft_lead", ...)` → `callStitch("election.elect", ...)`
- 更新 test.py 中的路径引用
- 如果 eto.ts 的 `.pi/extensions/eto.ts`（部署版）也存在同一调用，一并更新

### 3. 完善错误处理

所有三个 stitcher 脚本的 `__main__` 入口缺少错误处理：

```python
# 当前（脆弱）
data = json.loads(sys.stdin.read())
fn = globals().get(data["fn"])
if fn:
    result = fn(*data.get("args", []))
    print(json.dumps(result))

# 要求
# — 捕获 json.JSONDecodeError → 打印错误 JSON
# — fn 不存在 → 打印 "unknown function: xxx"
# — 执行异常 → 捕获并输出 {"_error": true, "message": "..."}
# — 保持 stdout 只输出 JSON（stderr 可输出日志）
```

### 4. 加 __init__.py + pyproject.toml

当前 `eto/stitches/` 不是 Python 包，没法 `from stitches.consensus import vote`。

**要求：**
- `eto/stitches/__init__.py` — 暴露 `__version__ = "0.1.0"`
- `eto/stitches/election/__init__.py` — 空
- `eto/stitches/consensus/__init__.py` — 空  
- `eto/stitches/comms/__init__.py` — 空
- `eto/pyproject.toml` — 最小化 pyproject，只声明包名 `eto-stitches`、Python 版本要求

### 5. 增强 test.py

当前 test.py 只测了「跑通」，没测「跑对」。

**要求：** 追加测试用例：
- `election.elect` 空候选列表 → 返回 leader="researcher"
- `election.elect` 多个候选 → leader 是分数最高者
- `consensus.peer_review` 空 peers → avg_score=0.6, status="approved"
- `comms.execute_plan` 空 steps → outputs=[], total=0
- JSON 解析错误 → 返回 `{"_error": true, ...}`
- 未知 fn → 返回 `{"_error": true, ...}`
- 已知 fn 但参数类型不对 → 优雅降级

### 6. shell 兼容性（可选）

当前调用用 `python3`，Windows 下一半环境用 `python` 一半用 `python3`。在 eto.ts 的 `findStitchesDir` 旁边可以加一个 `findPython()` 函数，也可以留着不改——优先级低。

## 不接受

- ❌ 不要加新依赖（pip install 什么包）
- ❌ 不要改架构（不要拆 eto.ts）
- ❌ 不要接入 protolink/votingai（等需要时再说）

## 验收标准

```bash
# 1. 重命名后的路径可用
cd eto/stitches && echo '{"fn":"elect","args":[[["r",0.9],["c",0.5]]]}' | python election/elect.py
# → {"leader":"r", ...}

# 2. 增强测试全过
cd eto/stitches && python test.py
# → 所有 ✅

# 3. 错误路径处理
echo 'not-json' | python comms/a2a.py
# → {"_error": true, ...}（不会崩溃）
```

## 文件引用

| 文件 | 行数 | 改动类型 |
|:-----|:-----|:---------|
| `eto/stitches/comms/a2a.py` | 45 | 加错误处理，加 __main__ 保护 |
| `eto/stitches/consensus/vote.py` | 48 | 加错误处理 |
| `eto/stitches/election/raft_lead.py` | 16 | 重命名为 elect.py |
| `eto/stitches/election/elect.py` | 16 | 加错误处理 |
| `eto/stitches/__init__.py` | 1 | **新建** |
| `eto/stitches/election/__init__.py` | 1 | **新建** |
| `eto/stitches/consensus/__init__.py` | 1 | **新建** |
| `eto/stitches/comms/__init__.py` | 1 | **新建** |
| `eto/pyproject.toml` | ~10 | **新建** |
| `eto/stitches/test.py` | 21 | 加强，覆盖错误路径 |
| `eto/stitches/README.md` | ~30 | 重写 |
| `eto/extensions/eto.ts` | 230 | 改 1 行（rafts → elect） |
| `.pi/extensions/eto.ts` | ~230 | 如有则改 1 行 |

## 预计工作量

- 实际编码：~30 分钟（Reasonix）
- 验证：~5 分钟
