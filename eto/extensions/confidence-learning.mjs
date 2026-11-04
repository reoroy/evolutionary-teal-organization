/**
 * confidence-learning.mjs — 置信度学习 / 路由历史回读（FR-A2.4）
 *
 * 纯函数 + 路径参数化 IO：eto.ts（Pi 扩展）与 tests/confidence-learning.test.mjs
 * 共用，沿用 mode-routing.mjs 的「逻辑独立成 .mjs + 双端 import」模式。
 *
 * 职责（docs/requirements.md FR-A2.4 / FR-A3.4 的回读部分）：
 * 1. 持久化每次路由的「预测」（gewu/route/MODE/权重/置信度/协调员）与「最终结果」
 *    （success | failure + 可观测原因），存 ~/.eto/memory/routing-history.jsonl
 * 2. 后续路由回读历史：同类任务（同 gewu）历史准确率低的 MODE 顺位降权、
 *    历史准确率低的 peer 在协调员选举中降分
 * 3. 每次调整产出结构化 adjustment（含样本数/成功率/前后值），可解释、非黑箱
 * 4. 默认保守：样本 < minSamples 或成功率 >= lowSuccessThreshold 一律不调整；
 *    peer 降分有下限（maxPeerDownweight），MODE 只顺位下移不跳档
 *
 * 「路由猜对了」的可观测判据（README「置信度学习」节同步维护）：
 * - plan+工作流：execute_workflow 的 success（所有步骤完成）
 * - plan+降级路径：共识终审通过与否
 * - plan+模糊指令：被指令澄清门拦截 → 预测错误
 * - consensus：终审 approved / revise
 * - direct：无失败信号（保守记正确，不参与 MODE 降权）
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, appendFileSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { selectMode } from "./mode-routing.mjs";

/** 默认学习配置：保守 —— 5 个样本起步、成功率 <40% 才动、peer 降分下限 0.5 */
export const DEFAULT_LEARNING_CONFIG = {
  enabled: true,
  minSamples: 5,
  lowSuccessThreshold: 0.4,
  maxPeerDownweight: 0.5,
};

const CONFIG_LIMITS = {
  minSamples: [1, 1000],
  lowSuccessThreshold: [0, 1],
  maxPeerDownweight: [0, 1],
};

/**
 * 合并用户配置（~/.pi/eto-config.json 的 router.learning 段）到默认值。
 * 非法值（非有限数、越界、enabled 非布尔）逐项回退默认，不整体失败。
 */
export function normalizeLearningConfig(raw) {
  const merged = { ...DEFAULT_LEARNING_CONFIG };
  if (!raw || typeof raw !== "object") return merged;
  if (typeof raw.enabled === "boolean") merged.enabled = raw.enabled;
  for (const key of Object.keys(CONFIG_LIMITS)) {
    const v = Number(raw[key]);
    if (!Number.isFinite(v)) continue;
    const [lo, hi] = CONFIG_LIMITS[key];
    if (v < lo || v > hi) continue;
    if (key === "minSamples" && !Number.isInteger(v)) continue;
    merged[key] = v;
  }
  return merged;
}

// ── 持久化（路径参数化：eto.ts 传真实路径，测试传临时路径） ──

function ensureDir(path) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * 记录一次路由预测。返回带 id/ts 的完整记录（id 供 appendOutcome 关联）。
 * 预测记录的 mode 是学习调整后的实际派发 MODE（统计口径 = 实际执行的模式）。
 */
export function appendPrediction(path, prediction) {
  ensureDir(path);
  const record = {
    type: "prediction",
    id: randomUUID(),
    ts: new Date().toISOString(),
    task: String(prediction.task ?? "").slice(0, 120),
    gewu: String(prediction.gewu ?? ""),
    route: String(prediction.route ?? ""),
    mode: String(prediction.mode ?? ""),
    weights: prediction.weights ?? null,
    confidence: Number(prediction.confidence ?? 0) || 0,
    coordinator: String(prediction.coordinator ?? ""),
    peers: Array.isArray(prediction.peers) ? prediction.peers.map(String) : [],
  };
  appendFileSync(path, JSON.stringify(record) + "\n", "utf-8");
  return record;
}

