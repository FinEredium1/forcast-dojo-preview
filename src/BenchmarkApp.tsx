import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
import type { AnalysisSummary, BreakdownAggregate, ConsistencySummary, DynamicsSummary, ForecastMode, Manifest, MurphySummary, PairedModeComparison, QuestionDetail, QuestionIndexItem, RunAnalysis, RunSummary, SourceType, TrajectoryRow } from './types'

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
const PAPER_URL = 'https://arxiv.org/pdf/2609.28876v1'
// Paper v1: Table 2 and Sections 3, 4.2, and 5.1.
const PAPER_SCOPE = {
  eventCount: 1338 + 230,
  forecastStepCount: 5325 + 797,
  modelCount: 12,
  memoryModeCount: 2,
  articleCount: '18.8M',
}

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
    </footer>
  )
}

function OverviewPage({ manifest, runs, analysis }: { manifest: Manifest; runs: RunSummary[]; analysis: AnalysisSummary | null }) {
  runs = runs.filter((run) => run.retrieval === 'baseline')
  const murphy = analysis?.research?.murphy ?? []
  const hasCost = runs.some((run) => isFiniteNumber(run.avgUsd) && run.avgUsd > 0 && isFiniteNumber(run.infoAlpha))

  return (
    <>
      <section className="hero overview-hero section-rule">
        <div className="overview-hero-intro">
          <h1>Forecast Dojo</h1>
          <p className="overview-question">Replayable environments to benchmark and train LLM forecasting agents.</p>
          <div className="overview-actions">
            <a className="button button-primary" href={PAPER_URL} target="_blank" rel="noopener noreferrer">Read the paper <span aria-hidden="true">↗</span></a>
            <a href={releaseHref('#/results')}>Explore results <span aria-hidden="true">↗</span></a>
          </div>
        </div>
        <PaperOverviewFigure />
      </section>

      <section className="highlight-section overview-results-stack section-rule" aria-label="Benchmark results">
        <MemoryChartCard title="Brier score" formula="brier" accent="activity" className="accuracy-card">
          {(memoryEnabled) => <MetricLeaderboardChart runs={runs} baseline={manifest.crowd.brier} metric="brier" memoryEnabled={memoryEnabled} />}
        </MemoryChartCard>
        <MemoryChartCard title="Accuracy" formula="accuracy" accent="quality" className="accuracy-card accuracy-metric-card">
          {(memoryEnabled) => <MetricLeaderboardChart runs={runs} baseline={manifest.crowd.accuracy} metric="accuracy" memoryEnabled={memoryEnabled} />}
        </MemoryChartCard>
      </section>

      <section className="highlight-section overview-results-stack overview-supporting-results section-rule" aria-label="Further benchmark analysis">
        <MemoryChartCard title="Information alpha" formula="infoAlpha" accent="tokens" className="accuracy-card">
          {(memoryEnabled) => <MetricLeaderboardChart runs={runs} baseline={manifest.crowd.infoAlpha} metric="infoAlpha" memoryEnabled={memoryEnabled} />}
        </MemoryChartCard>
        {murphy.length ? <MemoryChartCard title="Murphy decomposition" formula="murphy" accent="quality" className="accuracy-card research-scatter-card murphy-metric-card">
          {(memoryEnabled) => <ResearchScatterChart runs={runs} murphy={murphy} kind="murphy" memoryEnabled={memoryEnabled} />}
        </MemoryChartCard> : null}
        {hasCost ? <MemoryChartCard title="Information alpha vs. cost" accent="activity" className="accuracy-card research-scatter-card">
          {(memoryEnabled) => <ResearchScatterChart runs={runs} murphy={murphy} kind="cost" memoryEnabled={memoryEnabled} />}
        </MemoryChartCard> : null}
      </section>

      <section className="stat-grid section-rule" aria-label="Paper benchmark scope">
        <Stat value={number(manifest.questionCount)} label="forecasting events" />
        <Stat value={number(manifest.checkpointCount)} label="dated forecast steps" />
        <Stat value={number(manifest.modelCount ?? PAPER_SCOPE.modelCount)} label="models evaluated" />
        <Stat value={number(PAPER_SCOPE.memoryModeCount)} label="memory modes" />
        <Stat value={PAPER_SCOPE.articleCount} label="news articles in corpus" />
      </section>

      <OverviewStudyDesign />

    </>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return <article><span className="stat-value">{value}</span><span className="stat-label">{label}</span></article>
}

function OverviewStudyDesign() {
  return (
    <section className="overview-study section-rule" aria-label="Study design and forecast memory">
      <article className="overview-study-design">
        <p className="eyebrow">Study design</p>
        <h2>Replay · research · forecast</h2>
        <ol className="overview-study-steps">
          <li><span aria-hidden="true">01</span><div><h3>Replay an event</h3><p>Fixed forecast dates; outcomes hidden from agents.</p></div></li>
          <li><span aria-hidden="true">02</span><div><h3>Research dated evidence</h3><p>Search, read and compute over CC-News available by that date.</p></div></li>
          <li><span aria-hidden="true">03</span><div><h3>Score probabilities</h3><p>Brier, accuracy and Information α; historical market belief as a reference.</p></div></li>
        </ol>
      </article>
      <article className="overview-study-memory">
        <p className="eyebrow">Secondary analysis</p>
        <h2>Does a belief notebook help?</h2>
        <p className="overview-memory-context">Same events, forecast dates and tools. Two memory modes.</p>
        <div className="overview-memory-modes">
          <div className="overview-memory-free"><h3>Memory-free</h3><p>Each forecast step starts fresh, with no information carried from earlier steps.</p></div>
          <div className="overview-memory-on"><h3>Memory-on</h3><p>Only the belief notebook carries forward: assessment, evidence and open questions.</p></div>
        </div>
      </article>
    </section>
  )
}

function PaperOverviewFigure() {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const figureUrl = `${import.meta.env.BASE_URL}figures/forecast-dojo-figure-1.webp`
  const description = 'Figure 1 from the paper: curate historical events and dated news, forecast each question over time, research with date-limited tools and optional belief notebooks, then score hidden outcomes for evaluation and training.'

  return (
    <figure className="paper-overview-figure" id="environment">
      <button className="paper-figure-preview" type="button" onClick={() => dialogRef.current?.showModal()} aria-label="Enlarge Figure 1" title="Click to enlarge Figure 1">
        <img src={figureUrl} width="2800" height="1989" alt={description} fetchPriority="high" />
      </button>
      <dialog className="paper-figure-dialog" ref={dialogRef} aria-label="Figure 1: Overview of Forecast Dojo" onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close() }}>
        <div className="paper-figure-dialog-header"><span>Forecast Dojo environment</span><button type="button" aria-label="Close figure" onClick={() => dialogRef.current?.close()}>Close <span aria-hidden="true">×</span></button></div>
        <div className="paper-figure-enlarged"><img src={figureUrl} width="2800" height="1989" alt={description} /></div>
      </dialog>
    </figure>
  )
}

function ConditionComparison({ runs }: { runs: RunSummary[] }) {
  const [metric, setMetric] = useState<Metric>('brier')
  const models = [...new Set(runs.map((run) => run.modelName))].sort((a, b) => {
    const score = (name: string) => runs.find((run) => run.modelName === name && run.retrieval === 'baseline' && run.mode === 'independent')?.brier ?? Infinity
    return score(a) - score(b)
  })
  const conditions = [
    { label: 'No tools', retrieval: 'none', mode: 'independent' },
    { label: 'Memory-free', retrieval: 'baseline', mode: 'independent' },
    { label: 'Memory-on', retrieval: 'baseline', mode: 'sequential' },
  ]
  return (
    <section className="condition-comparison section-rule" aria-labelledby="condition-comparison-title">
      <div className="section-heading"><div><p className="eyebrow">Research tools</p><h2 id="condition-comparison-title">What changes with tools and memory?</h2></div></div>
      <div className="condition-metric-controls" role="group" aria-label="Comparison metric">
        {(['brier', 'accuracy', 'infoAlpha'] as Metric[]).map((value) => <button type="button" key={value} aria-pressed={metric === value} onClick={() => setMetric(value)}>{metricDetails[value].label}</button>)}
        <span>{metricDetails[metric].direction}</span>
      </div>
      <div className="condition-table-scroll"><table>
        <caption>797 scheduled forecast dates · four repeats</caption>
        <thead><tr><th scope="col">Model</th>{conditions.map((condition) => <th key={condition.label} scope="col" className={condition.mode}>{condition.label}</th>)}</tr></thead>
        <tbody>{models.map((model) => {
          const modelRuns = conditions.map((condition) => runs.find((run) => run.modelName === model && run.retrieval === condition.retrieval && run.mode === condition.mode))
          const available = modelRuns.flatMap((run) => run?.[metric] == null ? [] : [run[metric]!])
          const best = metric === 'brier' ? Math.min(...available) : Math.max(...available)
          return <tr key={model}><th scope="row">{shortModelName(model)}</th>{modelRuns.map((run, index) => <td key={conditions[index].label} className={run?.[metric] === best ? 'best-condition' : ''} title={run ? `${number(run.nRows)} recorded forecasts · ${number(run.nMissing ?? 0)} missing · ${percent(run.responseRate)} usable reports` : 'Unavailable'}>
            {formatMetric(run?.[metric] ?? null, metric)}
            {run && !run.complete ? <small>{percent(run.coverage, 1)} coverage</small> : null}
          </td>)}</tr>
        })}</tbody>
      </table></div>
      <p className="condition-note">Unusable recorded forecasts use uniform probabilities; missing records are excluded. Best setting per model is highlighted.</p>
    </section>
  )
}

