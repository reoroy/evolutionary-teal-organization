# ETO 复盘与路线图

> 2026-06-25 | 对比 Pi / OMP / 设计文档，重新定位 ETO

---

## 一、三角对比

### 1. Pi (pi-mono) — 极简 Agent 运行时

```
定位: 通用 Agent 基座（<1K tokens system prompt）
架构: pi-ai → pi-agent-core → pi-coding-agent → pi-tui
代码: TypeScript，单体仓库，5 个子包
扩展: ~/.pi/agent/extensions/*.ts 自动发现
会话: JSONL 树（可分支、可压缩）
提供商: 15+（OpenAI/Anthropic/Ollama/Google...）
工具: read/write/bash/edit/grep/find/ls
TUI: 差异渲染全屏终端
特点: 干净、可扩展、Provider 抽象一流
短板: 无权限系统、无MCP、无审核链、单Agent范式
```

### 2. OMP (oh-my-pi) — 全功能 AI 编码助手

```
定位: "有 IDE 接线进来的 Coding Agent"
血统: Pi 的硬分叉（v15.12.4）
Rust 核心: 27K 行 Rust（搜索/shell/高亮）
扩展: Pi 兼容（改 import 路径即可）
独有: Hashline 编辑（-61% token）、LSP、DAP
工具: 32 个内置（含 browser/web_search/github/memory）
提供商: 40+（Pi 的 15+ + 更多）
子Agent: 并行 Worker + Schema 校验
特点: 最全工具集、角色路由、Rust 性能
短板: Fork 上游合并风险、太重
```

### 3. ETO 设计文档 — 青色组织编排

```
定位: "一组 Agent 的协作制度，不是单个 Agent"
核心理念:
  自主管理 — 无固定层级，动态协调员
  完整性 — 共享全局上下文
  进化使命 — 集体回顾 + 动态校准

架构设计:
  TealContext（共享记忆池）
  青色决策协议（提议→广播→评分→执行）
  三镜分析（格物/析理/合验）
  智子（独立安全守卫，只否决不提议）
  临时协调员选举（匹配度 × 空闲率）

技术栈（设计）:
  CLI 框架 → Pi (pi-mono)
  Agent 通信 → ProtoLink / A2A
  Agent 运行时 → Pi CLI
  TUI → Pi 的 pi-tui
  记忆 → agentmemory / pi-memory
  MCP → pi-mcp-adapter
```

---

## 二、我们走过的弯路

### 弯路 1: 用 Python 重写 Pi 已有功能（已修正）

```
设计: CLI 框架 → 基于 Pi
实际: 自己写了 executor.py(253行) 封装 Pi 调用
     自己写了 context.py(270行) 重复 JSONL 会话
     自己写了 tui.py(366行) 重复 pi-tui
教训: Pi 不是"参考框架"，Pi 就是运行时
修正: 删掉 3156 行 Python，换 119 行 TS 扩展
```

### 弯路 2: 多 Agent 设计被简化成单 Agent + 通知

```
设计要求:
  多个独立 Agent 进程，通过 A2A 通信
  每个 Agent 有自己的 LLM 会话
  通过 TealContext 共享记忆
  共识协议 = 真实广播给同侪评分

实际实现:
  单 Agent（Pi 的一个会话）
  路由只是注入 system prompt
  共识 = 随机数模拟
  TealContext = Pi 的 JSONL

差距: 设计是"分布式多 Agent 系统"
     实现是"单 Agent 加了些提示"
```

### 弯路 3: 缝合方案依赖的开源项目已死（核心教训）

```
缝合方案计划:
  Phase 2: 接 Nexus → 任务分解    ❌ 项目已死/不可用
          接 Aegean → 共识投票    ❌ 项目已死/不可用
          接 Gravity AI → 选举    ❌ 项目已死/不可用

结果: 三个依赖都死了，但我们没找活的替代品，
     而是自己写了 2000 行 + 3 个模块。
```

缝合方案的原则没错（不写框架，只缝已有的），但缺少一条：**缝之前先确认那东西还活着**。如果 Phase 2 的三个依赖都不可用，正确的做法是：

1. 找活的替代品（`dead-ends.md` 记录了 Try 过 Aegean，impl 不可用）
2. 或者接受用 Pi 扩展 API 作为新的"缝合层"
3. **而不是自己重写**

Pi 的扩展系统本身就是最好的缝合层——我们不缝 Aegean/Nexus/Gravity AI 了，我们缝 Pi CLI。Pi 是活的、维护的、API 稳定的。

### 弯路 4: 功能堆砌代替架构收敛

```
我们做了（3156 行）:
  ✅ 三镜路由 × 3 种实现（关键词/embedding/LLM）
  ✅ 选举算法 × 3 层评分
  ✅ 共识协议 × 串行/并行
  ✅ TUI × 6 个版本
  ✅ 记忆系统 × 2 套（agentmemory + AIMemory）
  ✅ 测试 × 57 个

但核心问题没解决:
  ❌ 多 Agent 通信没真正实现
  ❌ 共识没有真正 peer 评分
  ❌ TealContext 没有真正共享
  ❌ 步骤上下文传递有但脆弱

做得多 ≠ 做得对
```

