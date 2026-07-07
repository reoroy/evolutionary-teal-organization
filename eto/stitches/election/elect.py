"""ETO Stitch: Raft 式 Leader 选举（自实现，无外部依赖）"""
import json, os, random, sys, time
sys.stdout.reconfigure(encoding="utf-8")

_leader = None
_leader_expiry = 0
_ELECTION_TIMEOUT = 10  # seconds

def elect(candidates: list[tuple[str, float]]) -> dict:
    """Raft 式 Leader 选举：随机超时 + 任期投票"""
    global _leader, _leader_expiry

    if not candidates:
        return {"leader": "researcher", "all": [], "method": "default"}

    now = time.time()

    # Leader 仍在任期 → 复用
    if _leader and now < _leader_expiry:
        names = [c[0] for c in candidates]
        if _leader in names:
            return {"leader": _leader, "all": candidates, "method": "raft-incumbent"}

    # 任期已过 → 重新选举
    names = [c[0] for c in candidates]
    scores = {name: score for name, score in candidates}

    # Raft 式：随机超时 + 得分加权
    timeout = random.uniform(0.5, 1.5)
    time.sleep(timeout * 0.01)  # 极小等待模拟

    # 得票 = 得分 × 随机因子（模拟竞选中的随机性）
    votes = {name: scores[name] * random.uniform(0.85, 1.15) for name in names}
    winner = max(votes, key=votes.get)

    _leader = winner
    _leader_expiry = now + _ELECTION_TIMEOUT

    return {"leader": winner, "all": candidates, "method": "raft", "votes": votes}

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