function ResultsPage({ runs, analysis }: { runs: RunSummary[]; analysis: AnalysisSummary | null }) {
  const allRuns = runs
  runs = runs.filter((run) => run.retrieval === 'baseline')
  const hasToolMetrics = runs.some((run) => isFiniteNumber(run.avgToolCalls))
  const hasInputTokens = runs.some((run) => isFiniteNumber(run.avgInputTokens))
  const hasOutputTokens = runs.some((run) => isFiniteNumber(run.avgOutputTokens))
  const hasLatency = runs.some((run) => isFiniteNumber(run.avgModelLatencySeconds))
  const pairedModes = dedupePairedModes(analysis?.pairedModes ?? [])
  const analysisRunIds = runs.map((run) => run.id)
  const pairedModeRunIds = pairedModes.flatMap((row) => [row.independentRunId, row.sequentialRunId])
  const consistencyRunIds = analysis?.research?.consistency.map((row) => row.runId) ?? []
  const dynamicsRunIds = analysis?.research?.dynamics.map((row) => row.runId) ?? []

  return (
    <div className="analysis-page">
      {analysis ? <ModelFilteredAnalysisSection chartId="results-domain" eyebrow="Domain breakdown" title="Which model performs best in each domain?" description="Choose a domain to rank published runs by crowd-relative information alpha. Higher values indicate more forecasting information than the contemporaneous market." note="Leaders are the highest observed values, not claims of statistical significance. Question and checkpoint counts remain visible for context." runs={runs} eligibleRunIds={analysisRunIds} modeControl="compare" defaultModelCount={8}>
        {({ visibleRunIds }) => <DomainLeaderboardChart analysisRuns={analysis.runs.filter((run) => analysisRunIds.includes(run.runId))} runSummaries={runs} visibleRunIds={visibleRunIds} domains={analysis.domains} />}
      </ModelFilteredAnalysisSection> : null}

      <ConditionComparison runs={allRuns} />

      {analysis ? <ModelFilteredAnalysisSection chartId="results-horizon" eyebrow="Resolution period" title="Accuracy as resolution approaches" description="Run accuracy at five pre-resolution horizons, keeping every model and forecasting mode distinct." note="Forecasts after the recorded close date are excluded from horizon analysis." runs={runs} eligibleRunIds={analysisRunIds}>
        {({ visibleRunIds }) => <BreakdownMatrix runs={analysis.runs} visibleRunIds={visibleRunIds} keys={analysis.horizonBuckets} field="byHorizon" metric="accuracy" />}
      </ModelFilteredAnalysisSection> : null}

      {analysis ? <ModelFilteredAnalysisSection chartId="results-question-type" eyebrow="Question types" title="Binary and multiple-choice performance" description="Accuracy separated by question format so changes in task composition remain visible." note="Each cell reports the mean across scored checkpoints in that question type." runs={runs} eligibleRunIds={analysisRunIds}>
        {({ visibleRunIds }) => <BreakdownMatrix runs={analysis.runs} visibleRunIds={visibleRunIds} keys={analysis.questionTypes.map((key) => ({ key, label: humanize(key) }))} field="byQuestionType" metric="accuracy" />}
      </ModelFilteredAnalysisSection> : null}

      {pairedModes.length ? <ModelFilteredAnalysisSection chartId="results-memory" eyebrow="Forecast memory" title="Does a belief notebook help?" description="Memory-on and memory-free runs are matched at the same question, forecast date and repeat before their differences are calculated." note="Differences are Memory-on minus Memory-free; negative Brier differences are favorable." runs={runs} eligibleRunIds={pairedModeRunIds} modeControl="compare">
        {({ visibleGroupIds }) => <PairedModeChart comparisons={pairedModes} visibleGroupIds={visibleGroupIds} />}
      </ModelFilteredAnalysisSection> : null}

      {analysis?.research?.consistency.length ? <ModelFilteredAnalysisSection chartId="results-consistency" eyebrow="Repeat reliability" title="Do repeated forecasts agree?" description="Four repeated forecasts expose run-to-run disagreement and show whether averaging the distributions improves Brier score." note="Brier improvement is Single-repeat Brier minus Averaged-forecast Brier; larger positive values favor averaging." runs={runs} eligibleRunIds={consistencyRunIds}>
        {({ visibleRunIds }) => <ConsistencyChart rows={analysis.research!.consistency} visibleRunIds={visibleRunIds} />}
      </ModelFilteredAnalysisSection> : null}

      {hasToolMetrics ? <ModelFilteredAnalysisSection chartId="results-tools" eyebrow="Agent behavior" title="Tool calls per checkpoint" description="Average research activity for each run, separated into corpus searches, article scrapes, and Python executions." note="Normalized per forecast checkpoint so partial runs remain comparable" runs={runs} eligibleRunIds={runIdsWithMetric(runs, 'avgToolCalls')}>
        {({ visibleRunIds }) => <ToolMixChart runs={runs} visibleRunIds={visibleRunIds} />}
      </ModelFilteredAnalysisSection> : null}

      {hasInputTokens ? <ModelFilteredAnalysisSection chartId="results-input-tokens" eyebrow="Context consumption" title="Input tokens per checkpoint" description="Average number of input tokens processed across all model calls used to produce one forecast." note="Includes repeated context and, for memory-on runs, carried belief-notebook context" runs={runs} eligibleRunIds={runIdsWithMetric(runs, 'avgInputTokens')}>
        {({ visibleRunIds }) => <GroupedRunChart runs={runs} visibleRunIds={visibleRunIds} metric="avgInputTokens" format="compact" minValue={0} />}
      </ModelFilteredAnalysisSection> : null}

      {hasOutputTokens ? <ModelFilteredAnalysisSection chartId="results-output-tokens" eyebrow="Response generation" title="Output tokens per checkpoint" description="Average output tokens generated across the agent loop for one forecast checkpoint." note="Visible and reasoning-token accounting depends on the model provider" runs={runs} eligibleRunIds={runIdsWithMetric(runs, 'avgOutputTokens')}>
        {({ visibleRunIds }) => <GroupedRunChart runs={runs} visibleRunIds={visibleRunIds} metric="avgOutputTokens" format="compact" minValue={0} />}
      </ModelFilteredAnalysisSection> : null}

      {hasLatency ? <ModelFilteredAnalysisSection chartId="results-latency" eyebrow="Execution profile" title="Model processing time per checkpoint" description="Average accumulated model-call latency required to complete one forecast checkpoint." note="Tool latency is tracked separately and is not included here" runs={runs} eligibleRunIds={runIdsWithMetric(runs, 'avgModelLatencySeconds')}>
        {({ visibleRunIds }) => <GroupedRunChart runs={runs} visibleRunIds={visibleRunIds} metric="avgModelLatencySeconds" format="duration" minValue={0} />}
      </ModelFilteredAnalysisSection> : null}

      {analysis?.research?.dynamics.length ? <ModelFilteredAnalysisSection chartId="results-dynamics" eyebrow="Forecast evolution" title="Do forecasts improve over an episode?" description="Compare Brier at the first and last scheduled forecast dates." note="Repeats are averaged within each question, then questions receive equal weight. Only recorded endpoint pairs contribute." runs={runs} eligibleRunIds={dynamicsRunIds}>
        {({ visibleRunIds }) => <DynamicsChart rows={analysis.research!.dynamics} visibleRunIds={visibleRunIds} />}
      </ModelFilteredAnalysisSection> : null}

      <section className="mode-note section-rule" id="evaluation-notes">
        <div><p className="eyebrow">Evaluation integrity</p><h2>Read uncertainty and coverage together</h2></div>
        <div className="mode-columns">
          <article><h3>Question-clustered intervals</h3><p>Confidence intervals resample whole questions, because checkpoints from the same question share an outcome and information history.</p></article>
          <article><h3>Scoring and coverage</h3><p>Unusable recorded forecasts receive uniform probabilities, following the paper. Missing records stay excluded and coverage remains visible.</p></article>
        </div>
      </section>

    </div>
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
    <div className="questions-page">
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
    </div>
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
  const scored = selectedRun?.rows.filter((row) => row.brier != null) ?? []
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
    <div className="questions-page question-detail-page">
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
              <p className="repeat-note">{repeatCount > 1 ? `Average of ${repeatCount} published repeats. Probabilities and scores are averaged across recorded repeats. Unusable reports use the paper’s uniform fallback.` : 'Single published repeat; no cross-repeat averaging is available.'}</p>
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
    </div>
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
      <figcaption>Color intensity is normalized within this visualization; rely on the printed values for comparisons. <a href={releaseHref('#/results#evaluation-notes')}>Coverage and uncertainty</a></figcaption>
    </figure>
  )
}

