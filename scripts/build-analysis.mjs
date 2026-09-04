import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const BOOTSTRAP_SAMPLES = 1000
const HORIZON_BUCKETS = [
  { key: '30-plus', label: '30+ days', minimum: 30, maximum: Number.POSITIVE_INFINITY },
  { key: '14-to-30', label: '14–30 days', minimum: 14, maximum: 30 },
  { key: '7-to-14', label: '7–14 days', minimum: 7, maximum: 14 },
  { key: 'under-7', label: 'Under 7 days', minimum: 0, maximum: 7 },
]

export async function buildAnalysis(outputRoot) {
  const [questions, rows, runSummaries] = await Promise.all([
    readArrayDirectory(join(outputRoot, 'questions')),
    readObjectDirectory(join(outputRoot, 'results')),
    readJson(join(outputRoot, 'results-summary.json')),
  ])
  const questionById = new Map(questions.map((question) => [String(question.id), question]))
  const rowsByRun = groupBy(rows, (row) => row.runId)

  const runs = runSummaries.map((run) => {
    const runRows = rowsByRun.get(run.id) ?? []
    return {
      runId: run.id,
      modelName: run.modelName,
      sourceType: run.sourceType,
      mode: run.mode,
      overall: summarizeMetrics(runRows, true, `${run.id}:overall`),
      byDomain: breakdown(runRows, (row) => questionById.get(String(row.eventId))?.domain ?? 'unknown'),
      byQuestionType: breakdown(runRows, (row) => questionById.get(String(row.eventId))?.beliefKind ?? 'unknown'),
      byHorizon: horizonBreakdown(runRows, questionById),
      bestQuestions: questionExtremes(runRows, questionById, 'best'),
      worstQuestions: questionExtremes(runRows, questionById, 'worst'),
    }
  })

  const pairedModes = buildPairedComparisons(runSummaries, rowsByRun, questionById)
  const validDomainCells = runs.flatMap((run) => run.byDomain
    .filter((cell) => cell.nScored >= 20 && isNumber(cell.infoAlpha))
    .map((cell) => ({ ...cell, runId: run.runId, modelName: run.modelName, mode: run.mode })))
  const closestDomain = validDomainCells.sort((a, b) => b.infoAlpha - a.infoAlpha)[0] ?? null
  const bestRun = [...runSummaries].filter((run) => isNumber(run.accuracy)).sort((a, b) => b.accuracy - a.accuracy)[0] ?? null
  const bestOpenRun = [...runSummaries].filter((run) => run.sourceType === 'open' && isNumber(run.accuracy)).sort((a, b) => b.accuracy - a.accuracy)[0] ?? null

  const analysis = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    bootstrap: {
      method: 'Question-clustered percentile bootstrap',
      confidenceLevel: 0.95,
      samples: BOOTSTRAP_SAMPLES,
    },
    horizonBuckets: HORIZON_BUCKETS.map(({ key, label }) => ({ key, label })),
    domains: [...new Set(questions.map((question) => question.domain ?? 'unknown'))].sort(),
    questionTypes: [...new Set(questions.map((question) => question.beliefKind ?? 'unknown'))].sort(),
    findings: {
      bestRunId: bestRun?.id ?? null,
      bestOpenRunId: bestOpenRun?.id ?? null,
      sequentialAccuracyWins: pairedModes.filter((comparison) => (comparison.accuracyDifference ?? 0) > 0).length,
      independentAccuracyWins: pairedModes.filter((comparison) => (comparison.accuracyDifference ?? 0) < 0).length,
      pairedModelCount: pairedModes.length,
      closestDomain: closestDomain ? {
        runId: closestDomain.runId,
        modelName: closestDomain.modelName,
        mode: closestDomain.mode,
        domain: closestDomain.key,
        infoAlpha: closestDomain.infoAlpha,
        nScored: closestDomain.nScored,
      } : null,
    },
    runs,
    pairedModes,
  }

  await writeFile(join(outputRoot, 'analysis-summary.json'), `${JSON.stringify(analysis)}\n`, 'utf8')
  return analysis
}

