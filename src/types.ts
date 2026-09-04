export type SourceType = 'open' | 'closed'
export type ForecastMode = 'sequential' | 'independent' | 'unknown'

export interface CrowdSummary {
  name: string
  brier: number
  accuracy: number
  infoAlpha: number
  nRows: number
  nScored: number
}

export interface Manifest {
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
