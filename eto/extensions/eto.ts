/**
 * ETO — Evolutionary Teal Organization
 * Pi CLI 扩展：三镜路由 + 协调员选举 + 同侪共识 + 智子安检
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execSync } from "child_process";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { buildPreviewPlan, compileRulePattern, executePreviewPlan } from "./sentinel-preview.mjs";
import { adjustConfidence, buildModeDispatch, formatWeights, normalizeWeights, routeWithMode, type Era, type Mode, type ModeDispatch, type ThreeBodyWeights } from "./mode-routing.mjs";

// ═══════════════════════════════════════════════════
//  Agent Profile + Skills + Metrics
// ═══════════════════════════════════════════════════

interface AgentProfile {
  name: string;
  label: string;
  specialty: string;
  description: string;
  weights: Record<string, number>;
  maxSubtasks: number;
}

function loadProfiles(): AgentProfile[] {
  const profilePath = join(findStitchesDir(), "profiles.json");
  try {
    return JSON.parse(readFileSync(profilePath, "utf-8"));
  } catch {
    return [
      { name: "researcher", label: "研究员", specialty: "research", description: "", weights: {}, maxSubtasks: 2 },
      { name: "coder", label: "编码员", specialty: "code", description: "", weights: {}, maxSubtasks: 3 },
      { name: "auditor", label: "审计员", specialty: "solution", description: "", weights: {}, maxSubtasks: 1 },
    ];
  }
}

const AGENT_PROFILES = loadProfiles();

async function tryBidding(task: string, gewu: string): Promise<{ winner: AgentProfile; confidence: number; bids: any[] } | null> {
  const taskSpec = JSON.stringify({ type: gewu, title: task.slice(0, 100), description: task.slice(0, 200) });
  const profiles = JSON.stringify(AGENT_PROFILES.map(p => ({ name: p.name, specialty: p.specialty, label: p.label, weights: p.weights })));
  const result = await callStitchAsync("bidding.protocol", "run_bidding", taskSpec, profiles);
  if (!result || "_error" in result || (result as any).fallback) return null;
  const winner = AGENT_PROFILES.find(p => p.name === (result as any).winner?.name);
  return winner ? { winner, confidence: (result as any).confidence as number, bids: (result as any).bids as any[] } : null;
}

function matchAgentsForRoute(gewu: string): AgentProfile[] {
  return AGENT_PROFILES
    .map(p => ({ profile: p, score: p.weights[gewu] || 0 }))
    .filter(x => x.score >= 0.3)
    .sort((a, b) => b.score - a.score)
    .map(x => x.profile);
}

function synthesizeSummary(task: string, route: RouteResult, agents: AgentProfile[]): string {
  return [
    `## ETO 执行总结`,
    ``,
    `目标: ${task}`,
    `路由: ${route.gewu} → ${route.route} (${route.layer} ${(route.confidence * 100).toFixed(0)}%)`,
    `三体: ${formatWeights(route.weights)} | 纪元: ${route.era === "chaotic" ? "乱纪元" : "恒纪元"}`,
    `MODE: ${route.mode} (dispatch: ${route.dispatch.path}, 审核深度: ${route.dispatch.reviewDepth})`,
    `协调员: ${route.coordinator}`,
    `执行 Agent: ${agents.map(a => a.label).join("、")}`,
  ].join("\n");
}

// ═══════════════════════════════════════════════════
//  Skill Memory — JSONL 加载
// ═══════════════════════════════════════════════════

interface SkillEntry {
  skill_name: string;
  context: string;
  reward: number;
  source: string;
}

function loadSkills(minReward = 0.3): SkillEntry[] {
  try {
    const p = join(require("os").homedir(), ".eto", "memory", "skills.jsonl");
    if (!existsSync(p)) return [];
    const text = readFileSync(p, "utf-8");
    return text.split("\n").filter(Boolean).map(l => JSON.parse(l)).filter((s: SkillEntry) => s.reward >= minReward);
  } catch { return []; }
}

function matchSkillsForRoute(gewu: string): SkillEntry[] {
  const skills = loadSkills();
  return skills.filter(s => s.context.toLowerCase().includes(gewu)).slice(0, 3);
}

// ═══════════════════════════════════════════════════
//  Metrics — 记录路由/Agent 统计
// ═══════════════════════════════════════════════════

function writeMetric(route: string, agent: string, success: boolean, steps = 0, duration = 0): void {
  try {
    const p = join(require("os").homedir(), ".eto", "memory", "metrics.jsonl");
    const dir = join(require("os").homedir(), ".eto", "memory");
    if (!existsSync(dir)) { (require("fs") as typeof import("fs")).mkdirSync(dir, { recursive: true }); }
    const entry = JSON.stringify({ route, agent, success, steps, duration, timestamp: new Date().toISOString() }) + "\n";
    (require("fs") as typeof import("fs")).appendFileSync(p, entry, "utf-8");
  } catch {}
}

const AGENT_PROMPT = [
  `Communication:`,
  `- Lead with the verdict, then the evidence.`,
  `- No filler: no celebration, no apologies, no 'notably'.`,
  `- Clipped while working, complete at boundaries.`,
  `- Don't create planning docs unless asked.`,
  ``,
  `Action Safety:`,
  `- Audit each claim against actual output.`,
  `- Call a flaw a mistake and fix it — don't relabel.`,
  `- Missing context → ask, don't invent.`,
  ``,
  `Tone:`,
  `- No emojis unless requested.`,
  `- 'Done' is hypothetical until verified.`,
];

// ── Fable Mode — 复杂任务注入工程方法论 ──

function loadFablePrompt(): string {
  // 1. 项目本地（git 仓库自带）
  try {
    const local = join(__dirname, "..", "..", "docs", "fable-mode.md");
    if (existsSync(local)) return readFileSync(local, "utf-8");
  } catch { /* fallback */ }
  // 2. 全局 Claude 配置
  try {
    const global = join(require("os").homedir(), ".claude", "commands", "fable-mode.md");
    if (existsSync(global)) return readFileSync(global, "utf-8");
  } catch { /* fallback */ }
  return `你运行在 Fable 模式下。
原则：
- 简单优先、读通再改、测试定锚、平铺好过嵌套
- 先结论再证据，无填充语
步骤：
1. 理解需求 2. 设计测试 3. 实现 4. 验证 5. 重构`;
}

function isComplexTask(task: string): boolean {
  const signals = ["重构", "架构", "迁移", "优化", "安全", "并发", "分布式", "调试", "性能", "兼容", "降级", "回滚", "容错", "熔断", "refactor", "migrate", "optimize", "security", "concurrent", "distributed", "debug", "performance", "compat", "rollback", "fault", "circuit"];
  const t = task.toLowerCase();
  return signals.some(s => t.includes(s.toLowerCase()));
}

