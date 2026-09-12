export type SourceType = 'open' | 'closed'
export type ForecastMode = 'sequential' | 'independent' | 'unknown'

export interface CrowdSummary {
  name: string
  brier: number | null
  accuracy: number | null
  infoAlpha: number
  nRows: number
  nScored: number | null
}

export interface Manifest {
  resultLayout?: 'question'
  evaluationQuestionCount?: number
  evaluationCheckpointCount?: number
  modelCount?: number
  rolloutCount?: number
  forecastCount?: number
  expectedForecastCount?: number
  missingForecastCount?: number
  scoringPolicy?: string
  version: string
  label: string
  generatedAt: string
  questionCount: number
  checkpointCount: number
  splitCounts: Record<string, number>
  domainCounts: Record<string, number>
  beliefCounts: Record<string, number>
  questionChunks: number
  resultRunCount: number
  notebookBaselines?: Array<{
    modelName: string
    validRate: number
  }>
  crowd: CrowdSummary
  huggingFace?: {
    repository: string
    datasetUrl: string
    revision: string
    webBase: string
  }
}

export interface QuestionIndexItem {
  id: string
  slug: string
  title: string
  domain: string
  domains: string[]
  split: 'train' | 'eval'
  beliefKind: string
  resolvedLabel: string
  checkpointCount: number
  firstForecastDate: string | null
  lastForecastDate: string | null
  lastCrowdProbability: number | null
  chunk: string
}

export interface QuestionDetail extends QuestionIndexItem {
  body: string
  tags: string[]
  marketFlags: string[]
  startDate: string | null
  closeDate: string | null
  forecastDates: string[]
  crowdProbabilities: Array<number | null>
  options: string[]
}

export interface RunSummary {
  baseModel?: string
  recency?: boolean
  retrieval?: string
  sourceRelease?: string
  protocol?: string
  rolloutCount?: number
  nExpected?: number
  nMissing?: number
  avgUsd?: number | null
  totalUsd?: number | null
  id: string
  modelName: string
  sourceType: SourceType
  mode: ForecastMode
  file: string
  nRows: number
  nScored: number
  coverage: number
  brier: number | null
  accuracy: number | null
  infoAlpha: number | null
  complete: boolean
  totalToolCalls?: number
  avgToolCalls?: number | null
  avgSearchCalls?: number | null
  avgScrapeCalls?: number | null
  avgPythonCalls?: number | null
  avgOtherToolCalls?: number | null
  avgModelCalls?: number | null
  totalInputTokens?: number
  avgInputTokens?: number | null
  totalOutputTokens?: number
  avgOutputTokens?: number | null
  totalCacheReadTokens?: number
  avgModelLatencySeconds?: number | null
  notebookValidRate?: number | null
  responseRate?: number | null
}

export interface ConfidenceInterval {
  lower: number | null
  upper: number | null
}

export interface MetricAggregate {
  nRows: number
  nScored: number
  nQuestions: number
  coverage: number
  accuracy: number | null
  brier: number | null
  infoAlpha: number | null
}

export interface MetricAggregateWithIntervals extends MetricAggregate {
  intervals: {
    accuracy: ConfidenceInterval | null
    brier: ConfidenceInterval | null
    infoAlpha: ConfidenceInterval | null
  }
}

export interface BreakdownAggregate extends MetricAggregate {
  key: string
  label: string
}

export interface QuestionPerformance extends MetricAggregate {
  id: string
  title: string
  domain: string
}

export interface RunAnalysis {
  runId: string
  modelName: string
  sourceType: SourceType
  mode: ForecastMode
  overall: MetricAggregateWithIntervals
  byDomain: BreakdownAggregate[]
  byQuestionType: BreakdownAggregate[]
  byHorizon: BreakdownAggregate[]
  bestQuestions: QuestionPerformance[]
  worstQuestions: QuestionPerformance[]
}

export interface DifferenceAggregate {
  nMatched: number
  nQuestions: number
  accuracyDifference: number | null
  brierDifference: number | null
  infoAlphaDifference: number | null
  sequentialWinRate: number | null
}

export interface DifferenceBreakdown extends DifferenceAggregate {
  key: string
  label: string
}

