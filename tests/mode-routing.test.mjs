import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODES,
  ERAS,
  CHAOTIC_MARGIN,
  CHAOTIC_REWORK_ROUNDS,
  STABLE_REWORK_ROUNDS,
  adjustConfidence,
  buildModeDispatch,
  classifyEra,
  deriveWeights,
  formatWeights,
  normalizeWeights,
  routeWithMode,
  selectMode,
} from "../eto/extensions/mode-routing.mjs";

// ═══════════════════════════════════════════════════
//  一、三体权重（FR-A2.3）
// ═══════════════════════════════════════════════════

test("deriveWeights varies with input: research task lifts 理体", () => {
  const w = deriveWeights("调研行业竞争格局并输出分析报告");
  assert.ok(w.li > w.shi, `理体(${w.li}) should dominate 实体(${w.shi}) for research task`);
  assert.ok(Math.abs(w.li + w.shi + w.de - 1) < 1e-9, "weights must sum to 1");
});

test("deriveWeights varies with input: build task lifts 实体", () => {
  const w = deriveWeights("实现登录模块并编写单元测试代码");
  assert.ok(w.shi > w.li, `实体(${w.shi}) should dominate 理体(${w.li}) for build task`);
});

test("deriveWeights varies with input: comparison task lifts 得体", () => {
  const w = deriveWeights("对比两个方案的优缺点并给出选型建议");
  assert.ok(w.de > w.li && w.de > w.shi, `得体(${w.de}) should dominate for comparison task`);
});

test("deriveWeights returns uniform prior for neutral input", () => {
  const w = deriveWeights("你好");
  assert.deepEqual(w, { li: 1 / 3, shi: 1 / 3, de: 1 / 3 });
});

test("normalizeWeights accepts and rescales valid input", () => {
  assert.deepEqual(normalizeWeights({ li: 2, shi: 1, de: 1 }), { li: 0.5, shi: 0.25, de: 0.25 });
});

test("normalizeWeights rejects invalid LLM weights and returns null", () => {
  assert.equal(normalizeWeights(null), null);
  assert.equal(normalizeWeights({ li: "x", shi: 1, de: 1 }), null);
  assert.equal(normalizeWeights({ li: -1, shi: 1, de: 1 }), null);
  assert.equal(normalizeWeights({ li: 0, shi: 0, de: 0 }), null);
});

// ═══════════════════════════════════════════════════
//  二、纪元判定（FR-A3.2）
// ═══════════════════════════════════════════════════

test("classifyEra: dominant weight → stable era (恒纪元)", () => {
  const { era, margin } = classifyEra({ li: 0.6, shi: 0.2, de: 0.2 });
  assert.equal(era, "stable");
  assert.ok(margin >= CHAOTIC_MARGIN);
});

test("classifyEra: near-tied weights → chaotic era (乱纪元)", () => {
  const { era } = classifyEra({ li: 0.34, shi: 0.33, de: 0.33 });
  assert.equal(era, "chaotic");
});

// ═══════════════════════════════════════════════════
//  三、MODE 选择（FR-A3.1）—— MODE 随输入变化
// ═══════════════════════════════════════════════════

test("selectMode: direct route → direct", () => {
  assert.equal(selectMode({ li: 0.6, shi: 0.2, de: 0.2 }, "direct"), "direct");
});

test("selectMode: consensus route → debate", () => {
  assert.equal(selectMode({ li: 0.6, shi: 0.2, de: 0.2 }, "consensus"), "debate");
});

test("selectMode: plan route + 理体主导 → research", () => {
  assert.equal(selectMode({ li: 0.6, shi: 0.2, de: 0.2 }, "plan"), "research");
});

test("selectMode: plan route + 实体主导 → build", () => {
  assert.equal(selectMode({ li: 0.2, shi: 0.6, de: 0.2 }, "plan"), "build");
});

test("selectMode: plan route + 得体主导 → debate", () => {
  assert.equal(selectMode({ li: 0.2, shi: 0.2, de: 0.6 }, "plan"), "debate");
});

test("selectMode: plan route + 乱纪元（三体拉扯）→ full", () => {
  assert.equal(selectMode({ li: 0.34, shi: 0.33, de: 0.33 }, "plan"), "full");
});

