# Plan: Fork Phase 1 — GitHub 推送

> 日期: 2026-06-26
> 来源: [handover-2026-06-26-a.md](../handover-2026-06-26-a.md) P0-2
> 发起端: Claude Code (Windows)
> 执行端: Reasonix (Linux)

## 背景

Fork 代码已在 `/tmp/eto-fork/`（Windows 路径），remote 指向 `https://github.com/reoroy/eto-cli.git`。GitHub 推送被 Windows 网络墙阻断 — Linux 端可推。

## 任务

### Step 1: 获取 Fork 代码

Fork 内容见 `docs/handoffs/fork-state-summary.md`（由我生成）。实际代码需要从 Windows 传递到 Linux 端。

两种传递方式（择一）:
- **Git bundle**: 我在 Windows 打 `git bundle create eto-fork.bundle --all`，你可从同一仓库恢复
- **Scp/Nutstore**: 检查 Nutstore 共享目录是否有 `/tmp/eto-fork/` 的副本

### Step 2: 处理未提交变更

Fork 工作区有 3 个修改过的文件:
- `packages/ai/src/providers/huggingface.models.ts`
- `packages/ai/src/providers/minimax-cn.models.ts`
- `packages/ai/src/providers/minimax.models.ts`

判断: 这是 Fork 时 pi-mono 自带的本地模型配置修改。**与 ETO 功能无关**，可 stash 丢弃:
```
git checkout -- packages/ai/src/providers/huggingface.models.ts \
  packages/ai/src/providers/minimax-cn.models.ts \
  packages/ai/src/providers/minimax.models.ts
```

### Step 3: Push 到 GitHub

```
git remote -v              # 确认 origin = https://github.com/reoroy/eto-cli.git
git push origin master     # 推送当前 master
```

如果 gh CLI 未认证:
- 要么用 `gh auth login` 交互登录
- 要么用 HTTPS + PAT: `git push https://<PAT>@github.com/reoroy/eto-cli.git master`

### Step 4 (可选): 验证

```
gh repo view reoroy/eto-cli --json url   # 确认仓库可见
git ls-remote origin HEAD                 # 确认远程已有提交
```

## 成功标准

- [ ] `https://github.com/reoroy/eto-cli` 可访问
- [ ] 远程 master 分支包含 commit `55bc5f4` (feat: ETO CLI v0.1.0)
- [ ] 工作区干净，无脏文件

## 回退方案

如果推送失败（权限/认证问题），在 `docs/handoffs/reasonix/completion-fork-phase1.md` 中说明具体错误信息，不硬解。

## 完成回执要求

列出:
1. 推送成功/失败
2. GitHub 仓库 URL
3. 远程 HEAD commit hash
4. 如有报错，完整错误信息