export interface PairedModeComparison extends DifferenceAggregate {
  modelName: string
  sourceType: SourceType
  sequentialRunId: string
  independentRunId: string
  intervals: {
    accuracyDifference: ConfidenceInterval | null
    brierDifference: ConfidenceInterval | null
    infoAlphaDifference: ConfidenceInterval | null
  }
  byDomain: DifferenceBreakdown[]
  byHorizon: DifferenceBreakdown[]
}

export interface AnalysisSummary {
  schemaVersion: number
  generatedAt: string
  bootstrap: {
    method: string
    confidenceLevel: number
    samples: number
  }
  horizonBuckets: Array<{ key: string; label: string }>
  domains: string[]
  questionTypes: string[]
  findings: {
    bestRunId: string | null
    bestOpenRunId: string | null
    sequentialAccuracyWins: number
    independentAccuracyWins: number
    pairedModelCount: number
    closestDomain: {
      runId: string
      modelName: string
      mode: ForecastMode
      domain: string
      infoAlpha: number
      nScored: number
    } | null
  }
  runs: RunAnalysis[]
  pairedModes: PairedModeComparison[]
  research?: {
    consistency: ConsistencySummary[]
    dynamics: DynamicsSummary[]
    recency: RecencyComparison[]
  }
}

export interface ConsistencySummary {
  runId: string
  modelName: string
  sourceType: SourceType
  mode: ForecastMode
  retrieval: string
  nGroups: number
  nUsed: number
  disagreement: number
  brierSingle: number
  brierEnsemble: number
  ensembleGain: number
  accuracySingle: number
  accuracyEnsemble: number
}

export interface DynamicsSummary {
  runId: string
  modelName: string
  sourceType: SourceType
  retrieval: string
  nEpisodes: number
  excessMovement: number
  interval: ConfidenceInterval
  modelLeadDays: number
  crowdLeadDays: number
  finalAccuracy: number
}

export interface RecencyComparison {
  modelName: string
  sourceType: SourceType
  mode: ForecastMode
  nMatched: number
  brierDifference: number
  accuracyDifference: number
  infoAlphaDifference: number
  intervals: {
    brierDifference: ConfidenceInterval
    accuracyDifference: ConfidenceInterval
    infoAlphaDifference: ConfidenceInterval
  }
}

export interface ToolUsageMetric {
  known: boolean | null
  calls: number
  successes: number
  errors: number
  parseErrors: number
  latencySeconds: number
}

export interface TrajectoryRow {
  baseModel?: string
  recency?: boolean
  retrieval?: string
  sourceRelease?: string
  protocol?: string
  usdTotal?: number | null
  repeatCount?: number
  runId: string
  modelName: string
  sourceType: SourceType
  mode: ForecastMode
  eventId: string
  rolloutIndex: number
  stepIndex: number
  forecastDate: string | null
  resolvedLabel: string | null
  forecast: Record<string, number> | null
  brier: number | null
  accuracy: number | null
  infoAlpha: number | null
  crowdProbability: number | null
  truthProbability: number | null
  parseOk: boolean
  termination: string | null
  toolIterations?: number
  toolCalls?: number
  cancelledToolCalls?: number
  searchCalls?: number
  scrapeCalls?: number
  pythonCalls?: number
  tools?: Record<string, ToolUsageMetric>
  modelCalls?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheHitRate?: number | null
  modelLatencySeconds?: number
  notebookFormatOk?: number | null
  notebookAvailable?: boolean
  notebook?: string | null
}

export interface NotebookDetailRow {
  runId: string
  modelName: string
  mode: ForecastMode
  retrieval: string
  rolloutIndex: number
  stepIndex: number
  forecastDate: string | null
  notebook: string
  characters: number
  blockCount: number
  formatOk: boolean
  jsonValid: boolean
}

export interface ToolDetailRow extends ToolUsageMetric {
  runId: string
  modelName: string
  mode: ForecastMode
  retrieval: string
  rolloutIndex: number
  stepIndex: number
  forecastDate: string | null
  toolName: string
  canonicalTool: string
}

export interface QuestionProcessDetail {
  eventId: string
  notebooks: NotebookDetailRow[]
  tools: ToolDetailRow[]
}