function decomposePrompt(agents: AgentProfile[]): string {
  const lines = agents.map(a => `- ${a.name} (${a.label}): ${a.description}`);
  return [
    `可用 Agent：`,
    ...lines,
    ``,
    ...AGENT_PROMPT,
    ``,
    `执行要求：`,
    `1. 将任务拆解成不超过 ${agents.length} 个子任务`,
    `2. 每个子任务标注由哪个 Agent 执行`,
    `3. 按顺序执行，前一步输出传递给下一步`,
    `4. 每完成一步输出 >> Step N (Agent: xxx)`,
    `5. 全部完成后输出：`,
    `====END====`,
    `工作总结：`,
    `- 目标: [任务]`,
    `- 执行者: [Agent列表]`,
    `- 完成步骤: [N步]`,
    `- 改动文件: [清单]`,
    `- 结果: [摘要]`,
  ].join("\n");
}

// ═══════════════════════════════════════════════════
//  一、三镜路由
// ═══════════════════════════════════════════════════

type Route = "direct" | "plan" | "consensus";
/** 路由层产出（weights 可选：LLM 给了就有，否则 finalizeRoute 关键词推断） */
interface BaseRoute {
  gewu: string; route: Route; confidence: number;
  coordinator: string; layer: string;
  weights?: unknown;
}
/** FR-A2.3 / FR-A3：补全三体权重 + 纪元 + MODE + 派发计划后的路由结果 */
interface RouteResult extends BaseRoute {
  weights: ThreeBodyWeights;
  era: Era;
  mode: Mode;
  dispatch: ModeDispatch;
}

const GEWU_MAP: Record<string, string> = {
  knowledge: "knowledge", question: "knowledge", definition: "knowledge",
  code: "code", coding: "code", programming: "code",
  research: "research", study: "research", analysis: "research",
  solution: "solution", problem: "solution", design: "solution",
};
const ROUTE_MAP: Record<string, Route> = {
  direct: "direct", simple: "direct",
  plan: "plan", multi_step: "plan",
  consensus: "consensus", highrisk: "consensus",
};

function parseRouteJSON(text: string): Record<string, unknown> | null {
  const m = text.match(/```(?:json)?\s*\n?(.*?)\n?```/s);
  const jsonStr = m ? m[1].trim() : text.trim();
  const start = jsonStr.indexOf("{");
  const end = jsonStr.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(jsonStr.slice(start, end + 1)); } catch { return null; }
}

async function llmRoute(task: string): Promise<BaseRoute | null> {
  try {
    const resp = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen2.5-coder:7b", stream: false,
        system: "Output only JSON.",
        prompt: `Classify. Output JSON: {"gewu":"code","ROUTE":"plan","confidence":0.9}
gewu + ROUTE rules:
  knowledge + Q&A/definition → direct
  research + investigate/study/report → plan
  code + write/implement/build → plan
  solution + delete/deploy/destroy → consensus
  solution + problem-solving → plan
Task: ${task}`,
        options: { temperature: 0, num_predict: 256 },
      }),
      signal: AbortSignal.timeout(2000),
    });
    const raw: string = ((await resp.json()) as any).response?.trim() || "";
    const parsed = parseRouteJSON(raw);
    if (!parsed) return null;
    const gewu = GEWU_MAP[String(parsed.gewu ?? "").toLowerCase()];
    const route = ROUTE_MAP[String(parsed.ROUTE ?? "").toLowerCase()];
    const confidence = Math.min(Math.max(parsed.confidence ?? 0.5, 0), 1);
    if (!route) return null;
    // FR-A2.3：LLM 可输出三体权重 {"li":0.5,"shi":0.3,"de":0.2}，非法则降级关键词推断
    const llmWeights = normalizeWeights(parsed.weights);
    return {
      gewu: gewu || "code", route, confidence, weights: llmWeights ?? undefined,
      coordinator: route === "consensus" ? "auditor" : gewu === "research" ? "researcher" : "coder",
      layer: "llm",
    };
  } catch { return null; }
}

function keywordRoute(task: string): BaseRoute {
  const t = task.toLowerCase();
  if (["delete", "remove", "deploy", "销毁", "删除", "部署"].some((k) => t.includes(k)))
    return { gewu: "solution", route: "consensus", confidence: 1, coordinator: "auditor", layer: "keyword" };
  if (/研究|调研|分析|报告|写|代码|实现|重构|write|code|implement/i.test(t)) {
    const isResearch = /研究|调研|分析|report|research/i.test(t);
    return { gewu: isResearch ? "research" : "code", route: "plan", confidence: 0.85,
      coordinator: isResearch ? "researcher" : "coder", layer: "keyword" };
  }
  if (["什么是", "是什么", "what is", "explain", "define"].some((k) => t.includes(k)))
    return { gewu: "knowledge", route: "direct", confidence: 0.9, coordinator: "researcher", layer: "keyword" };
  return { gewu: "knowledge", route: "direct", confidence: 0.7, coordinator: "researcher", layer: "keyword" };
}

async function routeTask(task: string): Promise<RouteResult> {
  const llm = await llmRoute(task);
  const base = llm && llm.confidence >= 0.3 ? llm : keywordRoute(task);
  return finalizeRoute(task, base);
}

/** FR-A3.4：置信度随历史执行结果调整 */
function loadRouteHistory(gewu: string): { samples: number; successRate: number } {
  try {
    const p = join(require("os").homedir(), ".eto", "memory", "metrics.jsonl");
    if (!existsSync(p)) return { samples: 0, successRate: 0 };
    const rows = readFileSync(p, "utf-8").split("\n").filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter((r: any) => r && r.route === gewu && typeof r.success === "boolean") as any[];
    if (rows.length === 0) return { samples: 0, successRate: 0 };
    return { samples: rows.length, successRate: rows.filter(r => r.success).length / rows.length };
  } catch { return { samples: 0, successRate: 0 }; }
}

/** 补全 RouteResult 的三体权重 / 纪元 / MODE / 派发计划（FR-A2.3 + FR-A3.1–A3.3） */
function finalizeRoute(task: string, base: BaseRoute): RouteResult {
  const routed = routeWithMode(task, base.route, base.weights);
  const confidence = adjustConfidence(base.confidence, loadRouteHistory(base.gewu));
  return { ...base, confidence, weights: routed.weights, era: routed.era, mode: routed.mode, dispatch: buildModeDispatch(routed) };
}

