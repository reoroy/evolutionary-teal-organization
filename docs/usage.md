# ETO 使用指南

> 安装后自动写入 `~/.eto/memory/guide.json`，ETO 运行时注入上下文。

---

## 一、三镜路由（任务自动分类）

用户说话 → ETO 自动分类任务 → 路由到合适的 Agent。

| 路由 | 场景 | 行为 |
|:-----|:------|:------|
| `direct` | 简单问答（"什么是 X"） | 直接回答 |
| `plan` | 代码/调研/创建任务 | 拆步执行 |
| `consensus` | 危险操作（删除/部署） | 三阶段共识审批 |

路由后端在 `~/.pi/eto-config.json` 配置。LLM 不可用时自动降级关键词匹配。

---

## 二、同侪共识（三阶段评审）

风险操作由三个 AI peer 独立评分、审议、终审。

1. **T1 独立评分** — 三个 peer 用角色专用 prompt 各自打分
2. **T2 审议** — 分歧 > 0.2 时 peer 看到他人意见后重新评分
3. **T3 终审** — 审议后分歧仍大 → auditor 终审裁决

**命令行调用：**
```bash
echo '{"fn":"peer_review","args":["部署到生产环境不备份不测试",["researcher","coder","auditor"]]}' \
  | python eto/stitches/consensus/vote.py
```

---

## 三、智子安检 v2 — 行为规则引擎

拦截危险操作，支持四种规则类型 + 逃生门防循环。

**配置：** `~/.pi/eto-sentinel.json`（热重载：对话中输入 `/sentinel-reload`）

**四种规则类型：**

| 类型 | 行为 | 示例 |
|:-----|:------|:------|
| `block` | 直接拦截不弹窗 | 禁止 `rm -rf /`、`dd`、`mkfs` |
| `confirm` | 弹窗确认+影响预览 | 删除文件前显示文件大小、数量 |
| `transform` | 正则替换 prompt 内容 | 自动过滤 emoji |
| `track_turns` | 轮数超阈值注入提醒 | 10 轮后提醒"确认正轨？" |

**逃生门：** 同一规则连拦 N 次后自动放行，用户新消息重置计数。

**trigger glob：** 支持工具名通配符匹配 — `bash`、`write`、`edit`、`git:*`。

**预览命令：** 检测到危险命令自动生成安全预览（`rm` → `ls`、`dd` → `lsblk`）。

**完整示例：**
```json
{
  "enabled": true,
  "deadlock": { "maxBlocksPerRule": 5, "escapeAction": "log" },
  "rules": [
    {
      "name": "dangerous-bash",
      "priority": 20,
      "type": "block",
      "trigger": "bash",
      "pattern": "rm\\s+-rf|dd\\s+if=|mkfs",
      "message": "危险命令已拦截"
    },
    {
      "name": "rm-preview",
      "priority": 10,
      "type": "confirm",
      "trigger": "bash",
      "pattern": "rm\\s+-rf",
      "message": "删除文件，请确认路径"
    }
  ]
}
```

---

## 四、MCP Server（被其他 Agent 调用）

ETO 作为 MCP Server，暴露 6 个工具给 Claude Code / Cursor 等外部 Agent。

**配置 `.mcp.json`：**
```json
{ "mcpServers": {
  "eto": { "command": "python", "args": ["-m", "eto.mcp_server"] }
} }
```

**可用工具：**
- `eto_consensus` — 发起同侪共识
- `eto_route` — 分析任务路由
- `eto_peer_config` — 查看 peer 配置
- `eto_memory_write/read/list` — 读/写/列出共享记忆

**验证：** `python -m eto.mcp_server`

---

## 五、MCP Client（调其他 Agent）

Peer 可以通过 MCP 调外部 Agent 来评分或执行任务。

**配置 `~/.pi/eto-config.json`：**
```json
{
  "peers": {
    "security_auditor": {
      "provider": "mcp",
      "mcp_server": ["python", "-m", "my_auditor_agent_mcp"],
      "mcp_tool": "audit_review"
    }
  }
}
```

---

## 六、共享记忆（TealContext）

Agent 之间通过 `~/.eto/shared_memory/` 共享上下文。自动写入：

| 写入方 | 内容 | 读取方 |
|:-------|:-----|:-------|
| `peer_review` | 评分 + 关切点 | 下次 plan 执行 |
| `execute_plan` | 步骤执行状态 | 下次 plan 执行 |
| MCP 工具 | 外部 Agent 数据 | ETO 内部 |

格式与 pi-team-agents 兼容，两边数据互通。

---

## 七、Fable 5 风格 Agent Prompt

所有 plan 路由的 Agent 注入以下 AGENT_PROMPT：

```
Communication:
- Lead with the verdict, then the evidence.
- No filler: no celebration, no apologies, no 'notably'.
- Clipped while working, complete at boundaries.
- Don't create planning docs unless asked.

Action Safety:
- Audit each claim against actual output.
- Call a flaw a mistake and fix it — don't relabel.
- Missing context → ask, don't invent.

Tone:
- No emojis unless requested.
- 'Done' is hypothetical until verified.
```

---

## 八、开发工作流（修改 ETO 自身）

```
描述需求 → /plan-eto → Reasonix 实现 → /review-eto → /test-eto → /release-eto
```

| 命令 | 阶段 | 产出 |
|:-----|:------|:------|
| `/plan-eto` | 写 Reasonix plan | `docs/handoffs/reasonix/plan-*.md` |
| `/code-eto` | 触发 Reasonix 实现 | Reasonix 完成回执 |
| `/test-eto` | 跑测试 | `python eto/stitches/test.py` (17/17) |
| `/review-eto` | 审计 completion | 审计报告 |
| `/release-eto` | 版本 bump + tag + push | 发布版本 |

---

## 九、运行时命令

| 操作 | 命令 |
|:-----|:------|
| 启动 TUI | `pi` |
| 一次性查询 | `pi -p "你的问题"` |
| 指定 provider | `pi --provider deepseek` |
| 智子重载 | `/sentinel-reload`（对话中） |
| 运行统计 | `/metrics`（对话中） |
| 品牌信息 | `/eto`（对话中） |
| 测试 | `python eto/stitches/test.py` |
