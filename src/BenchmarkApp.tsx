import { useEffect, useMemo, useState } from 'react'
import alibabaLogo from '@lobehub/icons-static-svg/icons/alibaba-color.svg'
import anthropicLogo from '@lobehub/icons-static-svg/icons/anthropic.svg'
import deepSeekLogo from '@lobehub/icons-static-svg/icons/deepseek-color.svg'
import minimaxLogo from '@lobehub/icons-static-svg/icons/minimax-color.svg'
import moonshotLogo from '@lobehub/icons-static-svg/icons/moonshot.svg'
import nvidiaLogo from '@lobehub/icons-static-svg/icons/nvidia-color.svg'
import openAiLogo from '@lobehub/icons-static-svg/icons/openai.svg'
import xAiLogo from '@lobehub/icons-static-svg/icons/xai.svg'
import zaiLogo from '@lobehub/icons-static-svg/icons/zai.svg'
import { attachQuestionProcess, loadAnalysis, loadManifest, loadQuestion, loadQuestionIndex, loadQuestionProcess, loadRunSummaries, loadTrajectories } from './data'
import type { AnalysisSummary, BreakdownAggregate, ConsistencySummary, DynamicsSummary, ForecastMode, Manifest, MurphySummary, PairedModeComparison, QuestionDetail, QuestionIndexItem, RecencyComparison, RunAnalysis, RunSummary, SourceType, TrajectoryRow } from './types'

import { averageRepeats } from './trajectories'

type CommonData = {
  manifest: Manifest | null
  analysis: AnalysisSummary | null
  questions: QuestionIndexItem[] | null
  runs: RunSummary[]
  coreError: string | null
  questionError: string | null
}

type Metric = 'brier' | 'accuracy' | 'infoAlpha'
type RunChartMetric = 'accuracy' | 'brier' | 'infoAlpha' | 'avgToolCalls' | 'avgInputTokens' | 'avgOutputTokens' | 'avgModelLatencySeconds' | 'avgUsd' | 'notebookValidRate'
type ChartValueFormat = 'percent' | 'decimal' | 'count' | 'compact' | 'duration' | 'money'
type QuestionBrowseState = { query: string; domain: string; split: string; belief: string; page: number }

const QUESTION_PAGE_SIZE = 48
const PAPER_URL = 'https://arxiv.org/pdf/2505.07782'

const metricDetails: Record<Metric, { label: string; direction: string; decimals: number }> = {
  brier: { label: 'Brier score', direction: 'Lower is better', decimals: 3 },
  accuracy: { label: 'Accuracy', direction: 'Higher is better', decimals: 1 },
  infoAlpha: { label: 'Information alpha', direction: 'Higher is better', decimals: 3 },
}

function BenchmarkApp() {
  const route = useHashRoute()
  const routePath = splitHashRoute(route).path
  const [data, setData] = useState<CommonData>({
    manifest: null,
    analysis: null,
    questions: null,
    runs: [],
    coreError: null,
    questionError: null,
  })

  useEffect(() => {
    let cancelled = false
    setData(current => ({ ...current, coreError: null }))
    Promise.all([loadManifest(), loadRunSummaries(), loadAnalysis().catch(() => null)])
      .then(([manifest, runs, analysis]) => { if (!cancelled) setData((current) => ({ ...current, manifest, runs, analysis, coreError: null })) })
      .catch((error: unknown) => { if (!cancelled) setData((current) => ({
        ...current,
        coreError: error instanceof Error ? error.message : 'Unable to load this release.',
      })) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!route.startsWith('/questions') || data.questions !== null || data.questionError) return

    let cancelled = false
    loadQuestionIndex()
      .then((questions) => {
        if (!cancelled) setData((current) => ({ ...current, questions, questionError: null }))
      })
      .catch((error: unknown) => {
        if (!cancelled) setData((current) => ({
          ...current,
          questionError: error instanceof Error ? error.message : 'Unable to load the question index.',
        }))
      })

    return () => { cancelled = true }
  }, [route, data.questions, data.questionError])

  useEffect(() => {
    const anchor = route.split('#')[1]
    if (!anchor) {
      window.scrollTo({ top: 0 })
      return
    }
    window.requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: 'start' }))
  }, [route])

  const section = routePath.startsWith('/results')
    ? 'results'
    : routePath.startsWith('/questions')
      ? 'questions'
      : routePath.startsWith('/paper') || routePath.startsWith('/method')
        ? 'paper'
        : 'overview'

  const content = (() => {
    if (section === 'paper') return <PaperRedirect />
    if (data.coreError) return <DataError message={data.coreError} />
    if (!data.manifest) return <LoadingPage />
    if (routePath.startsWith('/questions') && data.questionError) return <DataError message={data.questionError} />
    if (routePath.startsWith('/questions') && data.questions === null) return <LoadingPage label="Loading the question index…" />
    if (routePath.startsWith('/questions/')) {
      const id = decodeURIComponent(routePath.slice('/questions/'.length))
      const item = data.questions?.find((candidate) => candidate.id === id)
      return item ? <QuestionDetailPage key={item.id} manifest={data.manifest} item={item} questions={data.questions ?? []} browseState={readQuestionBrowseState(route, 'all')} runSummaries={data.runs} /> : <NotFoundPage />
    }
    if (section === 'results') return <ResultsPage runs={data.runs} analysis={data.analysis} />
    if (section === 'questions') return <QuestionsPage questions={data.questions ?? []} manifest={data.manifest} route={route} />
    return <OverviewPage manifest={data.manifest} runs={data.runs} analysis={data.analysis} />
  })()

  return (
    <div className="site-shell">
      <Header active={section} />
      <main>{content}</main>
      <Footer manifest={data.manifest} />
    </div>
  )
}

function Header({ active }: { active: string }) {
  return (
    <header className="site-header">
      <a className="wordmark" href={releaseHref('#/overview')} aria-label="Forecast Dojo overview">
        <img className="wordmark-mark" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" aria-hidden="true" /><span>Forecast Dojo</span>
      </a>
      <nav className="site-nav" aria-label="Primary navigation">
        {[
          ['overview', 'Overview'],
          ['results', 'Analysis'],
          ['questions', 'Questions'],
        ].map(([key, label]) => <a key={key} className={active === key ? 'active' : ''} href={releaseHref(`#/${key}`)}>{label}</a>)}
        <a className={active === 'paper' ? 'active' : ''} href={PAPER_URL} target="_blank" rel="noopener noreferrer">Paper</a>
      </nav>
    </header>
  )
}

function Footer({ manifest }: { manifest: Manifest | null }) {
  return (
    <footer className="site-footer">
      <span>Forecast Dojo</span>
      <span>{manifest?.label ?? 'Versioned benchmark release'}</span>
      <span>{manifest ? `${number(manifest.questionCount)} questions · ${number(manifest.checkpointCount)} checkpoints` : 'Loading release'}</span>
    </footer>
  )
}

function OverviewPage({ manifest, runs, analysis }: { manifest: Manifest; runs: RunSummary[]; analysis: AnalysisSummary | null }) {
  const bestRun = bestByMetric(runs, 'accuracy')
  const bestAccuracy = bestRun?.accuracy ?? null
  const crowdGap = bestAccuracy == null ? null : (manifest.crowd.accuracy ?? 0) - bestAccuracy
  const murphy = analysis?.research?.murphy ?? []
  const hasCost = runs.some((run) => isFiniteNumber(run.avgUsd) && run.avgUsd > 0 && isFiniteNumber(run.infoAlpha))

  return (
    <>
      <section className="hero overview-hero section-rule">
        <div className="overview-hero-intro">
          <h1>Forecast Dojo</h1>
          <p className="overview-question">Can LLM reasoning outperform human collective judgment in forecasting?</p>
        </div>
        <aside className="hero-readout" aria-label="Current benchmark readout">
          <span>{manifest.label}</span>
          <strong>{crowdGap == null ? 'Analysis in progress' : crowdGap > 0 ? `Crowd leads by ${percentagePoints(crowdGap)}` : `Best model leads by ${percentagePoints(Math.abs(crowdGap))}`}</strong>
          <p>{bestRun ? `${bestRun.modelName} · ${modeLabel(bestRun.mode)} is the highest-accuracy published model run at ${percent(bestAccuracy)}.` : 'No scored model runs are published yet.'}</p>
          <a href={releaseHref('#/results')}>See the analysis <span aria-hidden="true">↗</span></a>
        </aside>
      </section>

      <section className="highlight-section overview-results-stack section-rule" aria-label="Benchmark results">
        <ChartCard title="Accuracy" description="Forecasts assigning the highest probability to the resolved outcome." accent="quality" className="accuracy-card">
          <MetricLeaderboardChart runs={runs} baseline={manifest.crowd.accuracy} metric="accuracy" />
        </ChartCard>
        <ChartCard title="Brier score" description="Mean squared probability error across resolved outcomes." accent="activity" className="accuracy-card">
          <MetricLeaderboardChart runs={runs} baseline={manifest.crowd.brier} metric="brier" />
        </ChartCard>
        <ChartCard title="Information alpha" description="Forecasting information gained relative to the market crowd." accent="tokens" className="accuracy-card">
          <MetricLeaderboardChart runs={runs} baseline={manifest.crowd.infoAlpha} metric="infoAlpha" />
        </ChartCard>
        {murphy.length ? <ChartCard title="Murphy decomposition" description="Calibration error versus forecast resolution. Upper-left is better; shared uncertainty is shown in the details." accent="quality" className="accuracy-card research-scatter-card">
          <ResearchScatterChart runs={runs} murphy={murphy} kind="murphy" />
        </ChartCard> : null}
        {hasCost ? <ChartCard title="Information alpha vs. cost" description="Crowd-relative forecasting information against recorded cost per checkpoint. Upper-left is better." accent="activity" className="accuracy-card research-scatter-card">
          <ResearchScatterChart runs={runs} murphy={murphy} kind="cost" />
        </ChartCard> : null}
      </section>

      <section className="stat-grid section-rule" aria-label="Benchmark scope">
        <Stat value={number(manifest.questionCount)} label="forecasting questions" />
        <Stat value={number(manifest.checkpointCount)} label="dated checkpoints" />
        <Stat value={number(manifest.resultRunCount)} label="model runs published" />
        <Stat value="Monthly" label="versioned releases" />
        <Stat value="20M+" label="news articles in corpus" />
      </section>

      <section className="study-grid section-rule">
        <div className="section-heading"><p className="eyebrow">Study design</p><h2>One question, several moments, one fair information boundary</h2></div>
        <ol className="method-steps">
          <li><span>01</span><div><strong>Select a dated question</strong><p>Each question is observed at several checkpoints before resolution.</p></div></li>
          <li><span>02</span><div><strong>Retrieve news available then</strong><p>The model can access the CC-News collection only up to that checkpoint.</p></div></li>
          <li><span>03</span><div><strong>Record both probabilities</strong><p>The model forecast and contemporaneous crowd probability are compared after resolution.</p></div></li>
        </ol>
      </section>

      <section className="mode-note section-rule" id="memory">
        <div><p className="eyebrow">Secondary analysis</p><h2>Does forecast memory help?</h2></div>
        <div className="mode-columns">
          <article><h3>Independent</h3><p>At each checkpoint, the model begins fresh and cannot see its work from the previous checkpoint.</p></article>
          <article><h3>Sequential</h3><p>At each checkpoint, the model receives its compact belief notebook from the previous checkpoint.</p></article>
        </div>
      </section>

      <section className="mode-note section-rule" id="evaluation-notes">
        <div><p className="eyebrow">Evaluation integrity</p><h2>Read uncertainty and coverage together</h2></div>
        <div className="mode-columns">
          <article><h3>Question-clustered intervals</h3><p>Confidence intervals resample whole questions, because checkpoints from the same question share an outcome and information history.</p></article>
          <article><h3>Visible coverage</h3><p>Partial runs remain visible with their observed coverage. Missing forecasts stay missing rather than being imputed.</p></article>
        </div>
      </section>
    </>
  )
}

function ResultsPage({ runs, analysis }: { runs: RunSummary[]; analysis: AnalysisSummary | null }) {
  const hasToolMetrics = runs.some((run) => isFiniteNumber(run.avgToolCalls))
  const hasInputTokens = runs.some((run) => isFiniteNumber(run.avgInputTokens))
  const hasOutputTokens = runs.some((run) => isFiniteNumber(run.avgOutputTokens))
  const hasLatency = runs.some((run) => isFiniteNumber(run.avgModelLatencySeconds))
  const pairedModes = dedupePairedModes(analysis?.pairedModes ?? [])
  const analysisRunIds = (analysis?.runs ?? []).map((run) => run.runId)
  const pairedModeRunIds = pairedModes.flatMap((row) => [row.independentRunId, row.sequentialRunId])
  const consistencyRunIds = analysis?.research?.consistency.map((row) => row.runId) ?? []
  const dynamicsRunIds = analysis?.research?.dynamics.map((row) => row.runId) ?? []
  const recencyRunIds = recencyComparisonRunIds(runs, analysis?.research?.recency ?? [])

  return (
    <>
      <PageIntro eyebrow="Benchmark analysis" title="Forecasting quality, memory, and research effort" copy="Compare each published model run with the contemporaneous market crowd across forecasting quality, resolution horizon, domain, and available research telemetry." />

      {analysis ? <ModelFilteredAnalysisSection chartId="results-domain" eyebrow="Domain breakdown" title="Which model performs best in each domain?" description="Choose a domain to rank published runs by crowd-relative information alpha. Higher values indicate more forecasting information than the contemporaneous market." note="Leaders are the highest observed values, not claims of statistical significance. Question and checkpoint counts remain visible for context." runs={runs} eligibleRunIds={analysisRunIds} modeControl="compare" recencyControl="compare" defaultModelCount={8}>
        {({ visibleRunIds }) => <DomainLeaderboardChart analysisRuns={analysis.runs} runSummaries={runs} visibleRunIds={visibleRunIds} domains={analysis.domains} />}
      </ModelFilteredAnalysisSection> : null}

      {analysis ? <ModelFilteredAnalysisSection chartId="results-horizon" eyebrow="Resolution period" title="Accuracy as resolution approaches" description="Run accuracy at four pre-resolution horizons, keeping every model and forecasting mode distinct." note="Forecasts after the recorded close date are excluded from horizon analysis." runs={runs} eligibleRunIds={analysisRunIds}>
        {({ visibleRunIds }) => <BreakdownMatrix runs={analysis.runs} visibleRunIds={visibleRunIds} keys={analysis.horizonBuckets} field="byHorizon" metric="accuracy" />}
      </ModelFilteredAnalysisSection> : null}

      {analysis ? <ModelFilteredAnalysisSection chartId="results-question-type" eyebrow="Question types" title="Binary and multiple-choice performance" description="Accuracy separated by question format so changes in task composition remain visible." note="Each cell reports the mean across scored checkpoints in that question type." runs={runs} eligibleRunIds={analysisRunIds}>
        {({ visibleRunIds }) => <BreakdownMatrix runs={analysis.runs} visibleRunIds={visibleRunIds} keys={analysis.questionTypes.map((key) => ({ key, label: humanize(key) }))} field="byQuestionType" metric="accuracy" />}
      </ModelFilteredAnalysisSection> : null}

      {pairedModes.length ? <ModelFilteredAnalysisSection chartId="results-memory" eyebrow="Forecast memory" title="Does sequential memory help?" description="Sequential and independent runs are matched at the same question and forecast date before their differences are calculated." note="Differences are Sequential minus Independent; negative Brier differences are favorable." runs={runs} eligibleRunIds={pairedModeRunIds} modeControl="compare">
        {({ visibleGroupIds }) => <PairedModeChart comparisons={pairedModes} visibleGroupIds={visibleGroupIds} />}
      </ModelFilteredAnalysisSection> : null}

      {analysis?.research?.recency.length ? <ModelFilteredAnalysisSection chartId="results-recency" eyebrow="Retrieval strategy" title="Does recency weighting help?" description="Recency-weighted retrieval is compared with baseline retrieval for the same model, forecasting mode, and question-date." note="Differences are Recency minus Baseline; negative Brier differences are favorable." runs={runs} eligibleRunIds={recencyRunIds} recencyControl="compare">
        {({ visibleGroupIds, activeMode }) => <RecencyEffectChart comparisons={analysis.research!.recency} runs={runs} visibleGroupIds={visibleGroupIds} activeMode={activeMode} />}
      </ModelFilteredAnalysisSection> : null}

      {analysis?.research?.consistency.length ? <ModelFilteredAnalysisSection chartId="results-consistency" eyebrow="Repeat reliability" title="Do repeated forecasts agree?" description="Four repeated forecasts expose run-to-run disagreement and show whether averaging the distributions improves Brier score." note="Brier improvement is Single-repeat Brier minus Averaged-forecast Brier; larger positive values favor averaging." runs={runs} eligibleRunIds={consistencyRunIds}>
        {({ visibleRunIds }) => <ConsistencyChart rows={analysis.research!.consistency} visibleRunIds={visibleRunIds} />}
      </ModelFilteredAnalysisSection> : null}

      {hasToolMetrics ? <ModelFilteredAnalysisSection chartId="results-tools" eyebrow="Agent behavior" title="Tool calls per checkpoint" description="Average research activity for each run, separated into corpus searches, article scrapes, and Python executions." note="Normalized per forecast checkpoint so partial runs remain comparable" runs={runs} eligibleRunIds={runIdsWithMetric(runs, 'avgToolCalls')}>
        {({ visibleRunIds }) => <ToolMixChart runs={runs} visibleRunIds={visibleRunIds} />}
      </ModelFilteredAnalysisSection> : null}

      {hasInputTokens ? <ModelFilteredAnalysisSection chartId="results-input-tokens" eyebrow="Context consumption" title="Input tokens per checkpoint" description="Average number of input tokens processed across all model calls used to produce one forecast." note="Includes repeated context and, for sequential runs, carried notebook context" runs={runs} eligibleRunIds={runIdsWithMetric(runs, 'avgInputTokens')}>
        {({ visibleRunIds }) => <GroupedRunChart runs={runs} visibleRunIds={visibleRunIds} metric="avgInputTokens" format="compact" minValue={0} />}
      </ModelFilteredAnalysisSection> : null}

      {hasOutputTokens ? <ModelFilteredAnalysisSection chartId="results-output-tokens" eyebrow="Response generation" title="Output tokens per checkpoint" description="Average output tokens generated across the agent loop for one forecast checkpoint." note="Visible and reasoning-token accounting depends on the model provider" runs={runs} eligibleRunIds={runIdsWithMetric(runs, 'avgOutputTokens')}>
        {({ visibleRunIds }) => <GroupedRunChart runs={runs} visibleRunIds={visibleRunIds} metric="avgOutputTokens" format="compact" minValue={0} />}
      </ModelFilteredAnalysisSection> : null}

      {hasLatency ? <ModelFilteredAnalysisSection chartId="results-latency" eyebrow="Execution profile" title="Model processing time per checkpoint" description="Average accumulated model-call latency required to complete one forecast checkpoint." note="Tool latency is tracked separately and is not included here" runs={runs} eligibleRunIds={runIdsWithMetric(runs, 'avgModelLatencySeconds')}>
        {({ visibleRunIds }) => <GroupedRunChart runs={runs} visibleRunIds={visibleRunIds} metric="avgModelLatencySeconds" format="duration" minValue={0} />}
      </ModelFilteredAnalysisSection> : null}

      {analysis?.research?.dynamics.length ? <ModelFilteredAnalysisSection chartId="results-dynamics" eyebrow="Forecast evolution" title="How sequential beliefs move through time" description="Excess movement and lead time summarize how sequential forecasts update as resolution approaches." note="Excess movement describes updating conditional on the eventual outcome; its sign alone is not a test of rationality." runs={runs} eligibleRunIds={dynamicsRunIds} modeControl="sequential-only">
        {({ visibleRunIds }) => <DynamicsChart rows={analysis.research!.dynamics} visibleRunIds={visibleRunIds} />}
      </ModelFilteredAnalysisSection> : null}

    </>
  )
}

