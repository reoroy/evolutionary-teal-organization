# Plan: eto TUI 走代理——不碰 provider 选择

> 发送者: Claude Code
> 接收者: Reasonix
> 状态: READY
> 优先级: P0

## 一句话

用户敲 `eto` 进 TUI，打字就报错，因为默认 provider 是 ollama（不通）。
要让 `ANTHROPIC_BASE_URL=http://127.0.0.1:15721 eto` 直接跑通，不需要用户选 provider。

## 根因

`eto` 是 `/tmp/eto-fork/` 编译产物。它有自己的独立 `node_modules/`，`pi` 命令的 patch 不影响它。

## 任务

### 1. 找到 eto 二进制的 anthropic provider

```bash
eto 命令指向哪？
which eto  # 或 where eto
ls -la $(which eto)
```

找到它实际加载的 `providers/anthropic.js`，确认里面 `baseURL` 有没有读 `ANTHROPIC_BASE_URL`。

### 2. 没打补丁就打上

如果 eto 的 `anthropic.js` 里 `baseURL` 是硬编码的 `"https://api.anthropic.com"` 不是 `process.env.ANTHROPIC_BASE_URL || model.baseUrl`，就打同样的补丁（3 处替换）。

### 3. 验证

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:15721 ANTHROPIC_API_KEY=PROXY_MANAGED eto
```

期望：ETO TUI 启动，打字有回复（走代理）。

## 不做

- ❌ 不改 eto 的 config（它是编译产物，配置路径可能不读本地文件）
- ❌ 不改 eto 的默认 provider 选择
- ❌ 不管 `run-eto.cmd`、`run-eto.ps1`（那是 pi 命令的入口，不是 eto）

## 验收

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:15721 ANTHROPIC_API_KEY=PROXY_MANAGED eto
# → TUI 启动
# → 输入消息 → 回复正常
```

## 文件引用

| 文件 | 改动 |
|:-----|:------|
| `eto 的 node_modules/.../providers/anthropic.js` | patch 3 处 baseURL |
