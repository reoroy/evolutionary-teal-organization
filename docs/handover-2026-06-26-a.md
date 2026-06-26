# ETO Handover — 2026-06-26 (1/1 场)

> 生成日期: 2026-06-26
> 上一场: [handover-2026-06-25.md](handover-2026-06-25.md)

## 一、本场做了什么

**做成：**
- Reasonix 文件接力协议搭建（INDEX.md + CLAUDE.md 协议段）
- Stitcher 层硬化：3 层全部硬化，9/9 测试通过
- ETO Bootable：Pi anthropic.js 打补丁支持 `ANTHROPIC_BASE_URL`
- 启动脚本：`run-eto.cmd`、`run-eto.ps1`、Makefile 三个入口
- `eto` 命令换血：从旧 Python 管道切换到 Pi TUI + ETO 扩展 + 代理
- ETO 流式输出：路由信息 widget + notify + systemPrompt 三层输出
- 汉化插件安装
- 旧文档引用清理（feature-sourcing.md、framework.md）

**踩坑：**
- 第一份 bootable plan FAIL（以为配个 config 就行，实际 Pi 不支持 Ollama provider）
- `eto` 命令是 Python 包装器不是 Node 编译产物（下错结论又追了一轮 Plan）
- `ctx.ui.notify()` 在 TUI 状态栏一闪而过，用户看不到
- `ctx.ui.setWidget()` 有实现但用户 TUI 中不可见（原因未明，需 TUI 交互调试）

## 二、P0 未完成

| # | 事项 | 当前状态 | 建议下一步 |
|:-:|:-----|:---------|:-----------|
| 1 | ETO widget 不显示 | setWidget 代码已写，TUI 中不可见 | 实测 `pi -e test-widget.ts` 进 TUI 确认 |
| 2 | Fork Phase 1 → GitHub 推送 | 代码在 `/tmp/eto-fork/` | GitHub 网络不通 |
| 3 | ETO 扩展自动注册 | 已通过 `-e` 加载，非自动 | 需 Fork 的 AgentSession |

## 三、死胡同

- `--provider ollama`：Pi v0.79.8 没有 Ollama provider，走不通
- 旧 Python 管道（`~/.eto/pipelines/`）：tui.py GBK 崩溃，core.py 硬编码 ollama，已弃用
- `eto` npm 包装器：已被替换为 Pi TUI + ETO 扩展方向

## 四、活跃分支 / 修改文件

- `eto/extensions/eto.ts` — 核心扩展，多轮迭代（路由 + widget + systemPrompt）
- `eto/stitches/` — 全部硬化
- `C:\Users\a7140\AppData\Roaming\npm\eto.ps1` — 入口替换
- `C:\Users\a7140\AppData\Roaming\npm\eto.cmd` — 入口替换
- `run-eto.ps1`、`run-eto.cmd` — 启动脚本
- `Makefile` — run/run-proxy 双模式
- `test-widget.ts` — 调试用，可删

## 五、环境快照

- Pi CLI v0.79.8，anthropic.js 已打 `ANTHROPIC_BASE_URL` 补丁
- `eto` 命令走 Pi TUI + ETO 扩展 + 代理
- fd / ripgrep 已在 PATH
- `eto` 回车进 TUI，可正常对话
- GitHub 仍不通

## 六、已知技术债

- widget 不显示（需进 TUI 交互模式实测）
- `——provider ollama` 不通（Pi 没有该 provider）
- ETO 路由信息用户不可见（就差 widget 这层）
