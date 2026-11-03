// mode-routing.mjs 的类型声明（与 sentinel-preview.d.mts 同模式）
export type Body = "li" | "shi" | "de";

export interface ThreeBodyWeights {
  li: number;
  shi: number;
  de: number;
}

export type Era = "stable" | "chaotic";

export type Mode = "research" | "build" | "debate" | "full" | "direct";

export type RouteKind = "direct" | "plan" | "consensus";

export interface EraClassification {
  era: Era;
  margin: number;
}

export interface HistoryStats {
  samples: number;
  successRate: number;
}

export type ModeDispatchPath = "direct" | "pipeline" | "consensus" | "full";

export interface ModeDispatch {
  mode: Mode;
  era: Era;
  path: ModeDispatchPath;
  coordinatorHint: string;
  steps: string[];
  reviewPeers: string[];
  reworkRounds: number;
  reviewDepth: "deep" | "standard";
}

export interface RoutedMode {
  route: RouteKind;
  weights: ThreeBodyWeights;
  era: Era;
  mode: Mode;
}

export const MODES: Mode[];
export const ERAS: Era[];
export const CHAOTIC_MARGIN: number;
export const CHAOTIC_REWORK_ROUNDS: number;
export const STABLE_REWORK_ROUNDS: number;

export function deriveWeights(task: string): ThreeBodyWeights;

export function normalizeWeights(raw: unknown): ThreeBodyWeights | null;

export function classifyEra(weights: ThreeBodyWeights): EraClassification;

export function selectMode(weights: ThreeBodyWeights, route: RouteKind): Mode;

export function adjustConfidence(confidence: number, history?: HistoryStats): number;

export function buildModeDispatch(route: RoutedMode): ModeDispatch;

export function routeWithMode(task: string, route: RouteKind, llmWeights?: unknown): RoutedMode;

export function formatWeights(weights: ThreeBodyWeights): string;
