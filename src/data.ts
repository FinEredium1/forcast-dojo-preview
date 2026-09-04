import type { AnalysisSummary, Manifest, QuestionDetail, QuestionIndexItem, RunSummary, TrajectoryRow } from './types'

const base = `${import.meta.env.BASE_URL}data/`
let manifestPromise: Promise<Manifest> | null = null
let questionIndexPromise: Promise<QuestionIndexItem[]> | null = null
let runSummariesPromise: Promise<RunSummary[]> | null = null
let analysisPromise: Promise<AnalysisSummary> | null = null
const questionChunkCache = new Map<string, Promise<QuestionDetail[]>>()
const resultChunkCache = new Map<string, Promise<Record<string, TrajectoryRow[]>>>()

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${base}${path}`)
  if (!response.ok) throw new Error(`Unable to load ${path}: ${response.status}`)
  return response.json() as Promise<T>
}

export function loadManifest() {
  manifestPromise ??= getJson<Manifest>('manifest.json')
  return manifestPromise
}

export function loadQuestionIndex() {
  questionIndexPromise ??= getJson<QuestionIndexItem[]>('questions-index.json')
  return questionIndexPromise
}

export function loadRunSummaries() {
  runSummariesPromise ??= getJson<RunSummary[]>('results-summary.json')
  return runSummariesPromise
}

export function loadAnalysis() {
  analysisPromise ??= getJson<AnalysisSummary>('analysis-summary.json')
  return analysisPromise
}

export async function loadQuestion(item: QuestionIndexItem) {
  if (!questionChunkCache.has(item.chunk)) {
    questionChunkCache.set(item.chunk, getJson<QuestionDetail[]>(`questions/${item.chunk}`))
  }
  const questions = await questionChunkCache.get(item.chunk)!
  const question = questions.find((candidate) => candidate.id === item.id)
  if (!question) throw new Error(`Question ${item.id} is missing from ${item.chunk}`)
  return question
}

export async function loadTrajectories(item: QuestionIndexItem) {
  if (!resultChunkCache.has(item.chunk)) {
    resultChunkCache.set(item.chunk, getJson<Record<string, TrajectoryRow[]>>(`results/${item.chunk}`))
  }
  const results = await resultChunkCache.get(item.chunk)!
  return results[item.id] ?? []
}
