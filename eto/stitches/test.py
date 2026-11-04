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

# ── 集体回顾 + Loop 系统（issue #28: FR-E1 / FR-E2）────────────
# 核心语义：每个实现的 Loop 都必须真的「再跑一轮」，不是只算不跑。
# Rework：失败 → 收集失败原因 → 带上一轮失败信息重跑（execute_round 注入 mock，
# 断言第二轮收到的 feedback 包含第一轮失败原因 —— 真的重跑了一轮）。
# Iteration：多轮结果可比较、收敛即停。集体回顾：触发条件 + 权重调整闭环。

# 1. LoopContext 接口（FR-E2.3/E2.4）：type/round/maxRounds/artifacts，-1 无限
r = run(ROOT / "reflection.py", {"fn": "loop_context", "args": ["rework", 1, "修 bug"]})
p = ok(r) and '"type": "rework"' in r.stdout and '"round": 0' in r.stdout and '"maxRounds": 1' in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} loop ctx接口        type/round/maxRounds")
all_ok = all_ok and p

r = run(ROOT / "reflection.py", {"fn": "loop_advance", "args": [json.dumps({"type": "iteration", "round": 2, "maxRounds": 3, "task": "t", "artifacts": []})]})
p = ok(r) and '"round": 3' in r.stdout and '"should_continue": false' in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} loop advance        第3轮后停")
all_ok = all_ok and p

r = run(ROOT / "reflection.py", {"fn": "loop_advance", "args": [json.dumps({"type": "watch", "round": 5, "maxRounds": -1, "task": "t", "artifacts": []})]})
p = ok(r) and '"should_continue": true' in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} loop 无限循环      maxRounds=-1 继续")
all_ok = all_ok and p

# 2. 循环意图检测（FR-E2.1）：rework/iteration/watch/cron 四类关键词
for _kw, _type in [("失败了自动重试一轮", "rework"), ("反复执行直到收敛", "iteration"), ("盯着这个文件有变化时通知我", "watch"), ("每天定时生成简报", "cron")]:
    r = run(ROOT / "reflection.py", {"fn": "detect_loop_intent", "args": [_kw]})
    p = ok(r) and f'"type": "{_type}"' in r.stdout
    print(f"{OK_MARK if p else FAIL_MARK} loop intent {_type:10s} 关键词命中")
    all_ok = all_ok and p
r = run(ROOT / "reflection.py", {"fn": "detect_loop_intent", "args": ["查一下天气"]})
p = ok(r) and r.stdout.strip() == "null"
print(f"{OK_MARK if p else FAIL_MARK} loop intent none     无意图返回null")
all_ok = all_ok and p
# Watch/Cron 必须明确报「未实现」，不许静默装作支持
r = run(ROOT / "reflection.py", {"fn": "detect_loop_intent", "args": ["每天定时生成简报"]})
p = ok(r) and "未实现" in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} loop watch/cron      标注未实现")
all_ok = all_ok and p

# 3. Rework Loop（FR-E2.2）：真的再跑一轮 + 上一轮失败信息进入下一轮
_calls = []
def _mock_exec_round(task, steps, feedback):
    _calls.append(feedback)
    if not feedback:
        return [{"agent": "coder", "status": "failed", "output": "", "error": "connection refused by provider", "retries": 0}]
    return [{"agent": "coder", "status": "ok", "output": f"done with feedback: {feedback}", "retries": 0}]
sys.path.insert(0, str(ROOT.parent.parent))
from eto.stitches.bidding.workflow import rework_loop, failure_feedback
_rw = rework_loop("写一个爬虫", [{"step": 1, "agent": "coder", "description": "编码"}], 1, execute_round=_mock_exec_round)
p = (_rw["rounds_run"] == 2 and _rw["success"] is True
     and _rw["rounds"][0]["success"] is False
     and "connection refused" in _rw["rounds"][1]["rework_feedback"]
     and len(_calls) == 2 and "connection refused" in _calls[1])
print(f"{OK_MARK if p else FAIL_MARK} loop rework         失败带因重跑一轮")
all_ok = all_ok and p

# rework 与既有 step 级 retry 协调：retry 消耗步骤的 max_retries，rework 只在整轮失败后介入。
# 源码断言（防回归）：rework_loop 的实现复用 _make_node_fn/_rework_execute_round，不另起执行体系。
_wf_src2 = (ROOT / "bidding" / "workflow.py").read_text(encoding="utf-8")
p = ("def _rework_execute_round" in _wf_src2
     and "_make_node_fn(step)(state)" in _wf_src2
     and "rework_feedback" in _wf_src2)
