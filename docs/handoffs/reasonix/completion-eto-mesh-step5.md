# Completion: ETO Mesh Step 5 — 跨平台安装脚本与文档

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE
> 日期: 2026-07-04

## 新增

| 文件 | 内容 |
|:-----|:------|
| `scripts/install-eto-claude.sh` | 写 `.mcp.json` + `eto-mesh join` |
| `scripts/install-eto-reasonix.sh` | 写 `~/.reasonix/mcp/eto.json` + join |
| `scripts/install-eto-hermes.sh` | 写 `~/.hermes/mcp/eto.json` + join + 心跳 |

## 修改

| 文件 | 改动 |
|:-----|:------|
| `README.md` | 新增跨平台安装章节（Claude Code / Reasonix / Hermes） |

## 验证

```
Stitcher test: 17/17 PASS ✅
```
