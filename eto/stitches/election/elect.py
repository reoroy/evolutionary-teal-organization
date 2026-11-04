"""ETO Stitch: Raft 式 Leader 选举（term / quorum / 持久化 / busy_ratio）

design-spec 2.4 / FR-C1.2: 选举公式 match_score × (1 - busy_ratio)。

Raft 语义（对齐 issue #29 的四项要求）:
- term（任期）: 每次选举 term+1，单调递增；term 未过期时现任 leader 直接连任
- quorum（法定人数）: 候选人需获得过半投票（votes > N/2）才当选；
  票数不足（例如全员 busy_ratio>=1 导致无人有效得票）时不产生 leader
- 持久化: 选举状态落盘 ~/.eto/election-state.json，跨进程存活
  （每次 stitch 调用都是新进程，靠文件而不是模块级全局变量续任期）
- busy_ratio: 候选人真实负载（运行中任务/最大并发），由调用方
  （eto.ts，读 ~/.eto/busy.json）传入；缺省 0.0

投票模型: peers 数 = 候选人数 + 1（自投票）。每个 peer 把票投给
"match_score × (1 - busy_ratio)" 最高的候选人（Raft 中是随机超时
先到先得，这里按设计规范用确定性公式）。得票过半者当选。
"""
import json, os, sys, time
sys.stdout.reconfigure(encoding="utf-8")

_ELECTION_TIMEOUT = 10  # 任期时长（秒）；过期后触发重新选举
_STATE_DIR = os.path.join(os.path.expanduser("~"), ".eto")


def _state_path() -> str:
    return os.environ.get("ETO_ELECTION_STATE") or os.path.join(_STATE_DIR, "election-state.json")


def _load_state() -> dict:
    """读取持久化选举状态（term / leader / 当选时间 / 上次投票记录）"""
    try:
        with open(_state_path(), encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict) and isinstance(data.get("term"), int):
            return data
    except (OSError, ValueError):
        pass
    return {"term": 0, "leader": None, "elected_at": 0, "votes": {}}


def _save_state(state: dict) -> None:
    path = _state_path()
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False)
    os.replace(tmp, path)


def _normalize_candidates(candidates) -> list[dict]:
    """接受 [(name, score)] 或 [{name, score, busy_ratio}]，返回统一结构"""
    out = []
    for c in candidates:
        if isinstance(c, (list, tuple)) and len(c) >= 2:
            out.append({"name": str(c[0]), "score": float(c[1]), "busy_ratio": 0.0})
        elif isinstance(c, dict):
            name, score = str(c.get("name", "?")), float(c.get("score", 0.0))
            out.append({"name": name, "score": score,
                        "busy_ratio": max(0.0, min(1.0, float(c.get("busy_ratio", 0.0))))})
    return out


def elect(candidates) -> dict:
    """Raft 式 Leader 选举: term 递增 + 过半投票 + 状态持久化"""
    if not isinstance(candidates, (list, tuple)):
        raise TypeError(f"candidates must be a list, got {type(candidates).__name__}")
    if not candidates:
        return {"leader": "researcher", "all": [], "method": "default", "term": 0}

    state = _load_state()
    now = time.time()
    normalized = _normalize_candidates(candidates)
    names = [c["name"] for c in normalized]

    # 1) 现任 leader 仍在有效任期内、出现在候选集中且未满载 → 连任（term 不变）。
    #    busy_ratio>=1 的现任者视为无法履职，触发重新选举（FR-C1.4）。
    if state.get("leader") in names and now < state.get("elected_at", 0) + _ELECTION_TIMEOUT:
        incumbent = next(c for c in normalized if c["name"] == state["leader"])
        if incumbent["busy_ratio"] < 1.0:
            return {"leader": state["leader"], "all": candidates, "method": "raft-incumbent",
                    "term": state["term"]}

    # 2) 任期过期或无 leader → 发起新一轮选举: term += 1
    term = state["term"] + 1

    # FR-C1.2: 有效得分 = match_score × (1 - busy_ratio)
    for c in normalized:
        c["effective"] = c["score"] * (1.0 - c["busy_ratio"])

    # 全员有效得分 <= 0（全部满载）→ 本轮流选，不产生 leader（quorum 判定的一部分）
    if max((c["effective"] for c in normalized), default=0.0) <= 0.0:
        _save_state({"term": term, "leader": None, "elected_at": 0, "votes": {}})
        return {"leader": None, "all": candidates, "method": "raft-no-quorum",
                "term": term, "votes": {}, "quorum": 0, "reason": "all-busy"}

    # 投票: peers = 候选人数 + 1（含自投票），每票投给有效得分最高者
    peers = len(normalized) + 1
    votes = {name: 0 for name in names}
    for _ in range(peers):
        winner = max(normalized, key=lambda c: (c["effective"], c["name"]))["name"]
        votes[winner] += 1

    # quorum: 得票须过半（严格大于 peers/2）
    quorum = peers // 2
    top = max(votes, key=votes.get)
    if votes[top] <= quorum:
        # 票数未过半 → 本轮流选，不产生 leader
        _save_state({"term": term, "leader": None, "elected_at": 0, "votes": votes})
        return {"leader": None, "all": candidates, "method": "raft-no-quorum",
                "term": term, "votes": votes, "quorum": quorum + 1}

    _save_state({"term": term, "leader": top, "elected_at": now, "votes": votes})
    return {"leader": top, "all": candidates, "method": "raft",
            "term": term, "votes": votes, "quorum": quorum + 1}


if __name__ == "__main__":
    data = json.loads(sys.stdin.read())
    fn = data.get("fn")
    args = data.get("args", [])
    func = globals().get(fn)
    if func:
        try:
            result = func(*args)
            print(json.dumps(result, ensure_ascii=False))
        except Exception as e:
            print(json.dumps({"_error": True, "message": str(e)}))
    else:
        print(json.dumps({"_error": True, "message": f"unknown fn: {fn}"}))
