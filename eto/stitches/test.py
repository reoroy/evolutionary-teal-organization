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

# ── Raft 语义测试（issue #29: term/quorum/持久化/busy_ratio）──────────────
# 每次 run() 都是新进程，持久化只能靠状态文件，正好验证跨进程存活。
# ETO_ELECTION_STATE 指向临时文件，不污染 ~/.eto。

import tempfile as _tf
with _tf.NamedTemporaryFile(suffix=".json", delete=False) as _f:
    _ELEC_STATE = _f.name
os.environ["ETO_ELECTION_STATE"] = _ELEC_STATE

def _run_elect(cands):
    return run(ROOT / "election/elect.py", {"fn": "elect", "args": [cands]})

# 1) 持久化: 两次独立进程调用，第二次应复用同一 leader（raft-incumbent，term 不变）
r1 = _run_elect([["r", 0.9], ["c", 0.5]])
r2 = _run_elect([["r", 0.9], ["c", 0.5]])
try:
    _e1, _e2 = json.loads(r1.stdout), json.loads(r2.stdout)
except json.JSONDecodeError:
    _e1, _e2 = {}, {}
p = (
    ok(r1) and ok(r2)
    and _e1.get("method") == "raft" and _e1.get("term") == 1
    and _e2.get("method") == "raft-incumbent" and _e2.get("term") == 1
    and _e1.get("leader") == _e2.get("leader") == "r"
)
print(f"{OK_MARK if p else FAIL_MARK} elect persist       跨进程同一leader/term")
all_ok = all_ok and p

# 2) quorum 不足: 全员 busy_ratio=1 → 有效得分全为 0 → 不产生 leader
r = _run_elect([{"name": "r", "score": 0.9, "busy_ratio": 1.0},
                {"name": "c", "score": 0.5, "busy_ratio": 1.0}])
try:
    _e = json.loads(r.stdout)
except json.JSONDecodeError:
    _e = {}
p = ok(r) and _e.get("leader") is None and _e.get("method") == "raft-no-quorum"
print(f"{OK_MARK if p else FAIL_MARK} elect no-quorum     全忙无leader")
all_ok = all_ok and p

# 3) busy_ratio 真实生效: r 得分高但满载 → c 当选（match_score × (1-busy_ratio)）
r = _run_elect([{"name": "r", "score": 0.9, "busy_ratio": 1.0},
                {"name": "c", "score": 0.5, "busy_ratio": 0.0}])
try:
    _e = json.loads(r.stdout)
except json.JSONDecodeError:
    _e = {}
p = ok(r) and _e.get("leader") == "c" and _e.get("term") == 3
print(f"{OK_MARK if p else FAIL_MARK} elect busy_ratio    满载让位")
all_ok = all_ok and p

# 4) 源码断言: elect.py 实现 term/quorum/持久化/busy_ratio 四要素（防退化）
_elec_src = (ROOT / "election" / "elect.py").read_text(encoding="utf-8")
p = all(k in _elec_src for k in ("term", "quorum", "election-state.json", "busy_ratio", "1.0 - c[\"busy_ratio\"]"))
print(f"{OK_MARK if p else FAIL_MARK} elect raft-semantics 源码四要素")
all_ok = all_ok and p

# 5) 源码断言: eto.ts 候选分数来自 profiles.json（非硬编码）
_ts_src = (ROOT.parent / "extensions" / "eto.ts").read_text(encoding="utf-8")
import re as _re
_hardcoded = _re.search(r'candidates\w*\s*:\s*\[string,\s*number\]\[\]\s*=\s*\[', _ts_src)
p = ("buildElectionCandidates" in _ts_src and not _hardcoded
     and "weights" in _ts_src and "busyRatioFor" in _ts_src)
print(f"{OK_MARK if p else FAIL_MARK} elect cand非硬编码  profiles+busy")
all_ok = all_ok and p

os.environ.pop("ETO_ELECTION_STATE", None)
os.unlink(_ELEC_STATE)

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

