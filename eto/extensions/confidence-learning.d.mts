// confidence-learning.mjs 的类型声明（与 mode-routing.d.mts 同模式）

export interface LearningConfig {
  enabled: boolean;
  minSamples: number;
  lowSuccessThreshold: number;
  maxPeerDownweight: number;
}

export interface LearningStats {
  samples: number;
  successRate: number;
}

export interface HistorySummary {
  total: number;
  overall: LearningStats;
  modeStats: Record<string, LearningStats>;
  peerStats: Record<string, LearningStats>;
}

export interface SummarizeAllResult {
  byGewu: Record<string, HistorySummary>;
  overall: LearningStats;
}

export interface LearningAdjustment {
  kind: "mode-demotion" | "mode-at-floor" | "peer-downweight";
  [key: string]: unknown;
}

export interface RoutingPredictionRecord {
  type: "prediction";
  id: string;
  ts: string;
  task: string;
  gewu: string;
  route: string;
  mode: string;
  weights: unknown;
  confidence: number;
  coordinator: string;
  peers: string[];
}

export interface RoutingOutcomeRecord {
  type: "outcome";
  id: string;
  ts: string;
  outcome: "success" | "failure";
  reason: string;
}

export type RoutingRecord = RoutingPredictionRecord | RoutingOutcomeRecord;

export interface PredictionInput {
  task: string;
  gewu: string;
  route: string;
  mode: string;
  weights?: unknown;
  confidence?: number;
  coordinator: string;
  peers?: string[];
}

export interface ModeLearningResult {
  mode: string;
  adjustments: LearningAdjustment[];
}

export interface CandidateLearningResult {
  candidates: [string, number][];
  adjustments: LearningAdjustment[];
}

export interface ResetResult {
  reset: boolean;
  existed: boolean;
}

export const DEFAULT_LEARNING_CONFIG: LearningConfig;

export function normalizeLearningConfig(raw: unknown): LearningConfig;

export function appendPrediction(path: string, prediction: PredictionInput): RoutingPredictionRecord;

export function appendOutcome(
  path: string,
  id: string,
  outcome: "success" | "failure",
  reason: string
): RoutingOutcomeRecord | null;

export function resetRoutingHistory(path: string): ResetResult;

export function loadRoutingHistory(path: string): RoutingRecord[];

export function summarizeHistory(records: RoutingRecord[], gewu?: string): HistorySummary;

export function summarizeAll(records: RoutingRecord[]): SummarizeAllResult;

export function selectModeWithLearning(
  weights: { li: number; shi: number; de: number },
  route: string,
  modeStats: Record<string, LearningStats>,
  config: LearningConfig
): ModeLearningResult;

export function adjustCoordinatorCandidates(
  candidates: [string, number][],
  peerStats: Record<string, LearningStats>,
  config: LearningConfig
): CandidateLearningResult;

export function formatAdjustments(adjustments: LearningAdjustment[]): string[];
