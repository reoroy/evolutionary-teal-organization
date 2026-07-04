# Plan: ETO Mesh Step 3 — eto-mesh CLI (join/status)

> 创建日期: 2026-07-04 | 发送者: Claude Code
> 接收者: Reasonix Code
> 基线: v0.5.0 (Step 2 完成后)
> 父 Plan: `plan-eto-mesh.md` (Phase 2d)

---

## 现状

Step 2 已在 `eto/extensions/eto.ts` 中实现了 Agent Registry (`~/.eto/registry.json`)：

```json
{
  "version": 1,
  "agents": {
    "pi-ws-5090": {
      "id": "pi-ws-5090",
      "platform": "pi",
      "hostname": "ws-5090",
      "mcp_endpoint": "python -m eto.mcp_server",
      "capabilities": ["code", "research", "audit"],
      "status": "online",
      "last_seen": "2026-07-04T12:00:00Z"
    }
  }
}
```

但注册表目前只有 Pi 扩展在维护。缺一个**平台无关的 CLI**，让任何环境（Claude Code / Reasonix / Hermes / CI）都能注册和查看。

**约束：**
- 已有 `~/.pi/etoprofiles/profiles.json` — 3 个 Agent Profile 配置
- 已有 `rich` 依赖在 pyproject.toml
- 不要新建 `__main__.py`（Python 包入口），改加独立 CLI 模块

---

## 方案

新增 `eto/cli.py`，提供两个子命令：

```
eto-mesh join          # 注册本机到 Mesh
eto-mesh status        # 查看 Mesh Agent 列表
```

### 1. eto-mesh join

**行为：**
1. 读取 `~/.eto/registry.json`（不存在则创建空结构）
2. 生成 Agent ID：`platform-hostname`（platform 自动检测）
3. 写入 entry（与 eto.ts 兼容的 schema）
4. 输出已注册确认

**platform 自动检测逻辑（优先级）：**
```python
def detect_platform():
    if "PI_PLATFORM" in os.environ:
        return "pi"
    if "REASONIX_VERSION" in os.environ or shutil.which("reasonix"):
        return "reasonix"
    if "CLAUDE_CODE" in os.environ or "ANTHROPIC_API_KEY" in os.environ:
        return "claude"
    return "unknown"
```

### 2. eto-mesh status

**行为：**
1. 读取 `~/.eto/registry.json`
2. 用 `rich.table` 输出表格：

```
 Agent Registry
┌──────────────────────┬──────────┬────────┬──────────────────────┐
│ ID                   │ Platform │ Status │ Last Seen            │
├──────────────────────┼──────────┼────────┼──────────────────────┤
│ pi-ws-5090           │ pi       │ 在线   │ 2026-07-04 12:00:00  │
└──────────────────────┴──────────┴────────┴──────────────────────┘
Total: 1 agent(s)
```

3. 状态判定：`last_seen` < 120 秒 → 在线，否则离线（与 eto.ts 一致）

### 3. 架构图

```
eto-mesh join ──→ cli.py ──→ write ~/.eto/registry.json
eto-mesh status ──→ cli.py ──→ read + rich.table
                          ↑
           同一文件格式，与 eto.ts 兼容
```

---

## 改动文件

| 文件 | 改动 | 类型 |
|:-----|:------|:------|
| `eto/cli.py` | 新增：join / status 命令 | 新建 |
| `pyproject.toml` | 新增 `eto-mesh` 入口点 | 修改 |

### 具体实现

#### A. `eto/cli.py`（新建，~70 行）

```python
"""ETO Mesh CLI — 平台无关的 Agent 注册与状态查看"""
import json, os, platform, shutil, sys
from datetime import datetime, timezone
from pathlib import Path

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
    REGISTRY_PATH.write_text(json.dumps(reg, indent=2, ensure_ascii=False), "utf-8")

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
    console = Console()
    console.print(f"[green]✓[/green] 已注册: {agent_id}")

def cmd_status():
    reg = load_registry()
    agents = reg.get("agents", {})
    console = Console()
    if not agents:
        console.print("[yellow]Mesh 中尚无 Agent[/yellow]")
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
            status = "在线" if diff < 120 else "离线"
        except (ValueError, TypeError):
            status = "未知"
        table.add_row(
            agent.get("id", "?"),
            agent.get("platform", "?"),
            status,
            last_seen_str[:19].replace("T", " ") if last_seen_str else "-",
        )
    console.print(table)
    console.print(f"Total: {len(agents)} agent(s)")

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
```

#### B. `pyproject.toml` 修改

在 `[project.scripts]` 段新增：

```toml
eto-mesh = "eto.cli:main"
```

**不删现有** `eto = "src.tui:main"` 行，只追加。

#### C. 不做

- ❌ 不要改 `eto.ts` — Step 2 已完成
- ❌ 不要改 `mcp_server.py` — 不需要增加 MCP tool
- ❌ 不要改 `registry.py` — HTTP 版暂不集成
- ❌ 不要改测试 — Step 3 不涉及 stitch 改动

---

## 验证

```bash
# 1. join 注册
eto-mesh join
# → ✓ 已注册: pi-ws-5090

# 2. status 查看
eto-mesh status
# → 表格: ID / Platform / Status / Last Seen

# 3. 与 Pi 扩展共用 registry
cat ~/.eto/registry.json
# → 内容与 eto.ts 写入的格式一致

# 4. 测试不破坏
python eto/stitches/test.py
# → 17/17 PASS
```

---

## 验收标准

| # | 检查项 | 方法 |
|---|--------|------|
| S-1 | `eto-mesh join` 写入 `~/.eto/registry.json` | 运行后 cat 检查 |
| S-2 | Agent ID 格式为 `pi-<hostname>` (Pi 环境) | join 后检查 id 字段 |
| S-3 | `eto-mesh status` 输出 rich 表格 | 运行查看 |
| S-4 | 与 eto.ts 写入的 registry 格式兼容 | eto.ts 写入后 eto-mesh status 能读 |
| S-5 | `eto-mesh --help` 显示用法信息 | 运行看输出 |
| S-6 | 现有 stitch 测试不破坏 | `python eto/stitches/test.py` → PASS |
