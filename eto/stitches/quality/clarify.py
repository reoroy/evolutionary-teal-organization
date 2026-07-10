"""Clarify Gate — 检测模糊指令，返回结构化澄清选项（纯规则，零 LLM）"""
import json, sys
sys.stdout.reconfigure(encoding="utf-8")

_VAGUE_WORDS = ["分析", "优化", "研究", "看看", "搞一下", "弄一下",
                "fix", "improve", "optimize", "look into", "check"]

_SUGGESTIONS = {
    "分析": ["分析市场/行业", "分析代码质量", "分析数据/报表"],
    "优化": ["优化性能", "优化代码结构", "优化部署流程"],
    "研究": ["研究技术方案", "研究竞品", "研究可行性"],
    "看看": ["看看当前状态", "看看报告", "看看代码"],
    "fix": ["fix bug", "fix security issue", "fix performance"],
    "improve": ["improve performance", "improve code quality", "improve UX"],
    "optimize": ["optimize for speed", "optimize for memory", "optimize for cost"],
    "look into": ["look into error rates", "look into architecture", "look into alternatives"],
    "check": ["check status", "check logs", "check config"],
}

def detect_vague(task: str) -> dict | None:
    """检测模糊指令，返回澄清选项"""
    if not task:
        return None
    t = task.lower()
    # 先匹配完整短语
    for phrase in ["搞一下", "弄一下", "look into"]:
        if phrase in t:
            return {"vague": True, "matched": [phrase], "task": task, "suggestions": _SUGGESTIONS.get(phrase, [f"明确{phrase}的具体范围"])}
    # 再匹配单个词
    hits = [w for w in _VAGUE_WORDS if w in t]
    if not hits:
        return None
    return {"vague": True, "matched": hits, "task": task, "suggestions": _SUGGESTIONS.get(hits[0], [f"明确{hits[0]}的具体范围"])}

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
