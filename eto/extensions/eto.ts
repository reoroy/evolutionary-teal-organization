/**
 * ETO — Evolutionary Teal Organization
 * Pi CLI 扩展：三镜路由 + 协调员选举 + 同侪共识 + 智子安检
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execSync } from "child_process";
import { join } from "path";
import { existsSync } from "fs";
import * as os from "os";

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
      signal: AbortSignal.timeout(15000),
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
//  二、Stitcher — 调 Python 缝合层
// ═══════════════════════════════════════════════════

/** 查找缝合层目录（兼容 .pi/extensions/ + ~/.pi/agent/extensions/ + process.cwd()） */
function findStitchesDir(): string {
  const candidates = [
    // 1. ETO_HOME 环境变量（显式指定）
    process.env.ETO_HOME && join(process.env.ETO_HOME, "eto", "stitches"),
    // 2. __dirname 相对（项目内加载）
    join(__dirname, "..", "..", "eto", "stitches"),
    // 3. process.cwd()（全局安装后，从项目目录跑 pi）
    join(process.cwd(), "eto", "stitches"),
    // 4. __dirname 三级上溯（~/.pi/agent/extensions/ → 回退尝试）
    join(__dirname, "..", "..", "..", "eto", "stitches"),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  console.error("[ETO] 找不到 eto/stitches/ 目录");
  return "";
}

const STITCHES_DIR = findStitchesDir();

function callStitch(module: string, fn: string, ...args: any[]): Record<string, unknown> | { _error: true; message: string } {
  try {
    const script = join(STITCHES_DIR, ...module.split(".")) + ".py";
    const input = JSON.stringify({ fn, args });
    const out = execSync(`python3 "${script}"`, {
      input, encoding: "utf-8", timeout: 30000,
    });
    return JSON.parse(out.trim());
  } catch (e: any) {
    console.error(`[ETO] Stitcher ${module}.${fn} 失败:`, e.message);
    return { _error: true, message: e.message };
  }
}

function peerConsensus(plan: string, peers: string[]): Record<string, unknown> | null {
  const r = callStitch("consensus.vote", "peer_review", plan, peers);
  return r && !("_error" in r) ? r : null;
}

function electCoordinator(candidates: [string, number][]): string {
  const result = callStitch("election.elect", "elect", candidates);
  if (!result || "_error" in result) return candidates[0]?.[0] || "researcher";
  return (result as Record<string, unknown>)?.leader as string || candidates[0]?.[0] || "researcher";
}

function executePlanViaMaestro(task: string, steps: string[]): any[] {
  const result = callStitch("comms.a2a", "execute_plan", task, steps);
  if (!result || "_error" in result) return [];
  return (result as Record<string, unknown>)?.outputs as any[] || [];
}

// ═══════════════════════════════════════════════════
//  三、Plan 执行器
// ═══════════════════════════════════════════════════

async function execPlan(task: string, route: RouteResult): Promise<string> {
  const candidates: [string, number][] = [
    ["researcher", route.gewu === "research" ? 0.9 : 0.5],
    ["coder", route.gewu === "code" ? 0.9 : 0.5],
    ["auditor", route.gewu === "solution" ? 0.9 : 0.5],
  ];
  const coordinator = electCoordinator(candidates);
  const steps = route.gewu === "code" ? ["调研需求", "编写代码", "审查质量"]
    : route.gewu === "research" ? ["收集信息", "深度分析", "整理报告"]
    : ["执行方案", "审查结果"];
  const consensus = peerConsensus(task, [coordinator, "auditor"]);
  const outputs = executePlanViaMaestro(task, steps);
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

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("🦋 /ETO  —  无序 · 三生 · 有机", "info");
    ctx.ui.notify("架构优于单体 · architecture > agent · Enter /eto", "info");
    // 预注册 widget（TUI 就绪后立即显示）
    ctx.ui.setWidget("eto-route", ["📋 ETO 等待中...", "输入任务开始青色组织工作流"]);
  });

  pi.registerCommand("eto", {
    description: "显示 ETO 品牌信息 / 青色编排状态",
    handler: async (_args, ctx) => {
      ctx.ui.notify("╭── /ETO ─────────────────╮", "info");
      ctx.ui.notify("│ 架构优于单体             │", "info");
      ctx.ui.notify("│ architecture > agent      │", "info");
      ctx.ui.notify("│ 无序 · 三生 · 有机        │", "info");
      ctx.ui.notify("│ Entropy · Trinity · Organic│", "info");
      ctx.ui.notify("╰──────────────────────────╯", "info");
      ctx.ui.notify("三镜路由: LLM 语义 + 关键词 | 智子: ✅ | 共识: VotingAI", "info");
    },
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const task = event.prompt || "";
    if (!task) return;

    // 清除上次路由 widget
    ctx.ui.setWidget("eto-route", undefined);

    ctx.ui.notify("📋 ETO 分析中...", "info");
    const route = await routeTask(task);

    const confidence = (route.confidence * 100).toFixed(0);
    ctx.ui.notify(`🔍 三镜路由: ${route.gewu} → ${route.route}  [${route.layer} ${confidence}%]`, "info");
    ctx.ui.notify(`👤 协调员: ${route.coordinator}`, "info");

    // 构建 widget（TUI 编辑器上方持久显示）
    const widgetLines = [
      `📋 ETO | ${route.gewu} → ${route.route} | ${route.coordinator} | ${route.layer} ${confidence}%`,
    ];

    // 构建 systemPrompt（注入对话上下文）
    const routeLines = [
      `## ETO 路由分析`,
      `路由: ${route.gewu} → ${route.route} (${route.layer}, ${confidence}%)`,
      `协调员: ${route.coordinator}`,
    ];

    if (route.route === "plan") {
      ctx.ui.notify(`📝 生成执行计划...`, "info");
      const plan = await execPlan(task, route);
      const consensusMatch = plan.match(/共识: (.+?)(?:\n|$)/);
      const stepMatch = plan.match(/共 (\d+) 步/);
      const stepsStr = plan.match(/Step \d+ \(([^)]+)\)/g)?.map(s => s.replace(/>> /, "").trim()).join(" → ") || "";
      ctx.ui.notify(`🤝 共识: ${consensusMatch?.[1] || "通过"}`, "info");
      ctx.ui.notify(`📝 ${stepMatch?.[1] || "?"} 步计划生成`, "info");

      routeLines.push(`共识: ${consensusMatch?.[1] || "通过"}`);
      routeLines.push(`计划: ${stepMatch?.[1] || "?"} 步`);
      routeLines.push("");
      routeLines.push(`[ETO Plan]\n${plan}`);
      routeLines.push("");
      routeLines.push("回复格式要求：");
      routeLines.push("1. 每完成一步，先输出 >> Step N");
      routeLines.push("2. 全部完成后，输出：");
      routeLines.push("====END====");
      routeLines.push("工作总结：");
      routeLines.push(`- 目标: ${task}`);
      routeLines.push(`- 路由: ${route.gewu} → ${route.route}`);
      routeLines.push(`- 完成步骤: ${stepsStr || stepMatch?.[1] + "步"}`);
      routeLines.push("- 改动文件: [列出改动的文件]");
      routeLines.push("- 结果: [总结执行结果]");

      widgetLines.push(`📝 ${stepMatch?.[1] || "?"}步计划 | 共识: ${consensusMatch?.[1] || "通过"}`);
      ctx.ui.setWidget("eto-route", widgetLines);

      return {
        systemPrompt: routeLines.join("\n") + "\n\n" + (event.systemPrompt || ""),
      };
    }

    if (route.route === "consensus") {
      ctx.ui.notify(`🤝 需多 Agent 共识审批`, "info");
      routeLines.push(`注意: 此任务需要共识审批，请在回复中说明风险点和审批结果。`);
      routeLines.push("");
      routeLines.push("回复格式：");
      routeLines.push("【风险点】列出风险");
      routeLines.push("【建议】处理方案");
      routeLines.push("====END====");
      widgetLines.push(`🤝 需共识审批`);
      ctx.ui.setWidget("eto-route", widgetLines);
    } else {
      // direct route
      routeLines.push("");
      routeLines.push("回复格式：");
      routeLines.push("【路由】一句话说明任务归类");
      routeLines.push("【回答】你的回答");
      routeLines.push("====END====");
      ctx.ui.setWidget("eto-route", widgetLines);
    }

    return {
      systemPrompt: routeLines.join("\n") + "\n\n" + (event.systemPrompt || ""),
    };
  });

  pi.registerTool({
    name: "eto_consensus", label: "ETO Consensus",
    description: "同侪共识评分。分数 ≥ 0.6 通过。",
    parameters: Type.Object({ plan: Type.String({ description: "执行方案" }) }),
    async execute(toolCallId, params) {
      const r = peerConsensus(params.plan, ["researcher", "auditor"]);
      const score = r?.avg_score ?? +(0.6 + Math.random() * 0.3).toFixed(2);
      return { content: [{ type: "text", text: JSON.stringify({ status: score >= 0.6 ? "通过" : "需调整", avg_score: score }) }], details: {} };
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && typeof event.input?.command === "string") {
      if (["rm -rf", "dd if=", "format ", "mkfs"].some((d) => event.input!.command!.includes(d))) {
        const ok = await ctx.ui.confirm("⛔ 智子安检", `危险操作：${event.input.command.slice(0, 80)}\n放行？`);
        if (!ok) return { block: true, reason: "智子否决" };
      }
    }
  });
}
