# Plan: ETO 扩展自动注册 + 清理

> 日期: 2026-06-26
> 来源: P0-3 (handover-2026-06-26-a.md)
> 优先级: P0
> 执行端: Reasonix

## 一、当前状态

`eto` 命令通过 wrapper 脚本（`.cmd` / `.ps1`）调用 `pi -e eto.extensions.eto`。扩展加载路径硬编码在启动脚本中。

**问题：**
- 扩展注册依赖 wrapper 脚本的 `-e` 参数
- wrapper 脚本路径可能因安装方式不同而漂移
- 每次启动都需手动指定扩展路径

**目标：** ETO 扩展自动发现——不管怎么启动 `pi`，ETO 扩展自动加载。

## 二、方案

### 方案 A — Pi 的扩展发现机制（推荐）

Pi CLI 支持从用户目录自动发现扩展。检查 `~/.pi/extensions/` 或 Pi 配置中的扩展目录。将 `eto.ts` 注册到 Pi 的扩展发现路径中。

```bash
# 检查 Pi 扩展发现路径
pi --help | grep -i extension

# 检查 ~/.pi/ 配置文件
ls -la ~/.pi/
```

可能的路径（取决于 Pi 版本）:
- `~/.pi/extensions/` — 用户扩展目录
- `~/.pi/agent/extensions/` — Agent 扩展目录

**操作：** 将 `eto.ts` symlink 或复制到 Pi 的扩展发现目录。

### 方案 B — eto wrapper 加固

如果 Pi 无自动发现机制，加固现有 wrapper 脚本：

- `run-eto.cmd`: 验证 `-e` 参数路径存在，报错信息友好
- `run-eto.ps1`: 同上
- 统一入口：`eto` 命令走到正确路径

### 方案 C — 安装脚本

`make install-eto` 或 `npm run setup` 将 eto 注册到 Pi。

## 三、清理未跟踪文件

当前 untracked files 需要处理：

| 文件 | 处理 | 理由 |
|:-----|:------|:------|
| `run-eto.cmd` | 保留 | 启动入口 |
| `run-eto.ps1` | 保留 | 启动入口 |
| `eto-test-output.log` | 删除 | 运行时产物 |
| `verify-eto.cmd` | 保留 | 验证脚本 |
| `nul` | 删除 | 残留文件 |
| `.gitignore` 更新 | 追加 | 忽略 `*.log`, `nul` |

## 四、文件引用

| 文件 | 用途 |
|:-----|:------|
| `eto/extensions/eto.ts` | 核心扩展（不改） |
| `run-eto.cmd` | Windows CMD 入口 |
| `run-eto.ps1` | Windows PowerShell 入口 |
| `~/.pi/extensions/` | Pi 扩展发现目录 |
| `.gitignore` | 追加日志忽略规则 |

## 五、验证

1. `pi` (不带 -e) 启动 → `session_start` 触发 ETO notify
2. 或者 `eto` 回车 → TUI 启动 → widget 显示 "ETO 等待中..."
3. `.gitignore` cover `*.log` 和 `nul`

## 六、不做

- 不改 Pi 源码
- 不改 `eto.ts` 核心逻辑
- 不新增依赖
