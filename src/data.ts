import type {
  AnalysisSummary,
  Manifest,
  QuestionDetail,
  QuestionIndexItem,
  QuestionProcessDetail,
  RunSummary,
  ToolUsageMetric,
  TrajectoryRow,
} from './types'

const localBase = `${import.meta.env.BASE_URL}data/`
const cache = new Map<string, Promise<unknown>>()

function normalizedBase(value: string) {
  return value.endsWith('/') ? value : `${value}/`
}

function getJson<T>(url: string): Promise<T> {
  if (!cache.has(url)) {
    const request = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
        return response.json()
      })
      .catch((error) => {
        cache.delete(url)
        throw error
      })
    cache.set(url, request)
  }
  return cache.get(url) as Promise<T>
}

function localJson<T>(path: string) {
  return getJson<T>(`${localBase}${path}`)
}

function webAssetBase(manifest: Manifest) {
  const override = import.meta.env.VITE_HF_DATA_BASE?.trim()
  if (override) return normalizedBase(override)
  if (manifest.huggingFace?.webBase) return normalizedBase(manifest.huggingFace.webBase)
  throw new Error('This snapshot does not provide a Hugging Face web-asset location.')
}

function remoteError(kind: string, item: QuestionIndexItem, error: unknown) {
  console.warn(`Unable to load ${kind} for question ${item.id} from Hugging Face.`, error)
  return new Error(
    `Full ${kind} for question ${item.id} could not be loaded from Hugging Face. Check that this question's web assets are published and that you are online.`,
  )
}

export const loadManifest = () => localJson<Manifest>('manifest.json')
export const loadQuestionIndex = () => localJson<QuestionIndexItem[]>('questions-index.json')
export const loadRunSummaries = () => localJson<RunSummary[]>('results-summary.json')
export const loadAnalysis = () => localJson<AnalysisSummary>('analysis-summary.json')

export async function loadQuestion(item: QuestionIndexItem) {
  const questions = await localJson<QuestionDetail[]>(`questions/${item.chunk}`)
  const question = questions.find((candidate) => candidate.id === item.id)
  if (!question) throw new Error(`Question ${item.id} is missing from ${item.chunk}`)
  return { ...item, ...question }
}

export async function loadTrajectories(item: QuestionIndexItem, manifest: Manifest) {
  if (item.split !== 'eval') return []
  try {
    return await getJson<TrajectoryRow[]>(`${webAssetBase(manifest)}trajectories/${encodeURIComponent(item.id)}.json`)
  } catch (error) {
    throw remoteError('forecast trajectories', item, error)
  }
}

export async function loadQuestionProcess(item: QuestionIndexItem, manifest: Manifest) {
  if (item.split !== 'eval') return { eventId: item.id, notebooks: [], tools: [] } satisfies QuestionProcessDetail
  try {
    return await getJson<QuestionProcessDetail>(`${webAssetBase(manifest)}details/${encodeURIComponent(item.id)}.json`)
  } catch (error) {
    throw remoteError('notebook and tool records', item, error)
  }
}

function checkpointKey(runId: string, rolloutIndex: number, stepIndex: number, forecastDate: string | null) {
  return `${runId}:${rolloutIndex}:${stepIndex}:${forecastDate ?? ''}`
}

export function attachQuestionProcess(rows: TrajectoryRow[], detail: QuestionProcessDetail) {
  const notebooks = new Map(
    detail.notebooks.map((entry) => [
      checkpointKey(entry.runId, entry.rolloutIndex, entry.stepIndex, entry.forecastDate),
      entry,
    ]),
  )
  const tools = new Map<string, Record<string, ToolUsageMetric>>()
  for (const entry of detail.tools) {
    const key = checkpointKey(entry.runId, entry.rolloutIndex, entry.stepIndex, entry.forecastDate)
    const checkpoint = tools.get(key) ?? {}
    const label = entry.toolName === entry.canonicalTool
      ? entry.canonicalTool
      : `${entry.canonicalTool} · ${entry.toolName}`
    const previous = checkpoint[label]
    checkpoint[label] = {
      known: entry.known,
      calls: (previous?.calls ?? 0) + entry.calls,
      successes: (previous?.successes ?? 0) + entry.successes,
      errors: (previous?.errors ?? 0) + entry.errors,
      parseErrors: (previous?.parseErrors ?? 0) + entry.parseErrors,
      latencySeconds: (previous?.latencySeconds ?? 0) + entry.latencySeconds,
    }
    tools.set(key, checkpoint)
  }
  return rows.map((row) => {
    const key = checkpointKey(row.runId, row.rolloutIndex, row.stepIndex, row.forecastDate)
    const notebook = notebooks.get(key)
    return {
      ...row,
      tools: tools.get(key) ?? row.tools,
      searchCalls: row.searchCalls ?? toolCalls(tools.get(key), 'search'),
      scrapeCalls: row.scrapeCalls ?? toolCalls(tools.get(key), 'scrape'),
      pythonCalls: row.pythonCalls ?? toolCalls(tools.get(key), 'python'),
      notebook: notebook?.notebook ?? row.notebook ?? null,
      notebookFormatOk: notebook ? Number(notebook.formatOk) : row.notebookFormatOk,
    }
  })
}

function toolCalls(tools: Record<string, ToolUsageMetric> | undefined, prefix: string) {
  if (!tools) return undefined
  const values = Object.entries(tools)
    .filter(([name]) => name === prefix || name.startsWith(`${prefix} ·`))
    .map(([, metric]) => metric.calls)
  return values.length ? values.reduce((sum, value) => sum + value, 0) : undefined
}
