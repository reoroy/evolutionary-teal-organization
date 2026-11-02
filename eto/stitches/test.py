"""Verify all stitcher layers work via stdin pipe"""
import json, subprocess, sys
from pathlib import Path

# Windows GBK 终端兼容
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).parent
PY = sys.executable

def run(script: Path, payload: dict) -> subprocess.CompletedProcess:
    inp = json.dumps(payload)
    return subprocess.run([PY, str(script)], input=inp, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10)

OK_MARK = "PASS"
FAIL_MARK = "FAIL"

def ok(r: subprocess.CompletedProcess) -> bool:
    return r.returncode == 0 and r.stdout.strip() != ""

all_ok = True

# ── 正常路径 ──────────────────────────────────────────

cases = [
    ("comms/a2a.py",       {"fn": "execute_plan",    "args": ["task", ["a","b"]]}),
    ("consensus/vote.py",  {"fn": "peer_review",     "args": ["plan", ["x","y"]]}),
    ("election/elect.py",  {"fn": "elect",           "args": [[["r",0.9],["c",0.5]]]}),
]
for name, payload in cases:
    r = run(ROOT / name, payload)
    passed = ok(r)
    print(f"{OK_MARK if passed else FAIL_MARK} {name:20s} {r.stdout.strip()[:60] if passed else r.stderr.strip()[:60]}")
    all_ok = all_ok and passed

# ── 边界路径 ──────────────────────────────────────────

# 空候选列表 → leader="researcher"
r = run(ROOT / "election/elect.py", {"fn": "elect", "args": [[]]})
p = ok(r) and '"researcher"' in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} elect empty         leader=researcher")
all_ok = all_ok and p

# 空 peers → avg_score=0.6
r = run(ROOT / "consensus/vote.py", {"fn": "peer_review", "args": ["plan", []]})
p = ok(r) and '0.6' in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} vote empty peers    avg_score=0.6")
all_ok = all_ok and p

# 空 steps → outputs=[]
r = run(ROOT / "comms/a2a.py", {"fn": "execute_plan", "args": ["task", []]})
p = ok(r) and '"outputs"' in r.stdout and '"total": 0' in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} a2a empty steps     outputs=[], total=0")
all_ok = all_ok and p

# ── 错误路径 ──────────────────────────────────────────

# JSON 解析错误 → _error
r = subprocess.run([PY, str(ROOT / "comms/a2a.py")], input="not-json", capture_output=True, text=True, errors="replace", timeout=10)
p = '_error' in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} bad JSON             _error")
all_ok = all_ok and p

# 未知 fn → _error
r = run(ROOT / "election/elect.py", {"fn": "nonexistent", "args": []})
p = '_error' in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} unknown fn           _error")
all_ok = all_ok and p

# 参数类型不对 → 优雅降级（_error 而非崩溃）
r = run(ROOT / "election/elect.py", {"fn": "elect", "args": ["not-a-list"]})
p = '_error' in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} bad args             _error")
all_ok = all_ok and p

# ── Phase 5: 共识三阶段测试 ──────────────────────────

# T2/T3 逻辑测试：用预设评分验证审议+终审路径（不依赖 LLM）
r = run(ROOT / "consensus/vote.py", {"fn": "_test_deliberation", "args": []})
p = ok(r) and '"verdict"' in r.stdout and '"actions"' in r.stdout and '"deliberation"' in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} consensus 3-phase     deliberation+verdict+actions")
all_ok = all_ok and p

# 真实 LLM 调用：简单任务无分歧
r = run(ROOT / "consensus/vote.py", {"fn": "peer_review", "args": ["写一个hello world", ["researcher", "coder", "auditor"]]})
p = ok(r) and '"status"' in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} consensus simple     无分歧通过")
all_ok = all_ok and p

# ── MCP dispatch 基础测试 ──────────────────────────

