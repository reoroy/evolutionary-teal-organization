#!/usr/bin/env python3
"""dsh-eto runner: the one process a DSH tool call spawns, one call per process.

Protocol
--------
  argv[1]  tool name (see TOOLS below)
  stdin    the tool's arguments as one JSON object (empty stdin means {})
  stdout   arbitrary noise is tolerated; the result is the last line beginning
           with ``__ETO_RESULT__`` followed by one JSON object:
             {"ok": true,  "result": <json>}
             {"ok": false, "error": {"type": ..., "message": ...}}
  stderr   tracebacks and ETO's own warnings; the host quotes it on failure

Why a sentinel line instead of "stdout is the JSON": ETO stitches print to
stdout on import and during work (several call ``sys.stdout.reconfigure``), so a
bare ``json.loads(stdout)`` would break the first time a stitch logs. The
sentinel keeps one stable contract regardless of what the library prints.

Error types are stable so the host can say *which* step failed:
  usage        malformed request or missing/typed-wrong argument
  unknown_tool the host asked for a tool this runner does not implement
  import       a dependency of the tool is missing (ETO checkout/venv problem)
  tool         ETO itself raised
"""

import json
import os
import subprocess
import sys
import traceback
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

SENTINEL = "__ETO_RESULT__"


def eto_root() -> Path | None:
    """The ETO checkout this process should import from.

    The runner ships inside the *plugin*, not inside ETO, so the checkout cannot
    be derived from this file. The host exports `ETO_REPO`; without it, fall back
    to wherever the already-installed `eto` package lives (an editable install
    points back at its checkout). Both are resolved lazily so a missing checkout
    produces the import error message rather than a crash at start-up.
    """
    configured = os.environ.get("ETO_REPO", "").strip()
    if configured:
        return Path(configured)
    try:
        import eto  # noqa: PLC0415 - optional: only used to locate the checkout

        return Path(eto.__file__).resolve().parent.parent
    except Exception:  # noqa: BLE001 - absence is reported by the failing import
        return None


ROOT = eto_root()
if ROOT is not None and str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

#: Model-facing tools. The JS half declares their schemas; `test/catalog` keeps
#: the two lists in sync, so adding a tool here without its schema fails a test.
TOOLS = (
    "eto_consensus",
    "eto_route",
    "eto_peer_config",
    "eto_memory_write",
    "eto_memory_read",
    "eto_memory_list",
    "eto_clarify",
    "eto_review",
    "eto_feedback",
    "eto_file_status",
    "eto_file_update",
    "eto_file_release",
    "agent_execute",
)

#: Host-only tools: never registered with the model, used by the plugin's
#: status/config endpoints.
INTERNAL_TOOLS = ("eto_status",)

#: name -> (module, attribute) used by `eto_status` to report availability
#: without running anything. One entry per tool so the probe cannot drift from
#: the dispatch code below.
PROBES = {
    "eto_consensus": ("eto.stitches.consensus.vote", "peer_review"),
    "eto_route": ("eto.mcp_server", "eto_route"),
    "eto_peer_config": ("eto.mcp_server", "eto_peer_config"),
    "eto_memory_write": ("eto.stitches.memory.shared_memory", "write"),
    "eto_memory_read": ("eto.stitches.memory.shared_memory", "read"),
    "eto_memory_list": ("eto.stitches.memory.shared_memory", "list_keys"),
    "eto_clarify": ("eto.stitches.quality.clarify", "detect_vague"),
    "eto_review": ("eto.stitches.quality.review", "summarize_dispatch_result"),
    "eto_feedback": ("eto.stitches.quality.feedback", "save_constraint"),
    "eto_file_status": ("eto.stitches.memory.shared_memory", "file_status"),
    "eto_file_update": ("eto.stitches.memory.shared_memory", "file_update"),
    "eto_file_release": ("eto.stitches.memory.shared_memory", "file_release"),
    "agent_execute": ("eto.stitches.consensus.vote", "_call_provider"),
}


class RunnerError(Exception):
    """Failure with a stable type, reported as the JSON error payload."""

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message


def emit(payload: dict) -> None:
    print(SENTINEL + json.dumps(payload, ensure_ascii=False))


def fail(kind: str, message: str) -> "None":
    emit({"ok": False, "error": {"type": kind, "message": message}})
    sys.exit(0)


