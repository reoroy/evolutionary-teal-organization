/**
 * 智子安检预览 — 纯函数，不依赖 Pi CLI。
 *
 * 安全约束（issue #7 / P0-1）：
 * 1. 外部命令一律用 argv 数组调用，绝不拼接 shell 字符串；
 * 2. 捕获到的路径先 resolve + realpath，拒绝逃逸当前工作目录；
 * 3. 规则正则编译失败时返回错误，由调用方跳过该规则。
 */

import { realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_BUFFER_BYTES = 1024 * 1024;
const MAX_OUTPUT_CHARS = 4096;

/**
 * 从危险命令里提取预览目标。
 * @param {string} cmd
 * @returns {{ kind: "rm-rf" | "dd" | "rm"; target: string } | null}
 */
export function extractPreviewTarget(cmd) {
  if (typeof cmd !== "string" || cmd.length === 0) return null;

  const rmRf = /rm\s+-rf\s+(\S+)/.exec(cmd);
  if (rmRf) return { kind: "rm-rf", target: rmRf[1] };

  const dd = /dd\s+if=(\S+)/.exec(cmd);
  if (dd) return { kind: "dd", target: dd[1] };

  const rm = /rm\s+(\S+)/.exec(cmd);
  if (rm) return { kind: "rm", target: rm[1] };

  return null;
}

/**
 * 解析目标路径：先做词法 resolve，再对最长可存在前缀做 realpath。
 * 不存在路径的父级也可能是 symlink，因此不能只对最终路径调用 realpath。
 * @param {string} absPath
 * @returns {string}
 */
function realpathNearest(absPath) {
  const suffix = [];
  let current = absPath;

  while (true) {
    try {
      return path.join(realpathSync(current), ...suffix);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return absPath;
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * 校验预览目标必须落在 cwd 内（含 symlink 解析后的真实路径）。
 * @param {string} rawTarget
 * @param {string} [cwd]
 * @returns {{ ok: true; path: string } | { ok: false; reason: string }}
 */
export function resolvePreviewPath(rawTarget, cwd = process.cwd()) {
  if (typeof rawTarget !== "string" || rawTarget.length === 0) {
    return { ok: false, reason: "预览目标为空" };
  }
  if (/[\0\r\n]/.test(rawTarget)) {
    return { ok: false, reason: "预览目标包含控制字符" };
  }

  let base;
  try {
    base = realpathSync(cwd);
  } catch {
    return { ok: false, reason: `无法解析工作目录: ${cwd}` };
  }

  const resolved = path.resolve(base, rawTarget);
  const real = realpathNearest(resolved);
  const withinCwd = real === base || real.startsWith(base + path.sep);
  if (!withinCwd) {
    return { ok: false, reason: `预览目标逃逸工作目录: ${rawTarget}` };
  }

  return { ok: true, path: real };
}

/**
 * 构造预览计划：只描述要调用的可执行文件与 argv，不执行任何命令。
 * @param {string} cmd
 * @param {string} [cwd]
 * @returns {{ ok: true; kind: "rm-rf" | "dd" | "rm"; target?: string; commands: { file: string; args: string[]; maxLines: number }[] } | { ok: false; reason: string } | null}
 */
export function buildPreviewPlan(cmd, cwd = process.cwd()) {
  const target = extractPreviewTarget(cmd);
  if (!target) return null;

  if (target.kind === "dd") {
    return {
      ok: true,
      kind: "dd",
      commands: [{ file: "lsblk", args: [], maxLines: 10 }],
    };
  }

  const resolved = resolvePreviewPath(target.target, cwd);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };

  const commands = [{ file: "ls", args: ["-la", resolved.path], maxLines: 20 }];
  if (target.kind === "rm") {
    commands.push({ file: "wc", args: ["-c", resolved.path], maxLines: 2 });
  }

  return { ok: true, kind: target.kind, target: resolved.path, commands };
}

/**
 * 执行预览计划。参数化调用（spawnSync + argv，shell=false），不经过 shell。
 * @param {{ ok: true; commands: { file: string; args: string[]; maxLines?: number }[] }} plan
 * @param {{ timeoutMs?: number; maxChars?: number; cwd?: string }} [options]
 * @returns {string}
 */
export function executePreviewPlan(plan, options = {}) {
  if (!plan || plan.ok !== true) return "";

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxChars = options.maxChars ?? MAX_OUTPUT_CHARS;
  const cwd = options.cwd ?? process.cwd();
  const chunks = [];

  for (const command of plan.commands) {
    const result = spawnSync(command.file, command.args, {
      cwd,
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: MAX_BUFFER_BYTES,
      shell: false,
    });

    let output;
    if (result.error) {
      output = `${command.file}: ${result.error.message}`;
    } else {
      output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    }

    const lines = output.split(/\r?\n/);
    if (typeof command.maxLines === "number" && lines.length > command.maxLines) {
      lines.length = command.maxLines;
    }
    const text = lines.join("\n").trim();
    if (text) chunks.push(text);
  }

  const joined = chunks.join("\n");
  return joined.length > maxChars ? joined.slice(0, maxChars) : joined;
}

/**
 * 安全编译规则正则。非法 pattern 不抛错，返回 error 供调用方记录并跳过规则。
 * @param {string | null | undefined} pattern
 * @param {string} [flags]
 * @returns {{ regex: RegExp | null; error: string | null }}
 */
export function compileRulePattern(pattern, flags = "i") {
  if (pattern === undefined || pattern === null || pattern === "") {
    return { regex: null, error: null };
  }
  try {
    return { regex: new RegExp(pattern, flags), error: null };
  } catch (error) {
    return { regex: null, error: error instanceof Error ? error.message : String(error) };
  }
}