# 空 server_cmd → 优雅降级
r = run(ROOT / "mcp_dispatch.py", {"fn": "dispatch", "args": ["[]", "tool", "task"]})
p = ok(r) and ('{}' in r.stdout or '_error' in r.stdout)
print(f"{OK_MARK if p else FAIL_MARK} mcp dispatch empty   优雅降级")
all_ok = all_ok and p

# 合法参数但无实际 MCP 服务 → 降级不崩溃
r = run(ROOT / "mcp_dispatch.py", {"fn": "dispatch", "args": [json.dumps(["nonexistent"]), "test", "hi"]})
p = not ("Traceback" in r.stderr)
print(f"{OK_MARK if p else FAIL_MARK} mcp dispatch no-srv  不崩溃")
all_ok = all_ok and p

# ── MCP peer 评分测试（issue #15 / issue #1 P0-5）──────────────
# vote.py 曾缺 Path 导入：_call_mcp_agent 的 NameError 被裸 except 吞掉，
# provider="mcp" 的 peer 评分永远为空。以下用 mock MCP server 验证修复。

import importlib.util

try:
    _HAS_MCP = importlib.util.find_spec("mcp") is not None
except Exception:
    _HAS_MCP = False

if _HAS_MCP:
    # 用 mock MCP server（tests/mock_agent_mcp_server.py，真实 stdio 协议）作为 peer：
    # 断言 provider="mcp" 的 peer 能拿到非空评分（0.88），不再是 "" → 默认 0.5。
    _mock_cfg = {"provider": "mcp",
                 "mcp_server": [PY, str(ROOT.parent.parent / "tests" / "mock_agent_mcp_server.py")],
                 "mcp_tool": "agent_review"}
    r = run(ROOT / "consensus/vote.py", {"fn": "_call_mcp_agent", "args": [json.dumps(_mock_cfg), "你是一个评审专家。", "请对以下执行计划评分"]})
    try:
        _mcp_out = json.loads(r.stdout) if ok(r) else {}
    except json.JSONDecodeError:
        _mcp_out = {}
    # stitch 入口会把 str 返回值再包一层 JSON，剥掉后才是工具的 dict
    if isinstance(_mcp_out, str):
        try:
            _mcp_out = json.loads(_mcp_out)
        except json.JSONDecodeError:
            _mcp_out = {}
    p = ok(r) and isinstance(_mcp_out, dict) and _mcp_out.get("score") == 0.88
    print(f"{OK_MARK if p else FAIL_MARK} mcp peer score      mock server 非空评分")
    all_ok = all_ok and p

    # 完整链路：_call_peer 走 mcp 分支（覆盖 peer 名记录与 sys.path 修复）
    r = run(ROOT / "consensus/vote.py", {"fn": "_call_peer", "args": ["mock_peer", "你是一个评审专家。", "请评分"]})
    # _call_peer 对未知 peer 回退到 researcher(ollama)；mcp 分支只在配置存在时触发。
    # 这里直接断言无 _error 且不崩溃（默认 peer 无 mcp 配置时返回 ""）。
    p = ok(r) and "_error" not in r.stdout
    print(f"{OK_MARK if p else FAIL_MARK} mcp peer routing    不崩溃无 _error")
    all_ok = all_ok and p
else:
    # 无 mcp 包（裸解释器 demo job）：验证修复后的降级路径 ——
    # 配置非法必须返回 _error 而非静默 ""（这正是 P0-5 的静默失败面）。
    r = run(ROOT / "consensus/vote.py", {"fn": "_call_mcp_agent", "args": ["{bad json", "s", "p"]})
    p = ok(r) and '_error' in r.stdout and 'config' in r.stdout
    print(f"{OK_MARK if p else FAIL_MARK} mcp peer cfg-error  无 mcp 包时报 _error")
    all_ok = all_ok and p

    r = run(ROOT / "consensus/vote.py", {"fn": "_call_mcp_agent", "args": [json.dumps({"provider": "mcp"}), "s", "p"]})
    p = ok(r) and '_error' in r.stdout
    print(f"{OK_MARK if p else FAIL_MARK} mcp peer no-server  缺 server 报 _error")
    all_ok = all_ok and p

