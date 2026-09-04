import type { AnalysisSummary, Manifest, QuestionDetail, QuestionIndexItem, RunSummary, TrajectoryRow } from './types'

const base = `${import.meta.env.BASE_URL}data/`
let manifestPromise: Promise<Manifest> | null = null
let questionIndexPromise: Promise<QuestionIndexItem[]> | null = null
let runSummariesPromise: Promise<RunSummary[]> | null = null
let analysisPromise: Promise<AnalysisSummary> | null = null
const questionChunkCache = new Map<string, Promise<QuestionDetail[]>>()
const resultChunkCache = new Map<string, Promise<Record<string, TrajectoryRow[]>>>()
const notebookCache = new Map<string, Promise<NotebookEntry[]>>()

interface NotebookEntry {
  runId: string
  rolloutIndex: number
  stepIndex: number
  notebook: string
}

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
  const rows = results[item.id] ?? []
  if (!rows.some((row) => row.notebookAvailable)) return rows

  if (!notebookCache.has(item.id)) {
    notebookCache.set(item.id, getJson<NotebookEntry[]>(`notebooks/${encodeURIComponent(item.id)}.json`))
  }
  const notebooks = await notebookCache.get(item.id)!
  const byCheckpoint = new Map(
    notebooks.map((entry) => [
      `${entry.runId}:${entry.rolloutIndex}:${entry.stepIndex}`,
      entry.notebook,
    ]),
  )
  return rows.map((row) => ({
    ...row,
    notebook: byCheckpoint.get(`${row.runId}:${row.rolloutIndex}:${row.stepIndex}`) ?? null,
  }))
}