function summarizeMetrics(rows, includeIntervals = false, seed = 'summary') {
  const scored = rows.filter((row) => row.parseOk && isNumber(row.brier))
  const summary = {
    nRows: rows.length,
    nScored: scored.length,
    nQuestions: new Set(scored.map((row) => String(row.eventId))).size,
    coverage: rows.length ? scored.length / rows.length : 0,
    accuracy: mean(scored.map((row) => row.accuracy).filter(isNumber)),
    brier: mean(scored.map((row) => row.brier).filter(isNumber)),
    infoAlpha: mean(scored.map((row) => row.infoAlpha).filter(isNumber)),
  }
  if (!includeIntervals) return summary
  return {
    ...summary,
    intervals: {
      accuracy: clusterBootstrap(scored, 'accuracy', `${seed}:accuracy`),
      brier: clusterBootstrap(scored, 'brier', `${seed}:brier`),
      infoAlpha: clusterBootstrap(scored, 'infoAlpha', `${seed}:infoAlpha`),
    },
  }
}

function breakdown(rows, keyFn) {
  return [...groupBy(rows, keyFn)].map(([key, values]) => ({
    key,
    label: humanize(key),
    ...summarizeMetrics(values),
  })).sort((a, b) => b.nScored - a.nScored || a.key.localeCompare(b.key))
}

function horizonBreakdown(rows, questionById) {
  const groups = new Map(HORIZON_BUCKETS.map((bucket) => [bucket.key, []]))
  for (const row of rows) {
    const question = questionById.get(String(row.eventId))
    const key = horizonKey(row.forecastDate, question?.closeDate)
    if (key) groups.get(key).push(row)
  }
  return HORIZON_BUCKETS.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    ...summarizeMetrics(groups.get(bucket.key)),
  }))
}

function questionExtremes(rows, questionById, direction) {
  const summaries = [...groupBy(rows.filter((row) => row.parseOk && isNumber(row.brier)), (row) => String(row.eventId))]
    .map(([eventId, values]) => {
      const question = questionById.get(eventId)
      return {
        id: eventId,
        title: question?.title ?? eventId,
        domain: question?.domain ?? 'unknown',
        ...summarizeMetrics(values),
      }
    })
    .filter((summary) => isNumber(summary.brier))
    .sort((a, b) => direction === 'best' ? a.brier - b.brier : b.brier - a.brier)
  return summaries.slice(0, 5)
}

function buildPairedComparisons(runSummaries, rowsByRun, questionById) {
  const byModel = groupBy(runSummaries, (run) => run.modelName)
  const comparisons = []
  for (const [modelName, modelRuns] of byModel) {
    const sequential = modelRuns.find((run) => run.mode === 'sequential')
    const independent = modelRuns.find((run) => run.mode === 'independent')
    if (!sequential || !independent) continue
    const independentRows = new Map((rowsByRun.get(independent.id) ?? []).map((row) => [rowKey(row), row]))
    const differences = (rowsByRun.get(sequential.id) ?? []).flatMap((sequentialRow) => {
      const independentRow = independentRows.get(rowKey(sequentialRow))
      if (!independentRow || !sequentialRow.parseOk || !independentRow.parseOk || !isNumber(sequentialRow.brier) || !isNumber(independentRow.brier)) return []
      return [{
        eventId: String(sequentialRow.eventId),
        forecastDate: sequentialRow.forecastDate ?? independentRow.forecastDate,
        accuracyDifference: difference(sequentialRow.accuracy, independentRow.accuracy),
        brierDifference: difference(sequentialRow.brier, independentRow.brier),
        infoAlphaDifference: difference(sequentialRow.infoAlpha, independentRow.infoAlpha),
      }]
    })
    comparisons.push({
      modelName,
      sourceType: sequential.sourceType,
      sequentialRunId: sequential.id,
      independentRunId: independent.id,
      ...summarizeDifferences(differences, true, modelName),
      byDomain: differenceBreakdown(differences, (row) => questionById.get(row.eventId)?.domain ?? 'unknown'),
      byHorizon: differenceHorizonBreakdown(differences, questionById),
    })
  }
  return comparisons.sort((a, b) => (b.accuracyDifference ?? Number.NEGATIVE_INFINITY) - (a.accuracyDifference ?? Number.NEGATIVE_INFINITY))
}

function summarizeDifferences(rows, includeIntervals = false, seed = 'paired') {
  const summary = {
    nMatched: rows.length,
    nQuestions: new Set(rows.map((row) => row.eventId)).size,
    accuracyDifference: mean(rows.map((row) => row.accuracyDifference).filter(isNumber)),
    brierDifference: mean(rows.map((row) => row.brierDifference).filter(isNumber)),
    infoAlphaDifference: mean(rows.map((row) => row.infoAlphaDifference).filter(isNumber)),
    sequentialWinRate: mean(rows.map((row) => row.brierDifference).filter(isNumber).map((value) => value < 0 ? 1 : 0)),
  }
  if (!includeIntervals) return summary
  return {
    ...summary,
    intervals: {
      accuracyDifference: clusterBootstrap(rows, 'accuracyDifference', `${seed}:accuracyDifference`),
      brierDifference: clusterBootstrap(rows, 'brierDifference', `${seed}:brierDifference`),
      infoAlphaDifference: clusterBootstrap(rows, 'infoAlphaDifference', `${seed}:infoAlphaDifference`),
    },
  }
}

