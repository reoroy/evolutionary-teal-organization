"""ETO Stitch: Collective Reflection + Loop 系统（FR-E1 / FR-E2）

集体回顾（FR-E1）：
- record_round: 任务轮次落账（shared_memory: collective_reflection:history）
- should_reflect: 自动触发条件（每 N 轮 / 最近 5 轮失败 > 3）
- maybe_reflect: 落账后检查触发条件，命中即生成回顾报告
- run_reflection: 聚类失败记录 → 识别模式 → 调整策略权重 → 输出报告
- CLI 直跑: python3 eto/stitches/reflection.py reflect（对应设计中的 `eto reflect`）

Loop 系统（FR-E2）：
- LoopContext: 统一接口 type/round/maxRounds/artifacts（maxRounds=-1 无限）
- detect_loop_intent: 从任务文本检测循环意图（rework/iteration/watch/cron）
- iteration_loop: Iteration Loop —— 同一任务多轮执行，结果可比较，收敛即停
- Rework Loop 在 bidding/workflow.py（与既有 step 级 retry 协调，不另起一套）

Watch / Cron：仅检测意图（FR-E2.1），执行器未实现（README 标注缺失）。
"""
import json, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent

# 自动触发阈值（FR-E1.1 / FR-E1.2）
REFLECT_EVERY_N_ROUNDS = 10
REFLECT_FAILURE_WINDOW = 5
REFLECT_FAILURE_THRESHOLD = 3
# 历史轮次保留上限（防 shared_memory 无限膨胀）
HISTORY_CAP = 50

HISTORY_KEY = "collective_reflection:history"
WEIGHTS_KEY = "collective_reflection:weights"
REPORT_KEY = "collective_reflection:last_report"


def _ensure_import_root():
    """按 stitch 约定保证仓库根在 sys.path（直接脚本运行时 eto.* 才可导入）"""
    root = str(_REPO_ROOT)
    if root not in sys.path:
        sys.path.insert(0, root)


# ── FR-E2.3 LoopContext 统一接口 ──────────────

class LoopContext:
    """四种 Loop 的统一上下文：type/round/maxRounds/artifacts

    maxRounds = -1 表示无限循环（FR-E2.4）。
    """

    def __init__(self, type: str, max_rounds: int, task: str = ""):
        self.type = type
        self.round = 0
        self.max_rounds = max_rounds
        self.task = task
        self.artifacts: list = []

    def next_round(self) -> int:
        self.round += 1
        return self.round

    def should_continue(self) -> bool:
        return self.max_rounds == -1 or self.round < self.max_rounds

    def to_dict(self) -> dict:
        return {
            "type": self.type, "round": self.round, "maxRounds": self.max_rounds,
            "task": self.task, "artifacts": self.artifacts,
        }


def loop_context(type: str, max_rounds: int, task: str = "") -> str:
    """构造 LoopContext（stitch 接口）"""
    return json.dumps(LoopContext(type, max_rounds, task).to_dict(), ensure_ascii=False)


def loop_advance(ctx_json: str) -> str:
    """推一轮并报告是否继续（stitch 接口）"""
    d = json.loads(ctx_json) if isinstance(ctx_json, str) else ctx_json
    ctx = LoopContext(d.get("type", "?"), int(d.get("maxRounds", 0)), d.get("task", ""))
    ctx.round = int(d.get("round", 0))
    ctx.artifacts = d.get("artifacts", [])
    ctx.next_round()
    return json.dumps({"round": ctx.round, "should_continue": ctx.should_continue(), **ctx.to_dict()}, ensure_ascii=False)


# ── FR-E2.1 循环意图检测 ──────────────

_LOOP_KEYWORDS = [
    ("rework", 1,     ["失败重试", "失败后重试", "自动重试", "重试一轮", "返工", "rework", "retry", "再跑一次"]),
    ("iteration", 3,  ["迭代", "收敛", "多轮", "反复执行", "iterate", "converge", "refine until"]),
    ("watch", -1,     ["监控", "盯住", "盯着", "有变化时", "watch", "monitor"]),
    ("cron", -1,      ["定时", "每天", "每周", "每小时", "cron", "schedule"]),
]