print(f"{OK_MARK if p else FAIL_MARK} loop rework复用      不另起执行体系")
all_ok = all_ok and p

# failure_feedback：收集所有失败步骤的原因
_ff = failure_feedback([
    {"agent": "coder", "status": "failed", "output": "", "error": "err-a", "retries": 0},
    {"agent": "auditor", "status": "ok", "output": "x", "retries": 0},
    {"agent": "coder", "status": "failed", "output": "", "error": "err-b", "retries": 0},
])
p = "err-a" in _ff and "err-b" in _ff and "auditor" not in _ff
print(f"{OK_MARK if p else FAIL_MARK} rework feedback     聚合失败原因")
all_ok = all_ok and p

# 4. Iteration Loop（FR-E2）：多轮结果可比较，收敛即停
_iter_calls = {"n": 0}
def _mock_iter_round(round_no):
    _iter_calls["n"] += 1
    if round_no == 1:
        return "第一轮草稿：方向未定，需要补充数据"
    return "最终结论：市场规模 100 亿，CAGR 5%，头部三家占 60%"
from eto.stitches.reflection import iteration_loop, compare_rounds, similarity
_it = iteration_loop("市场分析", max_rounds=3, threshold=0.9, execute_round=_mock_iter_round)
p = (_it["rounds"] == 3 and _it["converged"] is True and _iter_calls["n"] == 3
     and len(_it["similarities"]) == 2 and _it["similarities"][0] < 0.9 and _it["similarities"][-1] >= 0.9)
print(f"{OK_MARK if p else FAIL_MARK} loop iteration      收敛即停可比")
all_ok = all_ok and p

# 不收敛场景：跑满 max_rounds，converged=False
_iter_calls2 = {"n": 0}
def _mock_iter_diverge(round_no):
    _iter_calls2["n"] += 1
    return f"第 {round_no} 轮完全不同的结果 {round_no * 1000}"
_it2 = iteration_loop("发散任务", max_rounds=3, threshold=0.95, execute_round=_mock_iter_diverge)
p = (_it2["rounds"] == 3 and _it2["converged"] is False and _iter_calls2["n"] == 3)
print(f"{OK_MARK if p else FAIL_MARK} loop iteration发散   跑满上限不停")
all_ok = all_ok and p

# compare_rounds/similarity 纯函数语义
p = similarity("abc", "abc") == 1.0 and similarity("abc", "xyz") < 0.5 and compare_rounds(["a", "a", "b"]) == [1.0, round(similarity("a", "b"), 3)]
print(f"{OK_MARK if p else FAIL_MARK} iteration similarity 相似度计算")
all_ok = all_ok and p

# 5. Iteration 真实执行链路（run_iteration 走 run_step dispatch，无 provider 环境 → 失败轮也照跑并落账）
with tempfile.TemporaryDirectory() as tmp_home:
    env = {**os.environ, "HOME": tmp_home}
    r = subprocess.run(
        [PY, "-c",
         "import sys, json; sys.path.insert(0, %r);" % str(ROOT.parent.parent) +
         "from eto.stitches.reflection import run_iteration; "
         "res = json.loads(run_iteration('反复执行测试任务', max_rounds=2, threshold=0.99)); "
         "print(json.dumps({'rounds': res['rounds'], 'converged': res['converged'], "
         "'has_outputs': len(res['outputs']) == res['rounds']}))" % ()],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60, env=env,
    )
    try:
        _it3 = json.loads(r.stdout) if r.stdout.strip() else {}
    except json.JSONDecodeError:
        _it3 = {}
    # 无 provider 环境：两轮输出同为失败串 → 相似度 1.0 → 收敛；重点断言「真的跑满可跑的轮次」
    p = r.returncode == 0 and _it3.get("rounds") == 2 and _it3.get("has_outputs") is True and isinstance(_it3.get("converged"), bool)
    print(f"{OK_MARK if p else FAIL_MARK} iteration真实链路   多轮执行落账")
    all_ok = all_ok and p

