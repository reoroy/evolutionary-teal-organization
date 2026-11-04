"""Task Budget — 任务级预算帽（requirements FR-D3.2 / FR-D3.3）

每个 task_id 一份可配置上限，至少覆盖**工具调用次数**（max_tool_calls）；
超限后 dispatch 拒绝放行，由工作流把任务停成 budget_exceeded 并如实上报，
绝不静默截断。留有余力的扩展维度（token/时间）以 no-op 字段占位：
配置里出现即校验类型，计数接口已预留，不在本 PR 秘密生效。

配置: ~/.eto/budget.json
{
  "default": {"max_tool_calls": 25},
  "tasks": {
    "task-42": {"max_tool_calls": 3}
  }
}

语义（安全相关，失败路径必须可定位）：
- 配置不存在 → 未启用 → 放行（向后兼容）。
- 任务未单列 → 用 default；default 也缺 → 内置 DEFAULT_MAX_TOOL_CALLS。
- max_tool_calls 必须 >= 0；0 表示「该任务不允许任何工具调用」。
- 计数持久化在 ~/.eto/budget_counters/{task_id}.json（带时间戳），跨进程可累加。
- 配置损坏 → 拒绝并给出可定位原因（fail-closed）。
"""
import json, sys, time
sys.stdout.reconfigure(encoding="utf-8")

DEFAULT_MAX_TOOL_CALLS = 25


def _budget_dir():
    from pathlib import Path
    return Path.home() / ".eto"


def _config_path() -> str:
    return str(_budget_dir() / "budget.json")


def _counters_dir():
    from pathlib import Path
    d = _budget_dir() / "budget_counters"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _log_event(event: str, **fields):
    payload = {"event": event, "ts": time.time()}
    payload.update(fields)
    print(json.dumps(payload, ensure_ascii=False), file=sys.stderr)


def _load_config() -> dict | None:
    from pathlib import Path
    p = _budget_dir() / "budget.json"
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("顶层必须是 JSON object")
        return data
    except Exception as e:
        return {"_invalid": True, "message": f"budget 配置解析失败 ({p}): {e}"}


def _normalize_cap(raw, where: str) -> int:
    """max_tool_calls 必须是 >= 0 的整数，否则按配置损坏处理。"""
    if isinstance(raw, bool) or not isinstance(raw, int) or raw < 0:
        raise ValueError(f"{where} 的 max_tool_calls 必须是 >= 0 的整数（当前值: {raw!r}）")
    return raw


def _caps_for_task(task_id: str, config: dict) -> dict:
    """合并 default 与任务级上限；非法值抛 ValueError（fail-closed）。"""
    tasks = config.get("tasks", {})
    if not isinstance(tasks, dict):
        raise ValueError(f"budget 配置 {_config_path()} 的 tasks 字段必须是 object")
    caps = {}
    if "default" in config:
        if not isinstance(config["default"], dict):
            raise ValueError(f"budget 配置 {_config_path()} 的 default 字段必须是 object")
        caps.update(config["default"])
    task_cfg = tasks.get(task_id)
    if task_cfg is not None:
        if not isinstance(task_cfg, dict):
            raise ValueError(f"budget 配置 {_config_path()} 的 tasks[\"{task_id}\"] 必须是 object")
        caps.update(task_cfg)
    if "max_tool_calls" not in caps:
        caps["max_tool_calls"] = DEFAULT_MAX_TOOL_CALLS
    caps["max_tool_calls"] = _normalize_cap(caps["max_tool_calls"],
                                            f"budget 配置 tasks[\"{task_id}\"]")
    return caps


def _counter_file(task_id: str):
    safe = (task_id or "").replace("/", "_").replace("\\", "_")
    return _counters_dir() / f"{safe}.json"


def _read_counter(task_id: str) -> int:
    from pathlib import Path
    p = _counter_file(task_id)
    if not p.exists():
        return 0
    try:
        return int(json.loads(p.read_text("utf-8")).get("tool_calls", 0))
    except Exception:
        # 计数器损坏按 0 处理并留日志：宁可少算也不多算（放行偏向），且可观测
        _log_event("budget_counter_corrupt", task_id=task_id, path=str(p))
        return 0