/** 补记某次预测的最终结果（success|failure）。同一 id 多条 outcome 时后者覆盖前者。 */
export function appendOutcome(path, id, outcome, reason) {
  if (!id) return null;
  if (outcome !== "success" && outcome !== "failure") return null;
  const record = {
    type: "outcome",
    id: String(id),
    ts: new Date().toISOString(),
    outcome,
    reason: String(reason ?? ""),
  };
  appendFileSync(path, JSON.stringify(record) + "\n", "utf-8");
  return record;
}

/** 清空学习历史（可回滚）：删除文件即从零开始。返回是否本来存在。 */
export function resetRoutingHistory(path) {
  const existed = existsSync(path);
  if (existed) unlinkSync(path);
  return { reset: true, existed };
}

/** 读取历史记录（JSONL）。坏行跳过，不因个别脏数据整体失败。 */
export function loadRoutingHistory(path) {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
  const records = [];
  for (const line of lines) {
    try { records.push(JSON.parse(line)); } catch { /* 坏行容忍 */ }
  }
  return records;
}

// ── 统计（纯函数） ──

function emptyStats() { return { samples: 0, successes: 0 }; }

function finalizeStats(map) {
  const out = {};
  for (const [key, s] of Object.entries(map)) {
    out[key] = {
      samples: s.samples,
      successRate: s.samples > 0 ? Math.round((s.successes / s.samples) * 1e9) / 1e9 : 0,
    };
  }
  return out;
}

/**
 * 折叠 records：prediction 建档、outcome 按 id 关联（后写覆盖先写）。
 * 只统计已有 success/failure 结果的预测；gewu 给定时只统计同类任务。
 * peer 维度按预测记录的 coordinator + peers 去重统计（同一预测内不重复计）。
 */
export function summarizeHistory(records, gewu) {
  const byId = new Map();
  for (const r of records) {
    if (!r || r.type === "prediction" && r.id) byId.set(String(r.id), { pred: r, outcome: null });
  }
  for (const r of records) {
    if (!r || r.type !== "outcome" || !r.id) continue;
    const entry = byId.get(String(r.id));
    if (entry && (r.outcome === "success" || r.outcome === "failure")) entry.outcome = r.outcome;
  }

  const overall = emptyStats();
  const modeStats = {};
  const peerStats = {};
  for (const { pred, outcome } of byId.values()) {
    if (!outcome) continue;
    if (gewu !== undefined && pred.gewu !== gewu) continue;
    const ok = outcome === "success";
    overall.samples++;
    if (ok) overall.successes++;
    const m = (modeStats[pred.mode] ??= emptyStats());
    m.samples++;
    if (ok) m.successes++;
    for (const peer of new Set([pred.coordinator, ...((pred.peers) || [])])) {
      if (!peer) continue;
      const p = (peerStats[peer] ??= emptyStats());
      p.samples++;
      if (ok) p.successes++;
    }
  }
  return {
    total: byId.size,
    overall: {
      samples: overall.samples,
      successRate: overall.samples > 0 ? Math.round((overall.successes / overall.samples) * 1e9) / 1e9 : 0,
    },
    modeStats: finalizeStats(modeStats),
    peerStats: finalizeStats(peerStats),
  };
}

/** 按 gewu 分组的完整统计（/routing-history 命令展示用）。 */
export function summarizeAll(records) {
  const gewus = new Set();
  for (const r of records) {
    if (r && r.type === "prediction" && r.gewu) gewus.add(String(r.gewu));
  }
  const byGewu = {};
  for (const g of [...gewus].sort()) byGewu[g] = summarizeHistory(records, g);
  return { byGewu, overall: summarizeHistory(records).overall };
}

// ── 回读调整（纯函数） ──

/**
 * MODE 顺位表：按当次三体权重把 research/build/debate 排序，full 永远垫底。
 * selectMode 的结果一定在表内（direct/consensus 除外，它们不走学习）。
 */