// ═══════════════════════════════════════════════════
//  二、Stitcher — 调 Python 缝合层（外部调用用 await 非阻塞）
// ═══════════════════════════════════════════════════

/** 查找缝合层目录 */
function findStitchesDir(): string {
  const candidates = [
    process.env.ETO_HOME && join(process.env.ETO_HOME, "eto", "stitches"),
    join(__dirname, "..", "..", "eto", "stitches"),
    join(process.cwd(), "eto", "stitches"),
    join(__dirname, "..", "..", "..", "eto", "stitches"),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return "";
}

const STITCHES_DIR = findStitchesDir();

async function callStitchAsync(module: string, fn: string, ...args: any[]): Promise<Record<string, unknown> | { _error: true; message: string }> {
  if (!checkCircuitBreaker()) {
    console.warn(`[ETO] 熔断: 跳过 ${module}.${fn}`);
    return { _error: true, message: "circuit breaker open" };
  }
  try {
    const script = join(STITCHES_DIR, ...module.split(".")) + ".py";
    const input = JSON.stringify({ fn, args });
    const out = execSync(`python3 "${script}"`, { input, encoding: "utf-8", timeout: 30000 });
    stitchFailureCount = 0;
    return JSON.parse(out.trim());
  } catch (e: any) {
    stitchFailureCount++;
    console.error(`[ETO] Stitcher ${module}.${fn} 失败(${stitchFailureCount}/${MAX_STITCH_FAILURES}):`, e.message);
    return { _error: true, message: e.message };
  }
}

async function peerConsensus(plan: string, peers: string[]): Promise<Record<string, unknown> | null> {
  const r = await callStitchAsync("consensus.vote", "peer_review", plan, peers);
  return r && !("_error" in r) ? r : null;
}

async function electCoordinator(candidates: [string, number][] | Record<string, unknown>[]): Promise<string | null> {
  const result = await callStitchAsync("election.elect", "elect", candidates);
  if (!result || "_error" in result) return (candidates[0] as any)?.[0] || (candidates[0] as any)?.name || "researcher";
  const leader = (result as Record<string, unknown>)?.leader as string | null;
  // quorum 未达成（method=raft-no-quorum）→ leader=null，由调用方决定回退
  if (leader === null || leader === undefined) return null;
  return leader || (candidates[0] as any)?.[0] || (candidates[0] as any)?.name || "researcher";
}

// ═══════════════════════════════════════════════════
//  busy_ratio — FR-C1.4 真实负载来源（运行中任务 / 最大并发）
// ═══════════════════════════════════════════════════

const BUSY_PATH = () => {
  const dir = join(homedir(), ".eto");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "busy.json");
};

/** 读取各 peer 的运行中任务数（dispatch 前后更新） */
function loadBusy(): Record<string, number> {
  try { return JSON.parse(readFileSync(BUSY_PATH(), "utf-8")); } catch { return {}; }
}

function saveBusy(busy: Record<string, number>): void {
  writeFileSync(BUSY_PATH(), JSON.stringify(busy, null, 2), "utf-8");
}

function bumpBusy(peer: string, delta: number): void {
  const busy = loadBusy();
  busy[peer] = Math.max(0, (busy[peer] || 0) + delta);
  saveBusy(busy);
}

/** FR-C1.4: busy_ratio = 运行中任务 / 最大并发，0..1（无记录=空闲） */
function busyRatioFor(profile: AgentProfile): number {
  const running = loadBusy()[profile.name] || 0;
  const max = Math.max(1, profile.maxSubtasks || 1);
  return Math.min(1, running / max);
}

/** FR-C1.2/FR-C1.3: 候选 = profiles.json 的 match_score × (1 - busy_ratio)。
 *  分数不再硬编码：match_score 取 AgentProfile.weights[gewu]（profiles.json），
 *  加 MODE coordinatorHint 奖励；busy_ratio 由 ~/.eto/busy.json 实时计算传入选举 stitch。 */
function buildElectionCandidates(gewu: string, hint: string): Record<string, unknown>[] {
  return AGENT_PROFILES.map(p => ({
    name: p.name,
    match_score: (p.weights?.[gewu] || 0) + (hint && p.name === hint ? 0.1 : 0),
    busy_ratio: busyRatioFor(p),
  }));
}

async function executePlanViaMaestro(task: string, steps: string[]): Promise<any[]> {
  const result = await callStitchAsync("comms.a2a", "execute_plan", task, steps);
  if (!result || "_error" in result) return [];
  return (result as Record<string, unknown>)?.outputs as any[] || [];
}

