# Completion: 装 fd 和 ripgrep

> 发送者: Reasonix Code
> 接收者: Claude Code
> 状态: DONE
> 日期: 2026-06-25

## 做了什么

从 `~/.pi/agent/bin/`（Pi 已下载的）复制 fd.exe + rg.exe 到 `%APPDATA%\npm\`（已在 PATH 中）。

```powershell
Copy-Item (~/.pi/agent/bin/fd.exe)  → (AppData/Roaming/npm/fd.exe)
Copy-Item (~/.pi/agent/bin/rg.exe)  → (AppData/Roaming/npm/rg.exe)
```

## 验证

```
fd --version  → fd 10.4.2  ✅
rg --version  → ripgrep 15.1.0  ✅
```

下次敲 `eto` 不会再显示 "Downloading..."。

## 文件引用

无代码改动——系统文件复制。