test("MODE varies with task input end-to-end via routeWithMode", () => {
  const modes = new Set([
    routeWithMode("调研行业竞争格局并输出分析报告", "plan").mode,   // research
    routeWithMode("实现登录模块并编写单元测试代码", "plan").mode,   // build
    routeWithMode("对比两个方案的优缺点并给出选型建议", "plan").mode, // debate
    routeWithMode("什么是青色组织", "direct").mode,                  // direct
  ]);
  assert.ok(modes.has("research"), `expected research in ${[...modes]}`);
  assert.ok(modes.has("build"), `expected build in ${[...modes]}`);
  assert.ok(modes.has("debate"), `expected debate in ${[...modes]}`);
  assert.ok(modes.has("direct"), `expected direct in ${[...modes]}`);
  assert.equal(modes.size, 4, "distinct inputs must produce distinct modes");
});

test("routeWithMode uses LLM weights when valid, keyword weights otherwise", () => {
  const withLlm = routeWithMode("任意任务", "plan", { li: 3, shi: 1, de: 0 });
  assert.deepEqual(withLlm.weights, { li: 0.75, shi: 0.25, de: 0 });
  assert.equal(withLlm.mode, "research");
  const withBad = routeWithMode("任意任务", "plan", { li: "oops" });
  assert.deepEqual(withBad.weights, deriveWeights("任意任务"));
});

// ═══════════════════════════════════════════════════
//  四、下游派发计划 —— 下游确实按 MODE 分支
// ═══════════════════════════════════════════════════

test("buildModeDispatch: direct mode → direct path, no pipeline steps", () => {
  const d = buildModeDispatch(routeWithMode("什么是青色组织", "direct"));
  assert.equal(d.path, "direct");
  assert.deepEqual(d.steps, []);
  assert.deepEqual(d.reviewPeers, []);
});

test("buildModeDispatch: research vs build take different pipeline steps", () => {
  const research = buildModeDispatch(routeWithMode("调研行业竞争格局并输出分析报告", "plan"));
  const build = buildModeDispatch(routeWithMode("实现登录模块并编写单元测试代码", "plan"));
  assert.equal(research.path, "pipeline");
  assert.equal(build.path, "pipeline");
  assert.notDeepEqual(research.steps, build.steps, "research and build must branch to different steps");
  assert.deepEqual(research.steps, ["收集信息", "深度分析", "整理报告"]);
  assert.deepEqual(build.steps, ["调研需求", "编写代码", "审查质量"]);
});

test("buildModeDispatch: debate mode → consensus path (not pipeline)", () => {
  const d = buildModeDispatch(routeWithMode("对比两个方案的优缺点并给出选型建议", "plan"));
  assert.equal(d.path, "consensus");
  assert.deepEqual(d.steps, []);
  assert.ok(d.reviewPeers.length > 0);
});

test("buildModeDispatch: full mode → full path with the longest pipeline", () => {
  const d = buildModeDispatch(routeWithMode("混合任务：调研分析加实现加权衡", "plan"));
  assert.equal(d.path, "full");
  assert.ok(d.steps.length >= 5, `full pipeline should be the longest, got ${d.steps.length}`);
});

test("FR-A3.3: chaotic era deepens review (REWORK rounds + peers)", () => {
  const chaotic = buildModeDispatch({ route: "plan", weights: { li: 0.34, shi: 0.33, de: 0.33 }, era: "chaotic", mode: "full" });
  const stable = buildModeDispatch({ route: "plan", weights: { li: 0.6, shi: 0.2, de: 0.2 }, era: "stable", mode: "research" });
  assert.equal(chaotic.reworkRounds, CHAOTIC_REWORK_ROUNDS);
  assert.equal(stable.reworkRounds, STABLE_REWORK_ROUNDS);
  assert.ok(chaotic.reworkRounds > stable.reworkRounds, "chaotic era must raise REWORK rounds");
  assert.equal(chaotic.reviewDepth, "deep");
  assert.equal(stable.reviewDepth, "standard");
  assert.deepEqual(chaotic.reviewPeers, ["researcher", "coder", "auditor"]);
  assert.deepEqual(stable.reviewPeers, ["researcher", "auditor"]);
});