# 6. Rework 真实执行链路（run_rework 走 run_step dispatch + 轮次落账 shared_memory）
with tempfile.TemporaryDirectory() as tmp_home:
    env = {**os.environ, "HOME": tmp_home}
    _steps = json.dumps([{"step": 1, "agent": "coder", "description": "编码", "system_prompt": "写代码", "skills": [], "mcp_tools": []}])
    r = subprocess.run(
        [PY, "-c",
         "import sys, json; sys.path.insert(0, %r);" % str(ROOT.parent.parent) +
         "from eto.stitches.bidding.workflow import run_rework; "
         "res = json.loads(run_rework('写一个hello world', %r, 1)); "
         "print(json.dumps({'rounds_run': res['rounds_run'], 'success': res['success'], "
         "'loop_type': res['loop']['type']}))" % _steps],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60, env=env,
    )
    try:
        _rw2 = json.loads(r.stdout) if r.stdout.strip() else {}
    except json.JSONDecodeError:
        _rw2 = {}
    p = r.returncode == 0 and _rw2.get("rounds_run") == 2 and _rw2.get("loop_type") == "rework"
    print(f"{OK_MARK if p else FAIL_MARK} rework真实链路     失败重跑+落账")
    all_ok = all_ok and p
    # 落账进 shared_memory（集体回顾的数据源）
    r2 = subprocess.run(
        [PY, "-c",
         "import sys, json; sys.path.insert(0, %r);" % str(ROOT.parent.parent) +
         "from eto.stitches.memory.shared_memory import read; "
         "h = read('collective_reflection:history') or {}; "
         "print(json.dumps({'total': h.get('total', 0), 'rounds': len(h.get('rounds', []))}))"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10, env=env,
    )
    try:
        _hist = json.loads(r2.stdout) if r2.stdout.strip() else {}
    except json.JSONDecodeError:
        _hist = {}
    p = r2.returncode == 0 and _hist.get("total", 0) >= 1
    print(f"{OK_MARK if p else FAIL_MARK} rework轮次落账     history有记录")
    all_ok = all_ok and p

# 7. 集体回顾触发条件（FR-E1.1/E1.2）：每 N 轮 / 最近 5 轮失败 > 3
_h10 = json.dumps({"total": 10, "rounds": [{"success": True}] * 10})
r = run(ROOT / "reflection.py", {"fn": "should_reflect", "args": [_h10]})
p = ok(r) and '"reflect": true' in r.stdout and "每 10 轮" in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} reflect触发:每N轮   total=10命中")
all_ok = all_ok and p

_hfail = json.dumps({"total": 3, "rounds": [{"success": False}] * 4 + [{"success": True}]})
r = run(ROOT / "reflection.py", {"fn": "should_reflect", "args": [_hfail]})
p = ok(r) and '"reflect": true' in r.stdout and "失败 4" in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} reflect触发:高失败  5轮4败命中")
all_ok = all_ok and p

_hok = json.dumps({"total": 7, "rounds": [{"success": True}] * 7})
r = run(ROOT / "reflection.py", {"fn": "should_reflect", "args": [_hok]})
p = ok(r) and '"reflect": false' in r.stdout
print(f"{OK_MARK if p else FAIL_MARK} reflect不触发       条件未达")
all_ok = all_ok and p

