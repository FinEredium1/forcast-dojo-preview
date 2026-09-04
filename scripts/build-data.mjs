import { createReadStream, existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { buildAnalysis } from './build-analysis.mjs'

const CHUNK_SIZE = 100
const args = parseArgs(process.argv.slice(2))

if (!args.train || !args.eval) {
  console.error('Usage: npm run data:build -- --train <forecast_train.jsonl> --eval <forecast_eval.jsonl> [--results <dir> ...]')
  process.exit(1)
}

const root = resolve(import.meta.dirname, '..')
const outputRoot = join(root, 'public', 'data')
const release = JSON.parse(await readFile(join(root, 'data.release.json'), 'utf8'))

await rm(outputRoot, { recursive: true, force: true })
await mkdir(join(outputRoot, 'questions'), { recursive: true })
await mkdir(join(outputRoot, 'results'), { recursive: true })
await mkdir(join(outputRoot, 'notebooks'), { recursive: true })

const questions = [
  ...(await readJsonl(resolve(args.train))).map((row) => normalizeQuestion(row, 'train')),
  ...(await readJsonl(resolve(args.eval))).map((row) => normalizeQuestion(row, 'eval')),
]

questions.sort((a, b) => a.id.localeCompare(b.id))

const index = []
const eventToChunk = new Map()
for (let offset = 0; offset < questions.length; offset += CHUNK_SIZE) {
  const chunkNumber = Math.floor(offset / CHUNK_SIZE)
  const file = `chunk-${String(chunkNumber).padStart(3, '0')}.json`
  const chunk = questions.slice(offset, offset + CHUNK_SIZE)
  for (const question of chunk) {
    eventToChunk.set(question.id, file)
    index.push({
      id: question.id,
      slug: question.slug,
      title: question.title,
      domain: question.domain,
      domains: question.domains,
      split: question.split,
      beliefKind: question.beliefKind,
      resolvedLabel: question.resolvedLabel,
      checkpointCount: question.forecastDates.length,
      firstForecastDate: question.forecastDates.at(0) ?? null,
      lastForecastDate: question.forecastDates.at(-1) ?? null,
      lastCrowdProbability: question.crowdProbabilities.at(-1) ?? null,
      chunk: file,
    })
  }
  await writeJson(join(outputRoot, 'questions', file), chunk)
}

const resultFiles = await discoverResultFiles(args.results ?? [])
const runRows = []
const trajectoryMap = new Map()
const notebookMap = new Map()

for (const file of resultFiles) {
  const rows = await readJsonl(file)
  if (!rows.length) continue

  const normalizedRows = rows.map(normalizeResultRow)
  runRows.push(summarizeRun(file, normalizedRows))

  for (const row of normalizedRows) {
    if (!eventToChunk.has(row.eventId)) continue
    if (!trajectoryMap.has(row.eventId)) trajectoryMap.set(row.eventId, [])
    trajectoryMap.get(row.eventId).push(toTrajectoryRow(row))
    if (row.notebook) {
      if (!notebookMap.has(row.eventId)) notebookMap.set(row.eventId, [])
      notebookMap.get(row.eventId).push({
        runId: row.runId,
        rolloutIndex: row.rolloutIndex,
        stepIndex: row.stepIndex,
        notebook: row.notebook,
      })
    }
  }
}

for (let offset = 0; offset < questions.length; offset += CHUNK_SIZE) {
  const chunkNumber = Math.floor(offset / CHUNK_SIZE)
  const file = `chunk-${String(chunkNumber).padStart(3, '0')}.json`
  const chunk = {}
  for (const question of questions.slice(offset, offset + CHUNK_SIZE)) {
    chunk[question.id] = (trajectoryMap.get(question.id) ?? []).sort(compareTrajectoryRows)
  }
  await writeJson(join(outputRoot, 'results', file), chunk)
}

for (const [eventId, notebooks] of notebookMap) {
  await writeJson(
    join(outputRoot, 'notebooks', `${encodeURIComponent(eventId)}.json`),
    notebooks.sort((a, b) => a.runId.localeCompare(b.runId)
      || a.rolloutIndex - b.rolloutIndex
      || a.stepIndex - b.stepIndex),
  )
}

const splitCounts = countBy(questions, (question) => question.split)
const domainCounts = countBy(questions, (question) => question.domain)
const beliefCounts = countBy(questions, (question) => question.beliefKind)
const checkpointCount = questions.reduce((sum, question) => sum + question.forecastDates.length, 0)

const manifest = {
  version: release.version,
  label: release.label,
  generatedAt: new Date().toISOString(),
  questionCount: questions.length,
  checkpointCount,
  splitCounts,
  domainCounts,
  beliefCounts,
  chunkSize: CHUNK_SIZE,
  questionChunks: Math.ceil(questions.length / CHUNK_SIZE),
  resultRunCount: runRows.length,
  notebookBaselines: release.notebookBaselines ?? [],
  crowd: release.crowd,
}

await writeJson(join(outputRoot, 'manifest.json'), manifest)
await writeJson(join(outputRoot, 'questions-index.json'), index)
await writeJson(join(outputRoot, 'results-summary.json'), runRows.sort((a, b) => a.brier - b.brier))
await buildAnalysis(outputRoot)

console.log(JSON.stringify({
  output: outputRoot,
  questions: questions.length,
  checkpoints: checkpointCount,
  questionChunks: manifest.questionChunks,
  resultFiles: resultFiles.length,
  resultRuns: runRows.length,
  publicFieldsOnly: true,
}, null, 2))

function parseArgs(values) {
  const parsed = { results: [] }
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index]
    const value = values[index + 1]
    if (key === '--train') parsed.train = value
    if (key === '--eval') parsed.eval = value
    if (key === '--results') parsed.results.push(value)
    if (key.startsWith('--')) index += 1
  }
  return parsed
}