# 注入真的进了 dispatch：eto.ts 的 execPlan + dispatchByMode 必须把 contextTask
# 传给 tryDispatchToMCPAgent / executePlanViaMaestro / peerConsensus（源码断言，防回归）。
# MODE 路由（issue #26）把流水线调用移进 dispatchByMode，故断言两者拼接后的整体。
ts_src = (ROOT.parent / "extensions" / "eto.ts").read_text(encoding="utf-8")
m_exec = re.search(r"async function execPlan\(task: string[^{]*\{(.*?)\n\}", ts_src, re.DOTALL)
m_disp = re.search(r"async function dispatchByMode\(task: string[^{]*\{(.*?)\n\}", ts_src, re.DOTALL)
combined = (m_exec.group(1) if m_exec else "") + (m_disp.group(1) if m_disp else "")
p = bool(m_exec) and bool(m_disp) and all(
    call in combined
    for call in (
        "tryDispatchToMCPAgent(coordinator, contextTask)",
        "peerConsensus(contextTask,",
        "executePlanViaMaestro(contextTask, steps)",
        "dispatchByMode(task, route, contextTask, coordinator)",
    )
) and "tryDispatchToMCPAgent(coordinator, task)" not in combined
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

# ── Governance 测试（issue #27: FR-D3 权限绑定 + 任务预算）──────────────
# 全部隔离 HOME（permit.json / budget.json / 计数器都落在临时目录），
# 不污染真实 ~/.eto。子进程 stitch 入口按惯例 stdin/stdout JSON 驱动。

GOV_TAG = "gov-"

def _gov_setup(tmp_home: str, permits: dict | None, budgets: dict | None) -> None:
    """在隔离 HOME 下写 permit/budget 配置。传 None 表示不写该配置。"""
    from pathlib import Path as _P
    eto_dir = _P(tmp_home) / ".eto"
    eto_dir.mkdir(parents=True, exist_ok=True)
    import json as _json
    if permits is not None:
        (eto_dir / "permit.json").write_text(_json.dumps(permits), "utf-8")
    if budgets is not None:
        (eto_dir / "budget.json").write_text(_json.dumps(budgets), "utf-8")

def _gov_run(tmp_home: str, spec: dict) -> subprocess.CompletedProcess:
    """走真实 stitch 入口（mcp_dispatch.py 的 __main__），隔离 HOME。

    拒绝路径在 import mcp 之前返回；放行路径在无 mcp 包环境会落到
    stitch 入口的 try/except → {"_error": ...}，同样是生产行为。
    """
    env = {**os.environ, "HOME": tmp_home}
    return subprocess.run(
        [PY, str(ROOT / "mcp_dispatch.py")],
        input=json.dumps({"fn": "dispatch_with_spec", "args": [json.dumps(spec)]}),
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=10, env=env,
    )

_SPEC_ALLOW = {"server_cmd": [], "tool": "agent_execute", "agent": "coder", "task": "t", "task_id": "t-1"}

def _gov_out(r: subprocess.CompletedProcess) -> dict:
    try:
        return json.loads(r.stdout) if r.stdout.strip() else {}
    except json.JSONDecodeError:
        return {}

# 1. 未配置 permit/budget → 放行（向后兼容：旧行为不变；无 mcp 包时
#    落到 stitch 入口 _error，但绝不是治理拒绝）
with tempfile.TemporaryDirectory() as tmp_home:
    r = _gov_run(tmp_home, _SPEC_ALLOW)
    out = _gov_out(r)
    p = r.returncode == 0 and "_governance" not in out
    print(f"{OK_MARK if p else FAIL_MARK} gov 未配置→放行      兼容旧行为")
    all_ok = all_ok and p

# 2. 越权操作被拒：researcher 只许 eto_*，调 agent_execute → PERMIT_DENIED，
#    错误信息可定位（谁/想做什么/配置在哪），且 stderr 有拒绝日志
with tempfile.TemporaryDirectory() as tmp_home:
    _gov_setup(tmp_home, {"default": "deny", "agents": {"researcher": ["eto_*"]}}, None)
    r = _gov_run(tmp_home, dict(_SPEC_ALLOW, agent="researcher"))
    out = _gov_out(r)
    p = (r.returncode == 0
         and out.get("_governance") is True
         and out.get("code") == "PERMIT_DENIED"
         and "researcher" in out.get("message", "")
         and "agent_execute" in out.get("message", "")
         and "permit.json" in out.get("message", "")
         and '"kind": "permit"' in r.stderr and '"code": "PERMIT_DENIED"' in r.stderr)
    print(f"{OK_MARK if p else FAIL_MARK} gov 越权→拒绝+日志   PERMIT_DENIED")
    all_ok = all_ok and p

