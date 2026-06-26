# Plan: 让 ETO 能跑起来

> 发送者: Claude Code
> 接收者: Reasonix
> 状态: READY
> 优先级: P0 — ETO 当前无法启动，入口不通

## 问题

`pi` CLI v0.79.8 和 `/tmp/eto-fork/` 的 ETO Fork 都不识别 `--provider ollama`。无论选什么 provider，都报：

```
No API key found for the selected model.
```

**根因：** Pi 没有本地模型支持。`eto/extensions/eto.ts` 里的三镜路由和 stitcher 走的都是直连 Ollama (`localhost:11434`)，不依赖 Pi 的 provider。Pi 只需要**任何一个能通过的 provider** 来启动底座。

## 解决方案

### 方案选型（选 A，最简单）

| 方案 | 工作量 | 风险 |
|:-----|:--------|:-----|
| **A. 配本地代理** | 10 分钟 | 最低，纯配置 |
| B. 给 Fork 加 Ollama Provider | 2-3 小时 | 改 provider 抽象层，工作量大 |

**选 A**：系统已经在 `127.0.0.1:15721` 跑了一个本地代理（Claude Code 就在用）。让 Pi 通过这个代理用 Anthropic provider 即可启动。ETO 的路由和 stitcher 继续直连 Ollama，互不影响。

## 任务清单

### 1. 确认代理可用

检查 `http://127.0.0.1:15721` 是否在 LISTEN，以及有没有 `/v1/messages` 端点。

```bash
curl -s http://127.0.0.1:15721/health 2>&1
```

如果不通，检查 `.claude/settings.json` 中的 `ANTHROPIC_BASE_URL` 指向就是这个代理。

### 2. 创建 ETO CLI 全局配置

在 `/tmp/eto-fork/` 的根目录创建配置文件，让 ETO CLI 用本地代理 + Anthropic provider 启动：

**配置文件位置：** `/tmp/eto-fork/.eto/settings.json`

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4-6",
  "providers": {
    "anthropic": {
      "baseUrl": "http://127.0.0.1:15721",
      "apiKey": "PROXY_MANAGED"
    }
  }
}
```

> 注意：先确认 `--eto` 配置目录的查找逻辑。如果 `src/core/defaults.ts` 已经把 `~/.pi/` 改成 `~/.eto/`，配置就放 `~/.eto/settings.json`。如果没改完，就放项目本地 `eto.json` 或 `.pi/settings.json`。

### 3. 确认 ETO 扩展自动加载

检查 `/tmp/eto-fork/packages/coding-agent/src/core/resource-loader.ts`（或类似文件）中扩展加载逻辑。如果扩展不会自动从 `/tmp/eto-fork/eto/extensions/` 加载，需要手动注册或在启动参数里加 `-e`。

目标是：
```bash
cd /tmp/eto-fork && node packages/coding-agent/dist/cli.js -e <eto-extension-path> -p "你好"
```
能启动且 ETO 通知出现（"🦋 /ETO — 无序 · 三生 · 有机"）即可。

### 4. 写个启动脚本

在项目根目录写一个 `make run` 或 `run-eto.sh` 一键启动命令：
- Unix: `cd /tmp/eto-fork && node packages/coding-agent/dist/cli.js -e 项目路径/eto/extensions/eto.ts`
- 自动传 `--provider anthropic` 等必要参数

### 5. 验证

```bash
cd /tmp/eto-fork && node packages/coding-agent/dist/cli.js -e ../../eto/extensions/eto.ts -p "测试" 2>&1
```

期望输出：
- `🦋 /ETO — 无序 · 三生 · 有机` 通知
- `ETO: code → plan [llm]` 路由信息（或 keyword）

## 不接受

- ❌ 不要改 Pi 的 provider 抽象层（工作量太大）
- ❌ 不要给 Pi 加 Ollama provider
- ❌ 不要动 `/tmp/eto-fork/` 的编译逻辑

## 注意事项

- 代理 `127.0.0.1:15721` 的 API key 是 `PROXY_MANAGED`（纯占位符，代理不校验）
- 代理端口不要写成 11434（那是 Ollama）
- `.claude/settings.json` 是 Claude Code 自己的配置，不要改它
- ETO 扩展的 `eto.ts` 文件路径是相对于工作目录的，注意绝对路径/相对路径问题

## 文件引用

| 文件 | 改动 |
|:-----|:------|
| `~/.eto/settings.json` | **新建** — 配本地代理 |
| 项目根 `run-eto.sh` 或 `Makefile` | **新建/修改** — 启动脚本 |
| `/tmp/eto-fork/packages/coding-agent/dist/cli.js` | 只读，确认启动参数 |
| `/tmp/eto-fork/src/core/defaults.ts` | 只读，确认配置路径 |