function modeLadder(weights) {
  const bodies = [["li", "research"], ["shi", "build"], ["de", "debate"]];
  const ranked = bodies
    .map(([k, mode]) => ({ mode, w: Number(weights?.[k]) || 0 }))
    .sort((a, b) => b.w - a.w)
    .map(x => x.mode);
  return [...ranked, "full"];
}

/**
 * MODE 降权（FR-A2.4 核心）：同类任务历史准确率低的 MODE 顺位下移。
 * 只降不升：从 selectMode 的正常结果出发，命中坏历史才顺位降级到下一个
 * 候选 MODE；full 已是最高强度模式，坏历史只记录（mode-at-floor）不降级。
 * direct / consensus 路由没有可切换的 MODE 空间，保守不动。
 */
export function selectModeWithLearning(weights, route, modeStats, config) {
  const base = selectMode(weights, route);
  if (!config || config.enabled === false) return { mode: base, adjustments: [] };
  if (route === "direct" || route === "consensus") return { mode: base, adjustments: [] };

  const ladder = modeLadder(weights);
  const start = ladder.indexOf(base);
  if (start === -1) return { mode: base, adjustments: [] };

  const adjustments = [];
  for (let i = start; i < ladder.length; i++) {
    const candidate = ladder[i];
    const s = modeStats ? modeStats[candidate] : null;
    const bad = s && s.samples >= config.minSamples && s.successRate < config.lowSuccessThreshold;
    if (!bad) return { mode: candidate, adjustments };
    if (i === ladder.length - 1) {
      // full 垫底也坏：无可再降，仅记录（保持可观测）
      adjustments.push({ kind: "mode-at-floor", mode: candidate, samples: s.samples, successRate: s.successRate });
      return { mode: candidate, adjustments };
    }
    const next = ladder[i + 1];
    adjustments.push({ kind: "mode-demotion", from: candidate, to: next, samples: s.samples, successRate: s.successRate });
  }
  return { mode: base, adjustments };
}

/**
 * peer 降权：协调员选举前对候选打历史折扣。
 * 因子 = max(maxPeerDownweight, 历史成功率)：成功率 0 也只打对折（保守下限），
 * 成功率 ≥ 阈值的 peer 不动。返回调整明细供路由分析展示。
 */
export function adjustCoordinatorCandidates(candidates, peerStats, config) {
  if (!Array.isArray(candidates)) return { candidates: [], adjustments: [] };
  if (!config || config.enabled === false) return { candidates, adjustments: [] };

  const adjustments = [];
  const adjusted = candidates.map(([name, score]) => {
    const s = peerStats ? peerStats[name] : null;
    const bad = s && s.samples >= config.minSamples && s.successRate < config.lowSuccessThreshold;
    if (!bad) return [name, score];
    const factor = Math.max(config.maxPeerDownweight, s.successRate);
    const to = Math.round(score * factor * 1e9) / 1e9;
    adjustments.push({ kind: "peer-downweight", peer: name, from: score, factor, to, samples: s.samples, successRate: s.successRate });
    return [name, to];
  });
  return { candidates: adjusted, adjustments };
}

// ── 可解释性输出 ──

const pct = (x) => Math.round((Number(x) || 0) * 100);

/** 每次调整一行人话，含样本数/成功率/前后值（不做黑箱优化）。 */
export function formatAdjustments(adjustments) {
  if (!Array.isArray(adjustments)) return [];
  const lines = [];
  for (const a of adjustments) {
    if (a.kind === "mode-demotion") {
      lines.push(`MODE ${a.from} 同类任务历史 ${a.samples} 次成功率 ${pct(a.successRate)}%（低于阈值）→ 降权改选 ${a.to}`);
    } else if (a.kind === "mode-at-floor") {
      lines.push(`MODE ${a.mode} 同类任务历史 ${a.samples} 次成功率 ${pct(a.successRate)}%，已是最高强度模式，仅记录不降级`);
    } else if (a.kind === "peer-downweight") {
      lines.push(`peer ${a.peer} 同类任务历史 ${a.samples} 次成功率 ${pct(a.successRate)}% → 选举分 ${a.from}→${a.to}（×${a.factor}）`);
    }
  }
  return lines;
}
