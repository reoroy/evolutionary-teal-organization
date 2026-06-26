"""ETO Stitch: 协调员选举（按分数排序选最高分）"""
import json, sys


def elect(candidates: list) -> dict:
    """按分数降序选举协调员。candidates: [(name, score), ...]"""
    if not candidates:
        return {"leader": "researcher"}
    candidates.sort(key=lambda x: x[1], reverse=True)
    return {"leader": candidates[0][0], "all": candidates}


if __name__ == "__main__":
    try:
        data = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        print(json.dumps({"_error": True, "message": f"JSON 解析失败: {e}"}))
        sys.exit(0)

    fn = data.get("fn")
    args = data.get("args", [])

    func = globals().get(fn)
    if func is None:
        print(json.dumps({"_error": True, "message": f"未知函数: {fn}"}))
        sys.exit(0)

    try:
        result = func(*args)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"_error": True, "message": str(e)}))
        sys.exit(0)