// ═══════════════════════════════════════════════════
  //  智子安检 — 可配置规则引擎
  // ═══════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════
  //  智子 v2 — AgentGuard 级规则引擎
  // ═══════════════════════════════════════════════════

  interface SentinelRule {
    name: string;
    enabled?: boolean;
    priority?: number;
    type: "block" | "confirm" | "transform" | "track_turns";
    trigger?: string;
    pattern?: string;
    message?: string;
    from?: string;
    to?: string;
    maxTurns?: number;
    reminder?: string;
    // backward compat
    action?: string;
    contentPattern?: string;
  }

  interface SentinelConfig {
    enabled: boolean;
    rules: SentinelRule[];
    logFile: string;
    deadlock?: { maxBlocksPerRule: number; escapeAction: string; autoResetMs: number };
    rateLimit?: { windowMs: number; maxPerWindow: number; action: string };
  }

  function migrateRule(r: any): SentinelRule {
    if (r.type) return r as SentinelRule;
    // old format: {trigger, pattern, action} → new format
    const typeMap: Record<string, string> = { block: "block", confirm: "confirm", log: "block" };
    return { name: r.name, enabled: r.action !== "log", priority: 0, type: (typeMap[r.action] || "block") as any, trigger: r.trigger === "write_file" ? "write" : r.trigger, pattern: r.pattern, message: r.message, contentPattern: r.contentPattern };
  }

  function loadSentinelConfig(): SentinelConfig {
    const defaultResult: SentinelConfig = { enabled: true, rules: [{ name: "dangerous-bash", enabled: true, priority: 20, type: "block", trigger: "bash", pattern: "rm\\s+-rf|dd\\s+if=|mkfs", message: "危险命令" }], logFile: "" };
    const configPath = join(require("os").homedir(), ".pi", "eto-sentinel.json");
    try {
      if (!existsSync(configPath)) return defaultResult;
      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      return {
        enabled: raw.enabled !== false,
        rules: (raw.rules || []).map(migrateRule),
        logFile: (raw.logFile || "~/.eto/sentinel-log.jsonl").replace("~", require("os").homedir()),
        deadlock: raw.deadlock,
        rateLimit: raw.rateLimit,
      };
    } catch { return defaultResult; }
  }

  let SENTINEL = loadSentinelConfig();
  const rateLimitMap = new Map<string, number[]>();
  const blockCounters = new Map<string, number>();
  let turnCounter = 0;

  function checkRateLimit(ruleName: string): boolean {
    if (!SENTINEL.rateLimit) return true;
    const { windowMs, maxPerWindow } = SENTINEL.rateLimit;
    const now = Date.now();
    let timestamps = rateLimitMap.get(ruleName) || [];
    timestamps = timestamps.filter(t => now - t < windowMs);
    if (timestamps.length >= maxPerWindow) return false;
    timestamps.push(now);
    rateLimitMap.set(ruleName, timestamps);
    return true;
  }

  function checkDeadlock(ruleName: string): boolean {
    const count = blockCounters.get(ruleName) || 0;
    const maxBlocks = SENTINEL.deadlock?.maxBlocksPerRule ?? 5;
    if (count >= maxBlocks) {
      logSentinel(ruleName + "-escape", `blocked ${count}x, auto-escaped`);
      return true;
    }
    blockCounters.set(ruleName, count + 1);
    return false;
  }

  function matchTool(toolName: string, trigger: string | undefined): boolean {
    if (!trigger) return false;
    if (trigger === toolName) return true;
    if (trigger.endsWith("*") && toolName.startsWith(trigger.slice(0, -1))) return true;
    return false;
  }

  function generatePreview(cmd: string): string {
    const plan = buildPreviewPlan(cmd, process.cwd());
    if (!plan) return "";
    if (!plan.ok) return `[预览已拒绝] ${plan.reason}`;
    return executePreviewPlan(plan, { timeoutMs: 5000 });
  }

  async function checkSentinel(event: any, ctx: any): Promise<{ block: true; reason: string } | null> {
    if (!SENTINEL.enabled) return null;
    const input = JSON.stringify(event.input || "").toLowerCase();
    const sortedRules = [...SENTINEL.rules].filter(r => r.enabled !== false).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    for (const rule of sortedRules) {
      if (rule.type === "block" || rule.type === "confirm") {
        if (!matchTool(event.toolName, rule.trigger)) continue;
        if (rule.pattern) {
          const compiled = compileRulePattern(rule.pattern);
          if (!compiled.regex) {
            console.warn(`[智子] 规则 "${rule.name}" 的正则无效，已跳过: ${compiled.error || "空正则"}`);
            continue;
          }
          if (!compiled.regex.test(input)) continue;
        }
        if (!checkRateLimit(rule.name)) return { block: true, reason: `频率限制: ${rule.name}` };
        if (checkDeadlock(rule.name)) return null;

        if (rule.type === "block") {
          logSentinel(rule.name, input.slice(0, 200));
          return { block: true, reason: rule.message || rule.name };
        }

        // confirm with preview
        const cmd = event.input?.command || "";
        const preview = generatePreview(cmd);
        const blockCount = blockCounters.get(rule.name) || 0;
        const msg = `[${rule.name}] (已拦 ${blockCount} 次)\n操作：${cmd.slice(0, 80)}\n` + (preview ? `影响预览:\n${preview.slice(0, 300)}` : "");
        const ok = await ctx.ui.confirm("⛔ 智子安检", msg);
        logSentinel(rule.name, cmd.slice(0, 200));
        return ok ? null : { block: true, reason: rule.message || rule.name };
      }
    }

    return null;
  }

  function logSentinel(ruleName: string, target: string): void {
    if (!SENTINEL.logFile) return;
    try {
      require("fs").appendFileSync(SENTINEL.logFile, JSON.stringify({ event: "blocked", rule: ruleName, target: target.slice(0, 200), ts: new Date().toISOString() }) + "\n", "utf-8");
    } catch {}
  }

  // ═══════════════════════════════════════════════════
  //  熔断守卫
  // ═══════════════════════════════════════════════════

  let stitchFailureCount = 0;
  const MAX_STITCH_FAILURES = 3;

function checkCircuitBreaker(): boolean {
  return stitchFailureCount < MAX_STITCH_FAILURES;
}

// ═══════════════════════════════════════════════════
//  三、Plan 执行器
// ═══════════════════════════════════════════════════

function loadPeerConfig(): Record<string, any> {
  const cfgPath = join(require("os").homedir(), ".pi", "eto-config.json");
  try { return JSON.parse(readFileSync(cfgPath, "utf-8")) } catch { return {} }
}

async function tryDispatchToMCPAgent(peerName: string, task: string): Promise<string | null> {
  const config = loadPeerConfig();
  const peerCfg = config?.peers?.[peerName];
  if (!peerCfg || peerCfg.provider !== "mcp") return null;

  const cmd = peerCfg.mcp_server;
  const tool = peerCfg.mcp_tool || "agent_execute";
  if (!Array.isArray(cmd) || cmd.length === 0) return null;

  try {
    // agent 字段显式传入：Feedback Gate 的约束按 agent 名读写，
    // 不再从 tool 名反推（tool=agent_execute 时反推恒为空串，见 issue #1 P0-6）
    const spec: Record<string, any> = { server_cmd: cmd, tool, task, agent: peerName };
    const ds = peerCfg.dispatch_spec;
    if (ds) {
      if (ds.system_prompt) spec.system_prompt = ds.system_prompt;
      if (Array.isArray(ds.skills)) spec.skills = ds.skills;
      if (Array.isArray(ds.mcp_tools)) spec.mcp_tools = ds.mcp_tools;
      if (ds.response_format) spec.response_format = ds.response_format;
      if (typeof ds.timeout === "number") spec.timeout = ds.timeout;
      if (ds.params) spec.params = ds.params;
    }
    const result = await callStitchAsync("mcp_dispatch", "dispatch_with_spec", JSON.stringify(spec));
    if (result && !("_error" in result)) {
      return `[MCP Agent: ${peerName}]\n结果: ${JSON.stringify(result, null, 2)}`;
    }
  } catch {}
  return null;
}

/**
 * MODE 派发（FR-A3）：下游真正按 MODE 走不同路径，不是算出来放着。
 * - direct：不走编排，返回简短指令（外层直接单次回答）
 * - debate：共识审议（含 REWORK 轮次）
 * - research / build / full：流水线步骤按 MODE 区分；乱纪元加深审核（FR-A3.3）
 */