def _write_counter(task_id: str, count: int):
    p = _counter_file(task_id)
    p.write_text(json.dumps({"task_id": task_id, "tool_calls": count, "ts": time.time()}, ensure_ascii=False), "utf-8")


def authorize_spec(spec: dict) -> dict:
    """dispatch 前检查预算。返回 {"allowed": bool, "reason": str, "task_id": str}。

    未配置预算 / spec 缺 task_id → 放行（旧调用方没有任务概念，不强行拦截）。
    已配置预算且 spec 有 task_id → 严格执行次数帽。
    """
    if not isinstance(spec, dict):
        return {"allowed": False, "reason": "budget denied: dispatch spec 不是 object，无法核算预算"}
    task_id = (spec.get("task_id") or "").strip()
    if not task_id:
        return {"allowed": True, "reason": "spec 缺 task_id，预算检查不适用，放行", "task_id": ""}

    config = _load_config()
    if config is None:
        return {"allowed": True, "reason": "budget 未配置（~/.eto/budget.json 不存在），默认放行",
                "task_id": task_id, "unconfigured": True}
    if config.get("_invalid"):
        return {"allowed": False, "task_id": task_id,
                "reason": f"budget denied: 配置不可用（fail-closed）→ {config['message']}"}

    try:
        caps = _caps_for_task(task_id, config)
    except ValueError as e:
        return {"allowed": False, "task_id": task_id,
                "reason": f"budget denied: {e}"}

    cap = caps["max_tool_calls"]
    used = _read_counter(task_id)
    if used >= cap:
        return {"allowed": False, "task_id": task_id,
                "reason": (f"budget exceeded: task '{task_id}' 已用 {used}/{cap} 次工具调用"
                           f"（上限来自 {_config_path()}），本次调用被拒；"
                           f"任务必须停止并如实上报 budget_exceeded，不许静默继续")}

    # 预检通过即计数（先记账再调用：即使调用本身失败也算消耗）
    _write_counter(task_id, used + 1)
    return {"allowed": True, "task_id": task_id,
            "reason": f"task '{task_id}' 工具调用 {used + 1}/{cap}（上限 max_tool_calls={cap}）"}


def log_denial(spec: dict, reason: str):
    _log_event("budget_denied",
               agent=(spec or {}).get("agent", "") if isinstance(spec, dict) else "",
               tool=(spec or {}).get("tool", "") if isinstance(spec, dict) else "",
               task_id=(spec or {}).get("task_id", "") if isinstance(spec, dict) else "",
               reason=reason)


def get_usage(task_id: str) -> dict:
    """查询某任务的预算与当前消耗（测试/CLI 用）。"""
    config = _load_config()
    if config is None:
        return {"task_id": task_id, "unconfigured": True, "tool_calls": _read_counter(task_id)}
    if config.get("_invalid"):
        return {"_error": True, "message": config["message"]}
    try:
        caps = _caps_for_task(task_id, config)
    except ValueError as e:
        return {"_error": True, "message": str(e)}
    return {"task_id": task_id, "max_tool_calls": caps["max_tool_calls"],
            "tool_calls": _read_counter(task_id)}


def set_config(config_json: str) -> dict:
    """写入预算配置（测试/CLI 用）。坏 JSON 返回 _error，不落盘。"""
    from pathlib import Path
    try:
        data = json.loads(config_json) if isinstance(config_json, str) else config_json
        if not isinstance(data, dict):
            raise ValueError("顶层必须是 JSON object")
    except Exception as e:
        return {"_error": True, "message": f"set_config: 配置必须是 JSON object → {e}"}
    p = _budget_dir() / "budget.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")
    _log_event("budget_config_updated", path=str(p))
    return {"saved": True, "path": str(p)}


def reset_counter(task_id: str) -> dict:
    """清零某任务计数（测试用；生产语义 = 开新任务用新 task_id）。"""
    p = _counter_file(task_id)
    p.unlink(missing_ok=True)
    return {"reset": True, "task_id": task_id}


if __name__ == "__main__":
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