# 8. 集体回顾分析（FR-E1.4/E1.5）：聚类失败 → 识别模式 → 调整权重 → 报告（隔离 HOME）
with tempfile.TemporaryDirectory() as tmp_home:
    env = {**os.environ, "HOME": tmp_home}
    _hist_fail = json.dumps({"total": 6, "rounds": [
        {"task": "t1", "success": False, "agent": "coder", "detail": "connection refused 111"},
        {"task": "t2", "success": False, "agent": "coder", "detail": "connection refused 222"},
        {"task": "t3", "success": False, "agent": "coder", "detail": "timeout 333"},
        {"task": "t4", "success": False, "agent": "coder", "detail": "connection refused 444"},
        {"task": "t5", "success": True, "agent": "researcher", "detail": ""},
        {"task": "t6", "success": True, "agent": "researcher", "detail": ""},
    ]})
    r = subprocess.run(
        [PY, "-c",
         "import sys, json; sys.path.insert(0, %r);" % str(ROOT.parent.parent) +
         "from eto.stitches.reflection import run_reflection, format_report; "
         "report = json.loads(run_reflection(%r)); "
         "text = format_report(report); "
         "print(json.dumps({'failure_count': report['failure_count'], "
         "'has_coder_finding': any(f['agent'] == 'coder' and f['failure_count'] == 4 for f in report['findings']), "
         "'has_adjustment': 'coder' in report['adjustments'], "
         "'adjust_val': report['adjustments'].get('coder', {}).get('code'), "
         "'report_text_ok': '集体回顾报告' in text and '建议' in text}))" % _hist_fail],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10, env=env,
    )
    try:
        _rep = json.loads(r.stdout) if r.stdout.strip() else {}
    except json.JSONDecodeError:
        _rep = {}
    p = (r.returncode == 0 and _rep.get("failure_count") == 4
         and _rep.get("has_coder_finding") is True
         and _rep.get("has_adjustment") is True
         and _rep.get("adjust_val") == 0.85
         and _rep.get("report_text_ok") is True)
    print(f"{OK_MARK if p else FAIL_MARK} reflect分析        聚类+调权+报告")
    all_ok = all_ok and p

    # 闭环：回顾调整写入 shared_memory 后，竞标 weights 降级路径用它（protocol._apply_adjustment）
    r2 = subprocess.run(
        [PY, "-c",
         "import sys, json; sys.path.insert(0, %r);" % str(ROOT.parent.parent) +
         "from eto.stitches.bidding.protocol import _apply_adjustment; "
         "p = {'name': 'coder', 'weights': {'code': 0.95, 'research': 0.2}}; "
         "adjusted = _apply_adjustment(p); "
         "print(json.dumps({'code': adjusted['weights']['code'], 'unchanged': p['weights']['code']}))"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10, env=env,
    )
    try:
        _adj = json.loads(r2.stdout) if r2.stdout.strip() else {}
    except json.JSONDecodeError:
        _adj = {}
    p = r2.returncode == 0 and _adj.get("code") == 0.85 and _adj.get("unchanged") == 0.95
    print(f"{OK_MARK if p else FAIL_MARK} reflect权重闭环    竞标读调整")
    all_ok = all_ok and p

# 9. 自动触发 + 手动 CLI（FR-E1.1/E1.3）
with tempfile.TemporaryDirectory() as tmp_home:
    env = {**os.environ, "HOME": tmp_home}
    # maybe_reflect：落账到第 10 轮时自动触发回顾
    r = subprocess.run(
        [PY, "-c",
         "import sys, json; sys.path.insert(0, %r);" % str(ROOT.parent.parent) +
         "from eto.stitches.reflection import maybe_reflect; "
         "res = json.loads(maybe_reflect()); "
         "print(json.dumps({'triggered': res['triggered'], 'reason': res['reason']}))"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10, env=env,
    )
    try:
        _mr = json.loads(r.stdout) if r.stdout.strip() else {}
    except json.JSONDecodeError:
        _mr = {}
    p = r.returncode == 0 and _mr.get("triggered") is False
    print(f"{OK_MARK if p else FAIL_MARK} reflect自动触发    未达不触发")
    all_ok = all_ok and p

# 手动 CLI：python3 eto/stitches/reflection.py reflect 输出人类可读报告（FR-E1.3）
with tempfile.TemporaryDirectory() as tmp_home:
    env = {**os.environ, "HOME": tmp_home}
    r = subprocess.run([PY, str(ROOT / "reflection.py"), "reflect"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30, env=env)
    p = r.returncode == 0 and "集体回顾报告" in r.stdout
    print(f"{OK_MARK if p else FAIL_MARK} reflect CLI         手动触发输出报告")
    all_ok = all_ok and p

# eto-mesh reflect 子命令存在（cli.py 源码断言，无需装包即可验证）
_cli_src = (ROOT.parent / "cli.py").read_text(encoding="utf-8")
p = "reflect" in _cli_src and "cmd_reflect" in _cli_src
print(f"{OK_MARK if p else FAIL_MARK} eto-mesh reflect    CLI子命令注册")
all_ok = all_ok and p

# eto.ts 集成断言（防回归）：/reflect 命令 + Loop 意图检测真的进了路由
ts_src2 = (ROOT.parent / "extensions" / "eto.ts").read_text(encoding="utf-8")
p = ('pi.registerCommand("reflect"' in ts_src2
     and 'detect_loop_intent' in ts_src2
     and "Loop 意图" in ts_src2)
print(f"{OK_MARK if p else FAIL_MARK} eto.ts reflect/loop  命令+意图接线")
all_ok = all_ok and p

sys.exit(0 if all_ok else 1)