# 3. 白名单内操作放行（tool 匹配 eto_* 尾通配；无 mcp 包时降级 _error，
#    但不能是治理拒绝）
with tempfile.TemporaryDirectory() as tmp_home:
    _gov_setup(tmp_home, {"default": "deny", "agents": {"researcher": ["eto_*"], "coder": ["agent_execute"]}}, None)
    r = _gov_run(tmp_home, dict(_SPEC_ALLOW, agent="researcher", tool="eto_route"))
    out = _gov_out(r)
    p = r.returncode == 0 and "_governance" not in out
    print(f"{OK_MARK if p else FAIL_MARK} gov 白名单→放行     通配匹配")
    all_ok = all_ok and p

# 4. 白名单外 agent（未列出）→ 拒绝（fail-closed，default=deny）
with tempfile.TemporaryDirectory() as tmp_home:
    _gov_setup(tmp_home, {"default": "deny", "agents": {"coder": ["agent_execute"]}}, None)
    r = _gov_run(tmp_home, dict(_SPEC_ALLOW, agent="intruder"))
    out = _gov_out(r)
    p = out.get("code") == "PERMIT_DENIED" and "intruder" in out.get("message", "")
    print(f"{OK_MARK if p else FAIL_MARK} gov 未列agent→拒绝   fail-closed")
    all_ok = all_ok and p

# 5. 已启用 permit 但 spec 缺 agent → 拒绝（身份不明不放行）
with tempfile.TemporaryDirectory() as tmp_home:
    _gov_setup(tmp_home, {"default": "deny", "agents": {"coder": ["agent_execute"]}}, None)
    r = _gov_run(tmp_home, {"server_cmd": [], "tool": "agent_execute", "task": "t"})
    out = _gov_out(r)
    p = out.get("code") == "PERMIT_DENIED" and "agent" in out.get("message", "")
    print(f"{OK_MARK if p else FAIL_MARK} gov 缺agent→拒绝    身份不明")
    all_ok = all_ok and p

# 6. permit 配置损坏 → 拒绝（fail-closed）且信息可定位
with tempfile.TemporaryDirectory() as tmp_home:
    from pathlib import Path as _P
    (_P(tmp_home) / ".eto").mkdir(parents=True)
    (_P(tmp_home) / ".eto" / "permit.json").write_text("{broken json", "utf-8")
    r = _gov_run(tmp_home, _SPEC_ALLOW)
    out = _gov_out(r)
    p = out.get("code") == "PERMIT_DENIED" and "解析失败" in out.get("message", "")
    print(f"{OK_MARK if p else FAIL_MARK} gov 坏配置→拒绝     fail-closed可定位")
    all_ok = all_ok and p

# 7. 预算超限被停：task 预算 max_tool_calls=2，第 3 次调用 → BUDGET_EXCEEDED，
#    错误信息带用量与上限，stderr 有 budget_denied 日志
with tempfile.TemporaryDirectory() as tmp_home:
    _gov_setup(tmp_home, None, {"default": {"max_tool_calls": 2}})
    outs = [_gov_out(_gov_run(tmp_home, _SPEC_ALLOW)) for _ in range(3)]
    r = _gov_run(tmp_home, _SPEC_ALLOW)  # 再跑一次确认 stderr 稳定含拒绝日志
    p = ("_governance" not in outs[0] and "_governance" not in outs[1]
         and outs[2].get("code") == "BUDGET_EXCEEDED"
         and "2/2" in outs[2].get("message", "")
         and "t-1" in outs[2].get("message", "")
         and '"kind": "budget"' in r.stderr and '"code": "BUDGET_EXCEEDED"' in r.stderr)
    print(f"{OK_MARK if p else FAIL_MARK} gov 超预算→停止     BUDGET_EXCEEDED")
    all_ok = all_ok and p

