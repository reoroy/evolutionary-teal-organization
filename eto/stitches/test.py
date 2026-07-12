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

# 合法参数但无实际 MCP 服务 → 降级不崩溃
r = run(ROOT / "mcp_dispatch.py", {"fn": "dispatch", "args": [json.dumps(["nonexistent"]), "test", "hi"]})
p = not ("Traceback" in r.stderr)
print(f"{OK_MARK if p else FAIL_MARK} mcp dispatch no-srv  不崩溃")
all_ok = all_ok and p

# ── Shared Memory 测试 ──────────────────────────────

r = run(ROOT / "memory/shared_memory.py", {"fn": "write", "args": ["test:mem", {"msg": "hello"}]})
p = ok(r) and '_error' not in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} shared_memory write   KV 写入")

r = run(ROOT / "memory/shared_memory.py", {"fn": "read", "args": ["test:mem"]})
p = ok(r) and '"hello"' in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} shared_memory read    KV 读取")

r = run(ROOT / "memory/shared_memory.py", {"fn": "context_block", "args": [3]})
p = ok(r) and ('TealContext' in r.stdout or r.stdout.strip() == '""')
print(f"{OK_MARK if p else FAIL_MARK} shared_memory ctx     context_block")

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

# file_release: 解除文件锁
r = run(ROOT / "memory/shared_memory.py", {"fn": "file_release", "args": ["src/test.py"]})
p = ok(r) and '"True"' in r.stdout or '"released": true' in r.stdout
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
p = ok(r) and '"c"' in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} select_agent code      选择编码员")
all_ok = all_ok and p

r = run(ROOT / "bidding/workflow.py", {"fn": "generate_steps", "args": ["调研 API 方案，然后写代码实现，最后审查安全"]})
p = ok(r) and '"编码"' in r.stdout and '"审查"' in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} generate_steps 3步     调研+编码+审查")
all_ok = all_ok and p

r = run(ROOT / "registry.py", {"fn": "get_available_agents", "args": []})
p = ok(r) and '"coder"' in r.stdout and '"researcher"' in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} registry agents        内置 3 Agent")
all_ok = all_ok and p

sys.exit(0 if all_ok else 1)