# Watch / Cron 只有意图识别，没有执行器（README「集体回顾与 Loop」节标注缺失）
_UNIMPLEMENTED_LOOPS = {"watch": "Watch Loop 执行器未实现（需常驻文件/PR 监听进程）",
                        "cron": "Cron Loop 执行器未实现（需调度器，见 README 缺失说明）"}


def detect_loop_intent(task: str) -> str | None:
    """检测任务文本中的循环意图，返回 LoopContext dict 或 None（FR-E2.1）"""
    t = (task or "").lower()
    for loop_type, default_rounds, keywords in _LOOP_KEYWORDS:
        if any(k in t for k in keywords):
            ctx = LoopContext(loop_type, default_rounds, task)
            note = _UNIMPLEMENTED_LOOPS.get(loop_type)
            d = ctx.to_dict()
            if note:
                d["note"] = note
            return json.dumps(d, ensure_ascii=False)
    return None


# ── FR-E2.2 Iteration Loop：同任务多轮执行 + 收敛检测 ──────────────

def similarity(a: str, b: str) -> float:
    """两轮结果的相似度（0-1）。用 difflib 序列匹配，纯标准库。"""
    from difflib import SequenceMatcher
    return SequenceMatcher(None, a or "", b or "").ratio()


def compare_rounds(outputs: list) -> list:
    """相邻轮次两两相似度（FR-E2 Iteration 的可比性核心）"""
    return [round(similarity(outputs[i - 1], outputs[i]), 3) for i in range(1, len(outputs))]


def iteration_loop(task: str, max_rounds: int = 3, threshold: float = 0.9,
                   execute_round=None) -> dict:
    """Iteration Loop：每轮执行一次任务，与上一轮结果比较，收敛即停。

    execute_round(round_no) -> str：可注入的轮执行器（测试/复用）；
    缺省用 _default_iteration_executor（走 bidding/workflow.run_step）。
    """
    ctx = LoopContext("iteration", max_rounds, task)
    outputs, sims = [], []
    while ctx.should_continue():
        rnd = ctx.next_round()
        out = str(execute_round(rnd) if execute_round else _default_iteration_executor(task, rnd))
        outputs.append(out)
        ctx.artifacts.append({"round": rnd, "output": out[:200]})
        if len(outputs) >= 2:
            s = similarity(outputs[-2], outputs[-1])
            sims.append(round(s, 3))
            if s >= threshold:
                break
    converged = bool(sims) and sims[-1] >= threshold
    return {
        "task": task, "rounds": ctx.round, "converged": converged,
        "similarities": sims, "outputs": [o[:500] for o in outputs],
        "loop": ctx.to_dict(),
    }


def _default_iteration_executor(task: str, round_no: int) -> str:
    """默认轮执行器：单步 run_step，取 output/error 作为可比较结果"""
    _ensure_import_root()
    from eto.stitches.bidding.workflow import run_step
    step = {"step": 1, "agent": "coder", "description": f"第 {round_no} 轮执行",
            "system_prompt": f"Iteration Loop 第 {round_no} 轮：执行任务并保持与前轮可比的输出格式",
            "skills": [], "mcp_tools": []}
    try:
        r = json.loads(run_step(json.dumps(step, ensure_ascii=False), task))
        return (r.get("output") or "") + (r.get("error") or "")
    except Exception as e:
        return f"iteration round error: {e}"


def run_iteration(task: str, step_json: str = "", max_rounds: int = 3,
                  threshold: float = 0.9) -> str:
    """Iteration Loop 的 stitch 入口（真实执行链路）"""
    result = iteration_loop(task, max_rounds, threshold)
    _record_round_quiet(task, result["converged"], "iteration",
                        f"rounds={result['rounds']} converged={result['converged']}")
    return json.dumps(result, ensure_ascii=False)


# ── FR-E1 集体回顾 ──────────────

