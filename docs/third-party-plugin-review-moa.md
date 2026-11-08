---
type: security-review
title: 第三方插件审查：@goodandready/dsh-moa
description: MoA 插件的完整性、攻击面、风险处置结论
timestamp: 2026-11-08
verdict: 可保留但休眠；启用前需知道三条
---

# 审查：`@goodandready/dsh-moa@0.2.83`

## 结论

**代码干净，完整性可验证。当前处于休眠状态（未加载），可保留。**

但**先装后审是我的流程错误**——正确顺序是审查通过再装。本文件是补做的审查。

## 完整性：通过

| 检查 | 方法 | 结果 |
|:--|:--|:--|
| 与官方发布一致 | `npm pack @goodandready/dsh-moa@0.2.83` 后 `diff -rq` 对比本地 `lib/` | **0 处差异**（88 文件） |
| 包完整性 | 本地 tarball 的 sha512 与 registry `dist.integrity` 对比 | **逐字符一致** |
| 运行时依赖 | `package.json` 的 `dependencies` | **无**（纯 peer） |
| 许可证 | — | MIT |

## 攻击面

### 网络出站：很小

| 目标 | 用途 | 是否需要鉴权 |
|:--|:--|:--|
| `openrouter.ai/api/v1/models` | 公开价格目录 | 否 |
| `127.0.0.1` / `localhost` | 本地服务间调用 | 本机 |

**无其他外连。** 其余 `https://` 出现在 README 的 GitHub 链接里。

### 命令执行：仅 5 处

| 文件 | 用途 |
|:--|:--|
| `moa-test-gate.js` | spawn 被测项目的测试命令 |
| `updater.js` | spawn `dsh plugin add <pkg>` |
| `moa-self-healing.js` / `moa-swarm.js` | 用 `execFile`（非 shell） |

**`execFile` / `spawn`（数组参数）不经过 shell，没有命令注入面。**

### 凭据：不读值

`access.js` 只**判断 cookie 是否存在**（`dsh_token=` / `dsh_lan_pin=` / `dsh-auth-*`）来确认请求来自已登录的 DSH 前端。
**不读取凭据内容，不外传。**

### 文件写入：双层防护

```js
if (!isSafeRelativePath(rel)) continue
const srcPath = assertPathContained(winningDir, rel)
const destPath = assertPathContained(baseDir, rel)
// 符号链接逃逸：realpath 后必须仍在 baseDir 内
```

**默认阻断**：没有 `dsh-time-machine` 快照时不允许覆盖项目文件（除非显式 `force: true`）。

## 三条已知风险（启用前需知道）

### 1. updater 是唯一「网络 → 装代码」路径

```
POST /api/dsh-moa/update  →  spawn("dsh plugin add @goodandready/dsh-moa --registry=...")
```

**防护比预期严格**（已核实 `lib/updater.js:40-70`）：

- 必须带自定义 header `x-dsh-plugin-update: 1`
- 必须是回环 IP
- 必须 `sec-fetch-site: same-origin`
- `origin.hostname` 必须是回环

**自定义 header 跨域要过 CORS 预检**，这一条单独就封死了 CSRF 与 DNS rebinding。包名在注册时硬编码，请求体不可控。

**没有配置开关**——`endpoint` 是硬编码参数。**不要改 `node_modules` 源码**（更新会覆盖，且掩盖真实风险）。

### 2. 前端注入 247KB

`package.json` 的 `dsh.client.inject` + `lib/client.js`（247KB）会注入 DSH UI。
**本次审查只覆盖 host 侧，前端未逐行审。**

### 3. 无 `dsh-time-machine` 则无法提升文件

```
createPrePromotionCheckpoint → 需要 dsh-time-machine 服务
                            → 未装 = null
                            → null 且非 force = 抛错阻断
```

这是**刻意设计**：宁可失败，也不无备份地覆盖文件。

## 当前状态：休眠

```
MoA 只装在 desktop profile
当前活动进程：superagent-eto (3083) / superagent-art (3084)
desktop profile 没有活动进程
```

**updater 路由当前不可达。** 这是最舒适的起点。

## 启用前检查清单

1. **在有 Git 的目录里用**——否则检查点建不了，文件提升会被阻断
2. **首次试用放 `/tmp` 下的临时仓库**，别在重要项目里
3. **用完从 `dsh.profile.bundles` 摘掉**（若只是临时试）
4. **不要点 UI 里的一键更新**——用 CLI 手动更新

## 与 ETO 的分工

| | ETO | dsh-moa |
|:--|:--|:--|
| 输出 | 意见（advise） | **真的写文件** + 自动提升 |
| 异构 | 三源 peer 投票 | N 候选 + 裁判评选 |
| 安全 | 无 | 红队扫描（SQLi/XSS/注入/路径穿越）+ 事实核验 + 变异测试 |
| 依赖 | 无第三方 | 需要 `dsh-time-machine` 才能提升文件 |

**ETO 说，dsh-moa 做。**