async function readJsonl(path) {
  const rows = []
  const input = createReadStream(path, { encoding: 'utf8' })
  const lines = createInterface({ input, crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line.trim()) continue
    rows.push(JSON.parse(line))
  }
  return rows
}

function normalizeQuestion(row, split) {
  const metadata = row.metadata ?? {}
  const question = metadata.question ?? {}
  return {
    id: String(row.event_id),
    slug: row.slug ?? String(row.event_id),
    title: question.title ?? row.prompt ?? 'Untitled question',
    body: question.body ?? '',
    domain: metadata.domain ?? 'unknown',
    domains: metadata.domains ?? [metadata.domain ?? 'unknown'],
    tags: metadata.tags ?? [],
    marketFlags: metadata.market_flags ?? [],
    split,
    beliefKind: row.belief_kind,
    resolvedLabel: row.label,
    startDate: metadata.start_date ?? null,
    closeDate: question.close_date ?? null,
    forecastDates: metadata.forecast_dates ?? [],
    crowdProbabilities: metadata.crowd_probs ?? [],
    options: extractOptions(question, row.belief_kind),
  }
}

function extractOptions(question, beliefKind) {
  if (beliefKind === 'binary') return ['YES', 'NO']
  const markets = question.markets ?? []
  return markets.map((market) => market.label ?? market.question).filter(Boolean)
}

async function discoverResultFiles(paths) {
  const files = []
  for (const value of paths) {
    const path = resolve(value)
    if (!existsSync(path)) continue
    const entries = await readdir(path, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(join(path, entry.name))
    }
  }
  return files.sort()
}

function normalizeResultRow(row) {
  const modelName = row.model_name ?? 'Unknown model'
  const metrics = row.metrics ?? {}
  const perTool = metrics.per_tool_metrics ?? {}
  const finalResponse = typeof row.final_response === 'string' ? row.final_response : ''
  return {
    runId: row.run_id ?? `${modelName}.${row.mode ?? 'unknown'}`,
    modelName,
    sourceType: classifySource(modelName),
    mode: row.mode ?? 'unknown',
    eventId: String(row.event_id),
    rolloutIndex: row.rollout_idx ?? 0,
    stepIndex: row.step_idx ?? 0,
    forecastDate: row.forecast_date ?? null,
    resolvedLabel: row.resolved_label ?? null,
    forecast: row.agent_forecast ?? null,
    brier: numeric(row.brier),
    accuracy: numeric(row.accuracy),
    infoAlpha: numeric(row.info_alpha),
    crowdProbability: numeric(row.crowd_prob),
    truthProbability: numeric(row.p_truth),
    parseOk: Boolean(row.parse_ok),
    termination: row.termination ?? null,
    toolIterations: numeric(metrics.tool_iters) ?? 0,
    toolCalls: numeric(metrics.tool_calls) ?? 0,
    cancelledToolCalls: numeric(metrics.cancelled_tool_calls) ?? 0,
    searchCalls: numeric(perTool.search?.calls) ?? 0,
    scrapeCalls: numeric(perTool.scrape?.calls) ?? 0,
    pythonCalls: numeric(perTool.python?.calls) ?? 0,
    tools: normalizeToolMetrics(perTool),
    modelCalls: numeric(metrics.model_calls) ?? 0,
    inputTokens: numeric(metrics.input_tokens?.total) ?? 0,
    outputTokens: numeric(metrics.output_tokens?.total) ?? 0,
    cacheReadTokens: numeric(metrics.cache_read_input_tokens?.total) ?? 0,
    cacheHitRate: numeric(metrics.cache_hit_rate),
    modelLatencySeconds: numeric(metrics.model_latency_s?.total) ?? 0,
    notebookFormatOk: numeric(row.format_notebook_ok),
    notebook: extractLastTaggedBlock(finalResponse, 'belief_notebook'),
    responsePresent: finalResponse.trim().length > 0,
  }
}

