# Plan: ETO Mesh Step 5 — 跨平台安装脚本与文档

> 创建日期: 2026-07-04 | 发送者: Claude Code
> 接收者: Reasonix Code
> 基线: v0.5.0 (Step 1-4 完成后，`eto-mesh` CLI 已可用)
> 父 Plan: `plan-eto-mesh.md` (Phase 2a-2c)

---

## 现状

Mesh 基础设施已就绪：
- `~/.eto/registry.json` — 统一注册表（受 eto.ts / eto-mesh CLI 维护）
- `eto-mesh join` / `eto-mesh status` — 平台无关的 CLI
- `dispatch_with_spec()` — 可配置调度
- MCP Server `python -m eto.mcp_server` — 始终可用

缺的是：**其他平台上怎么装？** 目前 `eto-mesh` 只能从项目目录跑，Claude Code / Reasonix / Hermes 各自需要不同的接入方式。

---

## 方案

写三个安装脚本（bash），各自完成：
1. MCP 通道配置（各平台格式不同）
2. `eto-mesh join` 注册到 registry
3. 写入上下文（profile 或 CLAUDE.md）

### 1. Claude Code 安装脚本

`scripts/install-eto-claude.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

# 安装 ETO Mesh 到 Claude Code
# 1. 确定 ETO 项目路径（自动检测或参数传入）
ETO_DIR="${1:-$PWD}"
MCP_JSON="$HOME/.claude/.mcp.json"

# 2. 写入/更新 .mcp.json
mkdir -p "$(dirname "$MCP_JSON")"
if [ -f "$MCP_JSON" ]; then
    # 追加 eto-mesh server（若不存在）
    python3 -c "
import json
p = '$MCP_JSON'
c = json.load(open(p))
c.setdefault('mcpServers', {})['eto-mesh'] = {
    'command': 'python',
    'args': ['-m', 'eto.mcp_server'],
    'cwd': '$ETO_DIR'
}
json.dump(c, open(p, 'w'), indent=2)
print('✓ .mcp.json 已更新')
"
else
    cat > "$MCP_JSON" <<- JSON
{
  "mcpServers": {
    "eto-mesh": {
      "command": "python",
      "args": ["-m", "eto.mcp_server"],
      "cwd": "$ETO_DIR"
    }
  }
}
JSON
    echo "✓ .mcp.json 已创建"
fi

# 3. 注册到 Mesh
python3 -m eto.cli join
echo "✓ 已注册到 Mesh"
```

### 2. Reasonix 安装脚本

`scripts/install-eto-reasonix.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

# 安装 ETO Mesh 到 Reasonix
ETO_DIR="${1:-$PWD}"

# Reasonix 用 MCP stdio 直连
REASONIX_MCP_DIR="$HOME/.reasonix/mcp"
mkdir -p "$REASONIX_MCP_DIR"

cat > "$REASONIX_MCP_DIR/eto.json" <<- JSON
{
  "name": "eto",
  "command": "python",
  "args": ["-m", "eto.mcp_server"],
  "cwd": "$ETO_DIR",
  "tools": ["eto_consensus", "eto_route", "eto_memory_read", "eto_memory_write"]
}
JSON
echo "✓ Reasonix MCP 配置已写入"

# 注册到 Mesh
python3 -m eto.cli join
echo "✓ 已注册到 Mesh"
```

### 3. Hermes 安装脚本

`scripts/install-eto-hermes.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

# 安装 ETO Mesh 到 Hermes（Linux 192.168.3.54）
ETO_DIR="${1:-$PWD}"

# Hermes 通过 MCP stdio 连接
HERMES_MCP_DIR="$HOME/.hermes/mcp"
mkdir -p "$HERMES_MCP_DIR"

cat > "$HERMES_MCP_DIR/eto.json" <<- JSON
{
  "name": "eto",
  "command": "python",
  "args": ["-m", "eto.mcp_server"],
  "cwd": "$ETO_DIR",
  "heartbeat_interval": 60
}
JSON
echo "✓ Hermes MCP 配置已写入"

# 注册到 Mesh（通过 SSH 转发到 Windows 端的 registry）
python3 -m eto.cli join
echo "✓ 已注册到 Mesh"
```

### 4. 更新 README

在 README.md 的安装段追加：

```markdown
## 跨平台安装

### 前置条件
```bash
pip install -e .          # 安装 eto-mesh CLI
eto-mesh join             # 注册本机
eto-mesh status           # 确认在线
```

### Claude Code
```bash
bash scripts/install-eto-claude.sh
# → 重启 Claude Code 后 MCP tools 自动可用
```

### Reasonix
```bash
bash scripts/install-eto-reasonix.sh
# → Reasonix 可直接调 eto_consensus / eto_route 等工具
```

### Hermes
```bash
bash scripts/install-eto-hermes.sh
# → 定时心跳到 registry，其他 Agent 可见
```

### 验证
```bash
eto-mesh status
# → 应列出所有已注册 Agent
```
```

---

## 改动文件

| 文件 | 改动 | 类型 |
|:-----|:------|:------|
| `scripts/install-eto-claude.sh` | Claude Code 安装脚本 | 新建 |
| `scripts/install-eto-reasonix.sh` | Reasonix 安装脚本 | 新建 |
| `scripts/install-eto-hermes.sh` | Hermes 安装脚本 | 新建 |
| `README.md` | 安装段追加跨平台安装文档 | 修改 |

### 不做

- ❌ 不改 `eto.ts` / `cli.py` / `mcp_dispatch.py` — Step 1-4 已完成
- ❌ 不改 `pyproject.toml` — 入口已在 Step 3 配置
- ❌ 不改测试

---

## 验收

| # | 检查项 | 方法 |
|---|--------|------|
| I-1 | `scripts/install-eto-claude.sh` 生成有效 `.mcp.json` | 运行后检查文件 |
| I-2 | `scripts/install-eto-reasonix.sh` 生成 reasonix MCP 配置 | 运行后检查文件 |
| I-3 | 安装后 `eto-mesh status` 显示本机 | 运行查看 |
| I-4 | README 中有跨平台安装章节 | 读文件 |
| I-5 | 17/17 stitch 测试不破坏 | `python eto/stitches/test.py` |