def need(args: dict, key: str, kind: type = str):
    """Required argument with a type check, so a bad call names the field."""
    if key not in args:
        raise RunnerError("usage", f"缺少必填参数 {key}")
    value = args[key]
    if kind is str and not isinstance(value, str):
        raise RunnerError("usage", f"参数 {key} 必须是字符串，收到 {type(value).__name__}")
    return value


# ── tools ────────────────────────────────────────────────────────────────────


def eto_consensus(args: dict) -> dict:
    from eto.stitches.consensus.vote import peer_review

    peers = args.get("peers")
    if peers is not None and (
        not isinstance(peers, list) or not all(isinstance(p, str) and p for p in peers)
    ):
        raise RunnerError("usage", "参数 peers 必须是字符串数组")
    return peer_review(
        need(args, "plan"), peers or ["researcher", "coder", "auditor"]
    )


def eto_route(args: dict) -> dict:
    from eto.mcp_server import eto_route as route

    return json.loads(route(need(args, "task")))


def eto_peer_config(_args: dict) -> dict:
    from eto.mcp_server import eto_peer_config as peer_config

    return json.loads(peer_config())


def eto_memory_write(args: dict) -> dict:
    from eto.stitches.memory.shared_memory import write

    key = need(args, "key")
    raw = need(args, "value_json")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        value = {"text": raw}
    write(key, value)
    return {"written": key}


def eto_memory_read(args: dict) -> dict:
    from eto.stitches.memory.shared_memory import read

    key = need(args, "key")
    value = read(key)
    return value if value is not None else {"missing": key}


def eto_memory_list(args: dict) -> list:
    from eto.stitches.memory.shared_memory import list_keys

    pattern = args.get("pattern") or ""
    if not isinstance(pattern, str):
        raise RunnerError("usage", "参数 pattern 必须是字符串")
    return list_keys(pattern)


def eto_clarify(args: dict) -> dict:
    from eto.stitches.quality.clarify import detect_vague

    task = need(args, "task")
    return detect_vague(task) or {"vague": False, "task": task}


def eto_review(args: dict) -> dict:
    from eto.stitches.quality.review import summarize_dispatch_result

    agent = need(args, "agent")
    raw = need(args, "result_json")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RunnerError("usage", f"参数 result_json 不是合法 JSON: {exc}") from exc
    return summarize_dispatch_result(agent, payload)


def eto_feedback(args: dict) -> dict:
    from eto.stitches.quality.feedback import save_constraint

    return save_constraint(need(args, "agent"), need(args, "constraint"))


def eto_file_status(args: dict) -> dict | None:
    from eto.stitches.memory.shared_memory import file_status

    return file_status(need(args, "file"))


def eto_file_update(args: dict) -> dict:
    from eto.stitches.memory.shared_memory import file_update

    editor = args.get("editor") or "default"
    file_hash = args.get("file_hash") or ""
    if not isinstance(editor, str) or not isinstance(file_hash, str):
        raise RunnerError("usage", "参数 editor / file_hash 必须是字符串")
    return file_update(need(args, "file"), editor, file_hash)


def eto_file_release(args: dict) -> dict:
    from eto.stitches.memory.shared_memory import file_release

    return {"released": file_release(need(args, "file"))}


def agent_execute(args: dict) -> dict:
    """Route one step to ETO's configured peer provider (ollama/deepseek/claude/mcp)."""
    from eto.stitches.consensus.vote import _call_provider, _load_peer_config

    task = need(args, "task")
    cfg = _load_peer_config().get("coder", {})
    provider = cfg.get("provider", "ollama")
    # mcp provider carries its whole peer config JSON in `model` (vote._call_provider).
    model = json.dumps(cfg, ensure_ascii=False) if provider == "mcp" else cfg.get("model", "")
    system = args.get("system") or f"执行以下任务:\n{task}"
    skills = args.get("skills")
    if isinstance(skills, list) and skills:
        system += "\n\n可用 skills: " + ", ".join(str(s) for s in skills)
    mcp_tools = args.get("mcp_tools")
    if isinstance(mcp_tools, list) and mcp_tools:
        system += "\n\n可用 MCP 工具: " + ", ".join(str(t) for t in mcp_tools)
    try:
        output = _call_provider(provider, model, system, task)
    except Exception as exc:  # noqa: BLE001 - provider boundary, reported with its type
        raise RunnerError("tool", f"provider {provider} 抛出异常 ({type(exc).__name__}): {exc}") from exc
    if not output:
        raise RunnerError(
            "tool",
            f"provider {provider} 返回空输出（服务未启动、凭据缺失或模型不可用）",
        )
    return {"status": "ok", "agent": "coder", "output": output}


