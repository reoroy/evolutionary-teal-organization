# Plan: 装 fd 和 ripgrep，消除每次启动下载

> 发送者: Claude Code
> 接收者: Reasonix
> 状态: READY
> 优先级: P1

## 问题

敲 `eto` 启动 Pi TUI 时每次都显示：
```
fd not found. Downloading...
ripgrep not found. Downloading...
```

Pi CLI 依赖这两个工具做文件搜索。下载没缓存住，或者说每次都重新下。

## 方案

用 Windows 包管理器装到系统 PATH 里，Pi 启动时直接找到就不用下了。

### 方案 A：scoop（推荐，如果已装）

```powershell
scoop install fd ripgrep
```

### 方案 B：winget（Windows 自带）

```powershell
winget install sharkdp.fd
winget install BurntSushi.ripgrep.MSVC
```

### 方案 C：直接下载放 PATH 目录

从 GitHub releases 下载 exe 放到 `C:\Users\a7140\bin\`（已在 PATH 中）：
- https://github.com/sharkdp/fd/releases
- https://github.com/BurntSushi/ripgrep/releases

## 验证

```bash
fd --version
rg --version
eto
# → 不再显示 Downloading...
```

## 文件引用
无代码改动，纯系统配置。
