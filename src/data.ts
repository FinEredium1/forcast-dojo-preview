import type { Manifest, QuestionDetail, QuestionIndexItem, RunSummary, TrajectoryRow } from './types'

const base = `${import.meta.env.BASE_URL}data/`
const questionChunkCache = new Map<string, Promise<QuestionDetail[]>>()
const resultChunkCache = new Map<string, Promise<Record<string, TrajectoryRow[]>>>()

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${base}${path}`)
  if (!response.ok) throw new Error(`Unable to load ${path}: ${response.status}`)
  return response.json() as Promise<T>
}

export function loadManifest() {
  return getJson<Manifest>('manifest.json')
}

export function loadQuestionIndex() {
  return getJson<QuestionIndexItem[]>('questions-index.json')
}

export function loadRunSummaries() {
  return getJson<RunSummary[]>('results-summary.json')
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
