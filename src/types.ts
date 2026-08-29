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
}