function differenceBreakdown(rows, keyFn) {
  return [...groupBy(rows, keyFn)].map(([key, values]) => ({ key, label: humanize(key), ...summarizeDifferences(values) }))
    .sort((a, b) => b.nMatched - a.nMatched || a.key.localeCompare(b.key))
}

function differenceHorizonBreakdown(rows, questionById) {
  const groups = new Map(HORIZON_BUCKETS.map((bucket) => [bucket.key, []]))
  for (const row of rows) {
    const key = horizonKey(row.forecastDate, questionById.get(row.eventId)?.closeDate)
    if (key) groups.get(key).push(row)
  }
  return HORIZON_BUCKETS.map((bucket) => ({ key: bucket.key, label: bucket.label, ...summarizeDifferences(groups.get(bucket.key)) }))
}

function clusterBootstrap(rows, metric, seedText) {
  const clusters = [...groupBy(rows.filter((row) => isNumber(row[metric])), (row) => String(row.eventId)).values()]
    .map((values) => values.map((row) => row[metric]))
  if (clusters.length < 2) return null
  const random = mulberry32(hash(seedText))
  const samples = []
  for (let iteration = 0; iteration < BOOTSTRAP_SAMPLES; iteration += 1) {
    let total = 0
    let count = 0
    for (let index = 0; index < clusters.length; index += 1) {
      const sampled = clusters[Math.floor(random() * clusters.length)]
      for (const value of sampled) {
        total += value
        count += 1
      }
    }
    if (count) samples.push(total / count)
  }
  samples.sort((a, b) => a - b)
  return {
    lower: percentile(samples, 0.025),
    upper: percentile(samples, 0.975),
  }
}

function horizonKey(forecastDate, closeDate) {
  if (!forecastDate || !closeDate) return null
  const forecast = new Date(`${String(forecastDate).slice(0, 10)}T00:00:00Z`)
  const close = new Date(`${String(closeDate).slice(0, 10)}T00:00:00Z`)
  const days = (close.valueOf() - forecast.valueOf()) / 86_400_000
  if (!Number.isFinite(days) || days < 0) return null
  return HORIZON_BUCKETS.find((bucket) => days >= bucket.minimum && days < bucket.maximum)?.key ?? null
}

function rowKey(row) {
  return `${row.eventId}:${row.forecastDate ?? `step-${row.stepIndex ?? 0}`}`
}

function difference(a, b) {
  return isNumber(a) && isNumber(b) ? a - b : null
}

function groupBy(values, keyFn) {
  const groups = new Map()
  for (const value of values) {
    const key = String(keyFn(value))
    groups.set(key, [...(groups.get(key) ?? []), value])
  }
  return groups
}

function mean(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null
}

function percentile(sorted, probability) {
  if (!sorted.length) return null
  const index = (sorted.length - 1) * probability
  const lower = Math.floor(index)
  const fraction = index - lower
  return sorted[lower + 1] === undefined ? sorted[lower] : sorted[lower] + fraction * (sorted[lower + 1] - sorted[lower])
}

function hash(value) {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

function mulberry32(seed) {
  return function random() {
    let value = seed += 0x6D2B79F5
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296
  }
}

function humanize(value) {
  return String(value).replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function readArrayDirectory(path) {
  const files = (await readdir(path)).filter((file) => file.endsWith('.json')).sort()
  const chunks = await Promise.all(files.map((file) => readJson(join(path, file))))
  return chunks.flat()
}

async function readObjectDirectory(path) {
  const files = (await readdir(path)).filter((file) => file.endsWith('.json')).sort()
  const chunks = await Promise.all(files.map((file) => readJson(join(path, file))))
  return chunks.flatMap((chunk) => Object.values(chunk).flat())
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url))
  const outputRoot = resolve(scriptDirectory, '..', 'public', 'data')
  const analysis = await buildAnalysis(outputRoot)
  console.log(JSON.stringify({
    output: join(outputRoot, 'analysis-summary.json'),
    runs: analysis.runs.length,
    pairedModels: analysis.pairedModes.length,
    confidenceIntervals: analysis.bootstrap,
    publicFieldsOnly: true,
  }, null, 2))
}