async function dispatchByMode(task: string, route: RouteResult, contextTask: string, coordinator?: string): Promise<string> {
  const dispatch = route.dispatch;
  const coord = coordinator || route.coordinator;

  if (dispatch.path === "direct") {
    return `MODE=direct：单次回答，不编排`;
  }

  if (dispatch.path === "consensus") {
    const votes = await peerConsensus(contextTask, dispatch.reviewPeers);
    const score = typeof votes?.final_score === "number" ? votes.final_score : (typeof votes?.avg_score === "number" ? votes.avg_score : 0.5);
    const status = typeof votes?.status === "string" ? votes.status : (score >= 0.6 ? "approved" : "revise");
    const actions = Array.isArray(votes?.actions) ? votes.actions : [];
    return [
      `MODE=debate | 纪元: ${route.era === "chaotic" ? "乱纪元" : "恒纪元"}`,
      `共识: ${status} (${(score * 100).toFixed(0)}%) | REWORK 上限: ${dispatch.reworkRounds} 轮 | 审核深度: ${dispatch.reviewDepth}`,
      actions.length > 0 ? `改进行动: ${actions.join("; ")}` : ``,
    ].filter(Boolean).join("\n");
  }

  // pipeline / full：步骤按 MODE 取自 dispatch.steps（research/build/full 各不同）
  const steps = dispatch.steps.length > 0 ? dispatch.steps : ["执行方案", "审查结果"];
  const consensusPeers = dispatch.reviewPeers.length > 0 ? dispatch.reviewPeers : [coord, "auditor"];
  const consensus = await peerConsensus(contextTask, consensusPeers);
  bumpBusy(coord, +1);  // FR-C1.4：运行中任务 +1，busy_ratio 反映到下次选举
  const outputs = await executePlanViaMaestro(contextTask, steps);
  bumpBusy(coord, -1);  // 任务完成 → 负载释放（FR-C1.5 协调员角色解散）
  const reworkNote = dispatch.reworkRounds > 1 ? `\nREWORK 上限: ${dispatch.reworkRounds} 轮（乱纪元自动加深，FR-A3.3）` : ``;
  if (outputs.length > 0) {
    const details = outputs.map((o: string, i: number) => `  >> Step ${i+1} (${steps[i]}):\n  ${o.slice(0, 300)}`).join("\n\n");
    return `MODE=${route.mode} | 协调员: ${coord}\n共识: ${consensus?.status || "通过"}\n共 ${steps.length} 步${reworkNote}\n\n${details}`;
  }
  return `MODE=${route.mode} | 协调员: ${coord}, 共 ${steps.length} 步, 共识: ${consensus?.status || "通过"}${reworkNote}`;
}

async function execPlan(task: string, route: RouteResult): Promise<string> {
  // Inject TealContext (shared agent memory) into task
  let contextTask = task;
  try {
    const out = execSync(`python3 -c "from eto.stitches.memory.shared_memory import context_block; print(context_block(5))"`, { encoding: "utf-8", timeout: 5000 });
    const ctx = (out.stdout || out || "").trim();
    if (ctx) contextTask = ctx + "\n\n" + task;
  } catch {}

  // FR-A3.1 + FR-C1.2：候选分数来自 profiles.json 的 match_score × (1 - busy_ratio)，
  // busy_ratio 为 ~/.eto/busy.json 的真实负载；MODE 的 coordinatorHint 参与加权
  const hint = route.dispatch.coordinatorHint;
  const candidates = buildElectionCandidates(route.gewu, hint);
  let coordinator = await electCoordinator(candidates);
  if (coordinator === null) {
    // quorum 未达成（全员满载等）→ 回退路由层 coordinator
    coordinator = route.coordinator;
  }

  // Try MCP agent dispatch first
  const mcpResult = await tryDispatchToMCPAgent(coordinator, contextTask);
  if (mcpResult) return mcpResult;

  // MODE 派发：按 MODE 走不同路径（direct/debate/pipeline/full）
  return dispatchByMode(task, route, contextTask, coordinator);
}

// ═══════════════════════════════════════════════════
//  Agent Registry — 本地注册 + 心跳
// ═══════════════════════════════════════════════════

const REGISTRY_PATH = () => {
  const dir = join(require("os").homedir(), ".eto");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "registry.json");
};