function normalizeToolMetrics(perTool) {
  return Object.fromEntries(
    Object.entries(perTool).map(([name, metric]) => [
      name,
      {
        known: typeof metric?.is_known === 'boolean' ? metric.is_known : null,
        calls: numeric(metric?.calls) ?? 0,
        successes: numeric(metric?.successes) ?? 0,
        errors: numeric(metric?.errors) ?? 0,
        parseErrors: numeric(metric?.parse_errors) ?? 0,
        latencySeconds: numeric(metric?.latency_s) ?? 0,
      },
    ]),
  )
}

function extractLastTaggedBlock(text, tag) {
  if (!text) return null
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g')
  let value = null
  for (const match of text.matchAll(pattern)) value = match[1].trim()
  return value || null
}

function toTrajectoryRow(row) {
  const {
    responsePresent,
    notebook,
    ...trajectoryRow
  } = row
  return { ...trajectoryRow, notebookAvailable: Boolean(notebook) }
}

function summarizeRun(file, rows) {
  const first = rows[0]
  const scored = rows.filter((row) => row.parseOk && row.brier !== null)
  const infoRows = scored.filter((row) => row.infoAlpha !== null)
  const notebookRows = first.mode === 'sequential'
    ? rows.filter((row) => row.notebookFormatOk !== null)
    : []
  return {
    id: first.runId,
    modelName: first.modelName,
    sourceType: first.sourceType,
    mode: first.mode,
    file: basename(file),
    nRows: rows.length,
    nScored: scored.length,
    coverage: rows.length ? scored.length / rows.length : 0,
    brier: mean(scored.map((row) => row.brier)),
    accuracy: mean(scored.map((row) => row.accuracy).filter((value) => value !== null)),
    infoAlpha: mean(infoRows.map((row) => row.infoAlpha)),
    complete: scored.length === rows.length,
    totalToolCalls: sum(rows.map((row) => row.toolCalls)),
    avgToolCalls: mean(rows.map((row) => row.toolCalls)),
    avgSearchCalls: mean(rows.map((row) => row.searchCalls)),
    avgScrapeCalls: mean(rows.map((row) => row.scrapeCalls)),
    avgPythonCalls: mean(rows.map((row) => row.pythonCalls)),
    avgModelCalls: mean(rows.map((row) => row.modelCalls)),
    totalInputTokens: sum(rows.map((row) => row.inputTokens)),
    avgInputTokens: mean(rows.map((row) => row.inputTokens)),
    totalOutputTokens: sum(rows.map((row) => row.outputTokens)),
    avgOutputTokens: mean(rows.map((row) => row.outputTokens)),
    totalCacheReadTokens: sum(rows.map((row) => row.cacheReadTokens)),
    avgModelLatencySeconds: mean(rows.map((row) => row.modelLatencySeconds)),
    notebookValidRate: notebookRows.length
      ? mean(notebookRows.map((row) => row.notebookFormatOk))
      : null,
    responseRate: mean(rows.map((row) => row.responsePresent ? 1 : 0)),
  }
}

function classifySource(modelName) {
  const value = modelName.toLowerCase()
  if (/(qwen|glm|mistral|llama|deepseek|kimi|gemma)/.test(value)) return 'open'
  return 'closed'
}

function compareTrajectoryRows(a, b) {
  return a.modelName.localeCompare(b.modelName)
    || a.mode.localeCompare(b.mode)
    || a.rolloutIndex - b.rolloutIndex
    || a.stepIndex - b.stepIndex
}

function numeric(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function mean(values) {
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0)
}

function countBy(values, keyFn) {
  return Object.fromEntries(
    [...values.reduce((counts, value) => {
      const key = keyFn(value)
      counts.set(key, (counts.get(key) ?? 0) + 1)
      return counts
    }, new Map())].sort(([a], [b]) => a.localeCompare(b)),
  )
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value)}\n`, 'utf8')
}
