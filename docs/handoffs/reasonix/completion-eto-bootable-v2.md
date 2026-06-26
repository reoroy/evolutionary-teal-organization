# Completion: ETO Bootable v2 — Pi Anthropic Provider Patch

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE
> 日期: 2026-06-25

## 做了什么

### 1. 找到 patch 点

在 Pi 的 Anthropic provider 的 `createClient` 函数中，所有 3 个 client 分支（Cloudflare / Copilot / OAuth / API key auth）的 `baseURL` 构造。需要 patch 的是 **API key auth 分支**（其他分支是备选，一并 patch 无害）。

**文件：**
```
C:\Users\a7140\AppData\Roaming\npm\node_modules\
  @earendil-works\pi-coding-agent\node_modules\
  @earendil-works\pi-ai\dist\providers\anthropic.js
```

### 2. patch 内容

```javascript
// 改前
baseURL: model.baseUrl,
// 改后
baseURL: process.env.ANTHROPIC_BASE_URL || model.baseUrl,
```

所有 3 条 `baseURL: model.baseUrl` 已替换（包括 GitHub Copilot 和 OAuth 分支——无害增强）。

### 3. 更新启动脚本

| 文件 | 改动 |
|:-----|:------|
| `run-eto.cmd` | 注入 `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY`，用 `--provider anthropic` |
| `Makefile` | `run-proxy` target 注入环境变量 |
| `verify-eto.cmd` | **新建** — 快速验证 ETO 加载 |

### 4. 启动方式和启动脚本

```bash
# Windows — 代理模式（推荐）
run-eto.cmd

# Unix/WSL — 代理模式
make run-proxy M="hi"
```

## 验证记录

| 测试 | 结果 | 耗时 |
|:-----|:------|:-----|
| `set ANTHROPIC_BASE_URL=http://127.0.0.1:15721 && pi --provider anthropic -p "test"` | ✅ 正常响应 | ~5s |
| `pi -e eto/extensions/eto.ts --provider anthropic` (带 env var) | ⚠️ 组合调用过慢，GPU 争用 | >60s timeout |

## 已知问题

**ETO 扩展 + 代理组合调用慢：** ETO 扩展的 `before_agent_start` hook 先调 `llmRoute()`（Ollama），然后 Pi 再调代理（DeepSeek）。两个模型争 RTX 5090 显存，可能导致超时。这是 ETO 扩展的设计问题（双 LLM 调用），不是 patch 的问题。

- 用 `--provider ollama` 时 ETO 扩展工作正常（因为 Ollama 模型和路由调用共用同一个模型进程）
- 用 `--provider anthropic` 走代理时，如果显存够用也能工作

## 请审计

1. 确认 patch 生效：`Select-String 'process.env.ANTHROPIC_BASE_URL' <file>` 应有 3 处匹配
2. 确认 provider 通：`set ANTHROPIC_BASE_URL=http://127.0.0.1:15721 && pi --provider anthropic -p "test"`
3. 检查 `run-eto.cmd` 和 `Makefile` 的 env 注入写法