function generateAgentId(): string {
  return `pi-${require("os").hostname().toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
}

function loadRegistry(): { version: number; agents: Record<string, any> } {
  try { return JSON.parse(readFileSync(REGISTRY_PATH(), "utf-8")); }
  catch { return { version: 1, agents: {} }; }
}

function saveRegistry(reg: any): void {
  writeFileSync(REGISTRY_PATH(), JSON.stringify(reg, null, 2), "utf-8");
}

function registerSelf(): void {
  const reg = loadRegistry();
  const id = generateAgentId();
  reg.agents[id] = {
    id,
    platform: "pi",
    hostname: require("os").hostname(),
    mcp_endpoint: "python -m eto.mcp_server",
    capabilities: ["code", "research", "audit"],
    status: "online",
    last_seen: new Date().toISOString(),
  };
  saveRegistry(reg);
}

function heartbeat(): void {
  const reg = loadRegistry();
  const id = generateAgentId();
  if (reg.agents[id]) {
    reg.agents[id].last_seen = new Date().toISOString();
    reg.agents[id].status = "online";
  } else {
    registerSelf();
  }
  saveRegistry(reg);
}

// ═══════════════════════════════════════════════════
//  四、Pi 扩展入口
// ═══════════════════════════════════════════════════

// ═══════════════════════════════════════════════════
//  Onboarding — 首次引导状态机
// ═══════════════════════════════════════════════════

interface OnboardingState {
  version: number;
  first_session_at?: string;
  seen_welcome: boolean;
}

const ONBOARDING_PATH = join(require("os").homedir(), ".eto", "memory", "onboarding.json");

function loadOnboarding(): OnboardingState {
  try { if (existsSync(ONBOARDING_PATH)) return JSON.parse(readFileSync(ONBOARDING_PATH, "utf-8")); } catch {}
  return { version: 1, seen_welcome: false };
}

function saveOnboarding(s: OnboardingState): void {
  const dir = join(require("os").homedir(), ".eto", "memory");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(ONBOARDING_PATH, JSON.stringify(s, null, 2), "utf-8");
}

function setProviderChoice(choice: number): void {
  const cfgPath = join(require("os").homedir(), ".pi", "eto-config.json");
  let config: any = {};
  try { if (existsSync(cfgPath)) config = JSON.parse(readFileSync(cfgPath, "utf-8")); } catch {}
  const pm: Record<number, string> = { 1: "deepseek", 2: "ollama", 3: "skip" };
  const selected = pm[choice] || "deepseek";
  config.router = config.router || {};
  config.router.provider = selected;
  // 同步设置 peer provider 默认值
  config.peers = config.peers || {};
  if (!config.peers.researcher) config.peers.researcher = { provider: selected, model: selected === "deepseek" ? "deepseek-chat" : "qwen2.5-coder:7b" };
  if (!config.peers.coder) config.peers.coder = { provider: selected, model: selected === "deepseek" ? "deepseek-chat" : "qwen2.5-coder:7b" };
  if (!config.peers.auditor) config.peers.auditor = { provider: selected, model: selected === "deepseek" ? "deepseek-chat" : "qwen2.5-coder:7b" };
  const dir = join(require("os").homedir(), ".pi");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(cfgPath, JSON.stringify(config, null, 2), "utf-8");
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const onb = loadOnboarding();
    if (!onb.seen_welcome) {
      onb.seen_welcome = true;
      saveOnboarding(onb);
      ctx.ui.setWidget("eto-route", [
        "╭────────────────────────────────────────╮",
        "│  Evolutionary-Teal-Organization        │",
        "│  现在，我们是同志了。                  │",
        "│  Now, we are comrades.                 │",
        "│                                        │",
        "│  架构优于单体                          │",
        "│  architecture > agent                   │",
        "│  无序 · 三生 · 有机                    │",
        "│  Entropy · Trinity · Organic           │",
        "│                                        │",
        "│  三镜路由 → 任务自动分配              │",
        "│  同侪共识 → 三阶段评分+审议+终审      │",
        "│  多模型   → 各 peer 配不同 LLM        │",
        "│  MCP 集成 → 调其他 Agent / 被调      │",
        "│                                        │",
        "│  配置 Agent: ~/.pi/eto-config.json     │",
        "│  加入 peers 段指定 mcp_server + tool   │",
        "│                                        │",
        "╰────────────────────────────────────────╯"
      ]);
      return;
    }
    ctx.ui.setWidget("eto-route", ["🦋 ETO 就绪", "描述任务开始"]);
    registerSelf();
  });

  pi.registerCommand("eto", {
    description: "显示 ETO 品牌信息 / 青色编排状态",
    handler: async (_args, ctx) => {
      ctx.ui.notify("╭─ /ETO ────────────────────────────╮", "info");
      ctx.ui.notify("│  Evolutionary-Teal-Organization  │", "info");
      ctx.ui.notify("│                                   │", "info");
      ctx.ui.notify("│  现在，我们是同志了。              │", "info");
      ctx.ui.notify("│  Now, we are comrades.            │", "info");
      ctx.ui.notify("│                                   │", "info");
      ctx.ui.notify("│  架构优于单体                     │", "info");
      ctx.ui.notify("│  architecture > agent              │", "info");
      ctx.ui.notify("│  无序 · 三生 · 有机               │", "info");
      ctx.ui.notify("│  Entropy · Trinity · Organic      │", "info");
      ctx.ui.notify("╰───────────────────────────────────╯", "info");
    },
  });

  pi.registerCommand("sentinel-reload", {
    description: "重新加载智子安全检查配置",
    handler: async (_args, ctx) => {
      SENTINEL = loadSentinelConfig();
      rateLimitMap.clear();
      ctx.ui.notify("智子配置已重新加载", "info");
    },
  });

  pi.registerCommand("metrics", {
    description: "显示 ETO 运行统计",
    handler: async (_args, ctx) => {
      try {
        const { execSync } = require("child_process");
        const out = execSync(`python3 "${join(__dirname, "..", "..", "eto", "stitches", "metrics.py")}"`, {
          input: JSON.stringify({ fn: "summary", args: [] }), encoding: "utf-8", timeout: 5000
        });
        ctx.ui.notify(`📊 ETO Metrics:\n${out.trim()}`, "info");
      } catch {
        ctx.ui.notify("📊 Metrics 不可用（需运行至少一个任务）", "info");
      }
    },
  });

  pi.registerCommand("agents", {
    description: "列出所有已注册 Agent 及其状态",
    handler: async (_args, ctx) => {
      const reg = loadRegistry();
      const agents = Object.values(reg.agents);
      if (agents.length === 0) {
        ctx.ui.notify("没有已注册的 Agent", "info");
        return;
      }
      const now = new Date();
      const lines = agents.map((a: any) => {
        const lastSeen = new Date(a.last_seen);
        const diffMs = now.getTime() - lastSeen.getTime();
        const status = diffMs < 120000 ? "在线" : "离线";
        return `  ${(a.id || "?").padEnd(22)} ${(a.platform || "?").padEnd(8)} ${status.padEnd(6)} ${a.last_seen.slice(0, 19).replace("T", " ")}`;
      });
      ctx.ui.notify(`📋 Agent Registry (${agents.length}):\n${lines.join("\n")}`, "info");
    },
  });

  // FR-E1.3：/reflect 手动触发集体回顾
  pi.registerCommand("reflect", {
    description: "手动触发集体回顾（FR-E1）",
    handler: async (_args, ctx) => {
      try {
        const out = execSync(`python3 "${join(__dirname, "..", "..", "eto", "stitches", "reflection.py")}" reflect`, {
          encoding: "utf-8", timeout: 30000,
        });
        ctx.ui.notify(out.trim(), "info");
      } catch (e: any) {
        ctx.ui.notify(`集体回顾失败: ${e?.message || e}`, "error");
      }
    },
  });

  pi.on("before_agent_start", async (event, ctx) => {
    blockCounters.clear();  // 用户新消息 → 逃生门计数归零
    turnCounter++;
    heartbeat();

    // transform rules — 修改 prompt
    if (event.prompt) {
      for (const rule of SENTINEL.rules) {
        if (rule.enabled === false || rule.type !== "transform") continue;
        if (rule.from) {
          event.prompt = event.prompt.replace(new RegExp(rule.from, "g"), rule.to || "");
        }
      }
    }

    // track_turns — 超阈值注入提醒
    for (const rule of SENTINEL.rules) {
      if (rule.enabled === false || rule.type !== "track_turns") continue;
      if (turnCounter >= (rule.maxTurns || 10)) {
        event.prompt = `[智子提醒] ${rule.reminder || "注意轮数"}\n\n` + (event.prompt || "");
        turnCounter = 0;
      }
    }

    const task = event.prompt || "";
    if (!task) return;

    const onb = loadOnboarding();
    if (!onb.seen_welcome) {
      onb.seen_welcome = true;
      saveOnboarding(onb);
      return { systemPrompt: "" };
    }

    stitchFailureCount = 0; // 重置熔断器

    ctx.ui.setWidget("eto-route", undefined);
    ctx.ui.notify("📋 ETO 分析中...", "info");
    const route = await routeTask(task);

    const confidence = (route.confidence * 100).toFixed(0);
    ctx.ui.notify(`🔍 三镜路由: ${route.gewu} → ${route.route}  [${route.layer} ${confidence}%]`, "info");
    ctx.ui.notify(`⚖️ 三体: ${formatWeights(route.weights)} | ${route.era === "chaotic" ? "乱纪元" : "恒纪元"}`, "info");
    ctx.ui.notify(`🎯 MODE: ${route.mode} → dispatch: ${route.dispatch.path}`, "info");
    ctx.ui.notify(`👤 协调员: ${route.coordinator}`, "info");

    const tz = process.env.ETO_TIMEZONE || "Asia/Shanghai";
    const now = new Date().toLocaleString("zh-CN", { timeZone: tz });
    const widgetLines = [
      `📋 ETO | ${route.gewu} → ${route.route} | ${route.coordinator} | ${route.layer} ${confidence}%`,
      `⚖️ ${formatWeights(route.weights)} | ${route.era === "chaotic" ? "乱纪元" : "恒纪元"}`,
      `🎯 MODE: ${route.mode} → ${route.dispatch.path}`,
    ];
    const routeLines = [
      `## ETO 路由分析`,
      `当前时间: ${now}`,
      `路由: ${route.gewu} → ${route.route} (${route.layer}, ${confidence}%)`,
      `三体: ${formatWeights(route.weights)} | 纪元: ${route.era === "chaotic" ? "乱纪元" : "恒纪元"}`,
      `MODE: ${route.mode} | dispatch: ${route.dispatch.path} | 审核深度: ${route.dispatch.reviewDepth} | REWORK 上限: ${route.dispatch.reworkRounds} 轮`,
      `协调员: ${route.coordinator}`,
    ];

    // FR-E2.1：通政司路由阶段检测循环意图（Rework/Iteration 可执行，Watch/Cron 报缺失）。
    // 必须在 widgetLines/routeLines 声明之后 push，否则命中关键词的任务会 TDZ 崩溃。
    let loopIntent: any = null;
    try {
      const li = await callStitchAsync("reflection", "detect_loop_intent", task);
      if (li && !("_error" in li) && typeof li === "object" && (li as any).type) {
        loopIntent = li;
      }
    } catch {}
    if (loopIntent) {
      const loopNote = loopIntent.note ? `（${loopIntent.note}）` : ``;
      ctx.ui.notify(`🔄 Loop 意图: ${loopIntent.type} (maxRounds=${loopIntent.maxRounds})${loopNote}`, "info");
      const loopLine = `Loop 意图: ${loopIntent.type} (round=0/${loopIntent.maxRounds === -1 ? "∞" : loopIntent.maxRounds})${loopNote}`;
      widgetLines.push(`🔄 ${loopIntent.type}`);
      routeLines.push(loopLine);
      // Iteration 意图：路由约束里带上收敛要求（执行走 reflection.run_iteration）
      if (loopIntent.type === "iteration") {
        routeLines.push(`[Loop 约束] 多轮迭代执行，输出需可比较（收敛阈值 0.9），收敛即停`);
      }
    }

    if (route.route === "plan") {
      // 0. Clarify Gate — 模糊指令拦截
      const clarifyResult = await callStitchAsync("quality.clarify", "detect_vague", task);
      if (clarifyResult && !("_error" in clarifyResult) && (clarifyResult as any).vague) {
        const suggestions = ((clarifyResult as any).suggestions as string[] || []).join(" / ");
        ctx.ui.notify(`💡 指令较模糊，试试更具体：${suggestions}`, "info");
        routeLines.push(`## 指令澄清\n检测到模糊词：${((clarifyResult as any).matched as string[] || []).join(", ")}`);
        routeLines.push(`建议方向：${suggestions}`);
        routeLines.push(`当前任务: ${task}`);
        routeLines.push(`请完善描述后再试。`);
        widgetLines.push(`💡 指令待澄清`);
        ctx.ui.setWidget("eto-route", widgetLines);
        writeMetric(route.route, "clarify", false, 0);
        return { systemPrompt: routeLines.join("\n") + "\n\n" + (event.systemPrompt || "") };
      }

      // 1. 先选协调员（Raft）—— 候选分数来自 profiles.json + 真实 busy_ratio（FR-C1.2）
      ctx.ui.notify(`🗳️ 选举协调员...`, "info");
      const hint = route.dispatch.coordinatorHint;
      const candidates_ = buildElectionCandidates(route.gewu, hint);
      let coordinator = await electCoordinator(candidates_);
      if (coordinator === null) {
        // quorum 未达成 → 回退路由层 coordinator
        coordinator = route.coordinator;
      }
      ctx.ui.notify(`👤 协调员: ${coordinator}`, "info");

      // 2. 协调员设计工作流
      ctx.ui.notify(`📋 协调员编排中...`, "info");
      const wfResult = await callStitchAsync("bidding.workflow", "coordinator_design",
        JSON.stringify({ type: route.gewu, title: task, description: task, coordinator }),
        JSON.stringify(AGENT_PROFILES.map(p => ({ name: p.name, label: p.label, specialty: p.specialty, description: p.description, weights: p.weights }))));
      let workflowSteps: any[] | null = null;
      if (wfResult && !("_error" in wfResult) && !(wfResult as any).fallback) {
        workflowSteps = (wfResult as any).steps as any[];
      }

      if (workflowSteps && workflowSteps.length > 1) {
        // Rework 轮次来自 MODE dispatch（恒纪元 1 轮 / 乱纪元 3 轮，FR-A3.3），
        // 与 workflow.py 的整轮 rework 对接；此前该配置只打印不下发。
        const reworkRounds = typeof route.dispatch.reworkRounds === "number" ? route.dispatch.reworkRounds : 1;
        const execResult = await callStitchAsync("bidding.workflow", "execute_workflow", JSON.stringify(wfResult), task, reworkRounds);
        const exec = execResult as any;
        const stepLines = (exec?.step_results || []).map((r: any, i: number) => `  >> Step ${i+1} (${r.agent}): ${r.status}${r.status === "failed" && r.error ? ` — ${String(r.error).slice(0, 120)}` : ""}`).join("\n");
        const wfOk = exec?.success === true;
        const reworkInfo = exec?.rework || {};
        const roundsRun = typeof reworkInfo.rounds_run === "number" ? reworkInfo.rounds_run : 1;
        ctx.ui.notify(wfOk ? `✅ 工作流完成${roundsRun > 1 ? `（rework ${roundsRun} 轮）` : ""}` : `⚠️ 工作流有失败步骤`, "info");
        routeLines.push(`## ETO 工作流 | 协调员: ${coordinator} | ${wfOk ? "成功" : "失败"}`);
        routeLines.push(stepLines);
        for (const err of ((exec?.errors || []) as string[])) routeLines.push(`  !! ${err.slice(0, 200)}`);
        if (roundsRun > 1) routeLines.push(`Rework: 已重跑 ${roundsRun} 轮（上限 ${reworkRounds}）`);
        widgetLines.push(wfOk ? `🔄 ${(wfResult as any).workflow || "workflow"} (${exec?.total_steps || 0} 步)` : `⚠️ ${(wfResult as any).workflow || "workflow"} 失败 (${(exec?.errors || []).length} 项错误)`);
        if (roundsRun > 1) widgetLines.push(`♻️ rework ${roundsRun} 轮`);
        ctx.ui.setWidget("eto-route", widgetLines);
        return { systemPrompt: routeLines.join("\n") + "\n\n" + (event.systemPrompt || "") };
      }

      // 3. 降级：竞标或关键词
      ctx.ui.notify(`📝 竞标中...`, "info");
      const bidResult = await tryBidding(task, route.gewu);
      const agents = bidResult ? [bidResult.winner] : matchAgentsForRoute(route.gewu);
      const agentNames = agents.map(a => a.name).join(", ");
      ctx.ui.notify(`👥 Agent: ${agentNames}${bidResult ? ` (竞标 ${(bidResult.confidence * 100).toFixed(0)}%)` : " (关键词降级)"}`, "info");

      const matchedSkills = matchSkillsForRoute(route.gewu);
      for (const sk of matchedSkills) {
        ctx.ui.notify(`📚 经验: ${sk.skill_name} (${(sk.reward * 100).toFixed(0)}%)`, "info");
      }

      const plan = await execPlan(task, route);
      const consensusMatch = plan.match(/共识: (.+?)(?:\n|$)/);
      const stepMatch = plan.match(/共 (\d+) 步/);

      routeLines.push(`Agent: ${agentNames}`);
      routeLines.push(`共识: ${consensusMatch?.[1] || "通过"}`);
      routeLines.push(`计划: ${stepMatch?.[1] || route.dispatch.steps.length} 步 (MODE=${route.mode})`);
      routeLines.push("");
      routeLines.push(synthesizeSummary(task, route, agents));
      routeLines.push("");
      if (isComplexTask(task)) {
        routeLines.push(`[Mode: Fable]\n${loadFablePrompt()}`);
        routeLines.push("");
      }
      routeLines.push(decomposePrompt(agents));
      if (route.mode === "full" || route.era === "chaotic") {
        // FR-A3.3：乱纪元/full 增加审核深度与 REWORK 轮次，下达给执行 Agent
        routeLines.push("");
        routeLines.push(`[MODE 约束] 审核: ${route.dispatch.reviewPeers.join("+")} | REWORK 上限: ${route.dispatch.reworkRounds} 轮 | 深度: ${route.dispatch.reviewDepth}`);
      }

      // 注入匹配的 skill 经验
      for (const sk of matchedSkills) {
        routeLines.push(`[Skill] ${sk.skill_name}: ${sk.context.slice(0, 100)}`);
      }

      widgetLines.push(`👥 ${agentNames}`);
      widgetLines.push(`📝 ${stepMatch?.[1] || "?"}步 | 共识: ${consensusMatch?.[1] || "通过"}`);
      ctx.ui.setWidget("eto-route", widgetLines);

      writeMetric(route.route, agentNames, true, parseInt(stepMatch?.[1] || "0"));
      return { systemPrompt: routeLines.join("\n") + "\n\n" + (event.systemPrompt || "") };
    }

    if (route.route === "consensus") {
      // MODE=debate：审议成员与 REWORK 轮次来自 dispatch（乱纪元自动加深，FR-A3.3）
      ctx.ui.notify(`🤝 共识审议中 (MODE=${route.mode}, ${route.dispatch.reviewDepth})...`, "info");
      const reviewPeers = route.dispatch.reviewPeers.length > 0 ? route.dispatch.reviewPeers : ["researcher", "coder", "auditor"];
      const cResult = await peerConsensus(task, reviewPeers);
      const score = typeof cResult?.final_score === "number" ? cResult.final_score : (typeof cResult?.avg_score === "number" ? cResult.avg_score : 0.5);
      const status = typeof cResult?.status === "string" ? cResult.status : (score >= 0.6 ? "approved" : "revise");
      ctx.ui.notify(`🤝 共识: ${status} (${(score * 100).toFixed(0)}%)`, "info");
      const actions = Array.isArray(cResult?.actions) ? cResult.actions : [];
      routeLines.push(`## 共识结果: ${status} (${(score * 100).toFixed(0)}%)`);
      routeLines.push(`审议: ${reviewPeers.join("+")} | REWORK 上限: ${route.dispatch.reworkRounds} 轮 (${route.dispatch.reviewDepth})`);
      if (actions.length > 0) routeLines.push(`改进行动: ${actions.join("; ")}`);
      widgetLines.push(`🤝 ${status === "approved" ? "通过" : "需修正"} ${(score * 100).toFixed(0)}%`);
      ctx.ui.setWidget("eto-route", widgetLines);
      writeMetric(route.route, "consensus", status === "approved", 1);
    } else {
      // MODE=direct：单次回答
      routeLines.push(`回复格式：`);
      routeLines.push(`【路由】一句话说明任务归类 (MODE=${route.mode})`);
      routeLines.push("【回答】你的回答");
      routeLines.push("====END====");
      ctx.ui.setWidget("eto-route", widgetLines);
    }
    return { systemPrompt: routeLines.join("\n") + "\n\n" + (event.systemPrompt || "") };
  });

  pi.registerTool({
    name: "eto_consensus", label: "ETO Consensus",
    description: "同侪共识评分（三阶段：评分→审议→终审）",
    parameters: Type.Object({ plan: Type.String({ description: "执行方案" }) }),
    async execute(toolCallId, params) {
      const r = await peerConsensus(params.plan, ["researcher", "coder", "auditor"]);
      const score = typeof r?.final_score === "number" ? r.final_score : (typeof r?.avg_score === "number" ? r.avg_score : 0.6);
      return { content: [{ type: "text", text: JSON.stringify({ status: score >= 0.6 ? "通过" : "需调整", final_score: score, votes: r?.votes, deliberation: r?.deliberation }) }], details: {} };
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    const result = await checkSentinel(event, ctx);
    if (result) return result;
  });
}
