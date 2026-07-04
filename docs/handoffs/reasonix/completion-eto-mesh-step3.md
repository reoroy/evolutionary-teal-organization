# Completion: ETO Mesh Step 3 — eto-mesh CLI (join/status)

> 实现日期: 2026-07-04 | 实现者: Reasonix Code
> 源 Plan: `docs/handoffs/reasonix/plan-eto-mesh-step3.md`

---

## 改动清单

### 1. 新建 `eto/cli.py` (~80 行)

平台无关的 Mesh CLI，提供两个子命令：

| 命令 | 功能 |
|:-----|:------|
| `eto-mesh join` | 自动检测平台，生成 Agent ID，写入 `~/.eto/registry.json` |
| `eto-mesh status` | 读取 registry，用 `rich.table` 输出表格格式 |

**platform 检测逻辑：** `PI_PLATFORM` env → `reasonix` (env/which) → `CLAUDE_CODE` env → `unknown`

**Agent ID 格式：** `{platform}-{hostname}`（hostname 清理非字母数字字符）

### 2. 修改 `pyproject.toml`

在 `[project.scripts]` 追加 `eto-mesh` 入口点：

```toml
eto-mesh = "eto.cli:main"
```

---

## 验证结果

| # | 检查项 | 结果 |
|---|--------|------|
| ✅ | `eto-mesh --help` 显示用法 | 输出 `join` / `status` 用法信息 |
| ✅ | `eto-mesh join` 写入 registry | 生成 `{platform}-{hostname}` entry |
| ✅ | Agent ID 格式 `platform-hostname` | 遵循格式 |
| ✅ | `eto-mesh status` 输出 rich 表格 | 表格含 ID/Platform/Status/Last Seen 列 |
| ✅ | 状态判定 < 120s → 在线 | 状态列显示「在线」 |
| ✅ | registry 格式与 eto.ts 兼容 | 相同 schema (version/agents/id/last_seen 等字段) |

---

## 未改动

- ❌ `eto/extensions/eto.ts` — Step 2 已完成
- ❌ `eto/stitches/` — 不受影响
- ❌ 测试文件 — Step 3 无 stitch 改动
