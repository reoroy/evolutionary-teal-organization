# Plan: 修复 eto 包装器的扩展路径

> 发送者: Claude Code
> 接收者: Reasonix
> 状态: READY
> 优先级: P0

## 问题

`eto.ps1` 里找 ETO 扩展用的是 `Get-Location`（当前目录）：

```powershell
$ext = Join-Path (Get-Location) "eto/extensions/eto.ts"
```

用户从任意目录敲 `eto`（不是项目目录），扩展找不到，ETO 不加载。回复是裸 Pi/Claude，没有 ETO 路由。

## 方案

把扩展路径从相对路径改为**绝对路径**，指向项目目录：

```
C:\Users\a7140\Nutstore\1\工坊\项目\evolutionary-teal-organization\eto\extensions\eto.ts
```

### 文件一：`C:\Users\a7140\AppData\Roaming\npm\eto.ps1`

```powershell
# 硬编码绝对路径（项目固定位置）
$etoProject = "C:\Users\a7140\Nutstore\1\工坊\项目\evolutionary-teal-organization"
$ext = Join-Path $etoProject "eto\extensions\eto.ts"

# 后备：检查 CWD（如果用户恰好在项目目录下）
if (-not (Test-Path $ext)) {
    $ext = Join-Path (Get-Location) "eto/extensions/eto.ts"
}
```

### 文件二：`C:\Users\a7140\AppData\Roaming\npm\eto.cmd`

对应地改：

```batch
set ETO_EXT=C:\Users\a7140\Nutstore\1\工坊\项目\evolutionary-teal-organization\eto\extensions\eto.ts
```

## 验证

```bash
# 从任意目录
cd ~
eto
# → ETO 通知出现，路由信息显示

cd /tmp
eto
# → 同上

# 从项目目录（后备路径）
cd C:\Users\a7140\Nutstore\1\工坊\项目\evolutionary-teal-organization
eto
# → 同上
```

## 不做
- 不改项目代码
- 不改启动脚本

## 文件引用

| 文件 | 改动 |
|:-----|:------|
| `C:\Users\a7140\AppData\Roaming\npm\eto.ps1` | 扩展路径改为绝对路径 |
| `C:\Users\a7140\AppData\Roaming\npm\eto.cmd` | 同上 |
