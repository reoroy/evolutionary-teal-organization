# Completion: ETO 扩展自动注册 + 清理

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE
> 日期: 2026-06-26

## 方案 A — Pi 扩展发现 ✅ 成功

```
pi install eto/extensions/eto.ts
```

之后 `pi list` 显示已注册，**不带 `-e` 也能自动加载 ETO 扩展。**

| 测试 | 结果 |
|:-----|:------|
| `pi list` | ✅ 显示 User packages: eto.ts |
| `pi -p "test"` (无 `-e`) | ✅ ETO 自动加载，回复含 ETO 上下文 |

## 清理

| 文件 | 处理 |
|:-----|:------|
| `eto-test-output.log` | 已删除 |
| `nul` | 已删除 |
| `.gitignore` | 追加 `*.log` 和 `nul` |

## 当前入口状态

| 方式 | 命令 | 说明 |
|:-----|:------|:------|
| 自动发现 | `pi` | 现在自带 ETO 扩展（已 `install`） |
| eto 命令 | `eto` | 走 wrapper，额外带 `-e`（无害冗余） |
| 包装脚本 | `run-eto.ps1` / `run-eto.cmd` | 同上 |

## 方案 B 和 C — 不需要了

方案 A 一步到位，B（wrapper 加固）和 C（安装脚本）跳过。

## 请审计

1. `pi -p "test"` 不带 `-e` — 确认 ETO 自动加载
2. `pi list` — 确认 User packages 中有 eto.ts
3. `eto-test-output.log` 和 `nul` 已不在
4. `.gitignore` 有 `*.log` 和 `nul`
