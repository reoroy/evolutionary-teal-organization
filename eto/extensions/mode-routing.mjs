/**
 * mode-routing.mjs — 三体权重与 MODE 路由（FR-A2.3 / FR-A3.1–A3.4）
 *
 * 纯函数模块：eto.ts（Pi 扩展）与 tests/mode-routing.test.mjs 共用，
 * 沿用 sentinel-preview.mjs 的「逻辑独立成 .mjs + 双端 import」模式。
 *
 * 领域语义（docs/requirements.md）：
 * - 三体权重 [☀️理体, 🌙实体, ⭐得体]（FR-A2.3）：理体=调研分析、实体=工程实现、得体=权衡评判
 * - MODE（FR-A3.1）：research | build | debate | full | direct
 * - 纪元（FR-A3.2）：恒纪元=权重有明确主导（稳定），乱纪元=三体拉扯（接近）→ 综合+深审
 * - 乱纪元自动增加 REWORK 轮次与审核深度（FR-A3.3）
 * - 通政司置信度随历史执行结果调整（FR-A3.4 的纯计算部分）
 */

export const MODES = ["research", "build", "debate", "full", "direct"];

export const ERAS = ["stable", "chaotic"];

// 权重首位与次位的差距低于该阈值 → 三体拉扯 → 乱纪元
export const CHAOTIC_MARGIN = 0.2;

// 乱纪元 / 恒纪元 的 REWORK 轮次上限（FR-A3.3）
export const CHAOTIC_REWORK_ROUNDS = 3;
export const STABLE_REWORK_ROUNDS = 1;

const DEEP_REVIEW_PEERS = ["researcher", "coder", "auditor"];
const STANDARD_REVIEW_PEERS = {
  research: ["researcher", "auditor"],
  build: ["coder", "auditor"],
  debate: ["auditor", "coder"],
  full: DEEP_REVIEW_PEERS,
  direct: [],
};

// 各 MODE 的流水线步骤（execPlan 消费；direct/debate 不走流水线）
const MODE_STEPS = {
  research: ["收集信息", "深度分析", "整理报告"],
  build: ["调研需求", "编写代码", "审查质量"],
  full: ["收集信息", "深度分析", "制定方案", "执行实现", "审查质量"],
  debate: [],
  direct: [],
};

const COORDINATOR_HINT = {
  research: "researcher",
  build: "coder",
  debate: "auditor",
  full: "auditor",
  direct: "researcher",
};

// 关键词信号：用于无 LLM 时的权重推断（keywordRoute 降级路径）
const SIGNALS = {
  li: ["研究", "调研", "分析", "报告", "论文", "综述", "考察", "research", "analyz", "investigat", "report", "survey", "study"],
  shi: ["实现", "编写", "开发", "构建", "重构", "部署", "代码", "写", "修复", "implement", "build", "code", "refactor", "write", "fix", "develop", "deploy"],
  de: ["对比", "比较", "评估", "选型", "取舍", "优缺点", "争论", "权衡", "评审", "compare", "pros", "cons", "trade-off", "tradeoff", "evaluat", "versus", " vs "],
};

/**
 * 从任务文本推断三体权重（FR-A2.3 降级路径）。
 * 先验 1:1:1，命中信号的身体加权，再归一化到和为 1。
 */
export function deriveWeights(task) {
  const t = String(task ?? "").toLowerCase();
  const raw = { li: 1, shi: 1, de: 1 };
  for (const [body, words] of Object.entries(SIGNALS)) {
    for (const w of words) {
      if (t.includes(w)) raw[body] += 2;
    }
  }
  return normalizeWeights(raw);
}

/**
 * 归一化外部权重（LLM 输出）。非法输入返回 null，由调用方降级到 deriveWeights。
 */
export function normalizeWeights(raw) {
  if (!raw || typeof raw !== "object") return null;
  const li = Number(raw.li);
  const shi = Number(raw.shi);
  const de = Number(raw.de);
  if (!Number.isFinite(li) || !Number.isFinite(shi) || !Number.isFinite(de)) return null;
  if (li < 0 || shi < 0 || de < 0) return null;
  const sum = li + shi + de;
  if (sum <= 0) return null;
  return { li: li / sum, shi: shi / sum, de: de / sum };
}