function QuestionsPage({ questions, manifest, route }: { questions: QuestionIndexItem[]; manifest: Manifest; route: string }) {
  const [initialState] = useState(() => readQuestionBrowseState(route, 'eval'))
  const [query, setQuery] = useState(initialState.query)
  const [domain, setDomain] = useState(initialState.domain)
  const [split, setSplit] = useState(initialState.split)
  const [belief, setBelief] = useState(initialState.belief)
  const [page, setPage] = useState(initialState.page)
  const domains = useMemo(() => [...new Set(questions.map((item) => item.domain))].sort(), [questions])
  const beliefs = useMemo(() => [...new Set(questions.map((item) => item.beliefKind))].sort(), [questions])
  const filtered = useMemo(() => filterQuestionIndex(questions, { query, domain, split, belief, page }), [questions, query, domain, split, belief, page])
  const pageCount = Math.max(1, Math.ceil(filtered.length / QUESTION_PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const browseState = { query, domain, split, belief, page: safePage }
  const visible = filtered.slice((safePage - 1) * QUESTION_PAGE_SIZE, safePage * QUESTION_PAGE_SIZE)

  useEffect(() => {
    const nextHash = questionListHref(browseState)
    if (window.location.hash !== nextHash) window.history.replaceState(null, '', nextHash)
  }, [query, domain, split, belief, safePage])

  return (
    <>
      <PageIntro eyebrow="Question explorer" title={`Browse all ${number(manifest.questionCount)} questions`} copy="Explore questions, resolution outcomes, and forecasts made at each date. Model results are available for evaluation questions." />
      <section className="question-filters section-rule" aria-label="Question filters">
        <label className="search-field"><span>Search</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Search question text or ID" /></label>
        <label className="select-field"><span>Domain</span><select value={domain} onChange={(event) => { setDomain(event.target.value); setPage(1) }}><option value="all">All domains</option>{domains.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label>
        <label className="select-field"><span>Split</span><select value={split} onChange={(event) => { setSplit(event.target.value); setPage(1) }}><option value="eval">Eval</option><option value="train">Train</option><option value="all">Train + eval</option></select></label>
        <label className="select-field"><span>Question type</span><select value={belief} onChange={(event) => { setBelief(event.target.value); setPage(1) }}><option value="all">All types</option>{beliefs.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label>
      </section>

      <section className="question-results section-rule">
        <div className="list-meta"><p><strong>{number(filtered.length)}</strong> matching questions</p><p>Page {safePage} of {pageCount}</p></div>
        <div className="question-list">
          {visible.map((item) => <QuestionCard key={item.id} item={item} href={questionDetailHref(item.id, browseState)} />)}
          {!visible.length ? <div className="empty-state"><h3>No questions match.</h3><p>Clear one or more filters and try again.</p></div> : null}
        </div>
        <Pagination page={safePage} count={pageCount} onChange={setPage} />
      </section>
    </>
  )
}

function QuestionDetailPage({ item, questions, browseState, manifest, runSummaries }: { item: QuestionIndexItem; questions: QuestionIndexItem[]; browseState: QuestionBrowseState; manifest: Manifest; runSummaries: RunSummary[] }) {
  const [detail, setDetail] = useState<QuestionDetail | null>(null)
  const [rows, setRows] = useState<TrajectoryRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [trajectoryError, setTrajectoryError] = useState<string | null>(null)
  const [trajectoryLoading, setTrajectoryLoading] = useState(item.split === 'eval')
  const [processState, setProcessState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const [processError, setProcessError] = useState<string | null>(null)
  const [runId, setRunId] = useState('')

  useEffect(() => {
    setDetail(null)
    setRows([])
    setError(null)
    setTrajectoryError(null)
    setTrajectoryLoading(item.split === 'eval')
    setProcessState('idle')
    setProcessError(null)
    setRunId('')
    loadQuestion(item)
      .then(setDetail)
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Unable to load this question.'))
    loadTrajectories(item, manifest)
      .then(setRows)
      .catch((loadError: unknown) => setTrajectoryError(loadError instanceof Error ? loadError.message : 'Unable to load forecast trajectories.'))
      .finally(() => setTrajectoryLoading(false))
  }, [item, manifest])

  const accuracyRunOrder = useMemo(() => {
    const order = new Map<string, number>()
    const modeOrder: Record<ForecastMode, number> = { independent: 0, sequential: 1, unknown: 2 }
    const rankedGroups = groupRuns(runSummaries).sort((a, b) => compareGroupMetric(a, b, 'accuracy'))
    let position = 0
    for (const group of rankedGroups) {
      const rankedRuns = [...group.runs].sort((a, b) => modeOrder[a.mode] - modeOrder[b.mode])
      for (const run of rankedRuns) order.set(run.id, position++)
    }
    return order
  }, [runSummaries])

  const runGroups = useMemo(() => {
    const groups = new Map<string, TrajectoryRow[]>()
    for (const row of rows) groups.set(row.runId, [...(groups.get(row.runId) ?? []), row])
    return [...groups.entries()]
      .map(([id, values]) => ({ id, rows: values.sort((a, b) => a.rolloutIndex - b.rolloutIndex || a.stepIndex - b.stepIndex), first: values[0] }))
      .sort((a, b) => {
        const aOrder = accuracyRunOrder.get(a.id) ?? Number.POSITIVE_INFINITY
        const bOrder = accuracyRunOrder.get(b.id) ?? Number.POSITIVE_INFINITY
        return aOrder - bOrder || `${a.first.modelName}:${a.first.mode}`.localeCompare(`${b.first.modelName}:${b.first.mode}`)
      })
  }, [rows, accuracyRunOrder])

  useEffect(() => {
    if (runGroups.length && !runGroups.some((group) => group.id === runId)) setRunId(runGroups[0].id)
  }, [runGroups, runId])

  if (error) return <DataError message={error} />
  if (!detail) return <LoadingPage label="Loading question…" />
  const selectedRun = runGroups.find((group) => group.id === runId) ?? null
  const availableRepeats = selectedRun ? [...new Set(selectedRun.rows.map((row) => row.rolloutIndex))].sort((a, b) => a - b) : []
  const repeatCount = availableRepeats.length
  const selected = selectedRun ? { ...selectedRun, rows: averageRepeats(selectedRun.rows) } : null
  const scored = selected?.rows.filter((row) => row.brier != null) ?? []
  const meanBrier = average(scored.map((row) => row.brier as number))
  const meanInfo = average(scored.flatMap((row) => row.infoAlpha == null ? [] : [row.infoAlpha]))
  const filteredQuestions = filterQuestionIndex(questions, browseState)
  const filteredPosition = filteredQuestions.findIndex((question) => question.id === item.id)
  const sequenceState = filteredPosition >= 0 ? browseState : { query: '', domain: 'all', split: 'all', belief: 'all', page: 1 }
  const sequence = filteredPosition >= 0 ? filteredQuestions : questions
  const sequencePosition = sequence.findIndex((question) => question.id === item.id)
  const stateForPosition = (position: number) => ({ ...sequenceState, page: Math.floor(Math.max(0, position) / QUESTION_PAGE_SIZE) + 1 })
  const previousQuestion = sequencePosition > 0 ? sequence[sequencePosition - 1] : null
  const nextQuestion = sequencePosition >= 0 && sequencePosition < sequence.length - 1 ? sequence[sequencePosition + 1] : null
  const hasActiveFilters = Boolean(sequenceState.query) || sequenceState.domain !== 'all' || sequenceState.split !== 'all' || sequenceState.belief !== 'all'
  const loadProcess = () => {
    if (processState === 'loading' || processState === 'loaded') return
    setProcessState('loading')
    setProcessError(null)
    loadQuestionProcess(item, manifest)
      .then((process) => {
        setRows((current) => attachQuestionProcess(current, process))
        setProcessState('loaded')
      })
      .catch((loadError: unknown) => {
        setProcessError(loadError instanceof Error ? loadError.message : 'Unable to load notebook and tool records.')
        setProcessState('error')
      })
  }

  return (
    <>
      <section className="detail-hero section-rule">
        <div className="question-detail-nav">
          <a className="back-link" href={questionListHref(stateForPosition(sequencePosition))}>← Back to questions</a>
          <nav className="question-step-nav" aria-label="Questions in the current filtered view">
            <span className="question-sequence-count">{number(sequencePosition + 1)} of {number(sequence.length)} {hasActiveFilters ? 'matching' : 'questions'}</span>
            {previousQuestion ? <a className="question-step-link" href={questionDetailHref(previousQuestion.id, stateForPosition(sequencePosition - 1))} aria-label={`Previous question: ${previousQuestion.title}`}>← Previous</a> : <span className="question-step-link disabled" aria-disabled="true">← Previous</span>}
            {nextQuestion ? <a className="question-step-link" href={questionDetailHref(nextQuestion.id, stateForPosition(sequencePosition + 1))} aria-label={`Next question: ${nextQuestion.title}`}>Next →</a> : <span className="question-step-link disabled" aria-disabled="true">Next →</span>}
          </nav>
        </div>
        <div className="detail-kicker"><span>{humanize(detail.domain)}</span><span>{detail.split}</span><span>{humanize(detail.beliefKind)}</span></div>
        <h1>{detail.title}</h1>
      </section>

      <section className="detail-layout section-rule">
        <div className="trajectory-panel">
          <div className="trajectory-head">
            <div><p className="eyebrow">Forecast trajectory</p><h2>Probability of the resolved outcome</h2></div>
            {runGroups.length ? (
              <label className="select-field run-select">
                <span>Model run</span>
                <select value={runId} onChange={(event) => setRunId(event.target.value)}>
                  {runGroups.map((group) => <option key={group.id} value={group.id}>{group.first.modelName} · {modeLabel(group.first.mode)} · {retrievalLabel(group.first.retrieval)}</option>)}
                </select>
              </label>
            ) : null}
          </div>
          {trajectoryLoading ? <div className="remote-state"><strong>Loading model trajectories…</strong><p>The question record is already available; forecast data is arriving from Hugging Face.</p></div> : null}
          {trajectoryError ? <div className="remote-state error" role="alert"><strong>Model trajectories are temporarily unavailable.</strong><p>{trajectoryError}</p>{manifest.huggingFace ? <a href={manifest.huggingFace.datasetUrl} target="_blank" rel="noreferrer">Open the Forecast Dojo dataset ↗</a> : null}</div> : null}
          {selected ? (
            <>
              <p className="run-context"><span>{sourceLabel(selected.first.sourceType)}</span><span>{modeLabel(selected.first.mode)}</span><span>{retrievalLabel(selected.first.retrieval)}</span><span>{selected.first.protocol ?? 'Published run'}</span></p>
              <p className="repeat-note">{repeatCount > 1 ? `Average of ${repeatCount} published repeats. Scores are recalculated from the averaged probability distribution; each checkpoint reports how many usable repeats contributed.` : 'Single published repeat; no cross-repeat averaging is available.'}</p>
              {!selected.rows.length ? <p className="empty-state">No forecast records are available for this model run.</p> : null}
              <ProbabilityTrajectoryChart rows={selected.rows} fallbackDates={detail.forecastDates} outcome={detail.resolvedLabel} />
              <div className="trajectory-summary"><SummaryCard label="Mean Brier" value={formatMetric(meanBrier, 'brier')} meta={repeatCount > 1 ? `Scores averaged across ${repeatCount} repeats` : 'Score from the published repeat'} tone="model" /><SummaryCard label="Mean information alpha" value={formatMetric(meanInfo, 'infoAlpha')} meta={`${sourceLabel(selected.first.sourceType)} · ${modeLabel(selected.first.mode)}`} tone={selected.first.sourceType} /></div>
              <div className="trajectory-list">{selected.rows.map((row, index) => <TrajectoryPoint key={`${row.runId}-${row.stepIndex}-${index}`} row={row} fallbackDate={detail.forecastDates[row.stepIndex]} />)}</div>
              {selectedRun && selectedRun.rows.some(hasCheckpointTelemetry) ? <CheckpointActivity rows={selectedRun.rows} fallbackDates={detail.forecastDates} processState={processState} processError={processError} onLoadProcess={loadProcess} datasetUrl={manifest.huggingFace?.datasetUrl} /> : null}
            </>
          ) : !trajectoryLoading && !trajectoryError ? <div className="empty-state"><h3>No evaluation model results for this question.</h3><p>{item.split === 'train' ? 'This is a training-set question; published model evaluations currently use the evaluation split.' : 'No forecast rows were recorded for this evaluation question.'}</p></div> : null}
        </div>

        <aside className="question-context">
          <p className="eyebrow">Question record</p>
          {detail.body ? <details><summary>Full resolution criteria</summary><p>{detail.body}</p></details> : <p>No additional resolution criteria were published.</p>}
          {detail.options.length ? <div className="option-block"><h3>Outcomes</h3><div className="tag-list">{detail.options.map((option) => <span key={option} className={option === detail.resolvedLabel ? 'resolved' : ''}>{option}</span>)}</div></div> : null}
          <dl className="metadata-list">
            <div><dt>Resolved outcome</dt><dd>{detail.resolvedLabel || '—'}</dd></div>
            <div><dt>Forecast checkpoints</dt><dd>{number(detail.checkpointCount)}</dd></div>
            <div><dt>First forecast</dt><dd>{shortDate(detail.firstForecastDate)}</dd></div>
            <div><dt>Last forecast</dt><dd>{shortDate(detail.lastForecastDate)}</dd></div>
            <div><dt>Question ID</dt><dd>{detail.id}</dd></div>
            <div><dt>Start</dt><dd>{shortDate(detail.startDate)}</dd></div>
            <div><dt>Close</dt><dd>{shortDate(detail.closeDate)}</dd></div>
          </dl>
        </aside>
      </section>
    </>
  )
}

function PageIntro({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return <section className="page-intro section-rule"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{copy}</p></section>
}

function PaperRedirect() {
  useEffect(() => {
    window.location.replace(PAPER_URL)
  }, [])

  return <LoadingPage label="Opening the paper…" />
}

function Stat({ value, label }: { value: string; label: string }) {
  return <article><span className="stat-value">{value}</span><span className="stat-label">{label}</span></article>
}

function BreakdownMatrix({ runs, keys, field, metric, visibleRunIds }: { runs: RunAnalysis[]; keys: Array<{ key: string; label: string }>; field: 'byDomain' | 'byHorizon' | 'byQuestionType'; metric: Metric; visibleRunIds?: string[] }) {
  const runOrder = visibleRunIds ? new Map(visibleRunIds.map((id, index) => [id, index])) : null
  const orderedRuns = [...runs]
    .filter((run) => !runOrder || runOrder.has(run.runId))
    .sort((a, b) => runOrder
      ? (runOrder.get(a.runId) ?? Number.MAX_SAFE_INTEGER) - (runOrder.get(b.runId) ?? Number.MAX_SAFE_INTEGER)
      : (b.overall.accuracy ?? Number.NEGATIVE_INFINITY) - (a.overall.accuracy ?? Number.NEGATIVE_INFINITY))
  const values = runs.flatMap((run) => run[field].map((cell) => cell[metric]).filter(isFiniteNumber))
  const minimum = values.length ? Math.min(...values) : 0
  const maximum = values.length ? Math.max(...values) : 1
  return (
    <figure className="breakdown-matrix">
      {orderedRuns.map((run) => {
        const cells = new Map(run[field].map((cell) => [cell.key, cell]))
        return (
          <article className="breakdown-run" key={run.runId}>
            <div className="breakdown-identity"><strong>{shortModelName(run.modelName)}</strong><span>{modeLabel(run.mode)} · {sourceLabel(run.sourceType)}</span></div>
            <div className="breakdown-cells">
              {keys.map(({ key, label }) => {
                const cell = cells.get(key) as BreakdownAggregate | undefined
                const value = cell?.[metric] ?? null
                return <div className="breakdown-cell" key={key} role="img" tabIndex={0} aria-label={`${run.modelName}, ${modeLabel(run.mode)}, ${label}, ${metricDetails[metric].label} ${formatMetric(value, metric)}, ${cell ? `${number(cell.nScored)} scored` : 'no data'}`} style={{ backgroundColor: heatColor(value, metric, minimum, maximum) }}><span>{label}</span><strong>{formatMetric(value, metric)}</strong><small>{cell ? `${number(cell.nScored)} scored` : 'No data'}</small></div>
              })}
            </div>
          </article>
        )
      })}
      <figcaption>Color intensity is normalized within this visualization; rely on the printed values for comparisons. <a href={releaseHref('#/overview#evaluation-notes')}>Coverage and uncertainty</a></figcaption>
    </figure>
  )
}

function DomainLeaderboardChart({ analysisRuns, runSummaries, visibleRunIds, domains }: { analysisRuns: RunAnalysis[]; runSummaries: RunSummary[]; visibleRunIds?: string[]; domains: string[] }) {
  const defaultDomain = [...domains].sort((a, b) => {
    const questionsFor = (domain: string) => Math.max(0, ...analysisRuns.map((run) => run.byDomain.find((cell) => cell.key === domain)?.nQuestions ?? 0))
    return questionsFor(b) - questionsFor(a)
  })[0] ?? ''
  const [activeDomain, setActiveDomain] = useState(defaultDomain)
  const [inspectedRunId, setInspectedRunId] = useState<string | null>(null)
  const summaryById = new Map(runSummaries.map((run) => [run.id, run]))
  const groupByRunId = new Map<string, RunGroup>()
  for (const group of groupRuns(runSummaries)) {
    for (const run of group.runs) groupByRunId.set(run.id, group)
  }

  useEffect(() => {
    if (!domains.includes(activeDomain)) setActiveDomain(defaultDomain)
  }, [activeDomain, defaultDomain, domains.join('|')])

  useEffect(() => {
    setInspectedRunId(null)
  }, [activeDomain])

  const candidates = analysisRuns.flatMap((run) => {
    const cell = run.byDomain.find((candidate) => candidate.key === activeDomain)
    if (!cell || !isFiniteNumber(cell.infoAlpha) || cell.nScored <= 0) return []
    const group = groupByRunId.get(run.runId)
    return [{ run, cell, infoAlpha: cell.infoAlpha, summary: summaryById.get(run.runId), provider: group ? providerForGroup(group) : undefined }]
  }).sort((a, b) => b.infoAlpha - a.infoAlpha || b.cell.nQuestions - a.cell.nQuestions || a.run.modelName.localeCompare(b.run.modelName))
  const leader = candidates[0]
  const visible = new Set(visibleRunIds ?? analysisRuns.map((run) => run.runId))
  const ranked = candidates.filter((candidate) => visible.has(candidate.run.runId))
  const inspected = candidates.find((candidate) => candidate.run.runId === inspectedRunId) ?? leader
  const scale = Math.max(0.001, ...candidates.map((candidate) => Math.abs(candidate.infoAlpha)))

  if (!domains.length || !leader) return <p className="chart-empty">No domain-level results are published yet.</p>

  const providerMark = (provider: ModelProvider | undefined) => <span className="domain-provider-mark"><ProviderMark provider={provider} /></span>
  const runContext = (candidate: typeof leader) => `${sourceLabel(candidate.run.sourceType)} · ${modeLabel(candidate.run.mode)} · ${retrievalLabel(candidate.summary?.retrieval)}`

  return (
    <figure className="domain-leaderboard">
      <div className="domain-tabs" role="group" aria-label="Choose a forecasting domain">
        {domains.map((domain) => <button key={domain} type="button" className={activeDomain === domain ? 'active' : ''} aria-pressed={activeDomain === domain} onClick={() => setActiveDomain(domain)}>{humanize(domain)}</button>)}
      </div>

      <div className="domain-leader-card">
        <div className="domain-leader-identity">
          <span className="domain-leader-kicker">{inspectedRunId ? 'Model detail' : `Observed leader · ${humanize(activeDomain)}`}</span>
          <div className="domain-leader-model">{providerMark(inspected.provider)}<div><strong>{shortModelName(inspected.run.modelName)}</strong><span>{runContext(inspected)}</span></div></div>
          {inspected.cell.nQuestions < 10 ? <span className="domain-small-sample">Small sample · {number(inspected.cell.nQuestions)} question{inspected.cell.nQuestions === 1 ? '' : 's'}</span> : null}
        </div>
        <dl className="domain-leader-metrics">
          <div><dt>Information α</dt><dd>{signedDecimal(inspected.infoAlpha)}</dd></div>
          <div><dt>Accuracy</dt><dd>{percent(inspected.cell.accuracy)}</dd></div>
          <div><dt>Brier</dt><dd>{formatMetric(inspected.cell.brier, 'brier')}</dd></div>
          <div><dt>Coverage</dt><dd>{percent(inspected.cell.coverage)}</dd></div>
          <div><dt>Questions</dt><dd>{number(inspected.cell.nQuestions)}</dd></div>
          <div><dt>Checkpoints</dt><dd>{number(inspected.cell.nScored)}</dd></div>
        </dl>
      </div>

      {ranked.length ? (
        <div className="domain-ranking">
          <div className="domain-ranking-axis" aria-hidden="true"><span /><div><span>{signedDecimal(-scale)}</span><span>Crowd · 0.000</span><span>{signedDecimal(scale)}</span></div><span>Information α</span></div>
          {ranked.map((candidate, index) => {
            const width = `${Math.min(50, Math.abs(candidate.infoAlpha) / scale * 50)}%`
            const barStyle = candidate.infoAlpha >= 0 ? { left: '50%', width } : { right: '50%', width }
            const providerColor = candidate.provider?.color ?? '#7a7168'
            const label = `${candidate.run.modelName}, ${runContext(candidate)}, information alpha ${signedDecimal(candidate.infoAlpha)}, accuracy ${percent(candidate.cell.accuracy)}, Brier ${formatMetric(candidate.cell.brier, 'brier')}, ${number(candidate.cell.nQuestions)} questions, ${number(candidate.cell.nScored)} checkpoints, ${percent(candidate.cell.coverage)} coverage`
            return (
              <article key={candidate.run.runId} className="domain-ranking-row" tabIndex={0} aria-label={label} onMouseEnter={() => setInspectedRunId(candidate.run.runId)} onMouseLeave={() => setInspectedRunId(null)} onFocus={() => setInspectedRunId(candidate.run.runId)} onBlur={() => setInspectedRunId(null)}>
                <div className="domain-rank-identity"><span className="domain-rank-number">{index + 1}</span>{providerMark(candidate.provider)}<div><strong>{shortModelName(candidate.run.modelName)}</strong><span>{modeLabel(candidate.run.mode)} · {retrievalLabel(candidate.summary?.retrieval)}</span></div></div>
                <div className="domain-score-track" aria-hidden="true"><span className="domain-score-zero" /><span className={`domain-score-bar ${candidate.infoAlpha >= 0 ? 'positive' : 'negative'}`} style={{ ...barStyle, backgroundColor: providerColor }} /></div>
                <div className="domain-score-value"><strong>{signedDecimal(candidate.infoAlpha)}</strong>{candidate.cell.nQuestions < 10 ? <span>Small sample</span> : <span>{number(candidate.cell.nQuestions)} questions</span>}</div>
              </article>
            )
          })}
        </div>
      ) : <div className="result-model-empty"><strong>No selected model has a result in {humanize(activeDomain)}.</strong><span>Use Add models or reset the filters to restore the ranking.</span></div>}
    </figure>
  )
}

function PairedModeChart({ comparisons, visibleGroupIds }: { comparisons: PairedModeComparison[]; visibleGroupIds?: string[] }) {
  const groupOrder = visibleGroupIds ? new Map(visibleGroupIds.map((id, index) => [id, index])) : null
  const ordered = [...comparisons]
    .filter((comparison) => !groupOrder || groupOrder.has(runGroupIdFromRunId(comparison.sequentialRunId)))
    .sort((a, b) => groupOrder
      ? (groupOrder.get(runGroupIdFromRunId(a.sequentialRunId)) ?? Number.MAX_SAFE_INTEGER) - (groupOrder.get(runGroupIdFromRunId(b.sequentialRunId)) ?? Number.MAX_SAFE_INTEGER)
      : a.modelName.localeCompare(b.modelName))
  return (
    <figure className="paired-mode-chart">
      {ordered.map((comparison) => (
        <article className="paired-mode-row" key={`${comparison.independentRunId}:${comparison.sequentialRunId}`}>
          <div className="paired-mode-identity"><strong>{shortModelName(comparison.modelName)}</strong><span>{sourceLabel(comparison.sourceType)} · {number(comparison.nMatched)} matched checkpoints</span></div>
          <div className="paired-mode-metrics">
            <DifferenceCell label="Accuracy Δ" value={comparison.accuracyDifference} format="points" favorable={(comparison.accuracyDifference ?? 0) > 0} interval={comparison.intervals.accuracyDifference} />
            <DifferenceCell label="Brier Δ" value={comparison.brierDifference} format="decimal" favorable={(comparison.brierDifference ?? 0) < 0} interval={comparison.intervals.brierDifference} />
            <DifferenceCell label="Information α Δ" value={comparison.infoAlphaDifference} format="decimal" favorable={(comparison.infoAlphaDifference ?? 0) > 0} interval={comparison.intervals.infoAlphaDifference} />
            <DifferenceCell label="Sequential lower Brier" value={comparison.sequentialWinRate} format="percent" favorable={(comparison.sequentialWinRate ?? 0) > 0.5} />
          </div>
        </article>
      ))}
      <figcaption>Paired intervals are clustered by question. These differences measure the effect of forecast memory within each model family. <a href={releaseHref('#/overview#memory')}>Protocol details</a></figcaption>
    </figure>
  )
}

function RecencyEffectChart({ comparisons, runs, visibleGroupIds, activeMode }: { comparisons: RecencyComparison[]; runs: RunSummary[]; visibleGroupIds?: string[]; activeMode: Exclude<ForecastMode, 'unknown'> }) {
  const selectedNameOrder = visibleGroupIds ? new Map(visibleGroupIds.flatMap((id, index) => {
    const group = groupRuns(runs).find((candidate) => candidate.id === id)
    return group ? [[comparisonModelKey(group.modelName), index] as const] : []
  })) : null
  const modeOrder: Record<ForecastMode, number> = { independent: 0, sequential: 1, unknown: 2 }
  const ordered = [...comparisons]
    .filter((row) => row.mode === activeMode && (!selectedNameOrder || selectedNameOrder.has(comparisonModelKey(row.modelName))))
    .sort((a, b) => selectedNameOrder
      ? (selectedNameOrder.get(comparisonModelKey(a.modelName)) ?? Number.MAX_SAFE_INTEGER) - (selectedNameOrder.get(comparisonModelKey(b.modelName)) ?? Number.MAX_SAFE_INTEGER) || modeOrder[a.mode] - modeOrder[b.mode]
      : a.brierDifference - b.brierDifference)
  const scale = Math.max(0.001, ...comparisons.map((row) => Math.abs(row.brierDifference)))
  return (
    <figure className="research-list-chart">
      {ordered.map((row) => {
        const tooltip = `${row.modelName} · ${modeLabel(row.mode)} · Brier difference ${signedDecimal(row.brierDifference)} · ${number(row.nMatched)} matched question-dates`
        return <article className="research-chart-row" key={`${row.modelName}:${row.mode}`} role="img" aria-label={tooltip} tabIndex={0}>
          <div className="research-chart-identity"><strong>{shortModelName(row.modelName)}</strong><span>{modeLabel(row.mode)} · {sourceLabel(row.sourceType)}</span></div>
          <EffectBar value={row.brierDifference} scale={scale} favorable={row.brierDifference < 0} />
          <div className="research-chart-values"><strong>{signedDecimal(row.brierDifference)} Brier</strong><span>{signedPoints(row.accuracyDifference)} accuracy · {signedDecimal(row.infoAlphaDifference)} α</span></div>
        </article>
      })}
      <figcaption>Hover or focus a row for emphasis. Intervals and exact matched counts are retained in the downloadable analysis summary.</figcaption>
    </figure>
  )
}

function ConsistencyChart({ rows, visibleRunIds }: { rows: ConsistencySummary[]; visibleRunIds?: string[] }) {
  const runOrder = visibleRunIds ? new Map(visibleRunIds.map((id, index) => [id, index])) : null
  const ordered = [...rows]
    .filter((row) => !runOrder || runOrder.has(row.runId))
    .sort((a, b) => runOrder
      ? (runOrder.get(a.runId) ?? Number.MAX_SAFE_INTEGER) - (runOrder.get(b.runId) ?? Number.MAX_SAFE_INTEGER)
      : b.ensembleGain - a.ensembleGain)
  const scale = Math.max(0.001, ...rows.map((row) => Math.abs(row.ensembleGain)))
  return (
    <figure className="research-list-chart">
      {ordered.map((row) => {
        const tooltip = `${row.modelName} · ${modeLabel(row.mode)} · averaging improves Brier by ${row.ensembleGain.toFixed(3)} · mean repeat disagreement ${row.disagreement.toFixed(3)}`
        return <article className="research-chart-row" key={row.runId} role="img" aria-label={tooltip} tabIndex={0}>
          <div className="research-chart-identity"><strong>{shortModelName(row.modelName)}</strong><span>{modeLabel(row.mode)} · {retrievalLabel(row.retrieval)}</span></div>
          <EffectBar value={row.ensembleGain} scale={scale} favorable={row.ensembleGain > 0} />
          <div className="research-chart-values"><strong>{row.ensembleGain.toFixed(3)} improvement</strong><span>{row.disagreement.toFixed(3)} disagreement · {number(row.nUsed)} complete groups</span></div>
        </article>
      })}
      <figcaption>Positive bars indicate that averaging the four available probability distributions lowered Brier score.</figcaption>
    </figure>
  )
}

function DynamicsChart({ rows, visibleRunIds }: { rows: DynamicsSummary[]; visibleRunIds?: string[] }) {
  const runOrder = visibleRunIds ? new Map(visibleRunIds.map((id, index) => [id, index])) : null
  const ordered = [...rows]
    .filter((row) => !runOrder || runOrder.has(row.runId))
    .sort((a, b) => runOrder
      ? (runOrder.get(a.runId) ?? Number.MAX_SAFE_INTEGER) - (runOrder.get(b.runId) ?? Number.MAX_SAFE_INTEGER)
      : a.excessMovement - b.excessMovement)
  const scale = Math.max(0.001, ...rows.flatMap((row) => [Math.abs(row.excessMovement), Math.abs(row.interval.lower ?? 0), Math.abs(row.interval.upper ?? 0)]))
  return (
    <figure className="research-list-chart">
      {ordered.map((row) => {
        const tooltip = `${row.modelName} · excess movement ${row.excessMovement.toFixed(3)} · model lead ${row.modelLeadDays.toFixed(1)} days · crowd lead ${row.crowdLeadDays.toFixed(1)} days`
        return <article className="research-chart-row" key={row.runId} role="img" aria-label={tooltip} tabIndex={0}>
          <div className="research-chart-identity"><strong>{shortModelName(row.modelName)}</strong><span>Sequential · {retrievalLabel(row.retrieval)}</span></div>
          <EffectBar value={row.excessMovement} scale={scale} favorable={row.excessMovement <= 0} />
          <div className="research-chart-values"><strong>{signedDecimal(row.excessMovement)} movement</strong><span>{row.modelLeadDays.toFixed(1)}d model lead · {row.crowdLeadDays.toFixed(1)}d crowd</span></div>
        </article>
      })}
      <figcaption>Lead days measure when probability assigned to the resolved outcome rises above 50% and remains there.</figcaption>
    </figure>
  )
}

function EffectBar({ value, scale, favorable }: { value: number; scale: number; favorable: boolean }) {
  const width = Math.max(0.7, Math.min(48, Math.abs(value) / scale * 48))
  const left = value < 0 ? 50 - width : 50
  return <div className="research-effect-track" aria-hidden="true"><i className="research-effect-zero" /><span className={favorable ? 'favorable' : 'unfavorable'} style={{ left: `${left}%`, width: `${width}%` }} /></div>
}

function DifferenceCell({ label, value, format, favorable, interval }: { label: string; value: number | null; format: 'points' | 'decimal' | 'percent'; favorable: boolean; interval?: { lower: number | null; upper: number | null } | null }) {
  const formatted = format === 'points' ? signedPoints(value) : format === 'percent' ? percent(value) : signedDecimal(value)
  return <div className={`difference-cell${favorable ? ' favorable' : ''}`} role="img" tabIndex={0} aria-label={`${label} ${formatted}${interval ? `, 95% confidence interval ${format === 'points' ? `${signedPoints(interval.lower)} to ${signedPoints(interval.upper)}` : `${signedDecimal(interval.lower)} to ${signedDecimal(interval.upper)}`}` : ''}`}><span>{label}</span><strong>{formatted}</strong>{interval ? <small>95% CI {format === 'points' ? `${signedPoints(interval.lower)} to ${signedPoints(interval.upper)}` : `${signedDecimal(interval.lower)} to ${signedDecimal(interval.upper)}`}</small> : null}</div>
}

function ChartCard({ title, description, accent, className = '', children }: { title: string; description: string; accent: 'quality' | 'activity' | 'tokens'; className?: string; children: React.ReactNode }) {
  return <article className={`highlight-card ${accent} ${className}`.trim()}><div className="highlight-card-heading"><span aria-hidden="true" /><h3>{title}</h3></div><p>{description}</p>{children}</article>
}

function AnalysisSection({ eyebrow, title, description, note, children }: { eyebrow: string; title: string; description: string; note: string; children: React.ReactNode }) {
  return (
    <section className="analysis-section section-rule">
      <div className="analysis-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><p>{description}</p></div>
      {children}
      <p className="analysis-note">{note}</p>
    </section>
  )
}

const modelProviders = [
  { name: 'OpenAI', match: /^(gpt-|gpt-oss)/, latestFamily: 'gpt-5.6-sol', color: '#3f7773' },
  { name: 'Anthropic', match: /^(opus-|claude)/, latestFamily: 'opus-4.8', color: '#c96648' },
  { name: 'xAI', match: /^grok-/, latestFamily: 'grok-4.6', color: '#4e4a47' },
  { name: 'Z.ai', match: /^glm-/, latestFamily: 'glm-5', color: '#7561b8' },
  { name: 'Alibaba', match: /^qwen/, latestFamily: 'qwen3.5-397b', color: '#487fbd' },
  { name: 'Moonshot AI', match: /^kimi-/, latestFamily: 'kimi-k2.5', color: '#a45d87' },
  { name: 'DeepSeek', match: /^deepseek-/, latestFamily: 'deepseek-v3.2', color: '#3571a8' },
  { name: 'MiniMax', match: /^minimax-/, latestFamily: 'minimax-m2.5', color: '#b55270' },
  { name: 'NVIDIA', match: /^nemotron-/, latestFamily: 'nemotron-3-super', color: '#6f963d' },
] as const

type ModelProvider = (typeof modelProviders)[number]
type RunGroup = { id: string; modelName: string; sourceType: SourceType; runs: RunSummary[] }
type AccuracySourceFilter = 'all' | 'open' | 'closed'
type AccuracyReleaseFilter = 'all' | 'current' | 'historical'
type AnalysisModeControl = 'select' | 'compare' | 'sequential-only'
type AnalysisRecencyControl = 'select' | 'compare'
type AnalysisFigureSelection = { visibleGroupIds: string[]; visibleRunIds: string[]; activeMode: Exclude<ForecastMode, 'unknown'> }
type AnalysisRunFamily = { representative: RunGroup; baseline?: RunGroup; recency?: RunGroup }

function ModelFilteredAnalysisSection({ chartId, eyebrow, title, description, note, runs, eligibleRunIds, modeControl = 'select', recencyControl = 'select', defaultModelCount, children }: {
  chartId: string
  eyebrow: string
  title: string
  description: string
  note: string
  runs: RunSummary[]
  eligibleRunIds: string[]
  modeControl?: AnalysisModeControl
  recencyControl?: AnalysisRecencyControl
  defaultModelCount?: number
  children: (selection: AnalysisFigureSelection) => React.ReactNode
}) {
  const eligible = new Set(eligibleRunIds)
  const eligibleGroups = groupRuns(runs)
    .map((group) => ({ ...group, runs: group.runs.filter((run) => eligible.has(run.id)) }))
    .filter((group) => group.runs.length)
  const familyMap = new Map<string, AnalysisRunFamily>()
  for (const group of eligibleGroups) {
    const key = retrievalFamilyKey(group)
    const current = familyMap.get(key)
    if (!current) {
      familyMap.set(key, { representative: group, ...(isRecencyGroup(group) ? { recency: group } : { baseline: group }) })
    } else if (isRecencyGroup(group)) {
      current.recency = group
    } else {
      current.baseline = group
      current.representative = group
    }
  }
  const families = [...familyMap.values()]
  const groups = families.map((family) => family.representative)
  const familyByRepresentativeId = new Map(families.map((family) => [family.representative.id, family]))
  const defaults = defaultResultGroupIds(groups).slice(0, defaultModelCount ?? groups.length)
  const [selectedIds, setSelectedIds] = useState<string[]>(() => defaults)
  const [modelSearch, setModelSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<AccuracySourceFilter>('all')
  const [releaseFilter, setReleaseFilter] = useState<AccuracyReleaseFilter>('all')
  const [providerFilter, setProviderFilter] = useState('all')
  const groupMap = new Map(groups.map((group) => [group.id, group]))
  const selected = selectedIds.map((id) => groupMap.get(id)).filter((group): group is RunGroup => Boolean(group))
  const activeMode: Exclude<ForecastMode, 'unknown'> = modeControl === 'sequential-only' ? 'sequential' : 'independent'
  const searchTerm = modelSearch.trim().toLowerCase()
  const searchResults = groups.filter((group) => {
    const haystack = `${group.modelName} ${providerNameForGroup(group)} ${group.runs[0]?.baseModel ?? ''}`.toLowerCase()
    return haystack.includes(searchTerm)
  })
  const visibleFamilies = selected.flatMap((group) => {
    if ((sourceFilter !== 'all' && group.sourceType !== sourceFilter) || (providerFilter !== 'all' && providerNameForGroup(group) !== providerFilter)) return []
    const family = familyByRepresentativeId.get(group.id)
    if (!family) return []
    const requestedGroups = recencyControl === 'compare'
      ? [family.baseline, family.recency]
      : [family.baseline]
    const conditionGroups = requestedGroups
      .filter((candidate): candidate is RunGroup => Boolean(candidate))
      .filter((candidate) => releaseFilter === 'all' || (isHistoricalGroup(candidate) ? 'historical' : 'current') === releaseFilter)
    const activeRuns = conditionGroups.flatMap((candidate) => candidate.runs.filter((run) => modeControl === 'compare' ? run.mode === 'independent' || run.mode === 'sequential' : run.mode === activeMode))
    return activeRuns.length ? [{ conditionGroups, activeRuns }] : []
  })
  const visibleGroupIds = [...new Set(visibleFamilies.flatMap((family) => family.conditionGroups.map((group) => group.id)))]
  const visibleRunIds = visibleFamilies.flatMap((family) => family.activeRuns.map((run) => run.id))
  const activeFilterCount = [sourceFilter, releaseFilter, providerFilter].filter((value) => value !== 'all').length
  const controlName = `${chartId}-model-controls`
  const filterTitleId = `${chartId}-filter-title`
  const providers = [...new Set(groups.map(providerNameForGroup))]
  const memoryStatus = modeControl === 'compare' ? 'Comparing both' : modeControl === 'sequential-only' ? 'Showing Sequential' : 'Showing Independent'
  const recencyStatus = recencyControl === 'compare' ? 'Comparing both' : 'Showing Recency off'

  useEffect(() => {
    const valid = new Set(groups.map((group) => group.id))
    setSelectedIds((current) => {
      const retained = current.filter((id) => valid.has(id))
      return retained.length ? retained : defaults
    })
  }, [eligibleRunIds.join('|')])

  const toggleModel = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id])
  }

  const resetFilters = () => {
    setSourceFilter('all')
    setReleaseFilter('all')
    setProviderFilter('all')
  }

  const updateProviderFilter = (value: string) => {
    setProviderFilter(value)
    if (value === 'all') return
    let candidates = selected.filter((group) => providerNameForGroup(group) === value)
    if (sourceFilter !== 'all') {
      const matching = candidates.filter((group) => group.sourceType === sourceFilter)
      if (matching.length) candidates = matching
      else setSourceFilter('all')
    }
    if (releaseFilter !== 'all') {
      const matching = candidates.filter((group) => (isHistoricalGroup(group) ? 'historical' : 'current') === releaseFilter)
      if (!matching.length) setReleaseFilter('all')
    }
  }

  return (
    <AnalysisSection eyebrow={eyebrow} title={title} description={description} note={note}>
      <div className="result-model-explorer">
        <div className="result-model-toolbar">
          <span><strong>{visibleFamilies.length}</strong> model{visibleFamilies.length === 1 ? '' : 's'} shown · {memoryStatus} · {recencyStatus}</span>
          <div className="accuracy-chart-actions">
            <details className="accuracy-model-picker" name={controlName}>
              <summary><span aria-hidden="true">＋</span> Add models <small>{selected.length}/{groups.length}</small></summary>
              <div className="accuracy-model-picker-panel">
                <label className="accuracy-model-search"><span className="sr-only">Search models</span><input type="search" value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="Search models or providers…" /></label>
                <div className="accuracy-model-options" role="group" aria-label={`Models shown in the ${title} figure`}>
                  {searchResults.map((group) => <label key={group.id}><input type="checkbox" checked={selectedIds.includes(group.id)} onChange={() => toggleModel(group.id)} /><span><strong>{group.modelName}</strong><small>{providerNameForGroup(group)} · All available run variants</small></span></label>)}
                  {!searchResults.length ? <p>No matching models.</p> : null}
                </div>
                <div className="accuracy-model-picker-actions"><button type="button" onClick={() => setSelectedIds(defaults)}>Reset default</button><button type="button" onClick={() => setSelectedIds([])}>Clear</button><button type="button" onClick={() => setSelectedIds(groups.map((group) => group.id))}>Select all</button></div>
              </div>
            </details>

            <details className="accuracy-control-menu" name={controlName}>
              <summary className="accuracy-icon-control" aria-label={`Filter ${title} figure${activeFilterCount ? `, ${activeFilterCount} active` : ''}`} title="Filter figure">
                <FilterGlyph />
                {activeFilterCount ? <small>{activeFilterCount}</small> : null}
              </summary>
              <div className="accuracy-control-panel accuracy-filter-panel" role="dialog" aria-labelledby={filterTitleId}>
                <div className="accuracy-control-heading"><strong id={filterTitleId}>Filters</strong>{activeFilterCount ? <span>{activeFilterCount} active</span> : null}</div>
                <AccuracyChoiceGroup name={`${chartId}-source-type`} label="Source type" value={sourceFilter} onChange={(value) => setSourceFilter(value as AccuracySourceFilter)} options={[
                  { value: 'all', label: 'All sources' },
                  { value: 'open', label: 'Open-source' },
                  { value: 'closed', label: 'Closed-source' },
                ]} />
                <AccuracyChoiceGroup name={`${chartId}-provider`} label="Provider" value={providerFilter} onChange={updateProviderFilter} options={[
                  { value: 'all', label: 'All providers' },
                  ...providers.map((provider) => ({ value: provider, label: provider })),
                ]} />
                <AccuracyChoiceGroup name={`${chartId}-evaluation`} label="Evaluation" value={releaseFilter} onChange={(value) => setReleaseFilter(value as AccuracyReleaseFilter)} options={[
                  { value: 'all', label: 'All evaluations' },
                  { value: 'current', label: 'Current · four repeats' },
                  { value: 'historical', label: 'Historical · one repeat' },
                ]} />
                <button className="accuracy-control-reset" type="button" onClick={resetFilters}>Reset filters</button>
              </div>
            </details>
          </div>
        </div>

        {visibleFamilies.length ? children({ visibleGroupIds, visibleRunIds, activeMode }) : <div className="result-model-empty" aria-live="polite"><strong>{selected.length ? 'No selected models have this run condition.' : 'No models selected.'}</strong><span>{selected.length ? 'Reset the filters or add another model.' : 'Use Add models to choose one or more model families.'}</span></div>}
      </div>
    </AnalysisSection>
  )
}

function MetricLeaderboardChart({ runs, baseline, metric }: { runs: RunSummary[]; baseline: number | null; metric: Metric }) {
  const allGroups = useMemo(() => groupRuns(runs)
    .filter((group) => group.runs.some((run) => isFiniteNumber(run[metric])))
    .sort((a, b) => compareGroupMetric(a, b, metric)), [runs, metric])
  const groups = useMemo(() => allGroups
    .filter((group) => !isRecencyGroup(group))
    .sort((a, b) => compareIndependentGroupMetric(a, b, metric)), [allGroups, metric])
  const recencyGroupsByFamily = useMemo(() => new Map(
    allGroups.filter(isRecencyGroup).map((group) => [retrievalFamilyKey(group), group]),
  ), [allGroups])
  const defaults = useMemo(() => groups.map((group) => group.id), [groups])
  const [memoryEnabled, setMemoryEnabled] = useState(false)
  const [recencyEnabled, setRecencyEnabled] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>(defaults)
  const [modelSearch, setModelSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<AccuracySourceFilter>('all')
  const [releaseFilter, setReleaseFilter] = useState<AccuracyReleaseFilter>('all')
  const [providerFilter, setProviderFilter] = useState('all')
  const [labelSize, setLabelSize] = useState(11)
  const [showBarValues, setShowBarValues] = useState(metric !== 'infoAlpha')
  const [showGridlines, setShowGridlines] = useState(true)
  const [showCrowdLine, setShowCrowdLine] = useState(true)
  const selected = groups.filter((group) => selectedIds.includes(group.id))
  const searchResults = groups.filter((group) => {
    const provider = providerForGroup(group)
    const haystack = `${group.modelName} ${provider?.name ?? ''} ${group.runs[0]?.baseModel ?? ''}`.toLowerCase()
    return haystack.includes(modelSearch.trim().toLowerCase())
  })
  const activeMode: Exclude<ForecastMode, 'unknown'> = memoryEnabled ? 'sequential' : 'independent'
  const activeEntries = selected.map((group) => {
    const activeGroup = recencyEnabled ? recencyGroupsByFamily.get(retrievalFamilyKey(group)) : group
    const run = activeGroup?.runs.find((candidate) => candidate.mode === activeMode)
    return { group, activeGroup, run }
  }).filter((entry): entry is { group: RunGroup; activeGroup: RunGroup; run: RunSummary } => Boolean(entry.activeGroup && entry.run && isFiniteNumber(entry.run[metric])))
  const visibleEntries = activeEntries.filter(({ group, activeGroup }) => {
    const provider = providerForGroup(group)
    const release = isHistoricalGroup(activeGroup) ? 'historical' : 'current'
    return (sourceFilter === 'all' || group.sourceType === sourceFilter)
      && (releaseFilter === 'all' || release === releaseFilter)
      && (providerFilter === 'all' || provider?.name === providerFilter)
  })
  const activeFilterCount = [sourceFilter, releaseFilter, providerFilter].filter((value) => value !== 'all').length
  const values = allGroups.flatMap((group) => group.runs.flatMap((run) => isFiniteNumber(run[metric]) ? [run[metric]] : []))
  const { domainMin, domainMax, axisTicks } = leaderboardDomain(metric, values, baseline)
  const position = (value: number) => Math.max(0, Math.min(100, ((value - domainMin) / (domainMax - domainMin)) * 100))
  const canvasWidth = Math.max(420, visibleEntries.length * 52 + 80)
  const controlName = `${metric}-chart-controls`
  const filterTitleId = `${metric}-filter-title`
  const displayTitleId = `${metric}-display-title`
  const toggleModel = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id])
  }

  const resetFilters = () => {
    setSourceFilter('all')
    setReleaseFilter('all')
    setProviderFilter('all')
  }

  const resetDisplay = () => {
    setLabelSize(11)
    setShowBarValues(metric !== 'infoAlpha')
    setShowGridlines(true)
    setShowCrowdLine(true)
  }

  const updateProviderFilter = (value: string) => {
    setProviderFilter(value)
    if (value === 'all') return

    let candidates = selected.filter((group) => providerForGroup(group)?.name === value)
    if (sourceFilter !== 'all') {
      const matching = candidates.filter((group) => group.sourceType === sourceFilter)
      if (matching.length) candidates = matching
      else setSourceFilter('all')
    }
    if (releaseFilter !== 'all') {
      const matching = candidates.filter((group) => (isHistoricalGroup(group) ? 'historical' : 'current') === releaseFilter)
      if (!matching.length) setReleaseFilter('all')
    }
  }

  return (
    <figure className={`accuracy-leaderboard metric-${metric}`}>
      <div className="accuracy-comparison-switch" role="group" aria-label={`${metricDetails[metric].label} run switches`}>
        <button type="button" className={memoryEnabled ? 'active' : ''} aria-pressed={memoryEnabled} onClick={() => setMemoryEnabled((enabled) => !enabled)}><span>Memory</span><small>{memoryEnabled ? 'Showing Sequential' : 'Showing Independent'}</small></button>
        <button type="button" className={recencyEnabled ? 'active' : ''} aria-pressed={recencyEnabled} onClick={() => setRecencyEnabled((enabled) => !enabled)}><span>Recency</span><small>{recencyEnabled ? 'Showing Recency on' : 'Showing Recency off'}</small></button>
      </div>
      <div className="accuracy-leaderboard-toolbar">
        <div className="accuracy-mode-legend" aria-label="Active run condition">
          <span><i className="sequential" />{modeLabel(activeMode)} · {recencyEnabled ? 'Recency on' : 'Recency off'}</span>
          {baseline == null || !showCrowdLine ? null : <span><i className="crowd" />Crowd · {formatLeaderboardValue(metric, baseline)}</span>}
        </div>
        <div className="accuracy-chart-actions">
          <details className="accuracy-model-picker" name={controlName}>
            <summary><span aria-hidden="true">＋</span> Add models <small>{selected.length}/{groups.length}</small></summary>
            <div className="accuracy-model-picker-panel">
              <label className="accuracy-model-search"><span className="sr-only">Search models</span><input type="search" value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="Search models or providers…" /></label>
              <div className="accuracy-model-options" role="group" aria-label={`Baseline model families shown in the ${metricDetails[metric].label} chart`}>
                {searchResults.map((group) => {
                  const provider = providerForGroup(group)
                  return <label key={group.id}><input type="checkbox" checked={selectedIds.includes(group.id)} onChange={() => toggleModel(group.id)} /><span><strong>{group.modelName}</strong><small>{provider?.name ?? sourceLabel(group.sourceType)} · All available run variants</small></span></label>
                })}
                {!searchResults.length ? <p>No matching models.</p> : null}
              </div>
              <div className="accuracy-model-picker-actions"><button type="button" onClick={() => setSelectedIds([])}>Clear</button><button type="button" onClick={() => setSelectedIds(defaults)}>Select all</button></div>
            </div>
          </details>

          <details className="accuracy-control-menu" name={controlName}>
            <summary className="accuracy-icon-control" aria-label={`Filter chart${activeFilterCount ? `, ${activeFilterCount} active` : ''}`} title="Filter chart">
              <FilterGlyph />
              {activeFilterCount ? <small>{activeFilterCount}</small> : null}
            </summary>
            <div className="accuracy-control-panel accuracy-filter-panel" role="dialog" aria-labelledby={filterTitleId}>
              <div className="accuracy-control-heading"><strong id={filterTitleId}>Filters</strong>{activeFilterCount ? <span>{activeFilterCount} active</span> : null}</div>
              <AccuracyChoiceGroup name={`${metric}-source-type`} label="Source type" value={sourceFilter} onChange={(value) => setSourceFilter(value as AccuracySourceFilter)} options={[
                { value: 'all', label: 'All sources' },
                { value: 'open', label: 'Open-source' },
                { value: 'closed', label: 'Closed-source' },
              ]} />
              <AccuracyChoiceGroup name={`${metric}-provider`} label="Provider" value={providerFilter} onChange={updateProviderFilter} options={[
                { value: 'all', label: 'All providers' },
                ...modelProviders.filter((provider) => groups.some((group) => providerForGroup(group)?.name === provider.name)).map((provider) => ({ value: provider.name, label: provider.name })),
              ]} />
              <AccuracyChoiceGroup name={`${metric}-evaluation`} label="Evaluation" value={releaseFilter} onChange={(value) => setReleaseFilter(value as AccuracyReleaseFilter)} options={[
                { value: 'all', label: 'All evaluations' },
                { value: 'current', label: 'Current · four repeats' },
                { value: 'historical', label: 'Historical · one repeat' },
              ]} />
              <button className="accuracy-control-reset" type="button" onClick={resetFilters}>Reset filters</button>
            </div>
          </details>

          <details className="accuracy-control-menu" name={controlName}>
            <summary className="accuracy-icon-control" aria-label="Chart display settings" title="Display settings"><DisplayGlyph /></summary>
            <div className="accuracy-control-panel accuracy-display-panel" role="dialog" aria-labelledby={displayTitleId}>
              <div className="accuracy-control-heading"><strong id={displayTitleId}>Display</strong></div>
              <label className="accuracy-label-slider"><span>Model label size <output>{labelSize}px</output></span><input type="range" min="8" max="20" step="1" value={labelSize} onChange={(event) => setLabelSize(Number(event.target.value))} /></label>
              <AccuracyToggle label="Values on bars" checked={showBarValues} onChange={setShowBarValues} />
              <AccuracyToggle label="Gridlines" checked={showGridlines} onChange={setShowGridlines} />
              <AccuracyToggle label="Crowd benchmark" checked={showCrowdLine} onChange={setShowCrowdLine} disabled={baseline == null} />
              <button className="accuracy-control-reset" type="button" onClick={resetDisplay}>Reset display</button>
            </div>
          </details>
        </div>
      </div>

      {!visibleEntries.length ? <div className="accuracy-empty" aria-live="polite"><strong>{selected.length ? 'No selected models have this run condition.' : 'No models selected.'}</strong><span>{selected.length ? 'Change a switch or reset the chart filters.' : 'Use “Add models” to choose one or more models.'}</span></div> : (
        <div className="accuracy-chart-scroll" tabIndex={0} aria-label={`Scrollable model ${metricDetails[metric].label.toLowerCase()} chart`}>
          <div className="accuracy-chart-canvas" style={{ minWidth: `${canvasWidth}px`, '--accuracy-label-size': `${labelSize}px` } as React.CSSProperties}>
            <div className="accuracy-y-axis" aria-hidden="true">
              {axisTicks.map((tick) => <span key={tick} style={{ bottom: `${position(tick)}%` }}>{formatLeaderboardTick(metric, tick)}</span>)}
            </div>
            <div className="accuracy-plot-field">
              {showGridlines ? axisTicks.map((tick) => <i key={tick} className="accuracy-gridline" style={{ bottom: `${position(tick)}%` }} />) : null}
              {baseline == null || !showCrowdLine ? null : <div className="accuracy-crowd-line" style={{ bottom: `${position(baseline)}%` }}><span>Crowd {formatLeaderboardValue(metric, baseline)}</span></div>}
              <div className="accuracy-model-groups">
                {visibleEntries.map(({ group, run }) => {
                  const provider = providerForGroup(group)
                  const chartStyle = { '--provider-color': provider?.color ?? '#887566' } as React.CSSProperties
                  const value = run[metric]
                  if (!isFiniteNumber(value)) return null
                  const valuePosition = position(value)
                  const originPosition = position(metric === 'infoAlpha' ? 0 : domainMin)
                  const barBottom = Math.min(valuePosition, originPosition)
                  const barHeight = Math.max(0.7, Math.abs(valuePosition - originPosition))
                  const isNegative = valuePosition < originPosition
                  const displayValue = formatLeaderboardValue(metric, value)
                  const conditionLabel = `${modeLabel(activeMode)} · ${recencyEnabled ? 'Recency on' : 'Recency off'}`
                  const tooltip = `${group.modelName} · ${conditionLabel} · ${displayValue} ${metricDetails[metric].label.toLowerCase()} · ${percent(run.coverage, 0)} coverage · ${metricDetails[metric].direction.toLowerCase()}`
                  return (
                    <article className="accuracy-model-group" key={group.id} style={chartStyle}>
                      <div className="accuracy-bar-pair single">
                        <div className="accuracy-bar-slot sequential" tabIndex={0} role="img" aria-label={tooltip}>
                          <div className={`accuracy-vertical-bar${isNegative ? ' negative' : ''}`} style={{ bottom: `${barBottom}%`, height: `${barHeight}%` }}>{showBarValues ? <strong>{displayValue}</strong> : null}</div>
                          <span className="accuracy-bar-tooltip"><small>{conditionLabel}</small><strong>{displayValue}</strong><span>{percent(run.coverage, 0)} coverage</span></span>
                        </div>
                      </div>
                      <ProviderMark provider={provider} />
                      <div className="accuracy-model-label" title={group.modelName}><span>{compactLeaderboardName(group.modelName)}</span></div>
                    </article>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}
      <figcaption aria-live="polite">Showing {visibleEntries.length} available model{visibleEntries.length === 1 ? '' : 's'} · Showing {modeLabel(activeMode)} · Showing {recencyEnabled ? 'Recency on' : 'Recency off'}{activeFilterCount ? ` · ${activeFilterCount} active filter${activeFilterCount === 1 ? '' : 's'}` : ''}.</figcaption>
    </figure>
  )
}

type ResearchScatterKind = 'murphy' | 'cost'
type ResearchScatterDatum = {
  group: RunGroup
  run: RunSummary
  provider?: ModelProvider
  x: number
  y: number
  murphy?: MurphySummary
}

function ResearchScatterChart({ runs, murphy, kind }: { runs: RunSummary[]; murphy: MurphySummary[]; kind: ResearchScatterKind }) {
  const murphyByRunId = useMemo(() => new Map(murphy.map((row) => [row.runId, row])), [murphy])
  const eligibleRunIds = useMemo(() => new Set(
    kind === 'murphy'
      ? murphy.map((row) => row.runId)
      : runs.filter((run) => isFiniteNumber(run.avgUsd) && run.avgUsd > 0 && isFiniteNumber(run.infoAlpha)).map((run) => run.id),
  ), [kind, murphy, runs])
  const allGroups = useMemo(() => groupRuns(runs)
    .filter((group) => group.runs.some((run) => eligibleRunIds.has(run.id))), [eligibleRunIds, runs])
  const groups = useMemo(() => allGroups
    .filter((group) => !isRecencyGroup(group))
    .sort((a, b) => compareIndependentGroupMetric(a, b, kind === 'murphy' ? 'brier' : 'infoAlpha')), [allGroups, kind])
  const recencyGroupsByFamily = useMemo(() => new Map(
    allGroups.filter(isRecencyGroup).map((group) => [retrievalFamilyKey(group), group]),
  ), [allGroups])
  const defaults = useMemo(() => groups.map((group) => group.id), [groups])
  const [memoryEnabled, setMemoryEnabled] = useState(false)
  const [recencyEnabled, setRecencyEnabled] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>(defaults)
  const [modelSearch, setModelSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<AccuracySourceFilter>('all')
  const [providerFilter, setProviderFilter] = useState('all')
  const [labelSize, setLabelSize] = useState(11)
  const [showLabels, setShowLabels] = useState(true)
  const [showGridlines, setShowGridlines] = useState(true)
  const [showReference, setShowReference] = useState(true)
  const [showFrontier, setShowFrontier] = useState(true)
  const activeMode: Exclude<ForecastMode, 'unknown'> = memoryEnabled ? 'sequential' : 'independent'
  const selected = groups.filter((group) => selectedIds.includes(group.id))
  const searchTerm = modelSearch.trim().toLowerCase()
  const searchResults = groups.filter((group) => {
    const provider = providerForGroup(group)
    return `${group.modelName} ${provider?.name ?? ''} ${group.runs[0]?.baseModel ?? ''}`.toLowerCase().includes(searchTerm)
  })
  const activeData: ResearchScatterDatum[] = selected.flatMap((group): ResearchScatterDatum[] => {
    const activeGroup = recencyEnabled ? recencyGroupsByFamily.get(retrievalFamilyKey(group)) : group
    const run = activeGroup?.runs.find((candidate) => candidate.mode === activeMode && eligibleRunIds.has(candidate.id))
    if (!activeGroup || !run) return []
    const provider = providerForGroup(group)
    if (kind === 'murphy') {
      const row = murphyByRunId.get(run.id)
      return row ? [{ group, run, provider, x: row.reliability, y: row.resolution, murphy: row }] : []
    }
    return isFiniteNumber(run.avgUsd) && run.avgUsd > 0 && isFiniteNumber(run.infoAlpha)
      ? [{ group, run, provider, x: run.avgUsd, y: run.infoAlpha }]
      : []
  })
  const visibleData = activeData.filter(({ group, provider }) => (
    (sourceFilter === 'all' || group.sourceType === sourceFilter)
    && (providerFilter === 'all' || provider?.name === providerFilter)
  ))
  const activeFilterCount = [sourceFilter, providerFilter].filter((value) => value !== 'all').length
  const controlName = `${kind}-scatter-controls`
  const filterTitleId = `${kind}-scatter-filter-title`
  const displayTitleId = `${kind}-scatter-display-title`
  const crowd = kind === 'murphy' ? visibleData.find((point) => point.murphy)?.murphy?.crowd ?? null : null
  const xValues = [...visibleData.map((point) => point.x), ...(crowd ? [crowd.reliability] : [])]
  const yValues = [...visibleData.map((point) => point.y), ...(crowd ? [crowd.resolution] : []), ...(kind === 'cost' ? [0] : [])]
  const xDomain = kind === 'cost' ? logarithmicDomain(xValues) : { min: 0, max: niceAxisMaximum(Math.max(...xValues, 0.01)) }
  const yDomain = kind === 'murphy'
    ? { min: 0, max: niceAxisMaximum(Math.max(...yValues, 0.1)) }
    : paddedLinearDomain(yValues)
  const xTicks = kind === 'cost' ? logarithmicTicks(xDomain.min, xDomain.max) : linearTicks(xDomain.min, xDomain.max)
  const yTicks = linearTicks(yDomain.min, yDomain.max)
  const xPosition = (value: number) => clampPercent(kind === 'cost'
    ? ((Math.log10(value) - Math.log10(xDomain.min)) / (Math.log10(xDomain.max) - Math.log10(xDomain.min))) * 100
    : ((value - xDomain.min) / (xDomain.max - xDomain.min)) * 100)
  const yPosition = (value: number) => clampPercent(((value - yDomain.min) / (yDomain.max - yDomain.min)) * 100)
  const frontier = kind === 'cost' ? paretoFrontier(visibleData) : []
  const frontierIds = new Set(frontier.map((point) => point.run.id))
  const frontierPath = frontier.map((point) => `${xPosition(point.x)},${100 - yPosition(point.y)}`).join(' ')
  const conditionLabel = `${modeLabel(activeMode)} · ${recencyEnabled ? 'Recency on' : 'Recency off'}`
  const providers = modelProviders.filter((provider) => groups.some((group) => providerForGroup(group)?.name === provider.name))

  useEffect(() => {
    const valid = new Set(groups.map((group) => group.id))
    setSelectedIds((current) => {
      const retained = current.filter((id) => valid.has(id))
      return retained.length || current.length === 0 ? retained : defaults
    })
  }, [defaults.join('|')])

  const toggleModel = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id])
  }

  const resetFilters = () => {
    setSourceFilter('all')
    setProviderFilter('all')
  }

  const resetDisplay = () => {
    setLabelSize(11)
    setShowLabels(true)
    setShowGridlines(true)
    setShowReference(true)
    setShowFrontier(true)
  }

  return (
    <figure className={`research-scatter research-scatter-${kind}`}>
      <div className="accuracy-comparison-switch" role="group" aria-label={`${kind === 'murphy' ? 'Murphy decomposition' : 'Cost efficiency'} run switches`}>
        <button type="button" className={memoryEnabled ? 'active' : ''} aria-pressed={memoryEnabled} onClick={() => setMemoryEnabled((enabled) => !enabled)}><span>Memory</span><small>{memoryEnabled ? 'Showing Sequential' : 'Showing Independent'}</small></button>
        <button type="button" className={recencyEnabled ? 'active' : ''} aria-pressed={recencyEnabled} onClick={() => setRecencyEnabled((enabled) => !enabled)}><span>Recency</span><small>{recencyEnabled ? 'Showing Recency on' : 'Showing Recency off'}</small></button>
      </div>

      <div className="accuracy-leaderboard-toolbar">
        <div className="accuracy-mode-legend" aria-label="Active run condition and chart references">
          <span><i className="sequential" />{conditionLabel}</span>
          {kind === 'murphy' && showReference ? <span><i className="scatter-crowd" />Market crowd</span> : null}
          {kind === 'cost' && showReference ? <span><i className="crowd" />Crowd alpha · 0.000</span> : null}
          {kind === 'cost' && showFrontier ? <span><i className="scatter-frontier" />Pareto frontier</span> : null}
        </div>

        <div className="accuracy-chart-actions">
          <details className="accuracy-model-picker" name={controlName}>
            <summary><span aria-hidden="true">＋</span> Add models <small>{selected.length}/{groups.length}</small></summary>
            <div className="accuracy-model-picker-panel">
              <label className="accuracy-model-search"><span className="sr-only">Search models</span><input type="search" value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="Search models or providers…" /></label>
              <div className="accuracy-model-options" role="group" aria-label={`Models shown in the ${kind === 'murphy' ? 'Murphy decomposition' : 'cost efficiency'} chart`}>
                {searchResults.map((group) => {
                  const provider = providerForGroup(group)
                  return <label key={group.id}><input type="checkbox" checked={selectedIds.includes(group.id)} onChange={() => toggleModel(group.id)} /><span><strong>{group.modelName}</strong><small>{provider?.name ?? sourceLabel(group.sourceType)} · All available run variants</small></span></label>
                })}
                {!searchResults.length ? <p>No matching models.</p> : null}
              </div>
              <div className="accuracy-model-picker-actions"><button type="button" onClick={() => setSelectedIds([])}>Clear</button><button type="button" onClick={() => setSelectedIds(defaults)}>Select all</button></div>
            </div>
          </details>

          <details className="accuracy-control-menu" name={controlName}>
            <summary className="accuracy-icon-control" aria-label={`Filter chart${activeFilterCount ? `, ${activeFilterCount} active` : ''}`} title="Filter chart">
              <FilterGlyph />
              {activeFilterCount ? <small>{activeFilterCount}</small> : null}
            </summary>
            <div className="accuracy-control-panel accuracy-filter-panel" role="dialog" aria-labelledby={filterTitleId}>
              <div className="accuracy-control-heading"><strong id={filterTitleId}>Filters</strong>{activeFilterCount ? <span>{activeFilterCount} active</span> : null}</div>
              <AccuracyChoiceGroup name={`${kind}-scatter-source-type`} label="Source type" value={sourceFilter} onChange={(value) => setSourceFilter(value as AccuracySourceFilter)} options={[
                { value: 'all', label: 'All sources' },
                { value: 'open', label: 'Open-source' },
                { value: 'closed', label: 'Closed-source' },
              ]} />
              <AccuracyChoiceGroup name={`${kind}-scatter-provider`} label="Provider" value={providerFilter} onChange={setProviderFilter} options={[
                { value: 'all', label: 'All providers' },
                ...providers.map((provider) => ({ value: provider.name, label: provider.name })),
              ]} />
              <button className="accuracy-control-reset" type="button" onClick={resetFilters}>Reset filters</button>
            </div>
          </details>

          <details className="accuracy-control-menu" name={controlName}>
            <summary className="accuracy-icon-control" aria-label="Chart display settings" title="Display settings"><DisplayGlyph /></summary>
            <div className="accuracy-control-panel accuracy-display-panel" role="dialog" aria-labelledby={displayTitleId}>
              <div className="accuracy-control-heading"><strong id={displayTitleId}>Display</strong></div>
              <label className="accuracy-label-slider"><span>Model label size <output>{labelSize}px</output></span><input type="range" min="9" max="20" step="1" value={labelSize} onChange={(event) => setLabelSize(Number(event.target.value))} /></label>
              <AccuracyToggle label="Model labels" checked={showLabels} onChange={setShowLabels} />
              <AccuracyToggle label="Gridlines" checked={showGridlines} onChange={setShowGridlines} />
              <AccuracyToggle label={kind === 'murphy' ? 'Crowd point' : 'Crowd benchmark'} checked={showReference} onChange={setShowReference} />
              {kind === 'cost' ? <AccuracyToggle label="Pareto frontier" checked={showFrontier} onChange={setShowFrontier} /> : null}
              <button className="accuracy-control-reset" type="button" onClick={resetDisplay}>Reset display</button>
            </div>
          </details>
        </div>
      </div>

      {!visibleData.length ? <div className="accuracy-empty" aria-live="polite"><strong>{selected.length ? 'No selected models have this run condition.' : 'No models selected.'}</strong><span>{selected.length ? 'Change a switch or reset the chart filters.' : 'Use “Add models” to choose one or more models.'}</span></div> : (
        <div className="research-scatter-scroll" tabIndex={0} aria-label={`Scrollable ${kind === 'murphy' ? 'Murphy decomposition' : 'information alpha versus cost'} chart`}>
          <div className="research-scatter-canvas" style={{ '--scatter-label-size': `${labelSize}px` } as React.CSSProperties}>
            <span className="research-scatter-y-title">{kind === 'murphy' ? 'Resolution · higher is better' : 'Information alpha · higher is better'}</span>
            <div className="research-scatter-plot">
              {showGridlines ? xTicks.map((tick) => <i key={`x-${tick}`} className="research-scatter-grid vertical" style={{ left: `${xPosition(tick)}%` }} />) : null}
              {showGridlines ? yTicks.map((tick) => <i key={`y-${tick}`} className="research-scatter-grid horizontal" style={{ bottom: `${yPosition(tick)}%` }} />) : null}
              {xTicks.map((tick) => <span key={`xt-${tick}`} className="research-scatter-x-tick" style={{ left: `${xPosition(tick)}%` }}>{formatScatterAxis(kind, tick)}</span>)}
              {yTicks.map((tick) => <span key={`yt-${tick}`} className="research-scatter-y-tick" style={{ bottom: `${yPosition(tick)}%` }}>{tick.toFixed(kind === 'murphy' ? 2 : 1)}</span>)}
              {kind === 'cost' && showReference ? <div className="research-scatter-zero" style={{ bottom: `${yPosition(0)}%` }}><span>Crowd</span></div> : null}
              {kind === 'cost' && showFrontier && frontier.length > 1 ? <svg className="research-scatter-frontier" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points={frontierPath} /></svg> : null}

              {visibleData.map((point) => {
                const x = xPosition(point.x)
                const y = yPosition(point.y)
                const logo = point.provider ? providerLogos[point.provider.name] : undefined
                const horizontal = x > 76 ? 'left' : x < 24 ? 'right' : 'center'
                const vertical = y > 72 ? 'below' : 'above'
                const labelPosition = y < 13 ? 'above' : 'below'
                const aria = kind === 'murphy' && point.murphy
                  ? `${point.group.modelName}, ${conditionLabel}, reliability ${point.murphy.reliability.toFixed(3)}, resolution ${point.murphy.resolution.toFixed(3)}, uncertainty ${point.murphy.uncertainty.toFixed(3)}, Brier ${point.murphy.brier.toFixed(3)}`
                  : `${point.group.modelName}, ${conditionLabel}, information alpha ${point.y.toFixed(3)}, recorded cost ${scatterMoney(point.x)} per checkpoint${frontierIds.has(point.run.id) ? ', Pareto efficient' : ''}`
                return (
                  <button type="button" key={point.run.id} className={`research-scatter-point${frontierIds.has(point.run.id) ? ' frontier-point' : ''}`} style={{ left: `${x}%`, bottom: `${y}%`, '--provider-color': point.provider?.color ?? '#887566' } as React.CSSProperties} aria-label={aria}>
                    <span className="research-scatter-marker">{logo ? <img src={logo} alt="" /> : <span aria-hidden="true">•</span>}</span>
                    {showLabels ? <span className={`research-scatter-model-label ${labelPosition}`} title={point.group.modelName}>{compactLeaderboardName(point.group.modelName)}</span> : null}
                    <span className={`research-scatter-tooltip ${horizontal} ${vertical}`}>
                      <small>{point.provider?.name ?? sourceLabel(point.group.sourceType)} · {conditionLabel}</small>
                      <strong>{point.group.modelName}</strong>
                      {kind === 'murphy' && point.murphy ? <>
                        <span><b>Reliability</b><em>{point.murphy.reliability.toFixed(3)}</em></span>
                        <span><b>Resolution</b><em>{point.murphy.resolution.toFixed(3)}</em></span>
                        <span><b>Uncertainty</b><em>{point.murphy.uncertainty.toFixed(3)}</em></span>
                        <span><b>REL − RES + UNC</b><em>{point.murphy.brier.toFixed(3)}</em></span>
                        <span><b>Option slots</b><em>{number(point.murphy.n)}</em></span>
                      </> : <>
                        <span><b>Information alpha</b><em>{point.y.toFixed(3)}</em></span>
                        <span><b>Cost / checkpoint</b><em>{scatterMoney(point.x)}</em></span>
                        <span><b>Brier score</b><em>{formatMetric(point.run.brier, 'brier')}</em></span>
                        <span><b>Coverage</b><em>{percent(point.run.coverage, 0)}</em></span>
                        <span><b>Frontier</b><em>{frontierIds.has(point.run.id) ? 'Efficient' : 'Dominated'}</em></span>
                      </>}
                    </span>
                  </button>
                )
              })}

              {kind === 'murphy' && crowd && showReference ? (() => {
                const x = xPosition(crowd.reliability)
                const y = yPosition(crowd.resolution)
                const horizontal = x > 76 ? 'left' : x < 24 ? 'right' : 'center'
                const vertical = y > 72 ? 'below' : 'above'
                return <button type="button" className="research-scatter-point crowd-point" style={{ left: `${x}%`, bottom: `${y}%` }} aria-label={`Market crowd, reliability ${crowd.reliability.toFixed(3)}, resolution ${crowd.resolution.toFixed(3)}, uncertainty ${crowd.uncertainty.toFixed(3)}, Brier ${crowd.brier.toFixed(3)}`}><span className="research-scatter-marker"><span aria-hidden="true">C</span></span>{showLabels ? <span className="research-scatter-model-label below">Market crowd</span> : null}<span className={`research-scatter-tooltip ${horizontal} ${vertical}`}><small>Human collective-judgment baseline</small><strong>Market crowd</strong><span><b>Reliability</b><em>{crowd.reliability.toFixed(3)}</em></span><span><b>Resolution</b><em>{crowd.resolution.toFixed(3)}</em></span><span><b>Uncertainty</b><em>{crowd.uncertainty.toFixed(3)}</em></span><span><b>REL − RES + UNC</b><em>{crowd.brier.toFixed(3)}</em></span><span><b>Option slots</b><em>{number(crowd.n)}</em></span></span></button>
              })() : null}
            </div>
            <span className="research-scatter-x-title">{kind === 'murphy' ? 'Reliability · lower is better' : 'Recorded USD per checkpoint · lower is better · logarithmic scale'}</span>
          </div>
        </div>
      )}

      <figcaption>{kind === 'murphy'
        ? `Showing ${visibleData.length} model${visibleData.length === 1 ? '' : 's'} · Brier = reliability − resolution + uncertainty; components are classwise and scaled to per-checkpoint units.`
        : `Showing ${visibleData.length} priced model${visibleData.length === 1 ? '' : 's'} · The frontier marks runs not beaten by a cheaper run with equal or better information alpha; zero-price and unavailable records are omitted.`}</figcaption>
    </figure>
  )
}

function niceAxisMaximum(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10
  return multiplier * magnitude
}

function paddedLinearDomain(values: number[]) {
  const finiteValues = values.filter(Number.isFinite)
  if (!finiteValues.length) return { min: -1, max: 1 }
  const rawMin = Math.min(...finiteValues)
  const rawMax = Math.max(...finiteValues)
  const span = rawMax - rawMin || Math.max(Math.abs(rawMin), Math.abs(rawMax), 0.1)
  const step = niceAxisMaximum(span / 4)
  const min = Math.floor((rawMin - span * 0.08) / step) * step
  const max = Math.ceil((rawMax + span * 0.08) / step) * step
  return min === max ? { min: min - step, max: max + step } : { min, max }
}

function logarithmicDomain(values: number[]) {
  const positive = values.filter((value) => Number.isFinite(value) && value > 0)
  if (!positive.length) return { min: 0.01, max: 10 }
  const min = 10 ** Math.floor(Math.log10(Math.min(...positive)))
  let max = 10 ** Math.ceil(Math.log10(Math.max(...positive)))
  if (max <= min) max = min * 10
  return { min, max }
}

function linearTicks(min: number, max: number, segments = 4) {
  return Array.from({ length: segments + 1 }, (_, index) => min + ((max - min) * index) / segments)
}

function logarithmicTicks(min: number, max: number) {
  const ticks: number[] = []
  for (let exponent = Math.floor(Math.log10(min)); exponent <= Math.ceil(Math.log10(max)); exponent += 1) {
    for (const multiplier of [1, 3]) {
      const value = multiplier * 10 ** exponent
      if (value >= min && value <= max) ticks.push(value)
    }
  }
  return ticks
}

function paretoFrontier(points: ResearchScatterDatum[]) {
  const sorted = [...points].sort((a, b) => a.x - b.x || b.y - a.y)
  const frontier: ResearchScatterDatum[] = []
  let bestInformation = Number.NEGATIVE_INFINITY
  for (const point of sorted) {
    if (point.y <= bestInformation) continue
    frontier.push(point)
    bestInformation = point.y
  }
  return frontier
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value))
}

function formatScatterAxis(kind: ResearchScatterKind, value: number) {
  if (kind === 'murphy') return value.toFixed(value < 0.1 ? 3 : 2)
  return scatterMoney(value)
}

function scatterMoney(value: number) {
  if (value < 0.01) return `$${value.toFixed(3)}`
  if (value < 1) return `$${value.toFixed(2)}`
  return `$${value.toFixed(value < 10 ? 2 : 0)}`
}

function AccuracyChoiceGroup({ name, label, value, options, onChange }: { name: string; label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return (
    <fieldset className="accuracy-choice-group">
      <legend>{label}</legend>
      <div>
        {options.map((option) => <label key={option.value}><input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} /><span>{option.label}</span></label>)}
      </div>
    </fieldset>
  )
}

function AccuracyToggle({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return <label className="accuracy-toggle"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} /><i aria-hidden="true" /></label>
}

function FilterGlyph() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-6.2 7.1v5.2l-3.6 1.7v-6.9L4 5Z" /></svg>
}

function DisplayGlyph() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M8 14v6M16 4v6" /></svg>
}

const providerLogos: Record<string, string> = {
  OpenAI: openAiLogo,
  Anthropic: anthropicLogo,
  xAI: xAiLogo,
  'Z.ai': zaiLogo,
  Alibaba: alibabaLogo,
  'Moonshot AI': moonshotLogo,
  DeepSeek: deepSeekLogo,
  MiniMax: minimaxLogo,
  NVIDIA: nvidiaLogo,
}

function ProviderMark({ provider }: { provider?: ModelProvider }) {
  const name = provider?.name ?? 'Other'
  const logo = providerLogos[name]
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return (
    <span className={`accuracy-provider-icon provider-${slug}`} title={name} aria-hidden="true">
      {logo ? <img src={logo} alt="" /> : <span className="provider-logo-fallback">•</span>}
    </span>
  )
}

function GroupedRunChart({ runs, metric, format, baseline = null, baselineLabel = '', minValue, maxValue, compact = false, visibleRunIds }: { runs: RunSummary[]; metric: RunChartMetric; format: ChartValueFormat; baseline?: number | null; baselineLabel?: string; minValue?: number; maxValue?: number; compact?: boolean; visibleRunIds?: string[] }) {
  const allGroups = groupRuns(runs)
  const runOrder = visibleRunIds ? new Map(visibleRunIds.map((id, index) => [id, index])) : null
  const visibleGroupIds = visibleRunIds ? [...new Set(visibleRunIds.map(runGroupIdFromRunId))] : null
  const groups = visibleGroupIds ? groupsByIdOrder(allGroups, visibleGroupIds) : compact ? allGroups.slice(0, 8) : allGroups
  const metricValues = allGroups.flatMap((group) => group.runs).map((run) => run[metric]).filter(isFiniteNumber)
  const plottedValues = baseline == null ? metricValues : [...metricValues, baseline]
  if (!plottedValues.length) return <p className="chart-empty">No published data for this metric.</p>

  let domainMin = minValue ?? Math.min(0, ...plottedValues)
  let domainMax = maxValue ?? Math.max(0, ...plottedValues)
  if (minValue == null && domainMin < 0) domainMin *= 1.08
  if (maxValue == null && domainMax > 0) domainMax *= 1.08
  if (domainMax === domainMin) domainMax = domainMin + 1

  const position = (value: number) => Math.max(0, Math.min(100, ((value - domainMin) / (domainMax - domainMin)) * 100))
  const zeroPosition = position(0)
  const baselinePosition = baseline == null ? null : position(baseline)
  const modes: Array<Exclude<ForecastMode, 'unknown'>> = ['independent', 'sequential'].filter((mode) => !runOrder || runs.some((run) => run.mode === mode && runOrder.has(run.id))) as Array<Exclude<ForecastMode, 'unknown'>>

  return (
    <figure className={`grouped-run-chart${compact ? ' compact' : ''}`}>
      <div className="run-chart-legend" aria-hidden="true">{modes.map((mode) => <span key={mode}><i className={mode} />{modeLabel(mode)}</span>)}{baselinePosition == null ? null : <span><i className="crowd" />{baselineLabel} · {formatChartValue(baseline, format)}</span>}</div>
      <div className="run-chart-scale" aria-hidden="true"><span>{formatChartValue(domainMin, format)}</span><span>{formatChartValue(domainMax, format)}</span></div>
      <div className="run-chart-groups">
        {groups.map((group) => (
          <article className="run-chart-group" key={group.modelName}>
            <div className="run-chart-label"><strong>{shortModelName(group.modelName)}</strong><span>{sourceLabel(group.sourceType)} · {group.runs[0]?.protocol ?? 'Published run'}</span></div>
            <div className="run-chart-bars">
              {modes.map((mode) => {
                const run = group.runs.find((candidate) => candidate.mode === mode && (!runOrder || runOrder.has(candidate.id)))
                const value = run?.[metric] ?? null
                if (!run || !isFiniteNumber(value)) return <div className="run-chart-row no-value" key={mode}><span>{modeLabel(mode)}</span><div className="run-chart-track" /><strong>n/a</strong></div>
                const valuePosition = position(value)
                const left = Math.min(valuePosition, zeroPosition)
                const width = Math.max(0.35, Math.abs(valuePosition - zeroPosition))
                const tooltip = `${run.modelName} · ${modeLabel(run.mode)} · ${formatChartValue(value, format)} · ${percent(run.coverage, 0)} coverage`
                return (
                  <div className="run-chart-row interactive-run-bar" key={mode} role="img" aria-label={tooltip} tabIndex={0}>
                    <span>{modeLabel(mode)}</span>
                    <div className="run-chart-track" aria-hidden="true">
                      {[25, 50, 75].map((tick) => <i key={tick} className="run-chart-gridline" style={{ left: `${tick}%` }} />)}
                      {domainMin < 0 && domainMax > 0 ? <i className="run-chart-zero" style={{ left: `${zeroPosition}%` }} /> : null}
                      {baselinePosition == null ? null : <i className="run-chart-baseline" style={{ left: `${baselinePosition}%` }} />}
                      <i className={`run-chart-bar ${mode}`} style={{ left: `${left}%`, width: `${width}%` }} />
                      <span className="run-bar-tooltip" style={{ left: `${Math.max(8, Math.min(82, valuePosition))}%` }}><small>{modeLabel(run.mode)}</small><strong>{formatChartValue(value, format)}</strong><span>{percent(run.coverage, 0)} coverage</span></span>
                    </div>
                    <strong>{formatChartValue(value, format)}</strong>
                  </div>
                )
              })}
            </div>
          </article>
        ))}
      </div>
      {compact && allGroups.length > groups.length ? <figcaption>Showing the eight highest-accuracy model conditions. All {allGroups.length} appear on the Analysis page.</figcaption> : null}
    </figure>
  )
}

function ToolMixChart({ runs, visibleRunIds }: { runs: RunSummary[]; visibleRunIds?: string[] }) {
  const runMap = new Map(runs.map((run) => [run.id, run]))
  const orderedRuns = visibleRunIds
    ? visibleRunIds.map((id) => runMap.get(id)).filter((run): run is RunSummary => Boolean(run))
    : groupRuns(runs).flatMap((group) => ['independent', 'sequential'].map((mode) => group.runs.find((run) => run.mode === mode)).filter((run): run is RunSummary => Boolean(run)))
  const maximum = Math.max(1, ...runs.map((run) => run.avgToolCalls ?? 0))
  return (
    <figure className="tool-mix-chart">
      <div className="tool-mix-legend" aria-hidden="true"><span><i className="search" />Search</span><span><i className="scrape" />Scrape</span><span><i className="python" />Python</span></div>
      <div className="tool-mix-rows">
        {orderedRuns.map((run) => {
          const search = run.avgSearchCalls ?? 0
          const scrape = run.avgScrapeCalls ?? 0
          const python = run.avgPythonCalls ?? 0
          const tooltip = `${run.modelName} · ${modeLabel(run.mode)} · ${formatChartValue(run.avgToolCalls, 'count')} tool calls per checkpoint`
          return (
            <div className="tool-mix-row" key={run.id} role="img" aria-label={tooltip} tabIndex={0}>
              <div className="tool-mix-identity"><strong>{shortModelName(run.modelName)}</strong><span>{modeLabel(run.mode)} · {sourceLabel(run.sourceType)}</span></div>
              <div className="tool-mix-track" aria-hidden="true"><span className="search" style={{ width: `${(search / maximum) * 100}%` }} /><span className="scrape" style={{ width: `${(scrape / maximum) * 100}%` }} /><span className="python" style={{ width: `${(python / maximum) * 100}%` }} /></div>
              <strong className="tool-mix-total">{formatChartValue(run.avgToolCalls, 'count')}</strong>
            </div>
          )
        })}
      </div>
    </figure>
  )
}

function SummaryCard({ label, value, meta, tone }: { label: string; value: string; meta: string; tone: 'crowd' | 'open' | 'closed' | 'model' }) {
  return <article className={`summary-card ${tone}`}><span>{label}</span><strong>{value}</strong><p>{meta}</p></article>
}

function QuestionCard({ item, href }: { item: QuestionIndexItem; href: string }) {
  return (
    <a className="question-card" href={href}>
      <div className="question-card-top"><span>{humanize(item.domain)}</span><span>{item.split}</span></div>
      <h2>{item.title}</h2>
      <div className="question-card-meta"><span>Resolved: <strong>{item.resolvedLabel}</strong></span><span>{item.checkpointCount} checkpoint{item.checkpointCount === 1 ? '' : 's'}</span><span>{humanize(item.beliefKind)}</span></div>
      <span className="question-arrow" aria-hidden="true">↗</span>
    </a>
  )
}

function Pagination({ page, count, onChange }: { page: number; count: number; onChange: (page: number) => void }) {
  if (count <= 1) return null
  return <nav className="pagination" aria-label="Question pages"><button type="button" disabled={page === 1} onClick={() => onChange(page - 1)}>← Previous</button><span>{page} / {count}</span><button type="button" disabled={page === count} onClick={() => onChange(page + 1)}>Next →</button></nav>
}

function ProbabilityTrajectoryChart({ rows, fallbackDates, outcome }: { rows: TrajectoryRow[]; fallbackDates: string[]; outcome: string }) {
  const points = [...rows].sort((a, b) => a.stepIndex - b.stepIndex)
  if (!points.some(row => row.truthProbability != null || row.crowdProbability != null)) return null

  const width = 720
  const height = 340
  const margin = { top: 24, right: 22, bottom: 56, left: 54 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom
  const x = (index: number) => fallbackDates.length <= 1 ? margin.left + plotWidth / 2 : margin.left + (points[index].stepIndex / (fallbackDates.length - 1)) * plotWidth
  const y = (value: number) => margin.top + (1 - Math.max(0, Math.min(1, value))) * plotHeight
  const pathFor = (key: 'truthProbability' | 'crowdProbability') => {
    let path = ''
    let previousStep: number | null = null
    points.forEach((point, index) => {
      const value = point[key]
      if (value == null) { previousStep = null; return }
      path += `${previousStep === point.stepIndex - 1 ? ' L' : ' M'} ${x(index).toFixed(2)} ${y(value).toFixed(2)}`
      previousStep = point.stepIndex
    })
    return path
  }
  const labelIndexes = points.length <= 5
    ? points.map((_, index) => index)
    : [0, Math.floor((points.length - 1) / 2), points.length - 1]
  const yTicks = [0, 0.25, 0.5, 0.75, 1]

  return (
    <figure className="probability-chart">
      <div className="chart-legend" aria-hidden="true">
        <span><i className="model" />Model</span>
        <span><i className="crowd" />Market crowd</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Model and crowd probability assigned to ${outcome} across ${points.length} checkpoints`}>
        {yTicks.map((tick) => (
          <g key={tick} className="chart-gridline">
            <line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
            <text x={margin.left - 12} y={y(tick) + 5} textAnchor="end">{Math.round(tick * 100)}%</text>
          </g>
        ))}
        {points.map((point, index) => <line key={`checkpoint-${point.stepIndex}-${index}`} className="chart-checkpoint" x1={x(index)} x2={x(index)} y1={margin.top} y2={height - margin.bottom} />)}
        <path className="chart-line crowd" d={pathFor('crowdProbability')} />
        <path className="chart-line model" d={pathFor('truthProbability')} />
        {points.map((point, index) => {
          const date = point.forecastDate ?? fallbackDates[point.stepIndex] ?? null
          const tooltip = `Checkpoint ${point.stepIndex + 1} · ${shortDate(date)} · Model ${percent(point.truthProbability)} · Crowd ${percent(point.crowdProbability)}`
          return (
            <g key={`points-${point.stepIndex}-${index}`}>
              {point.crowdProbability != null ? <circle className="chart-point crowd" cx={x(index)} cy={y(point.crowdProbability)} r="5" tabIndex={0} aria-label={tooltip}><title>{tooltip}</title></circle> : null}
              {point.truthProbability != null ? <circle className="chart-point model" cx={x(index)} cy={y(point.truthProbability)} r="5" tabIndex={0} aria-label={tooltip}><title>{tooltip}</title></circle> : null}
            </g>
          )
        })}
        {labelIndexes.map((index) => {
          const point = points[index]
          const date = point.forecastDate ?? fallbackDates[point.stepIndex] ?? null
          return <text key={`label-${point.stepIndex}-${index}`} className="chart-date" x={x(index)} y={height - 22} textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}>t{point.stepIndex + 1} · {compactDate(date)}</text>
        })}
      </svg>
      <figcaption>Probability assigned to the resolved outcome: <strong>{outcome}</strong>. Focus or hover over a point for exact values.</figcaption>
    </figure>
  )
}

function TrajectoryPoint({ row, fallbackDate }: { row: TrajectoryRow; fallbackDate?: string }) {
  return (
    <article className="trajectory-point">
      <div className="trajectory-date"><span>t{row.stepIndex + 1}</span><strong>{shortDate(row.forecastDate ?? fallbackDate ?? null)}</strong></div>
      <ProbabilityBar label="Model" value={row.truthProbability} tone="model" />
      <ProbabilityBar label="Crowd" value={row.crowdProbability} tone="crowd" />
      <div className="point-score"><span>Brier</span><strong>{formatMetric(row.brier, 'brier')}</strong></div>
      {row.repeatCount != null ? <div className="point-score"><span>Repeats averaged</span><strong>{row.repeatCount}</strong></div> : null}
      {row.usdTotal != null ? <div className="point-score"><span>Recorded cost</span><strong>${row.usdTotal.toFixed(2)}</strong></div> : null}
      {!row.parseOk ? <p className="repeat-note">{row.repeatCount === 0 ? 'No usable repeats at this checkpoint.' : 'No valid answer. The recorded score includes the failure penalty.'}</p> : row.truthProbability == null ? <p className="repeat-note">No usable probability distribution was returned.</p> : null}
    </article>
  )
}

function CheckpointActivity({ rows, fallbackDates, processState, processError, onLoadProcess, datasetUrl }: { rows: TrajectoryRow[]; fallbackDates: string[]; processState: 'idle' | 'loading' | 'loaded' | 'error'; processError: string | null; onLoadProcess: () => void; datasetUrl?: string }) {
  return (
    <section className="checkpoint-activity" aria-labelledby="checkpoint-activity-title">
      <div><p className="eyebrow">Process record</p><h3 id="checkpoint-activity-title">Tools and belief notebooks</h3><p>Checkpoint totals are part of the lightweight trajectory. Full notebook text and the tool success, error, and latency breakdown load from Hugging Face only when requested.</p></div>
      <div className="process-load-row">
        {processState === 'loaded' ? <span className="process-loaded">Full process records loaded</span> : <button className="button button-secondary process-button" type="button" disabled={processState === 'loading'} onClick={onLoadProcess}>{processState === 'loading' ? 'Loading from Hugging Face…' : processState === 'error' ? 'Retry full process records' : 'Load full notebooks & tool records'}</button>}
        {datasetUrl ? <a href={datasetUrl} target="_blank" rel="noreferrer">Open dataset ↗</a> : null}
      </div>
      {processError ? <p className="process-error" role="alert">{processError}</p> : null}
      <div className="checkpoint-activity-grid">
        {rows.map((row, index) => {
          const tools = Object.entries(row.tools ?? {}).filter(([, metric]) => metric.calls > 0)
          return (
            <article key={`${row.runId}-activity-${row.stepIndex}-${index}`}>
              <div className="checkpoint-activity-head"><span>Repeat {row.rolloutIndex + 1} · t{row.stepIndex + 1}</span><strong>{compactDate(row.forecastDate ?? fallbackDates[row.stepIndex] ?? null)}</strong></div>
              <dl className="checkpoint-metrics">
                <div><dt>Model forecast</dt><dd>{percent(row.truthProbability)}</dd></div>
                <div><dt>Crowd</dt><dd>{percent(row.crowdProbability)}</dd></div>
                <div><dt>Tool calls</dt><dd>{optionalNumber(row.toolCalls)}</dd></div>
                <div><dt>Tool iterations</dt><dd>{optionalNumber(row.toolIterations)}</dd></div>
                <div><dt>Cancelled calls</dt><dd>{optionalNumber(row.cancelledToolCalls)}</dd></div>
                <div><dt>Model calls</dt><dd>{optionalNumber(row.modelCalls)}</dd></div>
                <div><dt>Input tokens</dt><dd>{optionalNumber(row.inputTokens)}</dd></div>
                <div><dt>Output tokens</dt><dd>{optionalNumber(row.outputTokens)}</dd></div>
                <div><dt>Cache-read tokens</dt><dd>{optionalNumber(row.cacheReadTokens)}</dd></div>
                <div><dt>Cache hit rate</dt><dd>{percent(row.cacheHitRate)}</dd></div>
                <div><dt>Model latency</dt><dd>{formatSeconds(row.modelLatencySeconds)}</dd></div>
                <div><dt>Notebook valid</dt><dd>{row.notebookFormatOk == null ? '—' : row.notebookFormatOk ? 'Yes' : 'No'}</dd></div>
              </dl>
              <div className="tool-breakdown">
                <h4>Tool breakdown</h4>
                {tools.length ? tools.map(([name, metric]) => (
                  <div className="tool-breakdown-row" key={name}>
                    <strong>{humanize(name)}</strong>
                    <span>{number(metric.calls)} calls</span>
                    <span>{number(metric.successes)} succeeded</span>
                    <span>{number(metric.errors + metric.parseErrors)} errors</span>
                    <span>{formatSeconds(metric.latencySeconds)}</span>
                  </div>
                )) : [row.searchCalls, row.scrapeCalls, row.pythonCalls].some(isFiniteNumber) ? <div className="tool-breakdown-row"><span>Search: {optionalNumber(row.searchCalls)}</span><span>Scrape: {optionalNumber(row.scrapeCalls)}</span><span>Python: {optionalNumber(row.pythonCalls)}</span></div> : <p>{processState === 'loaded' ? 'No tool-category rows were recorded for this checkpoint.' : 'Load the full process records above to see tool categories and outcomes.'}</p>}
              </div>
              {row.notebook ? (
                <details className="notebook-disclosure">
                  <summary>Full belief notebook</summary>
                  <div className="notebook-content">{row.notebook}</div>
                </details>
              ) : <p className="notebook-missing">{row.mode === 'independent' ? 'Independent runs do not carry a notebook between checkpoints.' : row.notebookAvailable && processState !== 'loaded' ? 'This notebook is available on Hugging Face; load the full process records above to view it.' : 'No notebook text was recorded for this checkpoint.'}</p>}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function ProbabilityBar({ label, value, tone }: { label: string; value: number | null; tone: 'model' | 'crowd' }) {
  return <div className="probability-line"><div><span>{label}</span><strong>{percent(value)}</strong></div><div className="probability-track" aria-hidden="true"><span className={tone} style={{ width: `${Math.max(0, Math.min(100, (value ?? 0) * 100))}%` }} /></div></div>
}

function DataError({ message }: { message: string }) {
  return <section className="state-page section-rule" role="alert"><p className="eyebrow">Data unavailable</p><h1>This release could not be loaded.</h1><p>{message}</p></section>
}

function LoadingPage({ label = 'Loading the latest release…' }: { label?: string }) {
  return <section className="state-page section-rule" aria-live="polite"><p className="eyebrow">Forecast Dojo</p><h1>{label}</h1></section>
}

function NotFoundPage() {
  return <section className="state-page section-rule"><p className="eyebrow">Question not found</p><h1>This question is not in the current release.</h1><a className="button button-primary" href={releaseHref('#/questions')}>Browse all questions</a></section>
}

function splitHashRoute(route: string) {
  const location = route.split('#')[0]
  const queryStart = location.indexOf('?')
  return queryStart < 0 ? { path: location, query: '' } : { path: location.slice(0, queryStart), query: location.slice(queryStart + 1) }
}

function readQuestionBrowseState(route: string, defaultSplit: string): QuestionBrowseState {
  const params = new URLSearchParams(splitHashRoute(route).query)
  const parsedPage = Number.parseInt(params.get('page') ?? '1', 10)
  return {
    query: params.get('q') ?? '',
    domain: params.get('domain') || 'all',
    split: params.get('split') || defaultSplit,
    belief: params.get('type') || 'all',
    page: Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1,
  }
}

function questionBrowseQuery(state: QuestionBrowseState) {
  const params = new URLSearchParams()
  if (state.query.trim()) params.set('q', state.query.trim())
  if (state.domain !== 'all') params.set('domain', state.domain)
  params.set('split', state.split)
  if (state.belief !== 'all') params.set('type', state.belief)
  if (state.page > 1) params.set('page', String(state.page))
  return params.toString()
}

function questionListHref(state: QuestionBrowseState) {
  return `#/questions?${questionBrowseQuery(state)}`
}

function questionDetailHref(id: string, state: QuestionBrowseState) {
  return `#/questions/${encodeURIComponent(id)}?${questionBrowseQuery(state)}`
}

function filterQuestionIndex(questions: QuestionIndexItem[], state: QuestionBrowseState) {
  const normalized = state.query.trim().toLowerCase()
  return questions.filter((item) => {
    const matchesText = !normalized || `${item.title} ${item.id} ${item.domain}`.toLowerCase().includes(normalized)
    return matchesText && (state.domain === 'all' || item.domain === state.domain) && (state.split === 'all' || item.split === state.split) && (state.belief === 'all' || item.beliefKind === state.belief)
  })
}

function useHashRoute() {
  const read = () => window.location.hash.slice(1) || '/overview'
  const [route, setRoute] = useState(read)
  useEffect(() => { const update = () => setRoute(read()); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update) }, [])
  return route
}

function compareMetric(a: RunSummary, b: RunSummary, metric: Metric) {
  const aValue = a[metric]
  const bValue = b[metric]
  if (aValue == null) return 1
  if (bValue == null) return -1
  return metric === 'brier' ? aValue - bValue : bValue - aValue
}

function bestByMetric(runs: RunSummary[], metric: Metric) {
  return [...runs].sort((a, b) => compareMetric(a, b, metric))[0]
}

function formatMetric(value: number | null | undefined, metric: Metric) {
  if (value == null || Number.isNaN(value)) return '—'
  return metric === 'accuracy' ? `${(value * 100).toFixed(metricDetails[metric].decimals)}%` : value.toFixed(metricDetails[metric].decimals)
}

function groupRuns(runs: RunSummary[]): RunGroup[] {
  const grouped = new Map<string, RunGroup>()
  for (const run of runs) {
    const id = runGroupIdFromRunId(run.id) || run.modelName
    const group = grouped.get(id) ?? { id, modelName: run.modelName, sourceType: run.sourceType, runs: [] }
    group.runs.push(run)
    grouped.set(id, group)
  }
  return [...grouped.values()].sort((a, b) => {
    const aBest = Math.max(...a.runs.map((run) => run.accuracy ?? Number.NEGATIVE_INFINITY))
    const bBest = Math.max(...b.runs.map((run) => run.accuracy ?? Number.NEGATIVE_INFINITY))
    return bBest - aBest
  })
}

function runGroupIdFromRunId(runId: string) {
  return runId.split('.forecast_eval.')[0] || runId
}

function groupsByIdOrder(groups: RunGroup[], ids: string[]) {
  const groupMap = new Map(groups.map((group) => [group.id, group]))
  return ids.map((id) => groupMap.get(id)).filter((group): group is RunGroup => Boolean(group))
}

function baseModelForGroup(group: RunGroup) {
  return (group.runs[0]?.baseModel ?? group.modelName).toLowerCase().replace(/^models\//, '')
}

function providerForGroup(group: RunGroup): ModelProvider | undefined {
  const baseModel = baseModelForGroup(group)
  return modelProviders.find((provider) => provider.match.test(baseModel))
}

function providerNameForGroup(group: RunGroup) {
  return providerForGroup(group)?.name ?? 'Other'
}

function isRecencyGroup(group: RunGroup) {
  const retrieval = group.runs[0]?.retrieval?.toLowerCase()
  return retrieval === 'rec70' || retrieval === 'recency'
}

function isHistoricalGroup(group: RunGroup) {
  return group.runs[0]?.protocol?.toLowerCase().includes('historical') ?? false
}

function retrievalFamilyKey(group: RunGroup) {
  return baseModelForGroup(group).replace(/-(?:rec70|recency)(?=-|$)/g, '')
}

function defaultResultGroupIds(groups: RunGroup[]) {
  const ranked = [...groups].sort((a, b) => compareGroupMetric(a, b, 'accuracy'))
  const top = ranked.slice(0, 5)
  const selected = new Set(top.map((group) => group.id))
  const coveredProviders = new Set(top.map(providerNameForGroup))
  const providerRepresentatives: RunGroup[] = []
  for (const group of ranked) {
    const provider = providerNameForGroup(group)
    if (coveredProviders.has(provider)) continue
    selected.add(group.id)
    coveredProviders.add(provider)
    providerRepresentatives.push(group)
  }
  return [...top, ...providerRepresentatives].filter((group) => selected.has(group.id)).map((group) => group.id)
}

function runIdsWithMetric(runs: RunSummary[], metric: RunChartMetric) {
  return runs.filter((run) => isFiniteNumber(run[metric])).map((run) => run.id)
}

function dedupePairedModes(comparisons: PairedModeComparison[]) {
  const seen = new Set<string>()
  return comparisons.filter((comparison) => {
    const key = `${comparison.independentRunId}:${comparison.sequentialRunId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function comparisonModelKey(modelName: string) {
  return modelName.toLowerCase().replace(/\s*(?:·|\uFFFD)\s*recency\s*$/i, '').replace(/\s+/g, ' ').trim()
}

function recencyComparisonRunIds(runs: RunSummary[], comparisons: RecencyComparison[]) {
  const conditions = new Set(comparisons.map((row) => `${comparisonModelKey(row.modelName)}:${row.mode}`))
  return runs
    .filter((run) => conditions.has(`${comparisonModelKey(run.modelName)}:${run.mode}`))
    .map((run) => run.id)
}

function defaultMetricGroupIds(groups: RunGroup[], metric: Metric) {
  const ranked = [...groups].sort((a, b) => compareIndependentGroupMetric(a, b, metric))
  const selected = new Set(ranked.slice(0, 7).map((group) => group.id))
  for (const provider of modelProviders) {
    const hasLatestFamily = ranked.some((group) => selected.has(group.id) && baseModelForGroup(group).startsWith(provider.latestFamily))
    if (hasLatestFamily) continue
    const latestConditions = ranked.filter((group) => baseModelForGroup(group).startsWith(provider.latestFamily))
    const preferred = [...latestConditions].sort((a, b) => {
      const scoreDifference = compareIndependentGroupMetric(a, b, metric)
      if (scoreDifference) return scoreDifference
      const aBaseline = a.runs[0]?.retrieval === 'baseline' ? 1 : 0
      const bBaseline = b.runs[0]?.retrieval === 'baseline' ? 1 : 0
      return bBaseline - aBaseline || a.modelName.localeCompare(b.modelName)
    })[0]
    if (preferred) selected.add(preferred.id)
  }
  return ranked.filter((group) => selected.has(group.id)).map((group) => group.id)
}

function compareGroupMetric(a: RunGroup, b: RunGroup, metric: Metric) {
  const aScore = groupMetricScore(a, metric)
  const bScore = groupMetricScore(b, metric)
  const difference = metric === 'brier' ? aScore - bScore : bScore - aScore
  return difference || a.modelName.localeCompare(b.modelName)
}

function compareIndependentGroupMetric(a: RunGroup, b: RunGroup, metric: Metric) {
  const aScore = independentGroupMetricScore(a, metric)
  const bScore = independentGroupMetricScore(b, metric)
  const difference = metric === 'brier' ? aScore - bScore : bScore - aScore
  return difference || a.modelName.localeCompare(b.modelName)
}

function independentGroupMetricScore(group: RunGroup, metric: Metric) {
  const value = group.runs.find((run) => run.mode === 'independent')?.[metric]
  return isFiniteNumber(value) ? value : groupMetricScore(group, metric)
}

function groupMetricScore(group: RunGroup, metric: Metric) {
  const values = group.runs.map((run) => run[metric]).filter(isFiniteNumber)
  if (!values.length) return metric === 'brier' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
  return metric === 'brier' ? Math.min(...values) : Math.max(...values)
}

function leaderboardDomain(metric: Metric, values: number[], baseline: number | null) {
  const plotted = baseline == null ? values : [...values, baseline]
  if (metric === 'brier') return { domainMin: 0, domainMax: 1, axisTicks: [0, 0.2, 0.4, 0.6, 0.8, 1] }
  if (metric === 'accuracy') {
    const domainMax = Math.ceil(Math.max(0.7, ...plotted) * 10) / 10
    const axisTicks = Array.from({ length: Math.floor(domainMax / 0.2) + 1 }, (_, index) => index * 0.2)
    if (Math.abs(axisTicks[axisTicks.length - 1] - domainMax) > 0.0001) axisTicks.push(domainMax)
    return { domainMin: 0, domainMax, axisTicks }
  }

  let domainMin = Math.floor(Math.min(0, ...plotted) * 2) / 2
  let domainMax = Math.ceil(Math.max(0, ...plotted) * 2) / 2
  if (domainMin === domainMax) domainMin -= 0.5
  const axisTicks = Array.from({ length: Math.round((domainMax - domainMin) / 0.5) + 1 }, (_, index) => domainMin + index * 0.5)
  return { domainMin, domainMax, axisTicks }
}

function formatLeaderboardValue(metric: Metric, value: number) {
  return metric === 'accuracy' ? percent(value) : value.toFixed(3)
}

function formatLeaderboardTick(metric: Metric, value: number) {
  return metric === 'accuracy' ? percent(value, 0) : value.toFixed(1)
}

function compactLeaderboardName(value: string) {
  return shortModelName(value)
    .replace(/^Claude /, '')
    .replace(' think (max)', ' max')
    .replace(' think', '')
    .replace('DeepSeek-V', 'DeepSeek V')
    .replace('Qwen3.5-397B', 'Qwen3.5 397B')
}

function shortModelName(value: string) {
  const lower = value.toLowerCase()
  if (lower.includes('opus-4.6') || lower.includes('opus 4.6')) return 'Opus 4.6'
  if (lower.includes('qwen3-30b-a3b')) return 'Qwen3 30B'
  if (lower.includes('qwen3-32b')) return 'Qwen3 32B'
  return value.replace(/^models\//, '').replaceAll('_', ' ')
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function formatChartValue(value: number | null | undefined, format: ChartValueFormat) {
  if (!isFiniteNumber(value)) return '—'
  if (format === 'percent') return percent(value)
  if (format === 'decimal') return value.toFixed(3)
  if (format === 'compact') return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
  if (format === 'duration') return value >= 120 ? `${(value / 60).toFixed(1)}m` : `${value.toFixed(1)}s`
  if (format === 'money') return `$${value.toFixed(value < 1 ? 2 : 1)}`
  return value >= 100 ? Math.round(value).toLocaleString('en-US') : value.toFixed(1)
}

function signedPoints(value: number | null | undefined) {
  if (!isFiniteNumber(value)) return '—'
  const points = value * 100
  return `${points > 0 ? '+' : ''}${points.toFixed(1)} pts`
}

function signedDecimal(value: number | null | undefined) {
  if (!isFiniteNumber(value)) return '—'
  return `${value > 0 ? '+' : ''}${value.toFixed(3)}`
}

function optionalNumber(value: number | null | undefined) {
  return isFiniteNumber(value) ? number(value) : '—'
}

function formatSeconds(value: number | null | undefined) {
  if (!isFiniteNumber(value)) return '—'
  if (value < 1) return `${Math.round(value * 1000)} ms`
  return `${value.toFixed(1)} s`
}

function hasCheckpointTelemetry(row: TrajectoryRow) {
  return isFiniteNumber(row.toolCalls)
    || isFiniteNumber(row.searchCalls)
    || isFiniteNumber(row.scrapeCalls)
    || isFiniteNumber(row.pythonCalls)
    || isFiniteNumber(row.inputTokens)
    || row.notebookFormatOk != null
    || Boolean(row.notebook)
}

function heatColor(value: number | null | undefined, metric: Metric, minimum: number, maximum: number) {
  if (!isFiniteNumber(value)) return 'rgba(107, 107, 101, 0.045)'
  if (metric === 'infoAlpha') {
    const scale = Math.max(Math.abs(minimum), Math.abs(maximum), 0.001)
    const alpha = 0.08 + Math.min(1, Math.abs(value) / scale) * 0.28
    return value >= 0 ? `rgba(71, 118, 101, ${alpha})` : `rgba(211, 100, 66, ${alpha})`
  }
  const range = Math.max(0.001, maximum - minimum)
  const normalized = Math.max(0, Math.min(1, (value - minimum) / range))
  const direction = metric === 'brier' ? 1 - normalized : normalized
  return `rgba(102, 83, 166, ${0.07 + direction * 0.3})`
}

function percentagePoints(value: number) {
  return `${(value * 100).toFixed(1)} points`
}

function sourceLabel(source: SourceType) { return source === 'open' ? 'Open-source' : 'Closed-source' }
function modeLabel(mode: ForecastMode) { return mode === 'unknown' ? 'Mode unavailable' : mode[0].toUpperCase() + mode.slice(1) }
function retrievalLabel(retrieval: string | undefined) { return retrieval === 'rec70' || retrieval === 'recency' ? 'Recency weighted' : 'Baseline retrieval' }
function humanize(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) }
function number(value: number) { return new Intl.NumberFormat('en-US').format(value) }
function percent(value: number | null | undefined, digits = 1) { return value == null ? '—' : `${(value * 100).toFixed(digits)}%` }
function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null }
function shortDate(value: string | null) { if (!value) return '—'; const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value); return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date) }
function compactDate(value: string | null) { if (!value) return 'Date unavailable'; const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value); return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date) }

function releaseHref(href: string) {
  return href
}

export default BenchmarkApp
