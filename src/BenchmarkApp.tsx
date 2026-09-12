import { useEffect, useMemo, useState } from 'react'
import { attachQuestionProcess, loadAnalysis, loadManifest, loadQuestion, loadQuestionIndex, loadQuestionProcess, loadRunSummaries, loadTrajectories } from './data'
import type { AnalysisSummary, BreakdownAggregate, ConsistencySummary, DynamicsSummary, ForecastMode, Manifest, PairedModeComparison, QuestionDetail, QuestionIndexItem, RecencyComparison, RunAnalysis, RunSummary, SourceType, TrajectoryRow } from './types'

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
      : routePath.startsWith('/method')
        ? 'method'
        : 'overview'

  const content = (() => {
    if (data.coreError) return <DataError message={data.coreError} />
    if (!data.manifest) return <LoadingPage />
    if (routePath.startsWith('/questions') && data.questionError) return <DataError message={data.questionError} />
    if (routePath.startsWith('/questions') && data.questions === null) return <LoadingPage label="Loading the question index…" />
    if (routePath.startsWith('/questions/')) {
      const id = decodeURIComponent(routePath.slice('/questions/'.length))
      const item = data.questions?.find((candidate) => candidate.id === id)
      return item ? <QuestionDetailPage key={item.id} manifest={data.manifest} item={item} questions={data.questions ?? []} browseState={readQuestionBrowseState(route, 'all')} /> : <NotFoundPage />
    }
    if (section === 'results') return <ResultsPage manifest={data.manifest} runs={data.runs} analysis={data.analysis} />
    if (section === 'questions') return <QuestionsPage questions={data.questions ?? []} manifest={data.manifest} route={route} />
    if (section === 'method') return <MethodPage manifest={data.manifest} />
    return <OverviewPage manifest={data.manifest} runs={data.runs} />
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
        <span className="wordmark-mark" aria-hidden="true">⌁</span><span>Forecast Dojo</span>
      </a>
      <nav className="site-nav" aria-label="Primary navigation">
        {[
          ['overview', 'Overview'],
          ['results', 'Results'],
          ['questions', 'Questions'],
          ['method', 'Method'],
        ].map(([key, label]) => <a key={key} className={active === key ? 'active' : ''} href={releaseHref(`#/${key}`)}>{label}</a>)}
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

function OverviewPage({ manifest, runs }: { manifest: Manifest; runs: RunSummary[] }) {
  const bestRun = bestByMetric(runs, 'accuracy')
  const bestAccuracy = bestRun?.accuracy ?? null
  const crowdGap = bestAccuracy == null ? null : (manifest.crowd.accuracy ?? 0) - bestAccuracy

  return (
    <>
      <section className="hero overview-hero section-rule">
        <div>
          <p className="eyebrow">A longitudinal forecasting benchmark</p>
          <h1>Can LLM reasoning outperform human collective judgment in forecasting?</h1>
          <p className="hero-copy">
            We compare model probability forecasts with the prediction-market crowd at the same points in time.
            Every model receives only news available by that forecast date, then updates repeatedly until resolution.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href={releaseHref('#/results')}>Explore the analysis</a>
            <a className="button button-secondary" href={releaseHref('#/questions')}>Browse questions</a>
          </div>
        </div>
        <div className="hero-result-stack">
          <ChartCard title="Accuracy" description="Forecasts assigning the highest probability to the resolved outcome." accent="quality" className="accuracy-card">
            <MetricLeaderboardChart runs={runs} baseline={manifest.crowd.accuracy} metric="accuracy" />
          </ChartCard>
          <aside className="hero-readout" aria-label="Current benchmark readout">
            <span>{manifest.label}</span>
            <strong>{crowdGap == null ? 'Analysis in progress' : crowdGap > 0 ? `Crowd leads by ${percentagePoints(crowdGap)}` : `Best model leads by ${percentagePoints(Math.abs(crowdGap))}`}</strong>
            <p>{bestRun ? `${bestRun.modelName} · ${modeLabel(bestRun.mode)} is the highest-accuracy published model run at ${percent(bestAccuracy)}.` : 'No scored model runs are published yet.'}</p>
            <a href={releaseHref('#/results')}>See every result <span aria-hidden="true">↗</span></a>
          </aside>
        </div>
      </section>

      <section className="highlight-section section-rule" aria-label="Supporting benchmark results">
        <div className="highlight-grid supporting-metrics-grid">
          <ChartCard title="Brier score" description="Mean squared probability error across resolved outcomes." accent="activity" className="accuracy-card">
            <MetricLeaderboardChart runs={runs} baseline={manifest.crowd.brier} metric="brier" />
          </ChartCard>
          <ChartCard title="Information alpha" description="Forecasting information gained relative to the market crowd." accent="tokens" className="accuracy-card">
            <MetricLeaderboardChart runs={runs} baseline={manifest.crowd.infoAlpha} metric="infoAlpha" />
          </ChartCard>
        </div>
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

      <section className="mode-note section-rule">
        <div><p className="eyebrow">Secondary analysis</p><h2>Does forecast memory help?</h2></div>
        <div className="mode-columns">
          <article><h3>Independent</h3><p>At each checkpoint, the model begins fresh and cannot see its work from the previous checkpoint.</p></article>
          <article><h3>Sequential</h3><p>At each checkpoint, the model receives its compact belief notebook from the previous checkpoint.</p></article>
        </div>
      </section>
    </>
  )
}

function ResultsPage({ manifest, runs, analysis }: { manifest: Manifest; runs: RunSummary[]; analysis: AnalysisSummary | null }) {
  const hasToolMetrics = runs.some((run) => isFiniteNumber(run.avgToolCalls))
  const hasInputTokens = runs.some((run) => isFiniteNumber(run.avgInputTokens))
  const hasOutputTokens = runs.some((run) => isFiniteNumber(run.avgOutputTokens))
  const hasLatency = runs.some((run) => isFiniteNumber(run.avgModelLatencySeconds))
  const hasCost = runs.some((run) => isFiniteNumber(run.avgUsd))

  return (
    <>
      <PageIntro eyebrow="Benchmark results" title="Forecasting quality, memory, and research effort" copy="Compare each published model run with the contemporaneous market crowd across forecasting quality, resolution horizon, domain, and available research telemetry." />

      <AnalysisSection eyebrow="Proper scoring" title="Brier score" description="Mean squared probability error across the resolved outcomes. This rewards calibrated confidence rather than only the most likely answer." note={`${number(manifest.crowd.nScored ?? 0)} crowd checkpoints scored · lower is better`}>
        <GroupedRunChart runs={runs} metric="brier" format="decimal" baseline={manifest.crowd.brier} baselineLabel="Market crowd" minValue={0} maxValue={1} />
      </AnalysisSection>

      <AnalysisSection eyebrow="Market-relative performance" title="Information alpha" description="Forecasting information gained relative to the contemporaneous market crowd. Positive values indicate an improvement over the human baseline." note="The market crowd is fixed at zero · higher is better">
        <GroupedRunChart runs={runs} metric="infoAlpha" format="decimal" baseline={manifest.crowd.infoAlpha} baselineLabel="Market crowd" />
      </AnalysisSection>

      {analysis ? <AnalysisSection eyebrow="Resolution period" title="Accuracy as resolution approaches" description="Run accuracy at four pre-resolution horizons, keeping every model and forecasting mode distinct." note="Forecasts after the recorded close date are excluded from horizon analysis.">
        <BreakdownMatrix runs={analysis.runs} keys={analysis.horizonBuckets} field="byHorizon" metric="accuracy" />
      </AnalysisSection> : null}

      {analysis ? <AnalysisSection eyebrow="Domain breakdown" title="Where models come closest to the crowd" description="Information alpha by domain. Values closer to or above zero indicate performance nearer to or better than the contemporaneous market baseline." note="Cells with fewer scored checkpoints should be interpreted cautiously.">
        <BreakdownMatrix runs={analysis.runs} keys={analysis.domains.map((key) => ({ key, label: humanize(key) }))} field="byDomain" metric="infoAlpha" />
      </AnalysisSection> : null}

      {analysis ? <AnalysisSection eyebrow="Question types" title="Binary and multiple-choice performance" description="Accuracy separated by question format so changes in task composition remain visible." note="Each cell reports the mean across scored checkpoints in that question type.">
        <BreakdownMatrix runs={analysis.runs} keys={analysis.questionTypes.map((key) => ({ key, label: humanize(key) }))} field="byQuestionType" metric="accuracy" />
      </AnalysisSection> : null}

      {analysis?.pairedModes.length ? <AnalysisSection eyebrow="Forecast memory" title="Does sequential memory help?" description="Sequential and independent runs are matched at the same question and forecast date before their differences are calculated." note="Differences are Sequential minus Independent; negative Brier differences are favorable.">
        <PairedModeChart comparisons={analysis.pairedModes} />
      </AnalysisSection> : null}

      {analysis?.research?.recency.length ? <AnalysisSection eyebrow="Retrieval strategy" title="Does recency weighting help?" description="Recency-weighted retrieval is compared with baseline retrieval for the same model, forecasting mode, and question-date." note="Differences are Recency minus Baseline; negative Brier differences are favorable.">
        <RecencyEffectChart comparisons={analysis.research.recency} />
      </AnalysisSection> : null}

      {analysis?.research?.consistency.length ? <AnalysisSection eyebrow="Repeat reliability" title="Do repeated forecasts agree?" description="Four repeated forecasts expose run-to-run disagreement and show whether averaging the distributions improves Brier score." note="Brier improvement is Single-repeat Brier minus Averaged-forecast Brier; larger positive values favor averaging.">
        <ConsistencyChart rows={analysis.research.consistency} />
      </AnalysisSection> : null}

      {hasToolMetrics ? <AnalysisSection eyebrow="Agent behavior" title="Tool calls per checkpoint" description="Average research activity for each run, separated into corpus searches, article scrapes, and Python executions." note="Normalized per forecast checkpoint so partial runs remain comparable">
        <ToolMixChart runs={runs} />
      </AnalysisSection> : null}

      {hasCost ? <AnalysisSection eyebrow="Recorded cost" title="Cost per checkpoint" description="Historical input, cache-read, and output charges attached to each retained forecast." note="Recorded forecast cost is not total campaign spending; unavailable zero-price records are omitted">
        <GroupedRunChart runs={runs} metric="avgUsd" format="money" minValue={0} />
      </AnalysisSection> : null}

      {hasInputTokens ? <AnalysisSection eyebrow="Context consumption" title="Input tokens per checkpoint" description="Average number of input tokens processed across all model calls used to produce one forecast." note="Includes repeated context and, for sequential runs, carried notebook context">
        <GroupedRunChart runs={runs} metric="avgInputTokens" format="compact" minValue={0} />
      </AnalysisSection> : null}

      {hasOutputTokens ? <AnalysisSection eyebrow="Response generation" title="Output tokens per checkpoint" description="Average output tokens generated across the agent loop for one forecast checkpoint." note="Visible and reasoning-token accounting depends on the model provider">
        <GroupedRunChart runs={runs} metric="avgOutputTokens" format="compact" minValue={0} />
      </AnalysisSection> : null}

      {hasLatency ? <AnalysisSection eyebrow="Execution profile" title="Model processing time per checkpoint" description="Average accumulated model-call latency required to complete one forecast checkpoint." note="Tool latency is tracked separately and is not included here">
        <GroupedRunChart runs={runs} metric="avgModelLatencySeconds" format="duration" minValue={0} />
      </AnalysisSection> : null}

      {analysis?.research?.dynamics.length ? <AnalysisSection eyebrow="Forecast evolution" title="How sequential beliefs move through time" description="Excess movement and lead time summarize how sequential forecasts update as resolution approaches." note="Excess movement describes updating conditional on the eventual outcome; its sign alone is not a test of rationality.">
        <DynamicsChart rows={analysis.research.dynamics} />
      </AnalysisSection> : null}

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

function QuestionDetailPage({ item, questions, browseState, manifest }: { item: QuestionIndexItem; questions: QuestionIndexItem[]; browseState: QuestionBrowseState; manifest: Manifest }) {
  const [detail, setDetail] = useState<QuestionDetail | null>(null)
  const [rows, setRows] = useState<TrajectoryRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [trajectoryError, setTrajectoryError] = useState<string | null>(null)
  const [trajectoryLoading, setTrajectoryLoading] = useState(item.split === 'eval')
  const [processState, setProcessState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const [processError, setProcessError] = useState<string | null>(null)
  const [runId, setRunId] = useState('')
  const [repeat, setRepeat] = useState('0')

  useEffect(() => {
    setDetail(null)
    setRows([])
    setError(null)
    setTrajectoryError(null)
    setTrajectoryLoading(item.split === 'eval')
    setProcessState('idle')
    setProcessError(null)
    setRunId('')
    setRepeat('0')
    loadQuestion(item)
      .then(setDetail)
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Unable to load this question.'))
    loadTrajectories(item, manifest)
      .then(setRows)
      .catch((loadError: unknown) => setTrajectoryError(loadError instanceof Error ? loadError.message : 'Unable to load forecast trajectories.'))
      .finally(() => setTrajectoryLoading(false))
  }, [item, manifest])

  const runGroups = useMemo(() => {
    const groups = new Map<string, TrajectoryRow[]>()
    for (const row of rows) groups.set(row.runId, [...(groups.get(row.runId) ?? []), row])
    return [...groups.entries()]
      .map(([id, values]) => ({ id, rows: values.sort((a, b) => a.rolloutIndex - b.rolloutIndex || a.stepIndex - b.stepIndex), first: values[0] }))
      .sort((a, b) => `${a.first.modelName}:${a.first.mode}`.localeCompare(`${b.first.modelName}:${b.first.mode}`))
  }, [rows])

  useEffect(() => {
    if (runGroups.length && !runGroups.some((group) => group.id === runId)) setRunId(runGroups[0].id)
  }, [runGroups, runId])

  if (error) return <DataError message={error} />
  if (!detail) return <LoadingPage label="Loading question…" />
  const selectedRun = runGroups.find((group) => group.id === runId) ?? null
  const availableRepeats = selectedRun ? [...new Set(selectedRun.rows.map((row) => row.rolloutIndex))].sort((a, b) => a - b) : []
  const selectedRepeat = repeat === 'average' || availableRepeats.includes(Number(repeat)) ? repeat : String(availableRepeats[0] ?? 0)
  const selected = selectedRun ? { ...selectedRun, rows: selectedRepeat === 'average' ? averageRepeats(selectedRun.rows) : selectedRun.rows.filter(row => row.rolloutIndex === Number(selectedRepeat)) } : null
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
        <div className="detail-meta-grid">
          <Stat value={detail.resolvedLabel || '—'} label="resolved outcome" />
          <Stat value={number(detail.checkpointCount)} label="forecast checkpoints" />
          <Stat value={shortDate(detail.firstForecastDate)} label="first forecast" />
          <Stat value={shortDate(detail.lastForecastDate)} label="last forecast" />
        </div>
      </section>

      <section className="detail-layout section-rule">
        <aside className="question-context">
          <p className="eyebrow">Question record</p>
          {detail.body ? <details><summary>Full resolution criteria</summary><p>{detail.body}</p></details> : <p>No additional resolution criteria were published.</p>}
          {detail.options.length ? <div className="option-block"><h3>Outcomes</h3><div className="tag-list">{detail.options.map((option) => <span key={option} className={option === detail.resolvedLabel ? 'resolved' : ''}>{option}</span>)}</div></div> : null}
          <dl className="metadata-list"><div><dt>Question ID</dt><dd>{detail.id}</dd></div><div><dt>Start</dt><dd>{shortDate(detail.startDate)}</dd></div><div><dt>Close</dt><dd>{shortDate(detail.closeDate)}</dd></div></dl>
        </aside>

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
          {selectedRun && availableRepeats.length > 1 ? <div className="repeat-controls">
            <label className="select-field repeat-select"><span>Repeat</span><select aria-label="Forecast repeat" value={selectedRepeat} onChange={(event) => setRepeat(event.target.value)}>{availableRepeats.map((value) => <option key={value} value={value}>Repeat {value + 1}</option>)}<option value="average">Average of available repeats</option></select></label>
            <p>Four independent executions expose variability. Choose one repeat to inspect its notebook, or average them for a combined probability trajectory.</p>
          </div> : null}
          {trajectoryLoading ? <div className="remote-state"><strong>Loading model trajectories…</strong><p>The question record is already available; forecast data is arriving from Hugging Face.</p></div> : null}
          {trajectoryError ? <div className="remote-state error" role="alert"><strong>Model trajectories are temporarily unavailable.</strong><p>{trajectoryError}</p>{manifest.huggingFace ? <a href={manifest.huggingFace.datasetUrl} target="_blank" rel="noreferrer">Open the Forecast Dojo dataset ↗</a> : null}</div> : null}
          {selected ? (
            <>
              <p className="run-context"><span>{sourceLabel(selected.first.sourceType)}</span><span>{modeLabel(selected.first.mode)}</span><span>{retrievalLabel(selected.first.retrieval)}</span><span>{selected.first.protocol ?? 'Published run'}</span></p>
              <p className="repeat-note">{selectedRepeat === 'average' ? 'Average probability distribution across available usable repeats. Scores are recalculated for the averaged forecast; contributing repeat counts appear at each checkpoint.' : `Repeat ${Number(selectedRepeat)+1} · ${selected.rows.length} of ${detail.forecastDates.length} expected checkpoints recorded.`}</p>
              {!selected.rows.length ? <p className="empty-state">No forecast records are available for this repeat.</p> : null}
              <ProbabilityTrajectoryChart rows={selected.rows} fallbackDates={detail.forecastDates} outcome={detail.resolvedLabel} />
              <div className="trajectory-summary"><SummaryCard label="Mean Brier" value={formatMetric(meanBrier, 'brier')} meta={selectedRepeat === 'average' ? 'Scores of averaged forecasts' : 'Selected repeat trajectory'} tone="model" /><SummaryCard label="Mean information alpha" value={formatMetric(meanInfo, 'infoAlpha')} meta={`${sourceLabel(selected.first.sourceType)} · ${modeLabel(selected.first.mode)}`} tone={selected.first.sourceType} /></div>
              <div className="trajectory-list">{selected.rows.map((row, index) => <TrajectoryPoint key={`${row.runId}-${row.stepIndex}-${index}`} row={row} fallbackDate={detail.forecastDates[row.stepIndex]} />)}</div>
              {selectedRepeat !== 'average' && selected.rows.some(hasCheckpointTelemetry) ? <CheckpointActivity rows={selected.rows} fallbackDates={detail.forecastDates} processState={processState} processError={processError} onLoadProcess={loadProcess} datasetUrl={manifest.huggingFace?.datasetUrl} /> : null}
            </>
          ) : !trajectoryLoading && !trajectoryError ? <div className="empty-state"><h3>No evaluation model results for this question.</h3><p>{item.split === 'train' ? 'This is a training-set question; published model evaluations currently use the evaluation split.' : 'No forecast rows were recorded for this evaluation question.'}</p></div> : null}
        </div>
      </section>
    </>
  )
}

function MethodPage({ manifest }: { manifest: Manifest }) {
  return (
    <>
      <PageIntro eyebrow="Method" title="A time-bounded test of machine forecasting" copy="The benchmark asks whether models can produce better-calibrated probability forecasts than the prediction-market crowd when both are observed at the same historical moment." />
      <section className="method-page-grid section-rule">
        <article><span>01</span><h2>Questions</h2><p>The public release contains {number(manifest.questionCount)} resolved questions and {number(manifest.checkpointCount)} dated forecasting checkpoints. Both binary and multi-option questions are retained.</p></article>
        <article><span>02</span><h2>Information</h2><p>At each checkpoint, retrieval is bounded by date. Models can search the CC-News collection only for articles that existed by that forecast date, preventing future information leakage.</p></article>
        <article><span>03</span><h2>Forecasts</h2><p>Each model returns a probability distribution over outcomes. The website publishes probabilities, forecast dates, resolution outcomes, metrics, model source category, mode, and run metadata.</p></article>
        <article><span>04</span><h2>Comparison</h2><p>The primary baseline is the contemporaneous market probability, treated as collective human judgment. Accuracy is the headline comparison; Brier score and information alpha show calibration and crowd-relative quality.</p></article>
      </section>
      <section className="method-definitions section-rule" id="metrics">
        <div className="analysis-heading"><div><p className="eyebrow">Metric definitions</p><h2>Three views of forecast quality</h2></div><p>No single metric captures discrimination, calibration, and market-relative information at once.</p></div>
        <div className="definition-grid"><article><span>Accuracy</span><h3>Was the most likely outcome correct?</h3><p>The share of scored checkpoints where the outcome with the highest model probability was the outcome that resolved. Higher is better.</p></article><article><span>Brier score</span><h3>Were the probabilities well calibrated?</h3><p>Mean squared error across the complete probability distribution. Confident errors are penalized more heavily. Lower is better.</p></article><article><span>Information alpha</span><h3>Did the model add information beyond the crowd?</h3><p>A crowd-relative information measure. Zero is the market baseline; positive values indicate improvement over the contemporaneous crowd.</p></article></div>
      </section>
      <section className="method-comparison section-rule" id="memory">
        <div><p className="eyebrow">Secondary comparison</p><h2>Independent versus sequential forecasting</h2><p>This tests forecast memory, not access to retrieval: both modes receive the same date-bounded news access.</p></div>
        <div className="mode-columns"><article><h3>Independent</h3><p>Every checkpoint starts from a clean context. The model cannot see the probability, evidence, or working notes it produced previously.</p></article><article><h3>Sequential</h3><p>The next checkpoint includes the model’s compact belief notebook from the previous one, allowing its prior work to accumulate through time.</p></article></div>
      </section>
      <section className="method-definitions section-rule" id="uncertainty">
        <div className="analysis-heading"><div><p className="eyebrow">Coverage and uncertainty</p><h2>Repeated checkpoints are not independent</h2></div><p>Forecasts from the same question share topic, outcome, and information history.</p></div>
        <div className="definition-grid"><article><span>Confidence intervals</span><h3>Bootstrap whole questions</h3><p>The website resamples questions rather than individual checkpoints, then recomputes each metric over 1,000 bootstrap samples to form a 95% percentile interval.</p></article><article><span>Coverage</span><h3>Show what was actually recorded</h3><p>Coverage is observed forecast rows divided by expected rows. Partial runs remain visible and are explicitly marked rather than silently dropped.</p></article><article><span>Invalid and missing</span><h3>Keep the distinction visible</h3><p>Invalid recorded answers retain their evaluation failure score. Expected rows that were never recorded are reported as missing and are not imputed.</p></article></div>
      </section>
      <section className="method-comparison section-rule" id="notebooks">
        <div><p className="eyebrow">Belief notebook protocol</p><h2>Inspect forecast memory without bloating the site</h2><p>The notebook is a compact structured state carried only between sequential checkpoints. It is distinct from hidden chain-of-thought and from the final probability distribution.</p></div>
        <div className="mode-columns"><article><h3>Structural measurements</h3><p>The site reports format validity, notebook length, block count, and the checkpoint to which each notebook belongs.</p></article><article><h3>On-demand contents</h3><p>Full published belief notebooks are stored in the public Hugging Face dataset and load only when a visitor requests them on a question page.</p></article></div>
      </section>
      <section className="method-definitions section-rule" id="tools">
        <div className="analysis-heading"><div><p className="eyebrow">Information boundary</p><h2>Research is dated to the forecast checkpoint</h2></div><p>The model can search the CC-News corpus, scrape retrieved records, and use Python only within the experiment’s allowed tools.</p></div>
        <div className="definition-grid"><article><span>Retrieval</span><h3>No future news</h3><p>Search results are bounded to documents available on or before the checkpoint date to prevent resolution leakage.</p></article><article><span>Efficiency</span><h3>Normalize by checkpoint</h3><p>Tool calls, tokens, latency, and recorded cost are reported per checkpoint so runs with different coverage remain comparable.</p></article><article><span>Public telemetry</span><h3>Counts, outcomes, and timing</h3><p>Tool records show the tool kind, calls, successes, errors, parse errors, and latency. Queries and retrieved article text are not included.</p></article></div>
      </section>
      <section className="public-boundary section-rule"><div><p className="eyebrow">Public data boundary</p><h2>What the project publishes</h2><p>GitHub Pages carries the small index and chart summaries. Hugging Face carries the larger research records that are fetched only when needed.</p></div><div className="boundary-columns"><article><h3>Included</h3><ul><li>Questions and resolution metadata</li><li>Model and crowd probabilities</li><li>Forecast dates, metrics, intervals, and coverage</li><li>Tool counts, outcomes, tokens, cost, and latency</li><li>Published belief notebooks and integrity fields</li></ul></article><article><h3>Not included</h3><ul><li>Hidden chain-of-thought or full raw responses</li><li>The 20-million-article CC-News corpus</li><li>Search queries, retrieval indexes, or article text</li><li>System prompts, credentials, or provider logs</li><li>Internal infrastructure configuration</li></ul></article></div></section>
    </>
  )
}

function PageIntro({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return <section className="page-intro section-rule"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{copy}</p></section>
}

function Stat({ value, label }: { value: string; label: string }) {
  return <article><span className="stat-value">{value}</span><span className="stat-label">{label}</span></article>
}

function BreakdownMatrix({ runs, keys, field, metric }: { runs: RunAnalysis[]; keys: Array<{ key: string; label: string }>; field: 'byDomain' | 'byHorizon' | 'byQuestionType'; metric: Metric }) {
  const orderedRuns = [...runs].sort((a, b) => (b.overall.accuracy ?? Number.NEGATIVE_INFINITY) - (a.overall.accuracy ?? Number.NEGATIVE_INFINITY))
  const values = orderedRuns.flatMap((run) => run[field].map((cell) => cell[metric]).filter(isFiniteNumber))
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
      <figcaption>Color intensity is normalized within this visualization; rely on the printed values for comparisons. <a href={releaseHref('#/method#uncertainty')}>Coverage and uncertainty</a></figcaption>
    </figure>
  )
}

function PairedModeChart({ comparisons }: { comparisons: PairedModeComparison[] }) {
  return (
    <figure className="paired-mode-chart">
      {comparisons.map((comparison) => (
        <article className="paired-mode-row" key={comparison.modelName}>
          <div className="paired-mode-identity"><strong>{shortModelName(comparison.modelName)}</strong><span>{sourceLabel(comparison.sourceType)} · {number(comparison.nMatched)} matched checkpoints</span></div>
          <div className="paired-mode-metrics">
            <DifferenceCell label="Accuracy Δ" value={comparison.accuracyDifference} format="points" favorable={(comparison.accuracyDifference ?? 0) > 0} interval={comparison.intervals.accuracyDifference} />
            <DifferenceCell label="Brier Δ" value={comparison.brierDifference} format="decimal" favorable={(comparison.brierDifference ?? 0) < 0} interval={comparison.intervals.brierDifference} />
            <DifferenceCell label="Information α Δ" value={comparison.infoAlphaDifference} format="decimal" favorable={(comparison.infoAlphaDifference ?? 0) > 0} interval={comparison.intervals.infoAlphaDifference} />
            <DifferenceCell label="Sequential lower Brier" value={comparison.sequentialWinRate} format="percent" favorable={(comparison.sequentialWinRate ?? 0) > 0.5} />
          </div>
        </article>
      ))}
      <figcaption>Paired intervals are clustered by question. These differences measure the effect of forecast memory within each model family. <a href={releaseHref('#/method#memory')}>Protocol details</a></figcaption>
    </figure>
  )
}

function RecencyEffectChart({ comparisons }: { comparisons: RecencyComparison[] }) {
  const ordered = [...comparisons].sort((a, b) => a.brierDifference - b.brierDifference)
  const scale = Math.max(0.001, ...ordered.map((row) => Math.abs(row.brierDifference)))
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

function ConsistencyChart({ rows }: { rows: ConsistencySummary[] }) {
  const ordered = [...rows].sort((a, b) => b.ensembleGain - a.ensembleGain)
  const scale = Math.max(0.001, ...ordered.map((row) => Math.abs(row.ensembleGain)))
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

function DynamicsChart({ rows }: { rows: DynamicsSummary[] }) {
  const ordered = [...rows].sort((a, b) => a.excessMovement - b.excessMovement)
  const scale = Math.max(0.001, ...ordered.flatMap((row) => [Math.abs(row.excessMovement), Math.abs(row.interval.lower ?? 0), Math.abs(row.interval.upper ?? 0)]))
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
type AccuracyRetrievalFilter = 'all' | 'baseline' | 'recency'
type AccuracyReleaseFilter = 'all' | 'current' | 'historical'

function MetricLeaderboardChart({ runs, baseline, metric }: { runs: RunSummary[]; baseline: number | null; metric: Metric }) {
  const groups = useMemo(() => groupRuns(runs)
    .filter((group) => group.runs.some((run) => isFiniteNumber(run[metric])))
    .sort((a, b) => compareGroupMetric(a, b, metric)), [runs, metric])
  const defaults = useMemo(() => defaultMetricGroupIds(groups, metric), [groups, metric])
  const [selectedIds, setSelectedIds] = useState<string[]>(defaults)
  const [modelSearch, setModelSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<AccuracySourceFilter>('all')
  const [retrievalFilter, setRetrievalFilter] = useState<AccuracyRetrievalFilter>('all')
  const [releaseFilter, setReleaseFilter] = useState<AccuracyReleaseFilter>('all')
  const [providerFilter, setProviderFilter] = useState('all')
  const [labelSize, setLabelSize] = useState(8)
  const [showBarValues, setShowBarValues] = useState(metric !== 'infoAlpha')
  const [showGridlines, setShowGridlines] = useState(true)
  const [showCrowdLine, setShowCrowdLine] = useState(true)
  const selected = groups.filter((group) => selectedIds.includes(group.id))
  const searchResults = groups.filter((group) => {
    const provider = providerForGroup(group)
    const haystack = `${group.modelName} ${provider?.name ?? ''} ${group.runs[0]?.baseModel ?? ''}`.toLowerCase()
    return haystack.includes(modelSearch.trim().toLowerCase())
  })
  const visibleGroups = selected.filter((group) => {
    const provider = providerForGroup(group)
    const retrieval = isRecencyGroup(group) ? 'recency' : 'baseline'
    const release = isHistoricalGroup(group) ? 'historical' : 'current'
    return (sourceFilter === 'all' || group.sourceType === sourceFilter)
      && (retrievalFilter === 'all' || retrieval === retrievalFilter)
      && (releaseFilter === 'all' || release === releaseFilter)
      && (providerFilter === 'all' || provider?.name === providerFilter)
  })
  const activeFilterCount = [sourceFilter, retrievalFilter, releaseFilter, providerFilter].filter((value) => value !== 'all').length
  const values = groups.flatMap((group) => group.runs.flatMap((run) => isFiniteNumber(run[metric]) ? [run[metric]] : []))
  const { domainMin, domainMax, axisTicks } = leaderboardDomain(metric, values, baseline)
  const position = (value: number) => Math.max(0, Math.min(100, ((value - domainMin) / (domainMax - domainMin)) * 100))
  const canvasWidth = Math.max(420, visibleGroups.length * 60 + 96)
  const controlName = `${metric}-chart-controls`
  const filterTitleId = `${metric}-filter-title`
  const displayTitleId = `${metric}-display-title`
  const modes: Array<Exclude<ForecastMode, 'unknown'>> = ['independent', 'sequential']

  const toggleModel = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id])
  }

  const resetFilters = () => {
    setSourceFilter('all')
    setRetrievalFilter('all')
    setReleaseFilter('all')
    setProviderFilter('all')
  }

  const resetDisplay = () => {
    setLabelSize(8)
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
    if (retrievalFilter !== 'all') {
      const matching = candidates.filter((group) => (isRecencyGroup(group) ? 'recency' : 'baseline') === retrievalFilter)
      if (matching.length) candidates = matching
      else setRetrievalFilter('all')
    }
    if (releaseFilter !== 'all') {
      const matching = candidates.filter((group) => (isHistoricalGroup(group) ? 'historical' : 'current') === releaseFilter)
      if (!matching.length) setReleaseFilter('all')
    }
  }

  return (
    <figure className={`accuracy-leaderboard metric-${metric}`}>
      <div className="accuracy-leaderboard-toolbar">
        <div className="accuracy-mode-legend" aria-label="Forecasting modes">
          <span><i className="independent" />Independent</span>
          <span><i className="sequential" />Sequential</span>
          {baseline == null || !showCrowdLine ? null : <span><i className="crowd" />Crowd · {formatLeaderboardValue(metric, baseline)}</span>}
        </div>
        <div className="accuracy-chart-actions">
          <details className="accuracy-model-picker" name={controlName}>
            <summary><span aria-hidden="true">＋</span> Add models <small>{selected.length}/{groups.length}</small></summary>
            <div className="accuracy-model-picker-panel">
              <label className="accuracy-model-search"><span className="sr-only">Search models</span><input type="search" value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="Search models or providers…" /></label>
              <div className="accuracy-model-options" role="group" aria-label={`Models shown in the ${metricDetails[metric].label} chart`}>
                {searchResults.map((group) => {
                  const provider = providerForGroup(group)
                  return <label key={group.id}><input type="checkbox" checked={selectedIds.includes(group.id)} onChange={() => toggleModel(group.id)} /><span><strong>{group.modelName}</strong><small>{provider?.name ?? sourceLabel(group.sourceType)} · {retrievalLabel(group.runs[0]?.retrieval)}</small></span></label>
                })}
                {!searchResults.length ? <p>No matching models.</p> : null}
              </div>
              <div className="accuracy-model-picker-actions"><button type="button" onClick={() => setSelectedIds(defaults)}>Reset default</button><button type="button" onClick={() => setSelectedIds(groups.map((group) => group.id))}>Select all</button></div>
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
              <AccuracyChoiceGroup name={`${metric}-retrieval`} label="Retrieval" value={retrievalFilter} onChange={(value) => setRetrievalFilter(value as AccuracyRetrievalFilter)} options={[
                { value: 'all', label: 'All retrieval strategies' },
                { value: 'baseline', label: 'Baseline retrieval' },
                { value: 'recency', label: 'Recency weighted' },
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
              <label className="accuracy-label-slider"><span>Model label size <output>{labelSize}px</output></span><input type="range" min="8" max="12" step="1" value={labelSize} onChange={(event) => setLabelSize(Number(event.target.value))} /></label>
              <AccuracyToggle label="Values on bars" checked={showBarValues} onChange={setShowBarValues} />
              <AccuracyToggle label="Gridlines" checked={showGridlines} onChange={setShowGridlines} />
              <AccuracyToggle label="Crowd benchmark" checked={showCrowdLine} onChange={setShowCrowdLine} disabled={baseline == null} />
              <button className="accuracy-control-reset" type="button" onClick={resetDisplay}>Reset display</button>
            </div>
          </details>
        </div>
      </div>

      {!visibleGroups.length ? <div className="accuracy-empty" aria-live="polite"><strong>{selected.length ? 'No selected models match.' : 'No models selected.'}</strong><span>{selected.length ? 'Change or reset the chart filters.' : 'Use “Add models” to choose one or more model conditions.'}</span></div> : (
        <div className="accuracy-chart-scroll" tabIndex={0} aria-label={`Scrollable model ${metricDetails[metric].label.toLowerCase()} chart`}>
          <div className="accuracy-chart-canvas" style={{ minWidth: `${canvasWidth}px`, '--accuracy-label-size': `${labelSize}px` } as React.CSSProperties}>
            <div className="accuracy-y-axis" aria-hidden="true">
              {axisTicks.map((tick) => <span key={tick} style={{ bottom: `${position(tick)}%` }}>{formatLeaderboardTick(metric, tick)}</span>)}
            </div>
            <div className="accuracy-plot-field">
              {showGridlines ? axisTicks.map((tick) => <i key={tick} className="accuracy-gridline" style={{ bottom: `${position(tick)}%` }} />) : null}
              {baseline == null || !showCrowdLine ? null : <div className="accuracy-crowd-line" style={{ bottom: `${position(baseline)}%` }}><span>Crowd {formatLeaderboardValue(metric, baseline)}</span></div>}
              <div className="accuracy-model-groups">
                {visibleGroups.map((group) => {
                  const provider = providerForGroup(group)
                  const chartStyle = { '--provider-color': provider?.color ?? '#887566' } as React.CSSProperties
                  return (
                    <article className="accuracy-model-group" key={group.id} style={chartStyle}>
                      <div className="accuracy-bar-pair">
                        {modes.map((mode) => {
                          const run = group.runs.find((candidate) => candidate.mode === mode)
                          const value = run?.[metric]
                          if (!run || !isFiniteNumber(value)) return <div className={`accuracy-bar-slot ${mode} no-value`} key={mode}><span>—</span></div>
                          const valuePosition = position(value)
                          const originPosition = position(metric === 'infoAlpha' ? 0 : domainMin)
                          const barBottom = Math.min(valuePosition, originPosition)
                          const barHeight = Math.max(0.7, Math.abs(valuePosition - originPosition))
                          const isNegative = valuePosition < originPosition
                          const displayValue = formatLeaderboardValue(metric, value)
                          const tooltip = `${group.modelName} · ${modeLabel(mode)} · ${displayValue} ${metricDetails[metric].label.toLowerCase()} · ${percent(run.coverage, 0)} coverage · ${metricDetails[metric].direction.toLowerCase()}`
                          return (
                            <div className={`accuracy-bar-slot ${mode}`} key={mode} tabIndex={0} role="img" aria-label={tooltip}>
                              <div className={`accuracy-vertical-bar${isNegative ? ' negative' : ''}`} style={{ bottom: `${barBottom}%`, height: `${barHeight}%` }}>{showBarValues ? <strong>{displayValue}</strong> : null}</div>
                              <span className="accuracy-bar-tooltip"><small>{modeLabel(mode)}</small><strong>{displayValue}</strong><span>{percent(run.coverage, 0)} coverage</span></span>
                            </div>
                          )
                        })}
                      </div>
                      <div className="accuracy-model-label" title={group.modelName}><i /><span>{compactLeaderboardName(group.modelName)}</span></div>
                    </article>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}
      <figcaption aria-live="polite">Showing {visibleGroups.length} of {selected.length} selected model conditions{activeFilterCount ? ` · ${activeFilterCount} active filter${activeFilterCount === 1 ? '' : 's'}` : ''}.</figcaption>
    </figure>
  )
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

function GroupedRunChart({ runs, metric, format, baseline = null, baselineLabel = '', minValue, maxValue, compact = false }: { runs: RunSummary[]; metric: RunChartMetric; format: ChartValueFormat; baseline?: number | null; baselineLabel?: string; minValue?: number; maxValue?: number; compact?: boolean }) {
  const allGroups = groupRuns(runs)
  const groups = compact ? allGroups.slice(0, 8) : allGroups
  const visibleRuns = groups.flatMap((group) => group.runs)
  const metricValues = visibleRuns.map((run) => run[metric]).filter(isFiniteNumber)
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
  const modes: Array<Exclude<ForecastMode, 'unknown'>> = ['independent', 'sequential']

  return (
    <figure className={`grouped-run-chart${compact ? ' compact' : ''}`}>
      <div className="run-chart-legend" aria-hidden="true"><span><i className="independent" />Independent</span><span><i className="sequential" />Sequential</span>{baselinePosition == null ? null : <span><i className="crowd" />{baselineLabel} · {formatChartValue(baseline, format)}</span>}</div>
      <div className="run-chart-scale" aria-hidden="true"><span>{formatChartValue(domainMin, format)}</span><span>{formatChartValue(domainMax, format)}</span></div>
      <div className="run-chart-groups">
        {groups.map((group) => (
          <article className="run-chart-group" key={group.modelName}>
            <div className="run-chart-label"><strong>{shortModelName(group.modelName)}</strong><span>{sourceLabel(group.sourceType)} · {group.runs[0]?.protocol ?? 'Published run'}</span></div>
            <div className="run-chart-bars">
              {modes.map((mode) => {
                const run = group.runs.find((candidate) => candidate.mode === mode)
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
      {compact && allGroups.length > groups.length ? <figcaption>Showing the eight highest-accuracy model conditions. All {allGroups.length} appear on the Results page.</figcaption> : null}
    </figure>
  )
}

function ToolMixChart({ runs }: { runs: RunSummary[] }) {
  const orderedRuns = groupRuns(runs).flatMap((group) => ['independent', 'sequential'].map((mode) => group.runs.find((run) => run.mode === mode)).filter((run): run is RunSummary => Boolean(run)))
  const maximum = Math.max(1, ...orderedRuns.map((run) => run.avgToolCalls ?? 0))
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
      {row.repeatCount != null ? <div className="point-score"><span>Repeats used</span><strong>{row.repeatCount} / 4</strong></div> : null}
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
              <div className="checkpoint-activity-head"><span>t{row.stepIndex + 1}</span><strong>{compactDate(row.forecastDate ?? fallbackDates[row.stepIndex] ?? null)}</strong></div>
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
    const id = run.id.split('.forecast_eval.')[0] || run.modelName
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

function baseModelForGroup(group: RunGroup) {
  return (group.runs[0]?.baseModel ?? group.modelName).toLowerCase().replace(/^models\//, '')
}

function providerForGroup(group: RunGroup): ModelProvider | undefined {
  const baseModel = baseModelForGroup(group)
  return modelProviders.find((provider) => provider.match.test(baseModel))
}

function isRecencyGroup(group: RunGroup) {
  const retrieval = group.runs[0]?.retrieval?.toLowerCase()
  return retrieval === 'rec70' || retrieval === 'recency'
}

function isHistoricalGroup(group: RunGroup) {
  return group.runs[0]?.protocol?.toLowerCase().includes('historical') ?? false
}

function defaultMetricGroupIds(groups: RunGroup[], metric: Metric) {
  const ranked = [...groups].sort((a, b) => compareGroupMetric(a, b, metric))
  const selected = new Set(ranked.slice(0, 7).map((group) => group.id))
  for (const provider of modelProviders) {
    const hasLatestFamily = ranked.some((group) => selected.has(group.id) && baseModelForGroup(group).startsWith(provider.latestFamily))
    if (hasLatestFamily) continue
    const latestConditions = ranked.filter((group) => baseModelForGroup(group).startsWith(provider.latestFamily))
    const preferred = [...latestConditions].sort((a, b) => {
      const scoreDifference = compareGroupMetric(a, b, metric)
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