function DomainLeaderboardChart({ analysisRuns, runSummaries, visibleRunIds, domains }: { analysisRuns: RunAnalysis[]; runSummaries: RunSummary[]; visibleRunIds?: string[]; domains: string[] }) {
  const [activeDomain, setActiveDomain] = useState('all')
  const activeDomainLabel = activeDomain === 'all' ? 'All Domain' : humanize(activeDomain)
  const [inspectedRunId, setInspectedRunId] = useState<string | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const summaryById = new Map(runSummaries.map((run) => [run.id, run]))
  const groupByRunId = new Map<string, RunGroup>()
  for (const group of groupRuns(runSummaries)) {
    for (const run of group.runs) groupByRunId.set(run.id, group)
  }

  useEffect(() => {
    if (activeDomain !== 'all' && !domains.includes(activeDomain)) setActiveDomain('all')
  }, [activeDomain, domains.join('|')])

  useEffect(() => {
    setInspectedRunId(null)
  }, [activeDomain])

  const candidates = analysisRuns.flatMap((run) => {
    const cell = activeDomain === 'all' ? run.overall : run.byDomain.find((candidate) => candidate.key === activeDomain)
    if (!cell || !isFiniteNumber(cell.infoAlpha) || cell.nScored <= 0) return []
    const group = groupByRunId.get(run.runId)
    return [{ run, cell, infoAlpha: cell.infoAlpha, summary: summaryById.get(run.runId), provider: group ? providerForGroup(group) : undefined }]
  }).sort((a, b) => b.infoAlpha - a.infoAlpha || b.cell.nQuestions - a.cell.nQuestions || a.run.modelName.localeCompare(b.run.modelName))
  const leader = candidates[0]
  const visible = new Set(visibleRunIds ?? analysisRuns.map((run) => run.runId))
  const ranked = candidates.filter((candidate) => visible.has(candidate.run.runId))
  const selected = ranked.find((candidate) => candidate.run.runId === selectedRunId)
  const inspected = selected ?? candidates.find((candidate) => candidate.run.runId === inspectedRunId) ?? leader
  const scale = Math.max(0.001, ...candidates.map((candidate) => Math.abs(candidate.infoAlpha)))

  useEffect(() => {
    if (selectedRunId && !selected) setSelectedRunId(null)
  }, [selectedRunId, selected?.run.runId])

  if (!leader) return <p className="chart-empty">No domain-level results are published yet.</p>

  const providerMark = (provider: ModelProvider | undefined) => <span className="domain-provider-mark"><ProviderMark provider={provider} /></span>
  const runContext = (candidate: typeof leader) => `${sourceLabel(candidate.run.sourceType)} · ${modeLabel(candidate.run.mode)} · ${retrievalLabel(candidate.summary?.retrieval)}`

  return (
    <figure className="domain-leaderboard">
      <div className="domain-tabs" role="group" aria-label="Choose a forecasting domain">
        <button type="button" className={activeDomain === 'all' ? 'active' : ''} aria-pressed={activeDomain === 'all'} onClick={() => setActiveDomain('all')}>All Domain</button>
        {domains.map((domain) => <button key={domain} type="button" className={activeDomain === domain ? 'active' : ''} aria-pressed={activeDomain === domain} onClick={() => setActiveDomain(domain)}>{humanize(domain)}</button>)}
      </div>

      <div className="domain-leader-card">
        <div className="domain-leader-identity">
          <span className="domain-leader-kicker">{selected ? `Selected model · ${activeDomainLabel}` : inspectedRunId ? 'Model detail' : `Observed leader · ${activeDomainLabel}`}</span>
          <div className="domain-leader-model">{providerMark(inspected.provider)}<div><strong>{shortModelName(inspected.run.modelName)}</strong><span>{runContext(inspected)}</span></div></div>
          {inspected.cell.nQuestions < 10 ? <span className="domain-small-sample">Small sample · {number(inspected.cell.nQuestions)} question{inspected.cell.nQuestions === 1 ? '' : 's'}</span> : null}
        </div>
        <dl className="domain-leader-metrics">
          <div><dt>Information α</dt><dd>{signedDecimal(inspected.infoAlpha)}</dd></div>
          <div><dt>Accuracy</dt><dd>{percent(inspected.cell.accuracy)}</dd></div>
          <div><dt>Brier</dt><dd>{formatMetric(inspected.cell.brier, 'brier')}</dd></div>
          <div><dt>Coverage</dt><dd>{percent(inspected.cell.coverage)}</dd></div>
          <div><dt>Questions</dt><dd>{number(inspected.cell.nQuestions)}</dd></div>
          <div><dt>Forecasts</dt><dd>{number(inspected.cell.nScored)}</dd></div>
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
              <button key={candidate.run.runId} type="button" className={`domain-ranking-row${selectedRunId === candidate.run.runId ? ' selected' : ''}`} aria-label={label} aria-pressed={selectedRunId === candidate.run.runId} onClick={() => setSelectedRunId((current) => current === candidate.run.runId ? null : candidate.run.runId)} onMouseEnter={() => setInspectedRunId(candidate.run.runId)} onMouseLeave={() => setInspectedRunId(null)} onFocus={() => setInspectedRunId(candidate.run.runId)} onBlur={() => setInspectedRunId(null)}>
                <div className="domain-rank-identity"><span className="domain-rank-number">{index + 1}</span>{providerMark(candidate.provider)}<div><strong>{shortModelName(candidate.run.modelName)}</strong><span>{modeLabel(candidate.run.mode)} · {retrievalLabel(candidate.summary?.retrieval)}</span></div></div>
                <div className="domain-score-track" aria-hidden="true"><span className="domain-score-zero" /><span className={`domain-score-bar ${candidate.infoAlpha >= 0 ? 'positive' : 'negative'}`} style={{ ...barStyle, backgroundColor: providerColor }} /></div>
                <div className="domain-score-value"><strong>{signedDecimal(candidate.infoAlpha)}</strong>{candidate.cell.nQuestions < 10 ? <span>Small sample</span> : <span>{number(candidate.cell.nQuestions)} questions</span>}</div>
              </button>
            )
          })}
        </div>
      ) : <div className="result-model-empty"><strong>No selected model has a result in {activeDomainLabel}.</strong><span>Use Add models or reset the filters to restore the ranking.</span></div>}
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
          <div className="paired-mode-identity"><strong>{shortModelName(comparison.modelName)}</strong><span>{sourceLabel(comparison.sourceType)} · {number(comparison.nMatched)} matched forecasts</span></div>
          <div className="paired-mode-metrics">
            <DifferenceCell label="Accuracy Δ" value={comparison.accuracyDifference} format="points" favorable={(comparison.accuracyDifference ?? 0) > 0} interval={comparison.intervals.accuracyDifference} />
            <DifferenceCell label="Brier Δ" value={comparison.brierDifference} format="decimal" favorable={(comparison.brierDifference ?? 0) < 0} interval={comparison.intervals.brierDifference} />
            <DifferenceCell label="Information α Δ" value={comparison.infoAlphaDifference} format="decimal" favorable={(comparison.infoAlphaDifference ?? 0) > 0} interval={comparison.intervals.infoAlphaDifference} />
            <DifferenceCell label="Memory-on lower Brier" value={comparison.sequentialWinRate} format="percent" favorable={(comparison.sequentialWinRate ?? 0) > 0.5} />
          </div>
        </article>
      ))}
      <figcaption>Paired intervals are clustered by question. These differences compare matched memory settings within each model family. <a href={releaseHref('#/overview#environment')}>Protocol overview</a></figcaption>
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
      : b.improvement - a.improvement)
  const scale = Math.max(0.001, ...rows.flatMap((row) => [Math.abs(row.improvement), Math.abs(row.interval.lower ?? 0), Math.abs(row.interval.upper ?? 0)]))
  return (
    <figure className="research-list-chart">
      {ordered.map((row) => {
        const tooltip = `${row.modelName} · ${modeLabel(row.mode)} · first Brier ${row.firstBrier.toFixed(3)} · last Brier ${row.lastBrier.toFixed(3)} · improvement ${row.improvement.toFixed(3)}`
        return <article className="research-chart-row" key={row.runId} role="img" aria-label={tooltip} tabIndex={0}>
          <div className="research-chart-identity"><strong>{shortModelName(row.modelName)}</strong><span>{modeLabel(row.mode)} · {retrievalLabel(row.retrieval)}</span></div>
          <EffectBar value={row.improvement} scale={scale} favorable={row.improvement > 0} />
          <div className="research-chart-values"><strong>{signedDecimal(row.improvement)} improvement</strong><span>{row.firstBrier.toFixed(3)} → {row.lastBrier.toFixed(3)} · {number(row.nEpisodes)} questions</span></div>
        </article>
      })}
      <figcaption>Positive bars indicate lower Brier at the last forecast date. Hover or focus each row for endpoint scores.</figcaption>
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

type MetricFormulaKind = Metric | 'murphy'

type BarTooltip = { runId: string; condition: string; value: string; coverage: string; x: number; y: number; above: boolean }

const metricFormulas: Record<MetricFormulaKind, { label: string; math: string }> = {
  accuracy: {
    label: 'Accuracy: mean credit for the resolved outcome among top-probability outcomes. T is the set of most probable outcomes; ties split credit.',
    math: '<mfrac><mn>1</mn><mi>N</mi></mfrac><munder><mo>∑</mo><mi>i</mi></munder><mfrac><mrow><mn>𝟙</mn><mo>[</mo><msub><mi>y</mi><mi>i</mi></msub><mo>∈</mo><msub><mi>T</mi><mi>i</mi></msub><mo>]</mo></mrow><mrow><mo>|</mo><msub><mi>T</mi><mi>i</mi></msub><mo>|</mo></mrow></mfrac>',
  },
  brier: {
    label: 'Brier score: mean sum of squared differences between forecast probabilities and the resolved outcome.',
    math: '<mfrac><mn>1</mn><mi>N</mi></mfrac><munder><mo>∑</mo><mi>i</mi></munder><munder><mo>∑</mo><mi>k</mi></munder><msup><mrow><mo>(</mo><msub><mi>p</mi><mrow><mi>i</mi><mi>k</mi></mrow></msub><mo>−</mo><mn>𝟙</mn><mo>[</mo><msub><mi>y</mi><mi>i</mi></msub><mo>=</mo><mi>k</mi><mo>]</mo><mo>)</mo></mrow><mn>2</mn></msup>',
  },
  infoAlpha: {
    label: 'Information alpha: mean log ratio of agent to market probability for the resolved outcome. Epsilon is the probability floor, 0.001.',
    math: '<mfrac><mn>1</mn><mi>N</mi></mfrac><munder><mo>∑</mo><mi>i</mi></munder><mi mathvariant="normal">log</mi><mfrac><mrow><mi mathvariant="normal">max</mi><mo>(</mo><msub><mi>p</mi><mi>i</mi></msub><mo>(</mo><msub><mi>y</mi><mi>i</mi></msub><mo>)</mo><mo>,</mo><mi>ε</mi><mo>)</mo></mrow><mrow><mi mathvariant="normal">max</mi><mo>(</mo><msub><mi>m</mi><mi>i</mi></msub><mo>(</mo><msub><mi>y</mi><mi>i</mi></msub><mo>)</mo><mo>,</mo><mi>ε</mi><mo>)</mo></mrow></mfrac>',
  },
  murphy: {
    label: 'Binned Brier approximation: reliability minus resolution plus uncertainty. Ten equal-width bins; finite-bin residuals are reported in the tooltip.',
    math: '<mi mathvariant="normal">REL</mi><mo>−</mo><mi mathvariant="normal">RES</mi><mo>+</mo><mi mathvariant="normal">UNC</mi>',
  },
}

function MetricFormula({ kind }: { kind: MetricFormulaKind }) {
  const { label, math } = metricFormulas[kind]
  return <div className="metric-formula" role="img" aria-label={label} title={label}><span aria-hidden="true" dangerouslySetInnerHTML={{ __html: `<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow>${math}</mrow></math>` }} /></div>
}

function MemoryChartCard({ title, formula, accent, className = '', children }: { title: string; formula?: MetricFormulaKind; accent: 'quality' | 'activity' | 'tokens'; className?: string; children: (memoryEnabled: boolean) => React.ReactNode }) {
  const [memoryEnabled, setMemoryEnabled] = useState(false)
  const mode = memoryEnabled ? 'Memory-on' : 'Memory-free'
  return (
    <article className={`highlight-card ${accent} ${className}`.trim()}>
      <div className="highlight-card-header">
        <div className="highlight-card-copy"><div className="highlight-card-heading"><span aria-hidden="true" /><h3>{title}</h3></div>{formula ? <MetricFormula kind={formula} /> : null}</div>
        <button type="button" className={`memory-icon-control${memoryEnabled ? ' active' : ''}`} aria-label={`Belief notebook memory for ${title}`} aria-pressed={memoryEnabled} title={`${mode}. ${memoryEnabled ? 'Show memory-free forecasts' : 'Show memory-on forecasts with a carried belief notebook'}.`} onClick={() => setMemoryEnabled((enabled) => !enabled)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#b49bdf" stroke="#7052b8" d="M12 5.5C12 2.5 8 1.6 6.6 4.2C4 4.2 2.5 6.3 3.2 8.7C1.8 10.7 2.8 13.5 4.8 14.1C4 16.6 5.8 19 8 18.8C9.3 21.1 12 20.4 12 18.1Z" />
            <path fill="#82c9b8" stroke="#398774" d="M12 5.5C12 2.5 16 1.6 17.4 4.2C20 4.2 21.5 6.3 20.8 8.7C22.2 10.7 21.2 13.5 19.2 14.1C20 16.6 18.2 19 16 18.8C14.7 21.1 12 20.4 12 18.1Z" />
            <path stroke="#7052b8" d="M6.6 4.2C6.3 6.1 7.2 7.4 8.6 7.7M3.2 8.7C5.4 8.4 6.6 9.7 6.4 11.3M4.8 14.1C6.8 14.5 8.1 13.5 8.4 12M8 18.8C7.8 16.7 8.8 15.7 10.2 15.5" />
            <path stroke="#398774" d="M17.4 4.2C17.7 6.1 16.8 7.4 15.4 7.7M20.8 8.7C18.6 8.4 17.4 9.7 17.6 11.3M19.2 14.1C17.2 14.5 15.9 13.5 15.6 12M16 18.8C16.2 16.7 15.2 15.7 13.8 15.5" />
          </svg>
          <span className="sr-only">{mode}</span>
        </button>
      </div>
      {children(memoryEnabled)}
    </article>
  )
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
type AnalysisModeControl = 'select' | 'compare' | 'memory-on-only'
type AnalysisFigureSelection = { visibleGroupIds: string[]; visibleRunIds: string[]; activeMode: Exclude<ForecastMode, 'unknown'> }

function ModelFilteredAnalysisSection({ chartId, eyebrow, title, description, note, runs, eligibleRunIds, modeControl = 'select', defaultModelCount, children }: {
  chartId: string
  eyebrow: string
  title: string
  description: string
  note: string
  runs: RunSummary[]
  eligibleRunIds: string[]
  modeControl?: AnalysisModeControl
  defaultModelCount?: number
  children: (selection: AnalysisFigureSelection) => React.ReactNode
}) {
  const eligible = new Set(eligibleRunIds)
  const eligibleGroups = groupRuns(runs)
    .map((group) => ({ ...group, runs: group.runs.filter((run) => eligible.has(run.id)) }))
    .filter((group) => group.runs.length)
  const groups = eligibleGroups
  const defaults = defaultResultGroupIds(groups).slice(0, defaultModelCount ?? groups.length)
  const [selectedIds, setSelectedIds] = useState<string[]>(() => defaults)
  const [modelSearch, setModelSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<AccuracySourceFilter>('all')
  const [releaseFilter, setReleaseFilter] = useState<AccuracyReleaseFilter>('all')
  const [providerFilter, setProviderFilter] = useState('all')
  const groupMap = new Map(groups.map((group) => [group.id, group]))
  const selected = selectedIds.map((id) => groupMap.get(id)).filter((group): group is RunGroup => Boolean(group))
  const activeMode: Exclude<ForecastMode, 'unknown'> = modeControl === 'memory-on-only' ? 'sequential' : 'independent'
  const searchTerm = modelSearch.trim().toLowerCase()
  const searchResults = groups.filter((group) => {
    const haystack = `${group.modelName} ${providerNameForGroup(group)} ${group.runs[0]?.baseModel ?? ''}`.toLowerCase()
    return haystack.includes(searchTerm)
  })
  const visibleGroups = selected.filter((group) => (
    (sourceFilter === 'all' || group.sourceType === sourceFilter)
    && (providerFilter === 'all' || providerNameForGroup(group) === providerFilter)
    && (releaseFilter === 'all' || (isHistoricalGroup(group) ? 'historical' : 'current') === releaseFilter)
    && group.runs.some((run) => modeControl === 'compare' ? run.mode === 'independent' || run.mode === 'sequential' : run.mode === activeMode)
  ))
  const visibleGroupIds = visibleGroups.map((group) => group.id)
  const visibleRunIds = visibleGroups.flatMap((group) => group.runs.filter((run) => modeControl === 'compare' ? run.mode === 'independent' || run.mode === 'sequential' : run.mode === activeMode).map((run) => run.id))
  const activeFilterCount = [sourceFilter, releaseFilter, providerFilter].filter((value) => value !== 'all').length
  const controlName = `${chartId}-model-controls`
  const filterTitleId = `${chartId}-filter-title`
  const providers = [...new Set(groups.map(providerNameForGroup))]
  const memoryStatus = modeControl === 'compare' ? 'Comparing memory-on and memory-free' : `Showing ${modeLabel(activeMode)}`

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
          <span><strong>{visibleGroups.length}</strong> model{visibleGroups.length === 1 ? '' : 's'} shown · {memoryStatus}</span>
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
                  { value: 'open', label: 'Open-weight' },
                  { value: 'closed', label: 'Proprietary' },
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

        {visibleGroups.length ? children({ visibleGroupIds, visibleRunIds, activeMode }) : <div className="result-model-empty" aria-live="polite"><strong>{selected.length ? 'No selected models have this run condition.' : 'No models selected.'}</strong><span>{selected.length ? 'Reset the filters or add another model.' : 'Use Add models to choose one or more model families.'}</span></div>}
      </div>
    </AnalysisSection>
  )
}

function MetricLeaderboardChart({ runs, baseline, metric, memoryEnabled }: { runs: RunSummary[]; baseline: number | null; metric: Metric; memoryEnabled: boolean }) {
  const allGroups = useMemo(() => groupRuns(runs)
    .filter((group) => group.runs.some((run) => isFiniteNumber(run[metric])))
    .sort((a, b) => compareGroupMetric(a, b, metric)), [runs, metric])
  const groups = useMemo(() => allGroups
    .sort((a, b) => compareIndependentGroupMetric(a, b, metric)), [allGroups, metric])
  const defaults = useMemo(() => groups.map((group) => group.id), [groups])
  const [selectedIds, setSelectedIds] = useState<string[]>(defaults)
  const [modelSearch, setModelSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<AccuracySourceFilter>('all')
  const [releaseFilter, setReleaseFilter] = useState<AccuracyReleaseFilter>('all')
  const [providerFilter, setProviderFilter] = useState('all')
  const [labelSize, setLabelSize] = useState(17)
  const [barWidth, setBarWidth] = useState(34)
  const [showBarValues, setShowBarValues] = useState(metric !== 'infoAlpha')
  const [showGridlines, setShowGridlines] = useState(true)
  const [showCrowdLine, setShowCrowdLine] = useState(true)
  const [barTooltip, setBarTooltip] = useState<BarTooltip | null>(null)
  const selected = groups.filter((group) => selectedIds.includes(group.id))
  const searchResults = groups.filter((group) => {
    const provider = providerForGroup(group)
    const haystack = `${group.modelName} ${provider?.name ?? ''} ${group.runs[0]?.baseModel ?? ''}`.toLowerCase()
    return haystack.includes(modelSearch.trim().toLowerCase())
  })
  const activeMode: Exclude<ForecastMode, 'unknown'> = memoryEnabled ? 'sequential' : 'independent'
  const activeEntries = selected.map((group) => {
    const activeGroup = group
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
  const canvasWidth = Math.max(420, visibleEntries.length * barWidth + (visibleEntries.length + 1) * 8 + 108)
  const controlName = `${metric}-chart-controls`
  const filterTitleId = `${metric}-filter-title`
  const displayTitleId = `${metric}-display-title`
  const toggleModel = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id])
  }

  const revealBarTooltip = (element: HTMLDivElement, run: RunSummary) => {
    const rect = (element.querySelector('.accuracy-vertical-bar') ?? element).getBoundingClientRect()
    const anchorY = Math.max(12, rect.top)
    setBarTooltip({
      runId: run.id,
      condition: modeLabel(activeMode),
      value: formatLeaderboardValue(metric, run[metric]!),
      coverage: `${percent(run.coverage, run.coverage < 1 ? 1 : 0)} coverage`,
      x: Math.max(105, Math.min(window.innerWidth - 105, rect.left + rect.width / 2)),
      y: anchorY >= 120 ? anchorY - 10 : anchorY + Math.min(rect.height, 28) + 10,
      above: anchorY >= 120,
    })
  }

  useEffect(() => {
    if (!barTooltip) return
    const dismiss = () => setBarTooltip(null)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [barTooltip?.runId])

  useEffect(() => setBarTooltip(null), [memoryEnabled, metric, selectedIds, sourceFilter, providerFilter, releaseFilter])

  const resetFilters = () => {
    setSourceFilter('all')
    setReleaseFilter('all')
    setProviderFilter('all')
  }

  const resetDisplay = () => {
    setLabelSize(17)
    setBarWidth(34)
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
      <div className="accuracy-leaderboard-toolbar">
        <div className="accuracy-mode-legend" aria-label="Active run condition">
          <span className={`memory-legend${memoryEnabled ? ' on' : ''}`}><i />{modeLabel(activeMode)}</span>
          {baseline == null || !showCrowdLine ? null : <span title={metric === 'infoAlpha' ? 'Market reference: zero by definition' : 'Rounded market reference from paper v1, Table 3'}><i className="crowd" />Crowd · {formatLeaderboardValue(metric, baseline)}</span>}
        </div>
        <div className="accuracy-chart-actions">
          <details className="accuracy-model-picker" name={controlName}>
            <summary><span aria-hidden="true">＋</span> Add models <small>{selected.length}/{groups.length}</small></summary>
            <div className="accuracy-model-picker-panel">
              <label className="accuracy-model-search"><span className="sr-only">Search models</span><input type="search" value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="Search models or providers…" /></label>
              <div className="accuracy-model-options" role="group" aria-label={`Model families shown in the ${metricDetails[metric].label} chart`}>
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
                { value: 'open', label: 'Open-weight' },
                { value: 'closed', label: 'Proprietary' },
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
              <label className="accuracy-label-slider"><span>Bar thickness <output>{barWidth}px</output></span><input aria-label="Bar thickness" type="range" min="12" max="44" step="1" value={barWidth} onChange={(event) => setBarWidth(Number(event.target.value))} /></label>
              <label className="accuracy-label-slider"><span>Model label size <output>{labelSize}px</output></span><input aria-label="Model label size" type="range" min="14" max="28" step="1" value={labelSize} onChange={(event) => setLabelSize(Number(event.target.value))} /></label>
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
          <div className="accuracy-chart-canvas" style={{ minWidth: `${canvasWidth}px`, '--accuracy-label-size': `${labelSize}px`, '--accuracy-bar-width': `${barWidth}px` } as React.CSSProperties}>
            <div className="accuracy-y-axis" aria-hidden="true">
              {axisTicks.map((tick) => <span key={tick} style={{ bottom: `${position(tick)}%` }}>{formatLeaderboardTick(metric, tick)}</span>)}
            </div>
            <div className="accuracy-plot-field">
              {showGridlines ? axisTicks.map((tick) => <i key={tick} className="accuracy-gridline" style={{ bottom: `${position(tick)}%` }} />) : null}
              {baseline == null || !showCrowdLine ? null : <div className="accuracy-crowd-line" style={{ bottom: `${position(baseline)}%` }} />}
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
                  const conditionLabel = modeLabel(activeMode)
                  const tooltip = `${group.modelName} · ${conditionLabel} · ${displayValue} ${metricDetails[metric].label.toLowerCase()} · ${percent(run.coverage, run.coverage < 1 ? 1 : 0)} coverage · ${metricDetails[metric].direction.toLowerCase()}`
                  return (
                    <article className="accuracy-model-group" key={group.id} style={chartStyle}>
                      <div className="accuracy-bar-pair single">
                        <div className="accuracy-bar-slot sequential" tabIndex={0} role="img" aria-label={tooltip} aria-describedby={barTooltip?.runId === run.id ? `${metric}-bar-tooltip` : undefined} onMouseEnter={(event) => revealBarTooltip(event.currentTarget, run)} onMouseLeave={() => setBarTooltip(null)} onFocus={(event) => revealBarTooltip(event.currentTarget, run)} onBlur={() => setBarTooltip(null)}>
                          <div className={`accuracy-vertical-bar${isNegative ? ' negative' : ''}`} style={{ bottom: `${barBottom}%`, height: `${barHeight}%` }}>{showBarValues ? <strong>{displayValue}</strong> : null}</div>
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
      <figcaption aria-live="polite">{visibleEntries.length} model{visibleEntries.length === 1 ? '' : 's'}{activeFilterCount ? ` · ${activeFilterCount} active filter${activeFilterCount === 1 ? '' : 's'}` : ''}</figcaption>
      {barTooltip ? createPortal(<div id={`${metric}-bar-tooltip`} className={`accuracy-bar-tooltip floating${barTooltip.above ? ' above' : ''}`} role="tooltip" style={{ left: barTooltip.x, top: barTooltip.y }}><small>{barTooltip.condition}</small><strong>{barTooltip.value}</strong><span>{barTooltip.coverage}</span></div>, document.body) : null}
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

function ResearchScatterChart({ runs, murphy, kind, memoryEnabled }: { runs: RunSummary[]; murphy: MurphySummary[]; kind: ResearchScatterKind; memoryEnabled: boolean }) {
  const plotRef = useRef<HTMLDivElement>(null)
  const [plotSize, setPlotSize] = useState({ width: 958, height: 484 })
  const murphyByRunId = useMemo(() => new Map(murphy.map((row) => [row.runId, row])), [murphy])
  const eligibleRunIds = useMemo(() => new Set(
    kind === 'murphy'
      ? murphy.map((row) => row.runId)
      : runs.filter((run) => isFiniteNumber(run.avgUsd) && run.avgUsd > 0 && isFiniteNumber(run.infoAlpha)).map((run) => run.id),
  ), [kind, murphy, runs])
  const allGroups = useMemo(() => groupRuns(runs)
    .filter((group) => group.runs.some((run) => eligibleRunIds.has(run.id))), [eligibleRunIds, runs])
  const groups = useMemo(() => allGroups
    .sort((a, b) => compareIndependentGroupMetric(a, b, kind === 'murphy' ? 'brier' : 'infoAlpha')), [allGroups, kind])
  const defaults = useMemo(() => groups.map((group) => group.id), [groups])
  const [selectedIds, setSelectedIds] = useState<string[]>(defaults)
  const [modelSearch, setModelSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<AccuracySourceFilter>('all')
  const [providerFilter, setProviderFilter] = useState('all')
  const [labelSize, setLabelSize] = useState(17)
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
  const comparisonData: ResearchScatterDatum[] = selected.flatMap((group): ResearchScatterDatum[] => {
    const provider = providerForGroup(group)
    if ((sourceFilter !== 'all' && group.sourceType !== sourceFilter) || (providerFilter !== 'all' && provider?.name !== providerFilter)) return []
    return group.runs.filter((run) => eligibleRunIds.has(run.id) && (run.mode === 'independent' || run.mode === 'sequential'))
      .flatMap((run): ResearchScatterDatum[] => {
        if (kind === 'murphy') {
          const row = murphyByRunId.get(run.id)
          return row ? [{ group, run, provider, x: row.reliability, y: row.resolution, murphy: row }] : []
        }
        return isFiniteNumber(run.avgUsd) && run.avgUsd > 0 && isFiniteNumber(run.infoAlpha)
          ? [{ group, run, provider, x: run.avgUsd, y: run.infoAlpha }]
          : []
      })
  })
  const visibleData = comparisonData.filter((point) => point.run.mode === activeMode)
  const activeFilterCount = [sourceFilter, providerFilter].filter((value) => value !== 'all').length
  const controlName = `${kind}-scatter-controls`
  const filterTitleId = `${kind}-scatter-filter-title`
  const displayTitleId = `${kind}-scatter-display-title`
  const crowd = kind === 'murphy' ? comparisonData.find((point) => point.murphy)?.murphy?.crowd ?? null : null
  // Keep scales stable when switching memory modes; selection and filters still refit the axes.
  const xValues = [...comparisonData.map((point) => point.x), ...(crowd && showReference ? [crowd.reliability] : [])]
  const yValues = [...comparisonData.map((point) => point.y), ...(crowd && showReference ? [crowd.resolution] : []), ...(kind === 'cost' && showReference ? [0] : [])]
  const xDomain = kind === 'cost' ? logarithmicDomain(xValues) : paddedLinearDomain(xValues, true)
  const yDomain = paddedLinearDomain(yValues, kind === 'murphy')
  const xTicks = kind === 'cost' ? logarithmicTicks(xDomain.min, xDomain.max) : linearTicks(xDomain.min, xDomain.max)
  const yTicks = linearTicks(yDomain.min, yDomain.max)
  const xTickStep = xTicks.length > 1 ? xTicks[1] - xTicks[0] : xDomain.max - xDomain.min
  const yTickStep = yTicks.length > 1 ? yTicks[1] - yTicks[0] : yDomain.max - yDomain.min
  const xPosition = (value: number) => clampPercent(kind === 'cost'
    ? ((Math.log10(value) - Math.log10(xDomain.min)) / (Math.log10(xDomain.max) - Math.log10(xDomain.min))) * 100
    : ((value - xDomain.min) / (xDomain.max - xDomain.min)) * 100)
  const yPosition = (value: number) => clampPercent(((value - yDomain.min) / (yDomain.max - yDomain.min)) * 100)
  const frontier = kind === 'cost' ? paretoFrontier(visibleData) : []
  const frontierIds = new Set(frontier.map((point) => point.run.id))
  const frontierPath = frontier.map((point) => `${xPosition(point.x)},${100 - yPosition(point.y)}`).join(' ')
  const conditionLabel = modeLabel(activeMode)
  const providers = modelProviders.filter((provider) => groups.some((group) => providerForGroup(group)?.name === provider.name))
  const labelPoints = [
    ...visibleData.map((point) => ({ id: point.run.id, label: compactLeaderboardName(point.group.modelName), x: xPosition(point.x) / 100 * plotSize.width, y: (1 - yPosition(point.y) / 100) * plotSize.height })),
    ...(crowd && showReference ? [{ id: 'market-crowd', label: 'Market crowd', x: xPosition(crowd.reliability) / 100 * plotSize.width, y: (1 - yPosition(crowd.resolution) / 100) * plotSize.height }] : []),
  ]
  const labelPlacements = placeScatterLabels(labelPoints, labelSize, plotSize)

  useEffect(() => {
    const plot = plotRef.current
    if (!plot) return
    const observer = new ResizeObserver(([entry]) => setPlotSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(plot)
    return () => observer.disconnect()
  }, [visibleData.length])

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
    setLabelSize(17)
    setShowLabels(true)
    setShowGridlines(true)
    setShowReference(true)
    setShowFrontier(true)
  }

  return (
    <figure className={`research-scatter research-scatter-${kind}`}>

      <div className="accuracy-leaderboard-toolbar">
        <div className="accuracy-mode-legend" aria-label="Active run condition and chart references">
          <span className={`memory-legend${memoryEnabled ? ' on' : ''}`}><i />{conditionLabel}</span>
          {kind === 'murphy' && crowd && showReference ? <span><i className="scatter-crowd" />Market crowd</span> : null}
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
                { value: 'open', label: 'Open-weight' },
                { value: 'closed', label: 'Proprietary' },
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
              <label className="accuracy-label-slider"><span>Model label size <output>{labelSize}px</output></span><input aria-label="Model label size" type="range" min="14" max="28" step="1" value={labelSize} onChange={(event) => setLabelSize(Number(event.target.value))} /></label>
              <AccuracyToggle label="Model labels" checked={showLabels} onChange={setShowLabels} />
              <AccuracyToggle label="Gridlines" checked={showGridlines} onChange={setShowGridlines} />
              {kind === 'cost' || crowd ? <AccuracyToggle label={kind === 'murphy' ? 'Crowd point' : 'Crowd benchmark'} checked={showReference} onChange={setShowReference} /> : null}
              {kind === 'cost' ? <AccuracyToggle label="Pareto frontier" checked={showFrontier} onChange={setShowFrontier} /> : null}
              <button className="accuracy-control-reset" type="button" onClick={resetDisplay}>Reset display</button>
            </div>
          </details>
        </div>
      </div>

      {!visibleData.length ? <div className="accuracy-empty" aria-live="polite"><strong>{selected.length ? 'No selected models have this run condition.' : 'No models selected.'}</strong><span>{selected.length ? 'Change a switch or reset the chart filters.' : 'Use “Add models” to choose one or more models.'}</span></div> : (
        <div className="research-scatter-scroll" tabIndex={0} aria-label={`Scrollable ${kind === 'murphy' ? 'Murphy decomposition' : 'information alpha versus cost'} chart. Axes fit selected models and share the same scale across memory modes.`}>
          <div className="research-scatter-canvas" style={{ '--scatter-label-size': `${labelSize}px` } as React.CSSProperties}>
            <span className="research-scatter-y-title">{kind === 'murphy' ? 'Resolution · higher is better' : 'Information alpha · higher is better'}</span>
            <div className="research-scatter-plot" ref={plotRef}>
              {showGridlines ? xTicks.map((tick) => <i key={`x-${tick}`} className="research-scatter-grid vertical" style={{ left: `${xPosition(tick)}%` }} />) : null}
              {showGridlines ? yTicks.map((tick) => <i key={`y-${tick}`} className="research-scatter-grid horizontal" style={{ bottom: `${yPosition(tick)}%` }} />) : null}
              {xTicks.map((tick) => <span key={`xt-${tick}`} className="research-scatter-x-tick" style={{ left: `${xPosition(tick)}%` }}>{kind === 'cost' ? scatterMoney(tick) : formatLinearScatterTick(tick, xTickStep, 3)}</span>)}
              {yTicks.map((tick) => <span key={`yt-${tick}`} className="research-scatter-y-tick" style={{ bottom: `${yPosition(tick)}%` }}>{formatLinearScatterTick(tick, yTickStep, kind === 'murphy' ? 2 : 1)}</span>)}
              {kind === 'cost' && showReference ? <div className="research-scatter-zero" style={{ bottom: `${yPosition(0)}%` }} /> : null}
              {kind === 'cost' && showFrontier && frontier.length > 1 ? <svg className="research-scatter-frontier" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points={frontierPath} /></svg> : null}
              {showLabels ? <svg className="research-scatter-label-lines" viewBox={`0 0 ${plotSize.width} ${plotSize.height}`} aria-hidden="true">{labelPoints.map((point) => {
                const label = labelPlacements.get(point.id)!
                return label.leader.visible ? <line key={point.id} x1={label.leader.x1} y1={label.leader.y1} x2={label.leader.x2} y2={label.leader.y2} /> : null
              })}</svg> : null}

              {visibleData.map((point) => {
                const x = xPosition(point.x)
                const y = yPosition(point.y)
                const logo = point.provider ? providerLogos[point.provider.name] : undefined
                const horizontal = x > 76 ? 'left' : x < 24 ? 'right' : 'center'
                const vertical = y > 72 ? 'below' : 'above'
                const label = labelPlacements.get(point.run.id)!
                const aria = kind === 'murphy' && point.murphy
                  ? `${point.group.modelName}, ${conditionLabel}, reliability ${point.murphy.reliability.toFixed(3)}, resolution ${point.murphy.resolution.toFixed(3)}, uncertainty ${point.murphy.uncertainty.toFixed(3)}, Brier ${point.murphy.brier.toFixed(3)}`
                  : `${point.group.modelName}, ${conditionLabel}, information alpha ${point.y.toFixed(3)}, recorded cost ${scatterMoney(point.x)} per checkpoint${frontierIds.has(point.run.id) ? ', Pareto efficient' : ''}`
                return (
                  <button type="button" key={point.run.id} className={`research-scatter-point${frontierIds.has(point.run.id) ? ' frontier-point' : ''}`} style={{ left: `${x}%`, bottom: `${y}%`, '--provider-color': point.provider?.color ?? '#887566' } as React.CSSProperties} aria-label={aria}>
                    <span className="research-scatter-marker">{logo ? <img src={logo} alt="" /> : <span aria-hidden="true">•</span>}</span>
                    {showLabels ? <span className="research-scatter-model-label placed" style={{ left: 14 + label.dx, top: 14 + label.dy - label.height / 2, width: label.width }} title={point.group.modelName}>{compactLeaderboardName(point.group.modelName)}</span> : null}
                    <span className={`research-scatter-tooltip ${horizontal} ${vertical}`}>
                      <small>{point.provider?.name ?? sourceLabel(point.group.sourceType)} · {conditionLabel}</small>
                      <strong>{point.group.modelName}</strong>
                      {kind === 'murphy' && point.murphy ? <>
                        <span><b>Reliability</b><em>{point.murphy.reliability.toFixed(3)}</em></span>
                        <span><b>Resolution</b><em>{point.murphy.resolution.toFixed(3)}</em></span>
                        <span><b>Uncertainty</b><em>{point.murphy.uncertainty.toFixed(3)}</em></span>
                        <span><b>REL − RES + UNC</b><em>{(point.murphy.reliability - point.murphy.resolution + point.murphy.uncertainty).toFixed(3)}</em></span><span><b>Binning residual</b><em>{signedDecimal(point.murphy.binningResidual ?? 0)}</em></span><span><b>Brier score</b><em>{point.murphy.brier.toFixed(3)}</em></span>
                        <span><b>Option slots</b><em>{number(point.murphy.n)}</em></span>
                      </> : <>
                        <span><b>Information alpha</b><em>{point.y.toFixed(3)}</em></span>
                        <span><b>Cost / checkpoint</b><em>{scatterMoney(point.x)}</em></span>
                        <span><b>Brier score</b><em>{formatMetric(point.run.brier, 'brier')}</em></span>
                        <span><b>Coverage</b><em>{percent(point.run.coverage, point.run.coverage < 1 ? 1 : 0)}</em></span>
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
                return <button type="button" className="research-scatter-point crowd-point" style={{ left: `${x}%`, bottom: `${y}%` }} aria-label={`Market crowd, reliability ${crowd.reliability.toFixed(3)}, resolution ${crowd.resolution.toFixed(3)}, uncertainty ${crowd.uncertainty.toFixed(3)}, Brier ${crowd.brier.toFixed(3)}`}><span className="research-scatter-marker"><span aria-hidden="true">C</span></span>{showLabels ? <span className="research-scatter-model-label placed" style={{ left: 14 + labelPlacements.get('market-crowd')!.dx, top: 14 + labelPlacements.get('market-crowd')!.dy - labelPlacements.get('market-crowd')!.height / 2, width: labelPlacements.get('market-crowd')!.width }}>Market crowd</span> : null}<span className={`research-scatter-tooltip ${horizontal} ${vertical}`}><small>Human collective-judgment baseline</small><strong>Market crowd</strong><span><b>Reliability</b><em>{crowd.reliability.toFixed(3)}</em></span><span><b>Resolution</b><em>{crowd.resolution.toFixed(3)}</em></span><span><b>Uncertainty</b><em>{crowd.uncertainty.toFixed(3)}</em></span><span><b>REL − RES + UNC</b><em>{crowd.brier.toFixed(3)}</em></span><span><b>Option slots</b><em>{number(crowd.n)}</em></span></span></button>
              })() : null}
            </div>
            <span className="research-scatter-x-title">{kind === 'murphy' ? 'Reliability · lower is better' : 'Recorded USD per checkpoint · lower is better · logarithmic scale'}</span>
          </div>
        </div>
      )}

      <figcaption>{kind === 'murphy'
        ? `Showing ${visibleData.length} model${visibleData.length === 1 ? '' : 's'} · Classwise components · 10 probability bins · scaled per forecast.`
        : `Showing ${visibleData.length} priced model${visibleData.length === 1 ? '' : 's'} · Frontier: best information alpha at each cost.`}</figcaption>
    </figure>
  )
}

type ScatterLabelPoint = { id: string; label: string; x: number; y: number }
type ScatterLabelBox = { x: number; y: number; width: number; height: number }
type ScatterLeader = { x1: number; y1: number; x2: number; y2: number; visible: boolean }

function placeScatterLabels(points: ScatterLabelPoint[], fontSize: number, size: { width: number; height: number }) {
  const placements = new Map<string, { box: ScatterLabelBox; leader: ScatterLeader }>()
  const markers = points.map((point) => ({ x: point.x - 19, y: point.y - 19, width: 38, height: 38 }))
  const height = fontSize * 1.12 + 4
  const directions = [[0, -1], [0, 1], [1, 0], [-1, 0], [1, -1], [-1, -1], [1, 1], [-1, 1]]
  const candidatesById = new Map(points.map((point) => {
    const width = Math.min(210, point.label.length * fontSize * 0.62 + 12)
    const candidates = [0, 12, 28, 48, 76, 108].flatMap((extra) => directions.map(([dx, dy]) => {
      const gap = 27 + extra
      return {
        x: Math.max(0, Math.min(size.width - width, point.x + (dx > 0 ? gap : dx < 0 ? -gap - width : -width / 2))),
        y: Math.max(0, Math.min(size.height - height, point.y + (dy > 0 ? gap : dy < 0 ? -gap - height : -height / 2))),
        width,
        height,
      }
    }))
    return [point.id, candidates] as const
  }))
  const overlaps = (a: ScatterLabelBox, b: ScatterLabelBox) => a.x < b.x + b.width + 5 && a.x + a.width + 5 > b.x && a.y < b.y + b.height + 5 && a.y + a.height + 5 > b.y
  const density = (point: ScatterLabelPoint) => points.filter((other) => Math.hypot(point.x - other.x, point.y - other.y) < 130).length
  const ordered = [...points].sort((a, b) => density(b) - density(a) || a.x - b.x || a.y - b.y)
  const choosePlacement = (point: ScatterLabelPoint) => {
    let best: { box: ScatterLabelBox; leader: ScatterLeader; score: number } | null = null
    for (const box of candidatesById.get(point.id)!) {
      const leader = scatterLeader(point, box)
      let collisions = markers.filter((marker) => overlaps(box, marker)).length
      let obstructed = 0
      let crossings = 0
      for (const [id, other] of placements) {
        if (id === point.id) continue
        if (overlaps(box, other.box)) collisions += 1
        if (scatterLineHitsBox(leader, other.box)) obstructed += 1
        if (scatterLineHitsBox(other.leader, box)) obstructed += 1
        if (scatterLinesCross(leader, other.leader)) crossings += 1
      }
      for (const other of points) {
        if (other.id !== point.id && scatterLineNearPoint(leader, other, 18)) obstructed += 1
      }
      const length = Math.hypot(leader.x2 - leader.x1, leader.y2 - leader.y1)
      const centerDistance = (box.x + box.width / 2 - point.x) ** 2 + (box.y + box.height / 2 - point.y) ** 2
      const score = collisions * 10_000_000 + (obstructed + crossings) * 200_000 + length ** 2 + centerDistance * 0.01
      if (!best || score < best.score) best = { box, leader, score }
    }
    return best!
  }
  for (const point of ordered) placements.set(point.id, choosePlacement(point))
  // Refine the entire layout so earlier labels can move to remove later crossings.
  for (let pass = 0; pass < 6; pass += 1) {
    let changed = false
    for (const point of ordered) {
      const previous = placements.get(point.id)!
      const next = choosePlacement(point)
      if (previous.box.x !== next.box.x || previous.box.y !== next.box.y) changed = true
      placements.set(point.id, next)
    }
    if (!changed) break
  }
  return new Map(points.map((point) => {
    const { box, leader } = placements.get(point.id)!
    return [point.id, { dx: box.x + box.width / 2 - point.x, dy: box.y + box.height / 2 - point.y, width: box.width, height: box.height, leader }] as const
  }))
}

function scatterLeader(point: ScatterLabelPoint, box: ScatterLabelBox): ScatterLeader {
  const targetX = Math.max(box.x, Math.min(box.x + box.width, point.x))
  const targetY = Math.max(box.y, Math.min(box.y + box.height, point.y))
  const dx = targetX - point.x, dy = targetY - point.y
  const distance = Math.hypot(dx, dy)
  const ux = distance ? dx / distance : 0, uy = distance ? dy / distance : 0
  return { x1: point.x + ux * 17, y1: point.y + uy * 17, x2: targetX - ux * 3, y2: targetY - uy * 3, visible: distance > 24 }
}

function scatterLinesCross(a: ScatterLeader, b: ScatterLeader) {
  if (!a.visible || !b.visible) return false
  const side = (line: ScatterLeader, x: number, y: number) => (line.x2 - line.x1) * (y - line.y1) - (line.y2 - line.y1) * (x - line.x1)
  return side(a, b.x1, b.y1) * side(a, b.x2, b.y2) < -1e-8 && side(b, a.x1, a.y1) * side(b, a.x2, a.y2) < -1e-8
}

function scatterLineHitsBox(line: ScatterLeader, box: ScatterLabelBox) {
  if (!line.visible) return false
  const inside = (x: number, y: number) => x >= box.x - 2 && x <= box.x + box.width + 2 && y >= box.y - 2 && y <= box.y + box.height + 2
  if (inside(line.x1, line.y1) || inside(line.x2, line.y2)) return true
  const left = box.x - 2, right = box.x + box.width + 2, top = box.y - 2, bottom = box.y + box.height + 2
  return [
    { x1: left, y1: top, x2: right, y2: top, visible: true },
    { x1: right, y1: top, x2: right, y2: bottom, visible: true },
    { x1: right, y1: bottom, x2: left, y2: bottom, visible: true },
    { x1: left, y1: bottom, x2: left, y2: top, visible: true },
  ].some((edge) => scatterLinesCross(line, edge))
}

function scatterLineNearPoint(line: ScatterLeader, point: ScatterLabelPoint, radius: number) {
  if (!line.visible) return false
  const dx = line.x2 - line.x1, dy = line.y2 - line.y1
  const fraction = Math.max(0, Math.min(1, ((point.x - line.x1) * dx + (point.y - line.y1) * dy) / (dx ** 2 + dy ** 2 || 1)))
  return Math.hypot(line.x1 + dx * fraction - point.x, line.y1 + dy * fraction - point.y) < radius
}

function niceAxisMaximum(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10
  return multiplier * magnitude
}

function paddedLinearDomain(values: number[], nonNegative = false) {
  const finiteValues = values.filter(Number.isFinite)
  if (!finiteValues.length) return { min: nonNegative ? 0 : -1, max: 1 }
  const rawMin = Math.min(...finiteValues)
  const rawMax = Math.max(...finiteValues)
  const padding = rawMax > rawMin ? (rawMax - rawMin) * 0.1 : Math.max(Math.abs(rawMin) * 0.1, 0.0001)
  return { min: nonNegative ? Math.max(0, rawMin - padding) : rawMin - padding, max: rawMax + padding }
}

function logarithmicDomain(values: number[]) {
  const positive = values.filter((value) => Number.isFinite(value) && value > 0)
  if (!positive.length) return { min: 0.01, max: 10 }
  const logValues = positive.map(Math.log10)
  const rawMin = Math.min(...logValues)
  const rawMax = Math.max(...logValues)
  const padding = rawMax > rawMin ? (rawMax - rawMin) * 0.1 : 0.15
  return { min: 10 ** (rawMin - padding), max: 10 ** (rawMax + padding) }
}

function linearTicks(min: number, max: number, segments = 5) {
  const step = niceAxisMaximum((max - min) / segments)
  const first = Math.ceil(min / step - 1e-9)
  const last = Math.floor(max / step + 1e-9)
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => Number(((first + index) * step).toPrecision(12)))
}

function logarithmicTicks(min: number, max: number) {
  const ticks: number[] = []
  for (let exponent = Math.floor(Math.log10(min)); exponent <= Math.ceil(Math.log10(max)); exponent += 1) {
    for (const multiplier of [1, 2, 5]) {
      const value = multiplier * 10 ** exponent
      if (value >= min && value <= max) ticks.push(value)
    }
  }
  return ticks.length >= 3 ? ticks : linearTicks(min, max, 4)
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

function formatLinearScatterTick(value: number, step: number, minDecimals: number) {
  const exponent = Math.floor(Math.log10(step))
  const coefficient = step / 10 ** exponent
  const fractionalStep = Math.abs(coefficient - Math.round(coefficient)) > 1e-8
  const decimals = Math.min(8, Math.max(minDecimals, -exponent + (fractionalStep ? 1 : 0)))
  return (Math.abs(value) < step * 1e-8 ? 0 : value).toFixed(decimals)
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
                const tooltip = `${run.modelName} · ${modeLabel(run.mode)} · ${formatChartValue(value, format)} · ${percent(run.coverage, run.coverage < 1 ? 1 : 0)} coverage`
                return (
                  <div className="run-chart-row interactive-run-bar" key={mode} role="img" aria-label={tooltip} tabIndex={0}>
                    <span>{modeLabel(mode)}</span>
                    <div className="run-chart-track" aria-hidden="true">
                      {[25, 50, 75].map((tick) => <i key={tick} className="run-chart-gridline" style={{ left: `${tick}%` }} />)}
                      {domainMin < 0 && domainMax > 0 ? <i className="run-chart-zero" style={{ left: `${zeroPosition}%` }} /> : null}
                      {baselinePosition == null ? null : <i className="run-chart-baseline" style={{ left: `${baselinePosition}%` }} />}
                      <i className={`run-chart-bar ${mode}`} style={{ left: `${left}%`, width: `${width}%` }} />
                      <span className="run-bar-tooltip" style={{ left: `${Math.max(8, Math.min(82, valuePosition))}%` }}><small>{modeLabel(run.mode)}</small><strong>{formatChartValue(value, format)}</strong><span>{percent(run.coverage, run.coverage < 1 ? 1 : 0)} coverage</span></span>
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
      {!row.parseOk ? <p className="repeat-note">{row.repeatCount === 0 ? 'No recorded repeats at this checkpoint.' : `${row.fallbackCount ?? 1} recorded report${(row.fallbackCount ?? 1) === 1 ? '' : 's'} scored with uniform fallback.`}</p> : row.truthProbability == null ? <p className="repeat-note">No usable probability distribution was returned.</p> : null}
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
                  <BeliefNotebook content={row.notebook} />
                </details>
              ) : <p className="notebook-missing">{row.mode === 'independent' ? 'Memory-free runs do not carry a belief notebook between forecast steps.' : row.notebookAvailable && processState !== 'loaded' ? 'This notebook is available on Hugging Face; load the full process records above to view it.' : 'No notebook text was recorded for this checkpoint.'}</p>}
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

function BeliefNotebook({ content }: { content: string }) {
  const formatted = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(content), null, 2)
    } catch {
      return null
    }
  }, [content])

  if (formatted == null) return <pre className="notebook-content">{content}</pre>
  const lines = formatted.split('\n')

  return (
    <pre className="notebook-content notebook-json" aria-label="Formatted belief notebook"><code>{lines.map((line, lineIndex) => {
      const tokens: React.ReactNode[] = []
      const tokenPattern = /"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g
      let cursor = 0
      for (const match of line.matchAll(tokenPattern)) {
        const index = match.index!
        if (index > cursor) tokens.push(line.slice(cursor, index))
        const value = match[0]
        const end = index + value.length
        const kind = value.startsWith('"') ? /^\s*:/.test(line.slice(end)) ? 'key' : 'string' : value === 'null' ? 'null' : value === 'true' || value === 'false' ? 'boolean' : 'number'
        tokens.push(<span key={index} className={`json-${kind}`}>{value}</span>)
        cursor = end
      }
      if (cursor < line.length) tokens.push(line.slice(cursor))
      const indent = line.length - line.trimStart().length
      return <span className="notebook-json-line" key={lineIndex} style={{ '--json-indent': `${indent}ch` } as React.CSSProperties}>{tokens}{lineIndex < lines.length - 1 ? '\n' : ''}</span>
    })}</code></pre>
  )
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

function isHistoricalGroup(group: RunGroup) {
  return group.runs[0]?.protocol?.toLowerCase().includes('historical') ?? false
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

function sourceLabel(source: SourceType) { return source === 'open' ? 'Open-weight' : 'Proprietary' }
function modeLabel(mode: ForecastMode) { return mode === 'sequential' ? 'Memory-on' : mode === 'independent' ? 'Memory-free' : 'Mode unavailable' }
function retrievalLabel(retrieval: string | undefined) { return retrieval === 'none' ? 'No tools' : 'Dated research' }
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
