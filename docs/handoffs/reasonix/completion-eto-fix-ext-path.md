# Completion: 修复 eto 包装器的扩展路径

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE
> 日期: 2026-06-25

## 改动

| 文件 | 改了什么 |
|:-----|:---------|
| `C:\Users\a7140\AppData\Roaming\npm\eto.ps1` | 扩展路径改为**绝对路径**优先，CWD 回退 |
| `C:\Users\a7140\AppData\Roaming\npm\eto.cmd` | 同上 + `chcp 65001` 确保 UTF-8 路径解析 |

## 解析逻辑

```
1. 尝试绝对路径（项目固定位置）
   C:\Users\a7140\Nutstore\1\工坊\项目\evolutionary-teal-organization\eto\extensions\eto.ts
2. 如果不存在 → 回退到 CWD 相对路径（用户恰好在项目目录）
3. 如果还找不到 → $ext = $null，启动 Pi 但不加 -e
```

## 验证

```bash
# 从任意目录
cd ~
eto --help  → Pi 帮助（ETO 扩展存在 ✅）

# 从项目目录（走绝对路径）
cd C:\Users\a7140\Nutstore\1\工坊\项目\evolutionary-teal-organization
eto --help  → Pi 帮助 ✅

# CMD 通路
cmd /c "eto --help"  → 同上 ✅
```

## 请审计

从不同目录敲 `eto`，确认 ETO 扩展始终加载。