def eto_status(_args: dict) -> dict:
    """Host-only: version, commit, per-tool availability, recent results, routing stats."""
    import importlib

    tools: dict = {}
    for name, (module_name, attr) in PROBES.items():
        try:
            module = importlib.import_module(module_name)
            getattr(module, attr)
            tools[name] = {"available": True}
        except Exception as exc:  # noqa: BLE001 - reported per tool, never fatal
            tools[name] = {
                "available": False,
                "reason": f"{type(exc).__name__}: {exc}",
            }

    def safe(fn):
        try:
            return fn()
        except Exception:  # noqa: BLE001 - status must never fail as a whole
            return None

    consensus = safe(lambda: __import__(
        "eto.stitches.memory.shared_memory", fromlist=["read"]
    ).read("consensus:last"))
    routing = safe(lambda: __import__(
        "eto.stitches.metrics", fromlist=["summary"]
    ).summary())
    return {
        "version": _pyproject_version(),
        "commit": _git_commit(),
        "python": "%d.%d.%d" % sys.version_info[:3],
        "tools": tools,
        "consensus": consensus,
        "routing": routing,
    }


def _pyproject_version() -> str | None:
    if ROOT is None:
        return None
    try:
        text = (ROOT / "pyproject.toml").read_text("utf-8")
    except OSError:
        return None
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("version") and "=" in stripped:
            return stripped.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def _git_commit() -> str | None:
    if ROOT is None:
        return None
    try:
        out = subprocess.run(
            ["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return out.stdout.strip() or None if out.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


HANDLERS = {
    "eto_consensus": eto_consensus,
    "eto_route": eto_route,
    "eto_peer_config": eto_peer_config,
    "eto_memory_write": eto_memory_write,
    "eto_memory_read": eto_memory_read,
    "eto_memory_list": eto_memory_list,
    "eto_clarify": eto_clarify,
    "eto_review": eto_review,
    "eto_feedback": eto_feedback,
    "eto_file_status": eto_file_status,
    "eto_file_update": eto_file_update,
    "eto_file_release": eto_file_release,
    "agent_execute": agent_execute,
    "eto_status": eto_status,
}


def read_args() -> dict:
    try:
        raw = sys.stdin.read()
    except Exception as exc:  # noqa: BLE001 - stdin failure is a usage problem
        raise RunnerError("usage", f"无法读取 stdin: {exc}") from exc
    if not raw.strip():
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RunnerError("usage", f"stdin 不是合法 JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise RunnerError("usage", "参数必须是 JSON 对象")
    return value


def main(argv: list[str]) -> None:
    if len(argv) != 2:
        fail("usage", "用法: eto_runner.py <tool>  （参数从 stdin 读 JSON 对象）")
    tool = argv[1]
    handler = HANDLERS.get(tool)
    if handler is None:
        fail("unknown_tool", f"dsh-eto: 未知工具 {tool}（可用: {', '.join(sorted(HANDLERS))}）")
    try:
        args = read_args()
    except RunnerError as exc:
        fail(exc.kind, f"dsh-eto: {exc.message}")
    try:
        result = handler(args)
    except RunnerError as exc:
        fail(exc.kind, f"dsh-eto {tool}: {exc.message}")
    except ImportError as exc:
        fail(
            "import",
            f"dsh-eto {tool}: 依赖缺失 ({exc})——检查 ETO checkout 与 virtualenv 是否装好"
            "（cd <repo> && python3 -m venv .venv && .venv/bin/pip install -e eto/）",
        )
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 - tool boundary: report, never crash silently
        traceback.print_exc()
        fail("tool", f"dsh-eto {tool} 执行失败 ({type(exc).__name__}): {exc}")
    emit({"ok": True, "result": result})


if __name__ == "__main__":
    main(sys.argv)