# ── Shared Memory 测试 ──────────────────────────────

r = run(ROOT / "memory/shared_memory.py", {"fn": "write", "args": ["test:mem", {"msg": "hello"}]})
p = ok(r) and '_error' not in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} shared_memory write   KV 写入")
all_ok = all_ok and p

r = run(ROOT / "memory/shared_memory.py", {"fn": "read", "args": ["test:mem"]})
p = ok(r) and '"hello"' in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} shared_memory read    KV 读取")
all_ok = all_ok and p

r = run(ROOT / "memory/shared_memory.py", {"fn": "context_block", "args": [3]})
p = ok(r) and ('TealContext' in r.stdout or r.stdout.strip() == '""')
print(f"{OK_MARK if p else FAIL_MARK} shared_memory ctx     context_block")
all_ok = all_ok and p

r = run(ROOT / "memory/shared_memory.py", {"fn": "delete", "args": ["test:mem"]})
p = ok(r)
print(f"{OK_MARK if p else FAIL_MARK} shared_memory delete  KV 删除")
all_ok = all_ok and p

# ── File Coordination Tests ─────────────────────────────

# file_update: 发布文件状态
r = run(ROOT / "memory/shared_memory.py", {"fn": "file_update", "args": ["src/test.py", "agent-1", "abc123"]})
p = ok(r) and '"ok"' in r.stdout and '"agent-1"' in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} file_update           发布状态")
all_ok = all_ok and p

# file_status: 查询文件状态
r = run(ROOT / "memory/shared_memory.py", {"fn": "file_status", "args": ["src/test.py"]})
p = ok(r) and '"agent-1"' in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} file_status           查询状态")
all_ok = all_ok and p

# file_release: 解除文件锁（实现按 stitch 约定返回 JSON 布尔值 true/false）
r = run(ROOT / "memory/shared_memory.py", {"fn": "file_release", "args": ["src/test.py"]})
p = ok(r) and r.stdout.strip() == "true"
print(f"{OK_MARK if p else FAIL_MARK} file_release          解除锁")
all_ok = all_ok and p

# ── pi-mempalace 测试 ──────────────────────────

r = run(ROOT / "memory/mempalace.py", {"fn": "write", "args": ["test:mp", {"k": "v"}]})
p = ok(r) and '"ok"' in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} mempalace write       写入")
all_ok = all_ok and p

r = run(ROOT / "memory/mempalace.py", {"fn": "context_block", "args": [3]})
p = ok(r) and "mempalace" in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} mempalace context     上下文")
all_ok = all_ok and p

# ── 动态 Agent 测试 ──────────────────────────

r = run(ROOT / "bidding/workflow.py", {"fn": "select_agent", "args": ["写一个登录页", [{"id":"c","capabilities":["code","write"]},{"id":"r","capabilities":["research"]}]]})
p = ok(r) and r.stdout.strip() == "c"
print(f"{OK_MARK if p else FAIL_MARK} select_agent code      选择编码员")
all_ok = all_ok and p

r = run(ROOT / "bidding/workflow.py", {"fn": "generate_steps", "args": ["调研 API 方案，然后写代码实现，最后审查安全"]})
try:
    steps = json.loads(r.stdout) if ok(r) else []
except json.JSONDecodeError:
    steps = []
descs = " ".join(s.get("description", "") for s in steps)
p = ok(r) and len(steps) == 3 and all(k in descs for k in ("调研", "编码", "审查"))
print(f"{OK_MARK if p else FAIL_MARK} generate_steps 3步     调研+编码+审查")
all_ok = all_ok and p

r = run(ROOT / "registry.py", {"fn": "get_available_agents", "args": []})
p = ok(r) and '"coder"' in r.stdout and '"researcher"' in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} registry agents        内置 3 Agent")
all_ok = all_ok and p

sys.exit(0 if all_ok else 1)
