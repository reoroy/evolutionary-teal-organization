"""Review Gate — 结果审查摘要（纯规则，零 LLM）"""
import json, sys
sys.stdout.reconfigure(encoding="utf-8")

def extract_key_points(text: str, max_points: int = 3) -> list[str]:
    """提取重点摘要：取 bullet / numbered list / 前 200 字"""
    if not text:
        return ["(无输出)"]
    lines = text.split("\n")
    points = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("- ") or stripped.startswith("* "):
            points.append(stripped[2:].strip())
            if len(points) >= max_points:
                break
        elif stripped[0].isdigit() and ". " in stripped[:4]:
            idx = stripped.find(". ")
            if idx != -1:
                points.append(stripped[idx+2:].strip())
                if len(points) >= max_points:
                    break
    if not points:
        points.append(text[:200])
    return points[:max_points]

def summarize_dispatch_result(agent: str, result: dict) -> dict:
    """结构化的审查摘要"""
    raw = json.dumps(result, ensure_ascii=False) if isinstance(result, dict) else str(result)
    return {"agent": agent, "summary": extract_key_points(raw), "raw_length": len(raw)}

if __name__ == "__main__":
    data = json.loads(sys.stdin.read())
    fn = data.get("fn")
    args = data.get("args", [])
    func = globals().get(fn)
    if func:
        result = func(*args)
        print(json.dumps(result, ensure_ascii=False))
    else:
        print(json.dumps({"_error": True, "message": f"unknown fn: {fn}"}))