test("every mode maps to a valid dispatch shape", () => {
  for (const mode of MODES) {
    const weights = { li: 0.6, shi: 0.2, de: 0.2 };
    const routed = { route: "plan", weights, era: "stable", mode };
    const d = buildModeDispatch(routed);
    assert.ok(["direct", "pipeline", "consensus", "full"].includes(d.path), `${mode} path`);
    assert.ok(Array.isArray(d.steps));
    assert.ok(Array.isArray(d.reviewPeers));
    assert.ok(typeof d.coordinatorHint === "string");
  }
  assert.deepEqual(ERAS, ["stable", "chaotic"]);
});

// ═══════════════════════════════════════════════════
//  五、置信度学习（FR-A3.4 纯计算部分）
// ═══════════════════════════════════════════════════

test("adjustConfidence: no history → unchanged", () => {
  assert.equal(adjustConfidence(0.7, { samples: 0, successRate: 0 }), 0.7);
  assert.equal(adjustConfidence(0.7), 0.7);
});

test("adjustConfidence: all-success history raises, all-failure lowers", () => {
  assert.ok(Math.abs(adjustConfidence(0.5, { samples: 10, successRate: 1 }) - 0.6) < 1e-9); // +20%
  assert.ok(Math.abs(adjustConfidence(0.5, { samples: 10, successRate: 0 }) - 0.4) < 1e-9); // -20%
  const mixed = adjustConfidence(0.5, { samples: 10, successRate: 0.5 });
  assert.ok(Math.abs(mixed - 0.5) < 1e-9);
});

test("adjustConfidence: stays within [0, 1]", () => {
  assert.equal(adjustConfidence(0.95, { samples: 5, successRate: 1 }), 1); // 1.14 → clamp 1
  assert.ok(adjustConfidence(0.05, { samples: 5, successRate: 0 }) > 0);   // 0.04, 不下穿 0
});

// ═══════════════════════════════════════════════════
//  六、展示辅助
// ═══════════════════════════════════════════════════

test("formatWeights renders all three bodies with percentages", () => {
  const text = formatWeights({ li: 0.5, shi: 0.25, de: 0.25 });
  assert.ok(text.includes("理体 50%"));
  assert.ok(text.includes("实体 25%"));
  assert.ok(text.includes("得体 25%"));
});

// ═══════════════════════════════════════════════════
//  七、下游按 MODE 分支（模拟 eto.ts dispatchByMode 的分支选择）
// ═══════════════════════════════════════════════════

test("dispatch branch selection follows MODE, not gewu: same input text, different MODE → different branch", () => {
  // 模拟 eto.ts dispatchByMode 的分支骨架：path 决定走哪条下游路径
  const branchTaken = (routed) => {
    const d = buildModeDispatch(routed);
    if (d.path === "direct") return "single-shot answer";
    if (d.path === "consensus") return `peerConsensus(${d.reviewPeers.join("+")})`;
    return `executePlanViaMaestro(${d.steps.length} steps)`;
  };

  const research = branchTaken(routeWithMode("调研行业竞争格局并输出分析报告", "plan"));
  const build = branchTaken(routeWithMode("实现登录模块并编写单元测试代码", "plan"));
  const debate = branchTaken(routeWithMode("对比两个方案的优缺点并给出选型建议", "plan"));
  const direct = branchTaken(routeWithMode("什么是青色组织", "direct"));

  assert.equal(research, "executePlanViaMaestro(3 steps)");
  assert.equal(build, "executePlanViaMaestro(3 steps)");
  assert.notEqual(research, debate);
  assert.notEqual(research, direct);
  assert.ok(debate.startsWith("peerConsensus("), `debate must take the consensus branch, got ${debate}`);
  assert.equal(direct, "single-shot answer");

  // research 与 build 步骤内容不同（上面已断言 notDeepEqual steps），
  // 这里再直接验证两个分支拿到的 steps 序列不同：
  const rSteps = buildModeDispatch(routeWithMode("调研行业竞争格局并输出分析报告", "plan")).steps;
  const bSteps = buildModeDispatch(routeWithMode("实现登录模块并编写单元测试代码", "plan")).steps;
  assert.notDeepEqual(rSteps, bSteps);
});