# 8. 任务预算相互独立：t-1 耗尽不影响 t-2；default 帽对未列任务生效
with tempfile.TemporaryDirectory() as tmp_home:
    _gov_setup(tmp_home, None, {"tasks": {"t-1": {"max_tool_calls": 1}}})
    _gov_run(tmp_home, _SPEC_ALLOW)  # t-1 用掉 1/1
    r = _gov_run(tmp_home, dict(_SPEC_ALLOW, task_id="t-2"))
    out = _gov_out(r)
    p = "_governance" not in out  # t-2 走 default 帽（25），未被 t-1 影响
    print(f"{OK_MARK if p else FAIL_MARK} gov 预算按任务隔离  互不串账")
    all_ok = all_ok and p

# 9. 工作流超预算终止（FR-D3.3）：run_step 带 task_id，预算耗尽后步骤
#    必须标 failed + [BUDGET_EXCEEDED] 前缀 error，如实上报不静默
with tempfile.TemporaryDirectory() as tmp_home:
    _gov_setup(tmp_home, None, {"tasks": {"wf-budget": {"max_tool_calls": 1}}})
    env = {**os.environ, "HOME": tmp_home}
    wf_step_gov = json.dumps({"step": 1, "agent": "coder", "description": "编码", "system_prompt": "写代码", "skills": [], "mcp_tools": []})
    r1 = subprocess.run([PY, str(ROOT / "bidding" / "workflow.py")],
                        input=json.dumps({"fn": "run_step", "args": [wf_step_gov, "写一个hello world", "wf-budget"]}),
                        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30, env=env)
    r2 = subprocess.run([PY, str(ROOT / "bidding" / "workflow.py")],
                        input=json.dumps({"fn": "run_step", "args": [wf_step_gov, "再写一个", "wf-budget"]}),
                        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30, env=env)
    s1, s2 = _gov_out(r1), _gov_out(r2)
    p = (s1.get("status") == "failed"  # 无 provider 环境本就 failed（预算 1/1 已记账）
         and "_governance" not in s1
         and s2.get("status") == "failed"
         and str(s2.get("error", "")).startswith("[BUDGET_EXCEEDED]"))
    print(f"{OK_MARK if p else FAIL_MARK} gov 工作流超预算停  终止+如实上报")
    all_ok = all_ok and p

# 10. 治理门真的在 dispatch 路径上（源码断言，防回归）：
#     dispatch_with_spec 必须先 _apply_governance 再 sync_call_mcp
_dp_src = (ROOT / "mcp_dispatch.py").read_text(encoding="utf-8")
_p = (_dp_src.index("_apply_governance") < _dp_src.index("sync_call_mcp")
      and "def _apply_governance" in _dp_src)
# eto.ts 侧：spec 带 task_id + 治理拒绝如实上报（防回归）
_ts_src = (ROOT.parent / "extensions" / "eto.ts").read_text(encoding="utf-8")
_p = _p and "spec.task_id = currentTaskId" in _ts_src and "_governance" in _ts_src
print(f"{OK_MARK if _p else FAIL_MARK} gov dispatch路径接线  先治理后调用")
all_ok = all_ok and _p

# 11. 旧版 dispatch() 入口同样是治理门，不能当绕过后门：
#     启用 permit 后不传 agent（旧调用方）必须被拒，而不是悄悄放行
with tempfile.TemporaryDirectory() as tmp_home:
    _gov_setup(tmp_home, {"default": "deny", "agents": {"coder": ["agent_execute"]}}, None)
    env = {**os.environ, "HOME": tmp_home}
    def _legacy(*args):
        return subprocess.run([PY, str(ROOT / "mcp_dispatch.py")],
                              input=json.dumps({"fn": "dispatch", "args": list(args)}),
                              capture_output=True, text=True, encoding="utf-8",
                              errors="replace", timeout=10, env=env)
    no_agent = _gov_out(_legacy("[]", "agent_execute", "t"))
    with_agent = _gov_out(_legacy("[]", "agent_execute", "t", "coder"))
    p = (no_agent.get("code") == "PERMIT_DENIED"
         and "缺 agent" in no_agent.get("message", "")
         and "_governance" not in with_agent)
    print(f"{OK_MARK if p else FAIL_MARK} gov 旧dispatch不绕过   缺agent即拒")
    all_ok = all_ok and p

sys.exit(0 if all_ok else 1)
