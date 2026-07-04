/**
 * ETO — Evolutionary Teal Organization
 * Pi CLI 扩展：三镜路由 + 协调员选举 + 同侪共识 + 智子安检
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execSync } from "child_process";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";

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

const FABLE_STYLE = [
  `沟通风格：`,
  `- 结论先行，证据紧跟。先说结果再展开。`,
  `- 无废话：不要恭维、致歉、套话。`,
  `- 工作中简练，边界处完整。`,
  `- 承诺的事同一轮完成，否则不承诺。`,
  `- 格式：文件名:行号 开头，表格呈现数据，项目符号列要点。`,
];

function decomposePrompt(agents: AgentProfile[]): string {
  const lines = agents.map(a => `- ${a.name} (${a.label}): ${a.description}`);
  return [
    `可用 Agent：`,
    ...lines,
    ``,
    ...FABLE_STYLE,
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
interface RouteResult {
  gewu: string; route: Route; confidence: number;
  coordinator: string; layer: string;
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

async function llmRoute(task: string): Promise<RouteResult | null> {
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
    return {
      gewu: gewu || "code", route, confidence,
      coordinator: route === "consensus" ? "auditor" : gewu === "research" ? "researcher" : "coder",
      layer: "llm",
    };
  } catch { return null; }
}

function keywordRoute(task: string): RouteResult {
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
  if (llm && llm.confidence >= 0.3) return llm;
  return keywordRoute(task);
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

async function electCoordinator(candidates: [string, number][]): Promise<string> {
  const result = await callStitchAsync("election.elect", "elect", candidates);
  if (!result || "_error" in result) return candidates[0]?.[0] || "researcher";
  return (result as Record<string, unknown>)?.leader as string || candidates[0]?.[0] || "researcher";
}

async function executePlanViaMaestro(task: string, steps: string[]): Promise<any[]> {
  const result = await callStitchAsync("comms.a2a", "execute_plan", task, steps);
  if (!result || "_error" in result) return [];
  return (result as Record<string, unknown>)?.outputs as any[] || [];
}

// ═══════════════════════════════════════════════════
  //  智子安检 — 可配置规则引擎
  // ═══════════════════════════════════════════════════

  interface SentinelRule {
    name: string;
    trigger: "bash" | "write_file";
    pattern: string;
    action: "confirm" | "block" | "log";
    message?: string;
    contentPattern?: string;
  }

  interface SentinelConfig {
    enabled: boolean;
    rules: SentinelRule[];
    logFile: string;
    rateLimit?: { windowMs: number; maxPerWindow: number; action: string };
  }

  function loadSentinelConfig(): SentinelConfig {
    const defaultResult: SentinelConfig = { enabled: true, rules: [{ name: "default-rm", trigger: "bash", pattern: "rm\\s+-rf|dd\\s+if=|mkfs", action: "confirm" }], logFile: "" };
    const configPath = join(require("os").homedir(), ".pi", "eto-sentinel.json");
    try {
      if (!existsSync(configPath)) return defaultResult;
      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      return { enabled: raw.enabled !== false, rules: raw.rules || [], logFile: (raw.logFile || "~/.eto").replace("~", require("os").homedir()) };
    } catch { return defaultResult; }
  }

  let SENTINEL = loadSentinelConfig();
  const rateLimitMap = new Map<string, number[]>();

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

  async function checkSentinel(event: any, ctx: any): Promise<{ block: true; reason: string } | null> {
    if (!SENTINEL.enabled) return null;

    // Bash trigger
    if (event.toolName === "bash" && typeof event.input?.command === "string") {
      const cmd = event.input.command;
      for (const rule of SENTINEL.rules) {
        if (rule.trigger !== "bash") continue;
        if (!checkRateLimit(rule.name)) {
          logSentinel(rule.name + "-ratelimit", cmd);
          return { block: true, reason: `频率限制: ${rule.name}` };
        }
        const re = new RegExp(rule.pattern, "i");
        if (!re.test(cmd)) continue;

        if (rule.action === "block") { logSentinel(rule.name, cmd); return { block: true, reason: rule.message || rule.name }; }
        if (rule.action === "log")   { logSentinel(rule.name, cmd); return null; }
        // confirm
        const ok = await ctx.ui.confirm("⛔ 智子安检", `[${rule.name}] ${rule.message || rule.name}\n操作：${cmd.slice(0, 80)}\n放行？`);
        logSentinel(rule.name, cmd);
        return ok ? null : { block: true, reason: rule.message || rule.name };
      }
    }

    // write_file trigger — path + content scan
    if (event.toolName === "write" && typeof event.input?.filepath === "string") {
      const content = typeof event.input.content === "string" ? event.input.content : "";
      for (const rule of SENTINEL.rules) {
        if (rule.trigger !== "write_file") continue;
        if (!checkRateLimit(rule.name)) {
          logSentinel(rule.name + "-ratelimit", event.input.filepath);
          return { block: true, reason: `频率限制: ${rule.name}` };
        }
        if (new RegExp(rule.pattern, "i").test(event.input.filepath)) {
          logSentinel(rule.name, event.input.filepath);
          return { block: true, reason: rule.message || rule.name };
        }
        const cp = rule.contentPattern ? new RegExp(rule.contentPattern, "i") : null;
        if (cp && cp.test(content)) {
          logSentinel(rule.name + "-scan", event.input.filepath);
          return { block: true, reason: `内容扫描: ${event.input.filepath} 含敏感信息` };
        }
      }
    }

    return null;
  }

  function logSentinel(ruleName: string, target: string): void {
    if (!SENTINEL.logFile) return;
    try {
      const logPath = SENTINEL.logFile.endsWith(".jsonl") ? SENTINEL.logFile : SENTINEL.logFile + "/sentinel-log.jsonl";
      require("fs").appendFileSync(logPath, JSON.stringify({ event: "blocked", rule: ruleName, target: target.slice(0, 200), ts: new Date().toISOString() }) + "\n", "utf-8");
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
    const cmdJson = JSON.stringify(cmd);
    const result = await callStitchAsync("mcp_dispatch", "dispatch", cmdJson, tool, task);
    if (result && !("_error" in result)) {
      return `[MCP Agent: ${peerName}]\n结果: ${JSON.stringify(result, null, 2)}`;
    }
  } catch {}
  return null;
}

async function execPlan(task: string, route: RouteResult): Promise<string> {
  const candidates: [string, number][] = [
    ["researcher", route.gewu === "research" ? 0.9 : 0.5],
    ["coder", route.gewu === "code" ? 0.9 : 0.5],
    ["auditor", route.gewu === "solution" ? 0.9 : 0.5],
  ];
  const coordinator = await electCoordinator(candidates);

  // Try MCP agent dispatch first
  const mcpResult = await tryDispatchToMCPAgent(coordinator, task);
  if (mcpResult) return mcpResult;

  // Fallback to current LLM path
  const steps = route.gewu === "code" ? ["调研需求", "编写代码", "审查质量"]
    : route.gewu === "research" ? ["收集信息", "深度分析", "整理报告"]
    : ["执行方案", "审查结果"];
  const consensus = await peerConsensus(task, [coordinator, "auditor"]);
  const outputs = await executePlanViaMaestro(task, steps);
  const ok = outputs.length > 0;
  if (ok) {
    const details = outputs.map((o: string, i: number) => `  >> Step ${i+1} (${steps[i]}):\n  ${o.slice(0, 300)}`).join("\n\n");
    return `协调员: ${coordinator}\n共识: ${consensus?.status || "通过"}\n共 ${steps.length} 步\n\n${details}`;
  }
  return `协调员: ${coordinator}, 共 ${steps.length} 步, 共识: ${consensus?.status || "通过"}`;
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

  pi.on("before_agent_start", async (event, ctx) => {
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
    ctx.ui.notify(`👤 协调员: ${route.coordinator}`, "info");

    const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    const widgetLines = [
      `📋 ETO | ${route.gewu} → ${route.route} | ${route.coordinator} | ${route.layer} ${confidence}%`,
    ];
    const routeLines = [
      `## ETO 路由分析`,
      `当前时间: ${now}`,
      `路由: ${route.gewu} → ${route.route} (${route.layer}, ${confidence}%)`,
      `协调员: ${route.coordinator}`,
    ];

    if (route.route === "plan") {
      ctx.ui.notify(`📝 Agent 匹配中...`, "info");
      const agents = matchAgentsForRoute(route.gewu);
      const agentNames = agents.map(a => a.name).join(", ");
      ctx.ui.notify(`👥 Agent: ${agentNames}`, "info");

      // Skill Memory: 匹配经验技能
      const matchedSkills = matchSkillsForRoute(route.gewu);
      for (const sk of matchedSkills) {
        ctx.ui.notify(`📚 经验: ${sk.skill_name} (${(sk.reward * 100).toFixed(0)}%)`, "info");
      }

      const plan = await execPlan(task, route);
      const consensusMatch = plan.match(/共识: (.+?)(?:\n|$)/);
      const stepMatch = plan.match(/共 (\d+) 步/);

      routeLines.push(`Agent: ${agentNames}`);
      routeLines.push(`共识: ${consensusMatch?.[1] || "通过"}`);
      routeLines.push(`计划: ${stepMatch?.[1] || "?"} 步`);
      routeLines.push("");
      routeLines.push(synthesizeSummary(task, route, agents));
      routeLines.push("");
      routeLines.push(decomposePrompt(agents));

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
      ctx.ui.notify(`🤝 共识审议中...`, "info");
      const cResult = await peerConsensus(task, ["researcher", "coder", "auditor"]);
      const score = typeof cResult?.final_score === "number" ? cResult.final_score : (typeof cResult?.avg_score === "number" ? cResult.avg_score : 0.5);
      const status = typeof cResult?.status === "string" ? cResult.status : (score >= 0.6 ? "approved" : "revise");
      ctx.ui.notify(`🤝 共识: ${status} (${(score * 100).toFixed(0)}%)`, "info");
      const actions = Array.isArray(cResult?.actions) ? cResult.actions : [];
      routeLines.push(`## 共识结果: ${status} (${(score * 100).toFixed(0)}%)`);
      if (actions.length > 0) routeLines.push(`改进行动: ${actions.join("; ")}`);
      widgetLines.push(`🤝 ${status === "approved" ? "通过" : "需修正"} ${(score * 100).toFixed(0)}%`);
      ctx.ui.setWidget("eto-route", widgetLines);
      writeMetric(route.route, "consensus", status === "approved", 1);
    } else {
      routeLines.push("");
      routeLines.push("回复格式：");
      routeLines.push("【路由】一句话说明任务归类");
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
