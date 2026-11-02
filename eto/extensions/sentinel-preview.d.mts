export type PreviewKind = "rm-rf" | "dd" | "rm";

export interface PreviewTarget {
  kind: PreviewKind;
  target: string;
}

export interface PreviewCommand {
  file: string;
  args: string[];
  maxLines?: number;
}

export type PreviewPlan =
  | { ok: true; kind: PreviewKind; target?: string; commands: PreviewCommand[] }
  | { ok: false; reason: string };

export type PathResolution = { ok: true; path: string } | { ok: false; reason: string };

export interface CompileRuleResult {
  regex: RegExp | null;
  error: string | null;
}

export function extractPreviewTarget(cmd: string): PreviewTarget | null;

export function resolvePreviewPath(rawTarget: string, cwd?: string): PathResolution;

export function buildPreviewPlan(cmd: string, cwd?: string): PreviewPlan | null;

export function executePreviewPlan(
  plan: PreviewPlan,
  options?: { timeoutMs?: number; maxChars?: number; cwd?: string },
): string;

export function compileRulePattern(pattern?: string | null, flags?: string): CompileRuleResult;