/**
 * 纪元判定（FR-A3.2）：首位与次位差距 >= CHAOTIC_MARGIN → 恒纪元（稳定权重）；
 * 否则三体拉扯 → 乱纪元。
 */
export function classifyEra(weights) {
  const sorted = [weights.li, weights.shi, weights.de].sort((a, b) => b - a);
  const margin = sorted[0] - sorted[1];
  return { era: margin < CHAOTIC_MARGIN ? "chaotic" : "stable", margin };
}

/**
 * MODE 选择（FR-A3.1）：路由结果 + 三体权重 → MODE。
 * - direct 路由 → direct（快速查询）
 * - consensus 路由 → debate（高风险审议）
 * - 乱纪元（权重拉扯）→ full（综合任务）
 * - 恒纪元：主导体决定 —— 理体→research，实体→build，得体→debate
 */
export function selectMode(weights, route) {
  if (route === "direct") return "direct";
  if (route === "consensus") return "debate";
  const { era } = classifyEra(weights);
  if (era === "chaotic") return "full";
  if (weights.li >= weights.shi && weights.li >= weights.de) return "research";
  if (weights.shi >= weights.de) return "build";
  return "debate";
}

/**
 * 置信度随历史执行结果调整（FR-A3.4 纯计算部分）。
 * 无样本 → 原值；成功率 1 → 上浮 20%，成功率 0 → 下压 20%，线性内插。
 */
export function adjustConfidence(confidence, history) {
  const base = Math.min(Math.max(Number(confidence) || 0, 0), 1);
  if (!history || !Number.isFinite(history.samples) || history.samples <= 0) return base;
  const rate = Math.min(Math.max(history.successRate, 0), 1);
  // 0.8 + 0.4*rate 的浮点尾差会让 0.5*1.2 → 0.6000000000000001，先取整到 1e-9
  const factor = Math.round((0.8 + 0.4 * rate) * 1e9) / 1e9;
  return Math.min(Math.max(base * factor, 0), 1);
}

/**
 * 下游派发计划（本模块的核心出口，eto.ts 据此分支）：
 * - path: direct=单次回答 / pipeline=编排执行 / consensus=共识审议 / full=编排+深审
 * - steps: 流水线步骤（按 MODE 区分 research/build/full）
 * - reviewPeers / reworkRounds / reviewDepth: 审核配置（乱纪元自动加深，FR-A3.3）
 */
export function buildModeDispatch(route) {
  const mode = route.mode;
  const era = route.era;
  const chaotic = era === "chaotic";
  const path =
    mode === "direct" ? "direct" :
    mode === "debate" ? "consensus" :
    mode === "full" ? "full" :
    "pipeline";
  // direct 是单次快速回答：不编排、不审议，纪元不影响它
  if (path === "direct") {
    return {
      mode, era, path,
      coordinatorHint: COORDINATOR_HINT[mode],
      steps: [],
      reviewPeers: [],
      reworkRounds: 0,
      reviewDepth: "standard",
    };
  }
  return {
    mode,
    era,
    path,
    coordinatorHint: COORDINATOR_HINT[mode],
    steps: MODE_STEPS[mode],
    reviewPeers: chaotic ? DEEP_REVIEW_PEERS : STANDARD_REVIEW_PEERS[mode],
    reworkRounds: chaotic ? CHAOTIC_REWORK_ROUNDS : STABLE_REWORK_ROUNDS,
    reviewDepth: chaotic ? "deep" : "standard",
  };
}

/**
 * 便捷入口：任务 + 路由决策 → 带权重/MODE/纪元的完整路由结果。
 * llmWeights 可选：LLM 输出的原始权重，非法时降级到关键词推断。
 */
export function routeWithMode(task, route, llmWeights) {
  const weights = normalizeWeights(llmWeights) || deriveWeights(task);
  const { era } = classifyEra(weights);
  const mode = selectMode(weights, route);
  return { route, weights, era, mode };
}

/** 三体权重的单行展示（widget / 路由分析用） */
export function formatWeights(weights) {
  const pct = (x) => Math.round(x * 100);
  return `☀️理体 ${pct(weights.li)}% / 🌙实体 ${pct(weights.shi)}% / ⭐得体 ${pct(weights.de)}%`;
}
