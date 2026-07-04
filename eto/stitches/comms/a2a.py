"""ETO Stitch: 多步任务执行层（Step 3 - 真实 LLM 执行 + 上下文传递）"""
import io, json, sys, urllib.request, urllib.error, time
sys.stdout.reconfigure(encoding="utf-8")

OLLAMA_URL = "http://localhost:11434"
MODEL = "qwen2.5-coder:7b"

AGENT_PROMPT = (
    "## Communication\n"
    "- Don't create planning or analysis documents unless asked — work from conversation context.\n"
    "- Lead with the verdict, then the evidence.\n"
    "- No emojis, no celebration, no apologies, no filler.\n\n"
    "## Action Safety\n"
    "- Before reporting progress, audit each claim against actual output. Only report work you can point to evidence for.\n"
    "- Call a flaw a mistake and fix it — don't relabel a bug as a design decision.\n"
    "- If context you need is missing, ask for it — don't invent it.\n\n"
    "## Executing\n"
    "- Local, reversible actions (edit, run, read, build) take freely.\n"
    "- Confirm for destructive or shared-system actions.\n"
    "- Match scope to what was asked — don't expand blast radius.\n"
    "- A failing gate is a stop signal, not an obstacle to route around.\n\n"
    "## Doing Tasks\n"
    "- Take ambitious tasks at face value. Defer to the user on whether a task is too large.\n"
    "- Don't add features or abstractions beyond what the task requires.\n"
    "- Prefer editing existing files to creating new ones.\n\n"
    "## Tone\n"
    "- No emojis unless requested.\n"
    "- 'Done' is a hypothesis until verified. Run what you build."
)

def _call_llm(prompt: str, timeout: int = 60) -> str:
    """调 Ollama 生成回复"""
    full = f"{FABLE_STYLE}\n\n{prompt}"
    data = json.dumps({
        "model": MODEL, "prompt": full, "stream": False,
        "options": {"temperature": 0.3, "num_predict": 1024},
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_URL}/api/generate", data=data,
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8")).get("response", "").strip()

def execute_plan(task: str, steps: list[str]) -> dict:
    """执行多步计划，每步注入上一步输出作为上下文"""
    outputs = []
    context = ""
    total = len(steps)

    for i, step in enumerate(steps, 1):
        prompt = f"当前时间: {time.strftime('%Y-%m-%d %H:%M:%S')}\n总体任务: {task}\n"
        if context:
            prompt += f"\n上一步结果:\n{context}\n\n"
        prompt += f"当前步骤({i}/{total}): {step}\n请执行并输出结果。"
        try:
            result = _call_llm(prompt)
        except Exception as e:
            result = f"<步骤执行失败: {e}>"
        outputs.append(result)
        context = result[:500]  # 向下文传递上一步摘要

    return {"outputs": outputs, "total": total}

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
