"""ETO Mesh CLI — 平台无关的 Agent 注册与状态查看"""
import json, os, platform, shutil, sys
from datetime import datetime, timezone
from pathlib import Path

_USE_EN = not (sys.stdout.encoding and "utf" in sys.stdout.encoding.lower())

from rich.console import Console
from rich.table import Table

REGISTRY_PATH = Path.home() / ".eto" / "registry.json"


def detect_platform() -> str:
    env_checks = [
        ("pi", "PI_PLATFORM"),
        ("reasonix", "REASONIX_VERSION"),
        ("claude", "CLAUDE_CODE"),
    ]
    for plat, env in env_checks:
        if env in os.environ:
            return plat
    # fallback: check running process
    if shutil.which("reasonix"):
        return "reasonix"
    return "unknown"


def load_registry() -> dict:
    if REGISTRY_PATH.exists():
        try:
            return json.loads(REGISTRY_PATH.read_text("utf-8"))
        except json.JSONDecodeError:
            pass
    return {"version": 1, "agents": {}}


def save_registry(reg: dict) -> None:
    REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
    REGISTRY_PATH.write_text(
        json.dumps(reg, indent=2, ensure_ascii=False), "utf-8"
    )


def generate_agent_id() -> str:
    plat = detect_platform()
    host = platform.node().lower().replace(".", "-").replace("_", "-")
    host_clean = "".join(c if c.isalnum() or c == "-" else "-" for c in host)
    return f"{plat}-{host_clean}"


def cmd_join():
    reg = load_registry()
    agent_id = generate_agent_id()
    reg.setdefault("agents", {})[agent_id] = {
        "id": agent_id,
        "platform": detect_platform(),
        "hostname": platform.node(),
        "mcp_endpoint": "python -m eto.mcp_server",
        "capabilities": ["code", "research", "audit"],
        "status": "online",
        "last_seen": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    save_registry(reg)
    print(f"{'OK registered' if _USE_EN else 'OK 已注册'}: {agent_id}")


def cmd_status():
    reg = load_registry()
    agents = reg.get("agents", {})
    console = Console()
    if not agents:
        print("No agents registered" if _USE_EN else "Mesh 中尚无 Agent")
        return
    table = Table(title="Agent Registry")
    table.add_column("ID", style="cyan")
    table.add_column("Platform", style="magenta")
    table.add_column("Status", justify="center")
    table.add_column("Last Seen")
    now = datetime.now(timezone.utc)
    for agent in agents.values():
        last_seen_str = agent.get("last_seen", "")
        try:
            last_seen = datetime.fromisoformat(last_seen_str.replace("Z", "+00:00"))
            diff = (now - last_seen).total_seconds()
            status = "online" if _USE_EN else ("在线" if diff < 120 else "离线")
        except (ValueError, TypeError):
            status = "未知"
        table.add_row(
            agent.get("id", "?"),
            agent.get("platform", "?"),
            status,
            last_seen_str[:19].replace("T", " ") if last_seen_str else "-",
        )
    console.print(table)
    print(f"Total: {len(agents)} agent(s)")


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("--help", "-h"):
        print("用法: eto-mesh <join|status>")
        print("   join    注册本机到 Mesh")
        print("   status  查看 Mesh Agent 列表")
        return
    cmd = sys.argv[1]
    if cmd == "join":
        cmd_join()
    elif cmd == "status":
        cmd_status()
    else:
        print(f"未知命令: {cmd}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