def record_round(task: str, success: bool, agent: str = "?", detail: str = "") -> str:
    """任务轮次落账（stitch 接口）。history = {"total": n, "rounds": [...]}，rounds 上限 HISTORY_CAP。"""
    _ensure_import_root()
    from eto.stitches.memory.shared_memory import write as _write, read as _read
    hist = _read(HISTORY_KEY) or {"total": 0, "rounds": []}
    if not isinstance(hist.get("rounds"), list):
        hist = {"total": 0, "rounds": []}
    entry = {"task": (task or "")[:60], "success": bool(success),
             "agent": agent, "detail": (detail or "")[:200]}
    rounds = hist["rounds"][-(HISTORY_CAP - 1):] + [entry]
    out = {"total": int(hist.get("total", 0)) + 1, "rounds": rounds}
    _write(HISTORY_KEY, {"total": out["total"], "rounds": rounds}, author="reflection")
    return json.dumps(out, ensure_ascii=False)


def load_history() -> dict:
    _ensure_import_root()
    from eto.stitches.memory.shared_memory import read as _read
    hist = _read(HISTORY_KEY) or {"total": 0, "rounds": []}
    if not isinstance(hist.get("rounds"), list):
        return {"total": 0, "rounds": []}
    return hist


def _record_round_quiet(task: str, success: bool, agent: str, detail: str):
    """落账 + 触发检查（落账失败不阻断主流程，但留下 stderr 记录）"""
    try:
        record_round(task, success, agent, detail)
        maybe_reflect()
    except Exception as e:
        print(f"reflect record skipped: {e}", file=sys.stderr)


def should_reflect(history_json=None) -> str:
    """FR-E1.1/E1.2 触发条件：每 N 轮 / 最近 5 轮失败 > 3。纯函数，可测。"""
    if history_json is None:
        history = load_history()
    else:
        history = json.loads(history_json) if isinstance(history_json, str) else (history_json or {})
    rounds = history.get("rounds", [])
    total = int(history.get("total", len(rounds)))
    if total > 0 and total % REFLECT_EVERY_N_ROUNDS == 0:
        return json.dumps({"reflect": True, "reason": f"每 {REFLECT_EVERY_N_ROUNDS} 轮自动回顾（当前第 {total} 轮）"}, ensure_ascii=False)
    recent = rounds[-REFLECT_FAILURE_WINDOW:]
    failures = sum(1 for r in recent if not r.get("success"))
    if len(recent) >= REFLECT_FAILURE_WINDOW and failures > REFLECT_FAILURE_THRESHOLD:
        return json.dumps({"reflect": True, "reason": f"高失败率：最近 {REFLECT_FAILURE_WINDOW} 轮失败 {failures} 次"}, ensure_ascii=False)
    return json.dumps({"reflect": False, "reason": f"未达触发条件（总轮数 {total}，最近失败 {failures}/{len(recent)}）"}, ensure_ascii=False)


def _error_keyword(detail: str) -> str:
    """失败原因的词干（简单词法聚类：去数字/空白，取前 40 字符）"""
    import re
    k = re.sub(r"[\d\s]+", "", detail or "").lower()
    return k[:40] or "(空)"


def _builtin_weights() -> dict:
    """读取静态 profiles 权重作为调整基线（只读，不改仓库文件）"""
    try:
        profiles = json.loads((_REPO_ROOT / "eto" / "stitches" / "profiles.json").read_text("utf-8"))
        return {p["name"]: p.get("weights", {}) for p in profiles}
    except Exception:
        return {}


