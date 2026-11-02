"""Verify all stitcher layers work via stdin pipe"""
import json, os, re, subprocess, sys, tempfile
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

# ── TealContext 注入链路测试（issue #14: P0-4）────────────

# 降级链：mempalace 为空 → 本地文件。隔离 HOME 防止真实 ~/.eto 干扰：
# 先写 shared_memory，再在无 mempalace 的环境里调 context_block，必须返回刚写的条目。
with tempfile.TemporaryDirectory() as tmp_home:
    env = {**os.environ, "HOME": tmp_home}
    r = subprocess.run(
        [PY, "-c",
         "import sys; sys.path.insert(0, %r);" % str(ROOT.parent.parent) +
         "from eto.stitches.memory.shared_memory import write, context_block; "
         "write('consensus:last', {'type': 'consensus', 'status': 'passed', 'final_score': 0.9}); "
         "print(context_block(5))"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10, env=env,
    )
    p = r.returncode == 0 and "consensus" in r.stdout and "0.9" in r.stdout
    print(f"{OK_MARK if p else FAIL_MARK} ctx fallback         mempalace空→本地降级")
    all_ok = all_ok and p

# 降级链另一方向：mempalace 有数据时优先返回（不被 shared_memory 抢占）。
with tempfile.TemporaryDirectory() as tmp_home:
    env = {**os.environ, "HOME": tmp_home}
    r = subprocess.run(
        [PY, "-c",
         "import sys; sys.path.insert(0, %r);" % str(ROOT.parent.parent) +
         "from eto.stitches.memory import mempalace, shared_memory; "
         "mempalace.write('mp:prio', {'type': 'plan_step', 'step': 1, 'total': 2, 'status': 'ok'}); "
         "shared_memory.write('sm:other', {'type': 'consensus', 'status': 'passed'}); "
         "print(shared_memory.context_block(5))"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10, env=env,
    )
    p = r.returncode == 0 and "mempalace" in r.stdout and "plan_step" in r.stdout
    print(f"{OK_MARK if p else FAIL_MARK} ctx priority         mempalace非空→优先")
    all_ok = all_ok and p

# 注入真的进了 dispatch：eto.ts execPlan 必须把 contextTask 传给
# tryDispatchToMCPAgent / executePlanViaMaestro / peerConsensus（源码断言，防回归）。
ts_src = (ROOT.parent / "extensions" / "eto.ts").read_text(encoding="utf-8")
m = re.search(r"async function execPlan\(task: string[^{]*\{(.*?)\n\}", ts_src, re.DOTALL)
p = bool(m) and all(
    call in m.group(1)
    for call in (
        "tryDispatchToMCPAgent(coordinator, contextTask)",
        "peerConsensus(contextTask,",
        "executePlanViaMaestro(contextTask, steps)",
    )
) and "tryDispatchToMCPAgent(coordinator, task)" not in m.group(1)
print(f"{OK_MARK if p else FAIL_MARK} ctx dispatch         execPlan用contextTask")
all_ok = all_ok and p

# ── Feedback Gate 约束注入测试（issue #16: P0-6）────────────
# 断链复现：写入反馈后，下一次 dispatch 的 spec 必须能查到对应约束。
# 隔离 HOME：约束走 shared_memory（~/.eto/shared_memory），不能污染真实环境。
with tempfile.TemporaryDirectory() as tmp_home:
    env = {**os.environ, "HOME": tmp_home}
    r = subprocess.run(
        [PY, "-c",
         "import sys, json; sys.path.insert(0, %r);" % str(ROOT.parent.parent) +
         "from eto.stitches.quality.feedback import save_constraint, inject_constraints; "
         "save_constraint('coder', '回答前必须先读现有代码'); "
         "spec = {'agent': 'coder', 'tool': 'agent_execute', 'task': 'x', 'system_prompt': 'base'}; "
         "print(json.dumps(inject_constraints(spec), ensure_ascii=False))"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10, env=env,
    )
    try:
        injected = json.loads(r.stdout) if r.stdout.strip() else {}
    except json.JSONDecodeError:
        injected = {}
    p = (r.returncode == 0
         and injected.get("system_prompt", "").startswith("base")
         and "用户历史反馈约束" in injected.get("system_prompt", "")
         and "读现有代码" in injected.get("system_prompt", ""))
    print(f"{OK_MARK if p else FAIL_MARK} feedback inject      约束按agent名注入")
    all_ok = all_ok and p

# 空 agent 行为：spec 缺 agent 字段时必须留下记录（stderr），不许静默返回原 spec。
with tempfile.TemporaryDirectory() as tmp_home:
    env = {**os.environ, "HOME": tmp_home}
    r = subprocess.run(
        [PY, "-c",
         "import sys, json; sys.path.insert(0, %r);" % str(ROOT.parent.parent) +
         "from eto.stitches.quality.feedback import inject_constraints; "
         "spec = inject_constraints({'tool': 'agent_execute', 'task': 'x', 'system_prompt': 'base'}); "
         "print(json.dumps(spec, ensure_ascii=False))"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10, env=env,
    )
    p = (r.returncode == 0
         and "constraints_skipped" in r.stderr
         and "missing agent field" in r.stderr
         and '"用户历史反馈约束"' not in r.stdout)
    print(f"{OK_MARK if p else FAIL_MARK} feedback empty-agent 跳过并记录")
    all_ok = all_ok and p

# 注入链源头：eto.ts tryDispatchToMCPAgent 构造 spec 时显式传 agent 字段；
# workflow.py 的 dispatch spec 同样带 agent（源码断言，防回归）。
ts_src = (ROOT.parent / "extensions" / "eto.ts").read_text(encoding="utf-8")
m = re.search(r"async function tryDispatchToMCPAgent\(peerName: string[^{]*\{(.*?)\n\}", ts_src, re.DOTALL)
p = bool(m) and "agent: peerName" in m.group(1)
wf_src = (ROOT / "bidding" / "workflow.py").read_text(encoding="utf-8")
p = p and '"agent": step["agent"]' in wf_src
print(f"{OK_MARK if p else FAIL_MARK} feedback agent字段   spec显式传agent")
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

# ── LangGraph 工作流假成功防线（issue #13: P0-3）────────────
# 语义：dispatch 返回空/报错/失败时，步骤必须标 failed 并暴露 error，
# 绝不允许「空输出 + status:ok」的静默假成功。run_step 不依赖 langgraph 建图，
# 三种环境（裸解释器 / 仅 langgraph / 完整依赖）都能跑。

wf_step = json.dumps({"step": 1, "agent": "coder", "description": "编码", "system_prompt": "写代码", "skills": [], "mcp_tools": []})

# 1. 假成功不变量：run_step 不允许「空输出 + status:ok」。
#    - 无 provider 环境（CI 的三种 job 都是）：dispatch 落空 → 必须 failed + 非空 error。
#    - 有 provider 环境（如本地 fake MCP）：ok 必须伴随非空 output。
#    修复前这里是 status=ok + 空输出的静默假成功。
r = run(ROOT / "bidding/workflow.py", {"fn": "run_step", "args": [wf_step, "写一个hello world"]})
try:
    step_result = json.loads(r.stdout) if ok(r) else {}
except json.JSONDecodeError:
    step_result = {}
_status, _output, _error = step_result.get("status"), step_result.get("output", ""), step_result.get("error", "")
p = (
    (_status == "failed" and not _output and bool(_error))
    or (_status == "ok" and bool(_output))
)
print(f"{OK_MARK if p else FAIL_MARK} wf 空输出→failed     状态/输出一致")
all_ok = all_ok and p

# 2. mcp_server 源码必须注册 agent_execute 工具（AST 断言，无需 mcp 包）
#    修复前 server 只暴露 12 个工具、没有 agent_execute，工作流每步调空。
import ast as _ast
_srv_src = (ROOT.parent / "mcp_server.py").read_text(encoding="utf-8")
_registered = [
    n.name for n in _ast.walk(_ast.parse(_srv_src))
    if isinstance(n, _ast.FunctionDef)
    and any(isinstance(d, _ast.Call) and getattr(d.func, "attr", "") == "tool" for d in n.decorator_list)
]
p = "agent_execute" in _registered
print(f"{OK_MARK if p else FAIL_MARK} wf agent_execute      MCP server已注册")
all_ok = all_ok and p

# 3. 成功路径必须有非空输出：mcp 包可用时走真实 agent_execute（无 provider 环境
#    仍会 failed，由用例 1 覆盖）；mcp 不可用时跳过真实调用，只验证 dispatch 链路
#    的成功分支存在（源码断言，防止 ok 分支丢失非空输出检查）。
_wf_src = (ROOT / "bidding/workflow.py").read_text(encoding="utf-8")
_node_fn = _wf_src[_wf_src.index("def _make_node_fn"): _wf_src.index("def _make_router")]
p = (
    'state["step_results"].append({"agent": step["agent"], "status": "ok", "output": output' in _node_fn
    and 'not output.strip()' in _node_fn
)
print(f"{OK_MARK if p else FAIL_MARK} wf ok-branch非空输出  状态语义完整")
all_ok = all_ok and p

sys.exit(0 if all_ok else 1)
