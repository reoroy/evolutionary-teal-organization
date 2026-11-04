import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_LEARNING_CONFIG,
  adjustCoordinatorCandidates,
  appendOutcome,
  appendPrediction,
  formatAdjustments,
  loadRoutingHistory,
  normalizeLearningConfig,
  resetRoutingHistory,
  selectModeWithLearning,
  summarizeAll,
  summarizeHistory,
} from "../eto/extensions/confidence-learning.mjs";
import { deriveWeights, routeWithMode, buildModeDispatch } from "../eto/extensions/mode-routing.mjs";

// 每个测试用独立临时目录，互不污染，也不碰真实 ~/.eto
function freshHistoryPath() {
  const dir = mkdtempSync(join(tmpdir(), "eto-routing-history-"));
  return { dir, path: join(dir, "routing-history.jsonl") };
}

/** 喂一组「总是猜错」的历史：同 gewu、同 MODE 的预测全部 failure */
function feedAlwaysWrong(path, { gewu = "code", mode = "build", peers = ["coder"], n = 5 } = {}) {
  for (let i = 0; i < n; i++) {
    const pred = appendPrediction(path, {
      task: `历史任务 ${i}`, gewu, route: "plan", mode,
      weights: { li: 0.2, shi: 0.6, de: 0.2 }, confidence: 0.85,
      coordinator: peers[0], peers,
    });
    appendOutcome(path, pred.id, "failure", "workflow:1 步失败");
  }
}

// ═══════════════════════════════════════════════════
//  一、持久化：预测与最终结果落盘（FR-A2.4 要求 2）
// ═══════════════════════════════════════════════════