---

## 三、Pi / OMP / ETO 的本质差异

```
            单 Agent 范式                多 Agent 范式
            ─────────────                ────────────
轻量        Pi (pi-mono)                 ETO (设计目标)
            通用运行时                    青色组织编排
            <1K tokens                   共识 + 路由 + 守卫

重型        OMP (oh-my-pi)               ???
            全功能编码助手                暂无对标产品
            32 工具 / LSP / DAP           多 Agent + 共识 + 进化
```

**ETO 的独特价值不在"做得比 Pi 好"，而在"做 Pi 不做的事"：**

| Pi/OMP 擅长 | ETO 应该做 |
|:------------|:-----------|
| 单 Agent 对话 | 多 Agent 管道编排 |
| 工具执行 | 共识协议 + 路由 |
| 提供商抽象 | 青色组织策略 |
| 编码辅助 | 决策审计 + 安全守卫 |

---

## 四、未来路线图

### 阶段一：Extension 完善（现在 ~ 本周）

```yaml
目标: 在 Pi 生态内跑通 ETO 核心流程
形态: ~/.pi/agent/extensions/eto.ts
代码: ~200 行

优先级:
  P0  三镜路由（LLM 语义 + 关键词）    ✅ 已完成
  P0  before_agent_start 注入上下文    ✅ 已完成
  P0  智子安检                         ✅ 已完成
  P1  共识工具（真实 peer 调用）       ✅ 已完成（2026-11-02 起：vote.py 真实调用
      ollama/deepseek/claude/mcp provider，MCP peer 路径有 CI 检查覆盖，见 #15/#20）
  P1  Plan 模式的多步分解与执行        ✅ 已完成（2026-11-02 起：LangGraph 工作流
      + agent_execute 真实执行入口，空输出标 failed，见 #13/#22）
  P2  步骤间上下文传递                 ✅ 已完成（workflow 步骤输出注入下一步上下文）
  P2  跨会话历史加载                   📋 待做（Pi 已自带，优先级低）

# 2026-11-03 更新：此前标记待办的 6 个 P0（#7 安检命令注入、#12 安装可跑、
# #13 LangGraph 假成功、#14 共享记忆断链、#15 MCP peer 评分、#16 Feedback
# agent 字段）均已修复并合入主干（f6f4883），CI 5 个 job 全绿——从待办移出。

评估: 如果扩展阶段就走通了所有核心流程，
      说明 ETO 不需要独立 CLI。
```

### 阶段二：Fork 决策（1-2 周后）

```yaml
判断标准: Extension 是否触及能力天花板？
  - 无法修改 Pi 的 TUI 显示 ETO 特有信息？
  - 无法修改 Pi 的会话存储格式？
  - 需要 Pi 没有的内核钩子？

如果 YES → Fork:
  照着 FORK-PLAN.md 执行
  包名: @reoroy/eto-cli
  CLI: eto
  保持: pi-ai（提供商抽象）+ pi-tui（TUI）
  改:   CLI 入口 + 默认模型 + ETO 内核

如果 NO → 继续 Extension:
  接受 ETO 是 Pi 生态的一个扩展
  不是独立项目，而是"青色组织版 Pi"
```

### 阶段三：多 Agent 真正的实现（长期）

```yaml
真正的多 Agent ≠ 一个 Agent 会话里加提示
真正的多 Agent = 多个独立 Agent 进程 + 通信协议

可能的技术路径:
  路径 A: Pi RPC mode
    多个 Pi 进程通过 RPC 通信
    每个 Agent = 一个 Pi session
    通信 = ETO 自己写薄层

  路径 B: ProtoLink / A2A
    每个 Agent 独立进程
    通过 HTTP POST /tasks/ 通信
    ETO 做 Registry + 路由

  路径 C: 多 Worktree
    Hermes 模式: 每个子 Agent 在独立 worktree
    通过文件系统 + 结构化报告交换信息
    最轻量，但同步成本高

建议: 先走路径 A（Pi RPC mode），
      因为 Pi 已经实现了 Agent 内核，
      我们只需要编排多个 Pi 实例。
```

---

## 五、一句话总结

```
Pi 是 Agent 引擎。
OMP 是 Pi + 全功能工具链。
ETO 不是另一个引擎——ETO 是让多个引擎协作的制度。

做 Extension 还是做 Fork？
  Extension 快，但受限于 Pi 的钩子。
  Fork 慢，但有完全的控制权。
  先 Extension 验证设计，再决定是否 Fork。
```

---

*最后更新: 2026-11-03（实现状态对齐，见 implementation-roadmap.md 顶部对照表）*
*下一轮迭代: 三体权重/MODE 路由（#26）· Raft 选举语义（#29）· 权限与预算（#27）· 集体回顾/Loop（#28）· 置信度学习（#30）*