def run_reflection(history_json=None) -> str:
    """集体回顾（FR-E1.4/E1.5）：聚类失败 → 识别模式 → 调整策略权重 → 报告"""
    _ensure_import_root()
    from eto.stitches.memory.shared_memory import write as _write
    history = (json.loads(history_json) if isinstance(history_json, str) else history_json) if history_json else load_history()
    rounds = history.get("rounds", [])
    failures = [r for r in rounds if not r.get("success")]

    # 聚类：按 agent 分组，组内按错误词干归并
    clusters: dict = {}
    for f in failures:
        agent = f.get("agent", "?")
        kw = _error_keyword(f.get("detail", ""))
        clusters.setdefault(agent, {})
        clusters[agent][kw] = clusters[agent].get(kw, 0) + 1

    findings = []
    agent_stats = {}
    for agent, kws in clusters.items():
        total = sum(1 for r in rounds if r.get("agent") == agent)
        agent_stats[agent] = {"failures": sum(kws.values()), "rounds": total}
        patterns = sorted(({"keyword": k, "count": c} for k, c in kws.items()), key=lambda p: -p["count"])
        findings.append({"agent": agent, "failure_count": sum(kws.values()),
                         "rounds_seen": total, "patterns": patterns[:3]})

    # 策略权重调整：样本 ≥3 且失败率 > 0.5 的 agent，其最高权重项降 0.1（下限 0.1）
    base = _builtin_weights()
    adjustments = {}
    recommendations = []
    for agent, st in agent_stats.items():
        if st["rounds"] >= 3 and st["failures"] / st["rounds"] > 0.5:
            w = base.get(agent, {})
            if w:
                top_key = max(w, key=w.get)
                new_w = max(0.1, round(w[top_key] - 0.1, 2))
                adjustments[agent] = {top_key: new_w}
                recommendations.append(f"{agent} 失败率 {st['failures']}/{st['rounds']}，{top_key} 权重 {w[top_key]} → {new_w}（已写入，竞标降级路径生效）")
            else:
                recommendations.append(f"{agent} 失败率 {st['failures']}/{st['rounds']}，建议人工检查其 provider 配置")
    if not failures:
        recommendations.append("近期无失败记录，保持当前策略权重")

    report = {
        "total_rounds": int(history.get("total", len(rounds))),
        "failure_count": len(failures),
        "failure_rate": round(len(failures) / len(rounds), 2) if rounds else 0.0,
        "findings": findings,
        "adjustments": adjustments,
        "recommendations": recommendations,
    }
    _write(WEIGHTS_KEY, {"type": "strategy_weights", "adjustments": adjustments}, author="reflection")
    _write(REPORT_KEY, report, author="reflection")
    return json.dumps(report, ensure_ascii=False)


def maybe_reflect() -> str:
    """落账后调用：命中触发条件则生成回顾报告（FR-E1.1/E1.2 自动触发）"""
    decision = json.loads(should_reflect())
    if not decision.get("reflect"):
        return json.dumps({"triggered": False, "reason": decision.get("reason", "")}, ensure_ascii=False)
    report = json.loads(run_reflection())
    return json.dumps({"triggered": True, "reason": decision.get("reason"), "report": report}, ensure_ascii=False)


def format_report(report: dict) -> str:
    """人类可读的回顾报告（FR-E1.5）"""
    lines = ["## ETO 集体回顾报告"]
    lines.append(f"总轮数: {report.get('total_rounds', 0)} | 失败: {report.get('failure_count', 0)}"
                 f"（失败率 {report.get('failure_rate', 0) * 100:.0f}%）")
    findings = report.get("findings", [])
    if findings:
        lines.append("发现（失败聚类）:")
        for f in findings:
            pats = ", ".join(f"{p['keyword'][:20]}×{p['count']}" for p in f.get("patterns", []))
            lines.append(f"  - {f['agent']}: 失败 {f['failure_count']} 次 / {f['rounds_seen']} 轮（{pats}）")
    else:
        lines.append("发现: 无失败记录")
    adj = report.get("adjustments", {})
    lines.append(f"调整: {json.dumps(adj, ensure_ascii=False) if adj else '（无）'}")
    lines.append("建议:")
    for r in report.get("recommendations", []):
        lines.append(f"  - {r}")
    return "\n".join(lines)


def _cli_reflect() -> int:
    """`python3 eto/stitches/reflection.py reflect` — 手动触发集体回顾（FR-E1.3）"""
    try:
        report = json.loads(run_reflection())
        print(format_report(report))
        return 0
    except Exception as e:
        print(f"集体回顾失败: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "reflect":
        sys.exit(_cli_reflect())
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