test("appendPrediction persists the full prediction record to JSONL", () => {
  const { dir, path } = freshHistoryPath();
  try {
    const rec = appendPrediction(path, {
      task: "实现登录模块", gewu: "code", route: "plan", mode: "build",
      weights: { li: 0.2, shi: 0.6, de: 0.2 }, confidence: 0.85,
      coordinator: "coder", peers: ["coder", "auditor"],
    });
    assert.ok(existsSync(path), "history file must be created");
    assert.equal(rec.type, "prediction");
    assert.ok(rec.id, "prediction must carry an id for outcome correlation");
    const onDisk = loadRoutingHistory(path);
    assert.equal(onDisk.length, 1);
    assert.equal(onDisk[0].mode, "build");
    assert.equal(onDisk[0].gewu, "code");
    assert.deepEqual(onDisk[0].peers, ["coder", "auditor"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("appendOutcome links outcome to prediction by id; last write wins", () => {
  const { dir, path } = freshHistoryPath();
  try {
    const pred = appendPrediction(path, {
      task: "t", gewu: "code", route: "plan", mode: "build",
      coordinator: "coder", peers: ["coder"],
    });
    assert.ok(appendOutcome(path, pred.id, "failure", "workflow:2 步失败"));
    assert.ok(appendOutcome(path, pred.id, "success", "workflow:0 步失败")); // 后写覆盖
    const stats = summarizeHistory(loadRoutingHistory(path), "code");
    assert.equal(stats.overall.samples, 1);
    assert.equal(stats.overall.successRate, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("appendOutcome rejects invalid outcome values", () => {
  const { dir, path } = freshHistoryPath();
  try {
    assert.equal(appendOutcome(path, "any-id", "bogus", ""), null);
    assert.equal(appendOutcome(path, "", "success", ""), null);
    assert.equal(loadRoutingHistory(path).length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("loadRoutingHistory tolerates corrupted lines without failing", () => {
  const { dir, path } = freshHistoryPath();
  try {
    appendPrediction(path, { task: "t", gewu: "code", route: "plan", mode: "build", coordinator: "coder" });
    appendFileSync(path, "{not json\n", "utf-8");
    assert.equal(loadRoutingHistory(path).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ═══════════════════════════════════════════════════
//  二、清空 / 回滚机制（FR-A2.4 注意事项）
// ═══════════════════════════════════════════════════

test("resetRoutingHistory deletes the file; routing restarts from zero", () => {
  const { dir, path } = freshHistoryPath();
  try {
    feedAlwaysWrong(path);
    assert.ok(summarizeHistory(loadRoutingHistory(path), "code").overall.samples > 0);
    const r1 = resetRoutingHistory(path);
    assert.deepEqual(r1, { reset: true, existed: true });
    assert.equal(existsSync(path), false);
    assert.equal(loadRoutingHistory(path).length, 0);
    assert.deepEqual(summarizeHistory([], "code").overall, { samples: 0, successRate: 0 });
    const r2 = resetRoutingHistory(path); // 幂等：不存在也不报错
    assert.deepEqual(r2, { reset: true, existed: false });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ═══════════════════════════════════════════════════
//  三、统计口径（同类任务 = 同 gewu；peer 维度去重）
// ═══════════════════════════════════════════════════

test("summarizeHistory filters by gewu: other-task history does not leak in", () => {
  const { dir, path } = freshHistoryPath();
  try {
    feedAlwaysWrong(path, { gewu: "code", mode: "build", peers: ["coder"], n: 3 });
    const okPred = appendPrediction(path, {
      task: "调研", gewu: "research", route: "plan", mode: "research", coordinator: "researcher", peers: ["researcher"],
    });
    appendOutcome(path, okPred.id, "success", "workflow:0");
    const codeStats = summarizeHistory(loadRoutingHistory(path), "code");
    const researchStats = summarizeHistory(loadRoutingHistory(path), "research");
    assert.equal(codeStats.overall.samples, 3);
    assert.equal(codeStats.overall.successRate, 0);
    assert.equal(researchStats.overall.samples, 1);
    assert.equal(researchStats.overall.successRate, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("peer stats dedupe within one prediction (coordinator also listed as peer)", () => {
  const { dir, path } = freshHistoryPath();
  try {
    const pred = appendPrediction(path, {
      task: "t", gewu: "code", route: "plan", mode: "build",
      coordinator: "coder", peers: ["coder", "coder", "auditor"],
    });
    appendOutcome(path, pred.id, "failure", "x");
    const stats = summarizeHistory(loadRoutingHistory(path), "code");
    assert.equal(stats.peerStats.coder.samples, 1); // 同一预测内去重
    assert.equal(stats.peerStats.auditor.samples, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("predictions without outcome are not counted; summarizeAll groups by gewu", () => {
  const { dir, path } = freshHistoryPath();
  try {
    feedAlwaysWrong(path, { gewu: "code", n: 2 });
    appendPrediction(path, { task: "pending", gewu: "code", route: "plan", mode: "build", coordinator: "coder" }); // 无 outcome
    const all = summarizeAll(loadRoutingHistory(path));
    assert.equal(all.overall.samples, 2); // 只有已判定的
    assert.deepEqual(Object.keys(all.byGewu), ["code"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ═══════════════════════════════════════════════════
//  四、MODE 降权 —— 「总是猜错」历史确实改变路由选择（FR-A2.4 要求 3/4）
// ═══════════════════════════════════════════════════

const CONFIG = DEFAULT_LEARNING_CONFIG; // minSamples: 5, lowSuccessThreshold: 0.4
const taskWeights = deriveWeights("实现登录模块并编写单元测试代码"); // 实体主导 → base MODE=build

test("MODE demotion: always-wrong history for build flips routing to the next rung", () => {
  const { dir, path } = freshHistoryPath();
  try {
    feedAlwaysWrong(path, { gewu: "code", mode: "build", peers: ["coder"], n: 5 });
    const stats = summarizeHistory(loadRoutingHistory(path), "code");
    const learned = selectModeWithLearning(taskWeights, "plan", stats.modeStats, CONFIG);
    const baseline = selectModeWithLearning(taskWeights, "plan", stats.modeStats, { ...CONFIG, enabled: false });
    assert.equal(baseline.mode, "build", "前置条件：无学习时 build 是正常 MODE");
    assert.notEqual(learned.mode, baseline.mode, "历史必须改变 MODE 选择");
    // build 坏 → 顺位下移到按权重排序的下一档（实体主导 → research）
    assert.equal(learned.mode, "research");
    assert.ok(learned.adjustments.length > 0);
    assert.equal(learned.adjustments[0].kind, "mode-demotion");
    assert.equal(learned.adjustments[0].from, "build");
    assert.equal(learned.adjustments[0].samples, 5);
    assert.equal(learned.adjustments[0].successRate, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("MODE demotion cascades when the fallback MODE is also always-wrong", () => {
  const { dir, path } = freshHistoryPath();
  try {
    // 梯子（实体主导权重）：build → research → debate → full
    feedAlwaysWrong(path, { gewu: "code", mode: "build", n: 5 });
    feedAlwaysWrong(path, { gewu: "code", mode: "research", n: 5 });
    const stats = summarizeHistory(loadRoutingHistory(path), "code");
    const learned = selectModeWithLearning(taskWeights, "plan", stats.modeStats, CONFIG);
    assert.equal(learned.mode, "debate"); // build 坏 → research 也坏 → debate
    assert.equal(learned.adjustments.length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("full is the floor: all-rung-wrong history keeps full and records mode-at-floor", () => {
  const { dir, path } = freshHistoryPath();
  try {
    for (const mode of ["build", "debate", "research", "full"]) {
      feedAlwaysWrong(path, { gewu: "code", mode, n: 5 });
    }
    const stats = summarizeHistory(loadRoutingHistory(path), "code");
    const learned = selectModeWithLearning(taskWeights, "plan", stats.modeStats, CONFIG);
    assert.equal(learned.mode, "full");
    assert.equal(learned.adjustments.at(-1).kind, "mode-at-floor");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("end-to-end dispatch actually changes: same task, bad vs empty history → different dispatch", () => {
  const { dir, path } = freshHistoryPath();
  try {
    feedAlwaysWrong(path, { gewu: "code", mode: "build", n: 5 });
    const stats = summarizeHistory(loadRoutingHistory(path), "code");

    const bad = selectModeWithLearning(taskWeights, "plan", stats.modeStats, CONFIG);
    const clean = selectModeWithLearning(taskWeights, "plan", { build: { samples: 0, successRate: 0 } }, CONFIG);

    const dispatchBad = buildModeDispatch({ ...routeWithMode("实现登录模块并编写单元测试代码", "plan"), mode: bad.mode });
    const dispatchClean = buildModeDispatch({ ...routeWithMode("实现登录模块并编写单元测试代码", "plan"), mode: clean.mode });

    assert.equal(clean.mode, "build");
    assert.equal(bad.mode, "research");
    assert.notDeepEqual(dispatchBad, dispatchClean, "下游派发计划必须因历史而不同");
    assert.equal(dispatchClean.path, "pipeline");
    assert.equal(dispatchBad.path, "pipeline"); // MODE=research 仍走流水线但步骤不同（调研三步 vs 构建三步）
    assert.notDeepEqual(dispatchClean.steps, dispatchBad.steps);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("conservative: below minSamples or above threshold → no adjustment", () => {
  const { dir, path } = freshHistoryPath();
  try {
    feedAlwaysWrong(path, { gewu: "code", mode: "build", n: CONFIG.minSamples - 1 }); // 样本不足
    const few = summarizeHistory(loadRoutingHistory(path), "code");
    assert.deepEqual(
      selectModeWithLearning(taskWeights, "plan", few.modeStats, CONFIG),
      { mode: "build", adjustments: [] },
      "样本不足不得调整（默认保守）"
    );

    const okPreds = [];
    for (let i = 0; i < 5; i++) {
      okPreds.push(appendPrediction(path, { task: `t${i}`, gewu: "code", route: "plan", mode: "build", coordinator: "coder" }));
    }
    for (const p of okPreds) appendOutcome(path, p.id, "success", "ok"); // 成功率 1.0
    const good = summarizeHistory(loadRoutingHistory(path), "code");
    assert.deepEqual(
      selectModeWithLearning(taskWeights, "plan", good.modeStats, CONFIG),
      { mode: "build", adjustments: [] },
      "高成功率不得调整"
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("disabled config never adjusts; direct/consensus routes are exempt", () => {
  const { dir, path } = freshHistoryPath();
  try {
    feedAlwaysWrong(path, { gewu: "code", mode: "build", n: 10 });
    const stats = summarizeHistory(loadRoutingHistory(path), "code");
    const off = { ...CONFIG, enabled: false };
    assert.deepEqual(selectModeWithLearning(taskWeights, "plan", stats.modeStats, off), { mode: "build", adjustments: [] });
    // direct / consensus 路由没有 MODE 切换空间，即使历史全坏也不动
    assert.deepEqual(selectModeWithLearning(taskWeights, "direct", stats.modeStats, CONFIG), { mode: "direct", adjustments: [] });
    assert.deepEqual(selectModeWithLearning(taskWeights, "consensus", stats.modeStats, CONFIG), { mode: "debate", adjustments: [] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ═══════════════════════════════════════════════════
//  五、peer 降权（协调员选举）
// ═══════════════════════════════════════════════════

test("peer downweight: always-wrong peer loses election score with a floor", () => {
  const { dir, path } = freshHistoryPath();
  try {
    feedAlwaysWrong(path, { gewu: "code", peers: ["coder"], n: 5 });
    const stats = summarizeHistory(loadRoutingHistory(path), "code");
    const candidates = [["coder", 0.9], ["researcher", 0.6], ["auditor", 0.6]];
    const { candidates: adjusted, adjustments } = adjustCoordinatorCandidates(candidates, stats.peerStats, CONFIG);
    const byName = Object.fromEntries(adjusted);
    assert.ok(byName.coder < 0.9, "坏历史 peer 必须被降分");
    assert.equal(byName.coder, 0.9 * Math.max(CONFIG.maxPeerDownweight, 0)); // 成功率 0 → 下限 0.5
    assert.equal(byName.coder, 0.45);
    assert.equal(byName.researcher, 0.6, "无历史 peer 不动");
    assert.equal(adjustments.length, 1);
    assert.equal(adjustments[0].kind, "peer-downweight");
    assert.equal(adjustments[0].peer, "coder");
    // 降分后选举排序翻转：researcher(0.6) > coder(0.45)
    assert.ok(byName.researcher > byName.coder, "降权必须能改变选举结果");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("peer downweight is multiplicative on success rate, floored and disabled-safe", () => {
  const peerStats = { coder: { samples: 10, successRate: 0.3 } };
  const { candidates } = adjustCoordinatorCandidates([["coder", 0.8]], peerStats, CONFIG);
  // 因子 = max(maxPeerDownweight=0.5, successRate=0.3) = 0.5 → 0.8×0.5 = 0.4
  assert.equal(candidates[0][1], 0.4);
  const off = adjustCoordinatorCandidates([["coder", 0.8]], peerStats, { ...CONFIG, enabled: false });
  assert.equal(off.candidates[0][1], 0.8);
  assert.deepEqual(off.adjustments, []);
});

test("candidate order preserved after adjustment (stable mapping)", () => {
  const peerStats = { researcher: { samples: 8, successRate: 0.1 } };
  const { candidates } = adjustCoordinatorCandidates([["researcher", 0.9], ["coder", 0.5]], peerStats, CONFIG);
  assert.equal(candidates[0][0], "researcher");
  assert.equal(candidates[1][0], "coder");
  assert.equal(candidates[0][1], 0.45);
  assert.equal(candidates[1][1], 0.5);
});

// ═══════════════════════════════════════════════════
//  六、配置归一化（默认保守）
// ═══════════════════════════════════════════════════

test("normalizeLearningConfig: defaults are conservative; user values merge; invalid rejected", () => {
  assert.deepEqual(DEFAULT_LEARNING_CONFIG, { enabled: true, minSamples: 5, lowSuccessThreshold: 0.4, maxPeerDownweight: 0.5 });
  assert.deepEqual(normalizeLearningConfig(null), DEFAULT_LEARNING_CONFIG);
  assert.deepEqual(normalizeLearningConfig({}), DEFAULT_LEARNING_CONFIG);
  assert.deepEqual(
    normalizeLearningConfig({ enabled: false, minSamples: 3, lowSuccessThreshold: 0.7, maxPeerDownweight: 0.8 }),
    { enabled: false, minSamples: 3, lowSuccessThreshold: 0.7, maxPeerDownweight: 0.8 }
  );
  // 非法值逐项回退默认，不整体失败
  assert.deepEqual(normalizeLearningConfig({ minSamples: "x", lowSuccessThreshold: -1, maxPeerDownweight: 2, enabled: "yes" }),
    DEFAULT_LEARNING_CONFIG);
  assert.equal(normalizeLearningConfig({ minSamples: 2.5 }).minSamples, 5); // 非整数拒绝
});

// ═══════════════════════════════════════════════════
//  七、可解释性：每次调整都能说明依据（非黑箱）
// ═══════════════════════════════════════════════════

test("formatAdjustments renders one human-readable line per adjustment with evidence", () => {
  const lines = formatAdjustments([
    { kind: "mode-demotion", from: "build", to: "debate", samples: 5, successRate: 0 },
    { kind: "peer-downweight", peer: "coder", from: 0.9, factor: 0.5, to: 0.45, samples: 5, successRate: 0.2 },
    { kind: "mode-at-floor", mode: "full", samples: 6, successRate: 0.3 },
  ]);
  assert.equal(lines.length, 3);
  assert.ok(lines[0].includes("build") && lines[0].includes("debate") && lines[0].includes("5 次"));
  assert.ok(lines[1].includes("coder") && lines[1].includes("0.9→0.45"));
  assert.ok(lines[2].includes("full") && lines[2].includes("已是最高强度模式"));
  assert.deepEqual(formatAdjustments([]), []);
  assert.deepEqual(formatAdjustments(undefined), []);
});

// ═══════════════════════════════════════════════════
//  八、闭环验证：历史 → 路由变化 → 新历史（模拟 eto.ts 的完整回路）
// ═══════════════════════════════════════════════════

test("full loop: record → learn → route differently → reset → route as before", () => {
  const { dir, path } = freshHistoryPath();
  try {
    const routeOnce = () => {
      const stats = summarizeHistory(loadRoutingHistory(path), "code");
      const learned = selectModeWithLearning(taskWeights, "plan", stats.modeStats, CONFIG);
      // 模拟 eto.ts：预测记录的是学习调整后的实际派发 MODE
      const pred = appendPrediction(path, {
        task: "实现登录模块并编写单元测试代码", gewu: "code", route: "plan",
        mode: learned.mode, weights: taskWeights, confidence: 0.85,
        coordinator: "coder", peers: ["coder"],
      });
      return { learned, predId: pred.id };
    };

    // 第 1 次：无历史 → 正常 build，结果失败
    const first = routeOnce();
    assert.equal(first.learned.mode, "build");
    appendOutcome(path, first.predId, "failure", "workflow:1 步失败");

    // 喂到阈值之上的坏历史（同 MODE build）
    for (let i = 0; i < CONFIG.minSamples; i++) {
      const p = appendPrediction(path, { task: `t${i}`, gewu: "code", route: "plan", mode: "build", coordinator: "coder" });
      appendOutcome(path, p.id, "failure", "workflow:1 步失败");
    }

    // 第 2 次：同类任务历史全错 → MODE 变化，且预测记录的是新 MODE
    const second = routeOnce();
    assert.equal(second.learned.mode, "research");
    assert.equal(loadRoutingHistory(path).at(-1).mode, "research");
    assert.ok(second.learned.adjustments.length > 0);

    // 清空后：回到从零开始
    resetRoutingHistory(path);
    const third = routeOnce();
    assert.equal(third.learned.mode, "build");
    assert.deepEqual(third.learned.adjustments, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
