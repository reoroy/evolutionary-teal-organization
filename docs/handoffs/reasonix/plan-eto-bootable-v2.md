# Plan: ETO Bootable v2 — 让 Pi 支持本地代理

> 发送者: Claude Code
> 接收者: Reasonix
> 状态: READY
> 优先级: P0
> 前序: plan-eto-bootable.md 的 completion 经验证为 FAIL（详见审计报告）

## 前情

上一次 plan 假设配个 config 就行，但实际根因更深：

- Pi v0.79.8 没有 `ollama` provider
- Anthropic 模型的 `baseUrl` 在 `models.generated.js` 中硬编码为 `https://api.anthropic.com`
- 环境变量 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` Pi 根本不读
- 本地代理 `127.0.0.1:15721` 健康且可用（Claude Code 就在用）

## 解决方案

### 方案对比

| 方案 | 工作量 | 稳定性 |
|:-----|:--------|:-------|
| **A. 给 Pi 打补丁支持 `ANTHROPIC_BASE_URL`** | ~30 分钟 | ✅ 不改代码逻辑，纯注入 |
| B. 写 Pi custom provider | 2-3 小时 | ⚠️ 侵入性强 |
| C. 绕过 Pi 直接跑 ETO | — | ❌ 丢失所有 Pi 底座功能 |

**选 A**：在 Pi 的 model 注册流程中，让 Anthropic 模型的 `baseUrl` 优先读 `ANTHROPIC_BASE_URL` 环境变量。

## 具体方案 A 的两种实现

### A1. 轻量方式（推荐）

在启动脚本 `run-eto.cmd` 中设置 `ANTHROPIC_BASE_URL` 和 `ANTHROPIC_API_KEY`，然后 pat ch Pi 的 Anthropic provider 代码，让它在构建 client 时使用 `ANTHROPIC_BASE_URL` 替代硬编码的 `model.baseUrl`。

```bash
# run-eto.cmd（增强版）
set ANTHROPIC_BASE_URL=http://127.0.0.1:15721
set ANTHROPIC_API_KEY=PROXY_MANAGED
node .../cli.js -e eto/extensions/eto.ts --provider anthropic %*
```

但要让它真正工作，需要在 Anthropic provider 的 `createClient` 函数中读取该 env var 并覆盖 `baseUrl`。

### A2. 修改 models.generated.js

在 Anthropic 模型的 baseUrl 配置中改为动态读取环境变量：

```javascript
// 修改前
baseUrl: "https://api.anthropic.com"
// 修改后
baseUrl: process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"
```

但这每次升级 Pi 后会被覆盖。

## 任务清单

### 1. 找到 patch 点

在 Pi provider 的 `createClient` 函数中，API key auth 分支（`apiKey` 非空）构建 `new Anthropic({...})` 时传入 `baseURL`：

文件：`/c/Users/a7140/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/anthropic.js`

关键代码在第 660 行附近：
```javascript
baseURL: model.baseUrl,  // → 改为读 ANTHROPIC_BASE_URL 环境变量
```

把这个 `model.baseUrl` 改为 `process.env.ANTHROPIC_BASE_URL || model.baseUrl`。

### 2. 验证 patch

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:15721 ANTHROPIC_API_KEY=PROXY_MANAGED pi -e eto/extensions/eto.ts --provider anthropic "你好"
```

期望输出：
- ETO 通知 `🦋 /ETO — 无序 · 三生 · 有机`
- 路由信息 `ETO: xxx → xxx [llm]`
- LLM 回复（走代理经过 5090 上的模型）

### 3. 更新启动脚本

修改 `run-eto.cmd` 和 `Makefile` 确保必要的环境变量自动注入：

```batch
@echo off
set ANTHROPIC_BASE_URL=http://127.0.0.1:15721
set ANTHROPIC_API_KEY=PROXY_MANAGED
pi -e eto/extensions/eto.ts --provider anthropic %*
```

### 4. 写一个验证脚本

写 `verify-eto.cmd` 只跑一次 quick test（静默模式）确认 ETO 加载：

```batch
@echo off
set ANTHROPIC_BASE_URL=http://127.0.0.1:15721
set ANTHROPIC_API_KEY=PROXY_MANAGED
pi -e eto/extensions/eto.ts --provider anthropic --model claude-sonnet-4-6 "测试" > eto-test-output.log 2>&1
:: 检查输出包含 ETO 路由关键字
find "ETO" eto-test-output.log >nul && echo PASS || echo FAIL
```

## 不接受

- ❌ 不要加新 provider（工作量太大）
- ❌ 不要动 fork 编译逻辑
- ❌ 不要改 provider 注册逻辑

## 文件引用

| 文件 | 改动 |
|:-----|:------|
| `...pi-ai/dist/providers/anthropic.js` | patch 1 行：`baseURL: process.env.ANTHROPIC_BASE_URL \|\| model.baseUrl` |
| `run-eto.cmd` | 更新：注入环境变量 |
| `Makefile` | 更新 `run-proxy` target |
| `verify-eto.cmd` | **新建** — 验证脚本 |
