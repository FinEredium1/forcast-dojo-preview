import { useEffect, useMemo, useState } from 'react'
import { loadManifest, loadQuestion, loadQuestionIndex, loadRunSummaries, loadTrajectories } from './data'
import type { ForecastMode, Manifest, QuestionDetail, QuestionIndexItem, RunSummary, SourceType, TrajectoryRow } from './types'

type CommonData = {
  manifest: Manifest | null
  questions: QuestionIndexItem[]
  runs: RunSummary[]
  error: string | null
}

type SourceFilter = 'all' | SourceType
type ModeFilter = 'all' | Exclude<ForecastMode, 'unknown'>
type Metric = 'brier' | 'accuracy' | 'infoAlpha'

const metricDetails: Record<Metric, { label: string; direction: string; decimals: number }> = {
  brier: { label: 'Brier score', direction: 'Lower is better', decimals: 3 },
  accuracy: { label: 'Accuracy', direction: 'Higher is better', decimals: 1 },
  infoAlpha: { label: 'Information alpha', direction: 'Higher is better', decimals: 3 },
}

function BenchmarkApp() {
  const route = useHashRoute()
  const [data, setData] = useState<CommonData>({ manifest: null, questions: [], runs: [], error: null })

  useEffect(() => {
    Promise.all([loadManifest(), loadQuestionIndex(), loadRunSummaries()])
      .then(([manifest, questions, runs]) => setData({ manifest, questions, runs, error: null }))
      .catch((error: unknown) => setData({
        manifest: null,
        questions: [],
        runs: [],
        error: error instanceof Error ? error.message : 'Unable to load this release.',
      }))
  }, [])

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [route])

  const section = route.startsWith('/results')
    ? 'results'
    : route.startsWith('/questions')
      ? 'questions'
      : route.startsWith('/method')
        ? 'method'
        : 'overview'

  const content = (() => {
    if (data.error) return <DataError message={data.error} />
    if (!data.manifest) return <LoadingPage />
    if (route.startsWith('/questions/')) {
      const id = decodeURIComponent(route.slice('/questions/'.length))
      const item = data.questions.find((candidate) => candidate.id === id)
      return item ? <QuestionDetailPage item={item} /> : <NotFoundPage />
    }
    if (section === 'results') return <ResultsPage manifest={data.manifest} runs={data.runs} />
    if (section === 'questions') return <QuestionsPage questions={data.questions} manifest={data.manifest} />
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
      <a className="wordmark" href="#/overview" aria-label="Forecast Dojo overview">
        <span className="wordmark-mark" aria-hidden="true">⌁</span><span>Forecast Dojo</span>
      </a>
      <nav className="site-nav" aria-label="Primary navigation">
        {[
          ['overview', 'Overview'],
          ['results', 'Results'],
          ['questions', 'Questions'],
          ['method', 'Method'],
        ].map(([key, label]) => <a key={key} className={active === key ? 'active' : ''} href={`#/${key}`}>{label}</a>)}
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
  const bestRuns = [...runs].filter((run) => run.brier != null).sort((a, b) => (a.brier ?? 1) - (b.brier ?? 1)).slice(0, 3)

  return (
    <>
      <section className="hero section-rule">
        <p className="eyebrow">A longitudinal forecasting benchmark</p>
        <h1>Can LLM reasoning outperform human collective judgment in forecasting?</h1>
        <p className="hero-copy">
          We compare model probability forecasts with the prediction-market crowd at the same points in time.
          Every model receives only news available by that forecast date, then updates repeatedly until resolution.
        </p>
        <div className="hero-actions">
          <a className="button button-primary" href="#/results">Explore results</a>
          <a className="button button-secondary" href="#/questions">Browse questions</a>
        </div>
      </section>

      <section className="stat-grid section-rule" aria-label="Benchmark scope">
        <Stat value={number(manifest.questionCount)} label="forecasting questions" />
        <Stat value={number(manifest.checkpointCount)} label="dated checkpoints" />
        <Stat value={number(manifest.resultRunCount)} label="model runs published" />
        <Stat value="Monthly" label="versioned releases" />
      </section>

      <section className="comparison section-rule">
        <div className="section-heading">
          <p className="eyebrow">The central comparison</p>
          <h2>Models against the crowd, date by date</h2>
          <p>The crowd probability is our operational measure of collective human judgment. Lower Brier scores indicate forecasts that assign more probability to what ultimately happened.</p>
        </div>
        <div className="score-card" aria-label="Brier score preview">
          <div className="score-card-head"><span>Brier score</span><span>Lower is better</span></div>
          <ScoreRow label={manifest.crowd.name} meta="Human baseline" value={manifest.crowd.brier} tone="crowd" />
          {bestRuns.map((run) => <ScoreRow key={run.id} label={run.modelName} meta={`${sourceLabel(run.sourceType)} · ${modeLabel(run.mode)}`} value={run.brier} tone="model" />)}
        </div>
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

function ResultsPage({ manifest, runs }: { manifest: Manifest; runs: RunSummary[] }) {
  const [source, setSource] = useState<SourceFilter>('all')
  const [mode, setMode] = useState<ModeFilter>('all')
  const [metric, setMetric] = useState<Metric>('brier')
  const filtered = useMemo(() => {
    return runs
      .filter((run) => source === 'all' || run.sourceType === source)
      .filter((run) => mode === 'all' || run.mode === mode)
      .sort((a, b) => compareMetric(a, b, metric))
  }, [runs, source, mode, metric])
  const bestOpen = bestByMetric(runs.filter((run) => run.sourceType === 'open'), metric)
  const bestClosed = bestByMetric(runs.filter((run) => run.sourceType === 'closed'), metric)
  const crowdValue = crowdMetric(manifest, metric)

  return (
    <>
      <PageIntro eyebrow="Benchmark results" title="Which forecasts beat the crowd?" copy="Filter the model runs by availability and forecast memory. The contemporaneous crowd baseline always remains visible so every comparison keeps the paper’s main question in view." />

      <section className="filter-panel section-rule" aria-label="Results filters">
        <FilterGroup label="Model source">
          <Segmented value={source} onChange={(value) => setSource(value as SourceFilter)} options={[['all', 'All models'], ['open', 'Open-source'], ['closed', 'Closed-source']]} />
        </FilterGroup>
        <FilterGroup label="Forecast mode">
          <Segmented value={mode} onChange={(value) => setMode(value as ModeFilter)} options={[['all', 'Both'], ['sequential', 'Sequential'], ['independent', 'Independent']]} />
        </FilterGroup>
        <label className="select-field"><span>Metric</span><select value={metric} onChange={(event) => setMetric(event.target.value as Metric)}><option value="brier">Brier score</option><option value="accuracy">Accuracy</option><option value="infoAlpha">Information alpha</option></select></label>
      </section>

      <section className="result-summary-grid section-rule" aria-label="Result summary">
        <SummaryCard label="Crowd baseline" value={formatMetric(crowdValue, metric)} meta={metricDetails[metric].direction} tone="crowd" />
        <SummaryCard label="Best open-source run" value={formatMetric(bestOpen?.[metric], metric)} meta={bestOpen ? `${bestOpen.modelName} · ${modeLabel(bestOpen.mode)}` : 'No published run'} tone="open" />
        <SummaryCard label="Best closed-source run" value={formatMetric(bestClosed?.[metric], metric)} meta={bestClosed ? `${bestClosed.modelName} · ${modeLabel(bestClosed.mode)}` : 'No published run'} tone="closed" />
      </section>

      <section className="rankings section-rule">
        <div className="rankings-head"><div><p className="eyebrow">Run-level comparison</p><h2>{metricDetails[metric].label}</h2></div><p>{filtered.length} model run{filtered.length === 1 ? '' : 's'} shown · {metricDetails[metric].direction}</p></div>
        <div className="result-list">
          <ResultRow label={manifest.crowd.name} source="Human baseline" mode="Contemporaneous market" value={crowdValue} metric={metric} baseline={crowdValue} tone="crowd" complete />
          {filtered.map((run) => <ResultRow key={run.id} label={run.modelName} source={sourceLabel(run.sourceType)} mode={modeLabel(run.mode)} value={run[metric]} metric={metric} baseline={crowdValue} tone={run.sourceType} complete={run.complete} coverage={run.coverage} />)}
          {!filtered.length ? <div className="empty-state"><h3>No runs match these filters.</h3><p>Try including both model sources or forecast modes.</p></div> : null}
        </div>
        <p className="result-footnote">Source and mode filters apply only to model runs. The crowd is intentionally never filtered out.</p>
      </section>
    </>
  )
}

function QuestionsPage({ questions, manifest }: { questions: QuestionIndexItem[]; manifest: Manifest }) {
  const [query, setQuery] = useState('')
  const [domain, setDomain] = useState('all')
  const [split, setSplit] = useState('all')
  const [belief, setBelief] = useState('all')
  const [page, setPage] = useState(1)
  const pageSize = 48
  const domains = useMemo(() => [...new Set(questions.map((item) => item.domain))].sort(), [questions])
  const beliefs = useMemo(() => [...new Set(questions.map((item) => item.beliefKind))].sort(), [questions])
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return questions.filter((item) => {
      const matchesText = !normalized || `${item.title} ${item.id} ${item.domain}`.toLowerCase().includes(normalized)
      return matchesText && (domain === 'all' || item.domain === domain) && (split === 'all' || item.split === split) && (belief === 'all' || item.beliefKind === belief)
    })
  }, [questions, query, domain, split, belief])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  useEffect(() => setPage(1), [query, domain, split, belief])

  return (
    <>
      <PageIntro eyebrow="Question explorer" title={`Browse all ${number(manifest.questionCount)} questions`} copy="Every question can live on the static site. The compact index loads once; full details and model trajectories load only when you open a question." />
      <section className="question-filters section-rule" aria-label="Question filters">
        <label className="search-field"><span>Search</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search question text or ID" /></label>
        <label className="select-field"><span>Domain</span><select value={domain} onChange={(event) => setDomain(event.target.value)}><option value="all">All domains</option>{domains.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label>
        <label className="select-field"><span>Split</span><select value={split} onChange={(event) => setSplit(event.target.value)}><option value="all">Train + eval</option><option value="train">Train</option><option value="eval">Eval</option></select></label>
        <label className="select-field"><span>Question type</span><select value={belief} onChange={(event) => setBelief(event.target.value)}><option value="all">All types</option>{beliefs.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label>
      </section>

      <section className="question-results section-rule">
        <div className="list-meta"><p><strong>{number(filtered.length)}</strong> matching questions</p><p>Page {safePage} of {pageCount}</p></div>
        <div className="question-list">
          {visible.map((item) => <QuestionCard key={item.id} item={item} />)}
          {!visible.length ? <div className="empty-state"><h3>No questions match.</h3><p>Clear one or more filters and try again.</p></div> : null}
        </div>
        <Pagination page={safePage} count={pageCount} onChange={setPage} />
      </section>
    </>
  )
}

function QuestionDetailPage({ item }: { item: QuestionIndexItem }) {
  const [detail, setDetail] = useState<QuestionDetail | null>(null)
  const [rows, setRows] = useState<TrajectoryRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [runId, setRunId] = useState('')

  useEffect(() => {
    setDetail(null)
    setRows([])
    setError(null)
    Promise.all([loadQuestion(item), loadTrajectories(item)])
      .then(([question, trajectories]) => { setDetail(question); setRows(trajectories) })
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Unable to load this question.'))
  }, [item])

  const runGroups = useMemo(() => {
    const groups = new Map<string, TrajectoryRow[]>()
    for (const row of rows) groups.set(row.runId, [...(groups.get(row.runId) ?? []), row])
    return [...groups.entries()].map(([id, values]) => ({ id, rows: values.sort((a, b) => a.stepIndex - b.stepIndex), first: values[0] }))
  }, [rows])

  useEffect(() => {
    if (runGroups.length && !runGroups.some((group) => group.id === runId)) setRunId(runGroups[0].id)
  }, [runGroups, runId])

  if (error) return <DataError message={error} />
  if (!detail) return <LoadingPage label="Loading question…" />
  const selected = runGroups.find((group) => group.id === runId) ?? null
  const scored = selected?.rows.filter((row) => row.brier != null) ?? []
  const meanBrier = average(scored.map((row) => row.brier as number))
  const meanInfo = average(scored.flatMap((row) => row.infoAlpha == null ? [] : [row.infoAlpha]))

  return (
    <>
      <section className="detail-hero section-rule">
        <a className="back-link" href="#/questions">← All questions</a>
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
          <div className="trajectory-head"><div><p className="eyebrow">Forecast trajectory</p><h2>Probability of the resolved outcome</h2></div>{runGroups.length ? <label className="select-field run-select"><span>Model run</span><select value={runId} onChange={(event) => setRunId(event.target.value)}>{runGroups.map((group) => <option key={group.id} value={group.id}>{group.first.modelName} · {modeLabel(group.first.mode)}</option>)}</select></label> : null}</div>
          {selected ? (
            <>
              <div className="trajectory-summary"><SummaryCard label="Mean Brier" value={formatMetric(meanBrier, 'brier')} meta="Selected question trajectory" tone="model" /><SummaryCard label="Mean information alpha" value={formatMetric(meanInfo, 'infoAlpha')} meta={`${sourceLabel(selected.first.sourceType)} · ${modeLabel(selected.first.mode)}`} tone={selected.first.sourceType} /></div>
              <div className="trajectory-list">{selected.rows.map((row, index) => <TrajectoryPoint key={`${row.runId}-${row.stepIndex}-${index}`} row={row} fallbackDate={detail.forecastDates[row.stepIndex]} />)}</div>
            </>
          ) : <div className="empty-state"><h3>No model trajectory is published for this question yet.</h3><p>The question and crowd record remain available; model results can be added in a later monthly release.</p></div>}
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
        <article><span>04</span><h2>Comparison</h2><p>The primary baseline is the contemporaneous market probability, treated as collective human judgment. Brier score is primary; accuracy and information alpha provide additional views.</p></article>
      </section>
      <section className="method-comparison section-rule">
        <div><p className="eyebrow">Secondary comparison</p><h2>Independent versus sequential forecasting</h2><p>This tests forecast memory, not access to retrieval: both modes receive the same date-bounded news access.</p></div>
        <div className="mode-columns"><article><h3>Independent</h3><p>Every checkpoint starts from a clean context. The model cannot see the probability, evidence, or working notes it produced previously.</p></article><article><h3>Sequential</h3><p>The next checkpoint includes the model’s compact belief notebook from the previous one, allowing its prior work to accumulate through time.</p></article></div>
      </section>
      <section className="public-boundary section-rule"><div><p className="eyebrow">Public data boundary</p><h2>What this frontend publishes</h2></div><div className="boundary-columns"><article><h3>Included</h3><ul><li>Questions and resolution metadata</li><li>Model and crowd probabilities</li><li>Forecast dates and outcomes</li><li>Brier, accuracy, and information alpha</li><li>Model source, mode, run, and coverage</li></ul></article><article><h3>Not included in v1</h3><ul><li>Raw chain-of-thought</li><li>Private belief notebooks</li><li>The full CC-News corpus</li><li>Retrieval indexes or article text</li><li>Credentials or provider logs</li></ul></article></div></section>
    </>
  )
}

function PageIntro({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return <section className="page-intro section-rule"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{copy}</p></section>
}

function Stat({ value, label }: { value: string; label: string }) {
  return <article><span className="stat-value">{value}</span><span className="stat-label">{label}</span></article>
}

function ScoreRow({ label, meta, value, tone }: { label: string; meta: string; value: number | null; tone: 'crowd' | 'model' }) {
  const width = value == null ? 0 : Math.max(4, Math.min(100, (value / 0.6) * 100))
  return <div className="score-row"><div className="score-label"><strong>{label}</strong><span>{meta}</span></div><div className="score-track" aria-hidden="true"><span className={tone} style={{ width: `${width}%` }} /></div><span className="score-number">{formatMetric(value, 'brier')}</span></div>
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="filter-group"><span>{label}</span>{children}</div>
}

function Segmented({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return <div className="segmented">{options.map(([key, label]) => <button key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)}>{label}</button>)}</div>
}

function SummaryCard({ label, value, meta, tone }: { label: string; value: string; meta: string; tone: 'crowd' | 'open' | 'closed' | 'model' }) {
  return <article className={`summary-card ${tone}`}><span>{label}</span><strong>{value}</strong><p>{meta}</p></article>
}

function ResultRow({ label, source, mode, value, metric, baseline, tone, complete, coverage }: { label: string; source: string; mode: string; value: number | null; metric: Metric; baseline: number; tone: 'crowd' | SourceType; complete: boolean; coverage?: number }) {
  const delta = value == null ? null : value - baseline
  const favorable = delta == null ? null : metric === 'brier' ? delta < 0 : delta > 0
  const width = resultBarWidth(value, metric)
  return (
    <article className={`result-row ${tone}`}>
      <div className="result-identity"><strong>{label}</strong><div><span className={`source-pill ${tone}`}>{source}</span><span>{mode}</span>{!complete ? <span className="partial-pill">Partial · {percent(coverage ?? 0, 0)}</span> : null}</div></div>
      <div className="result-measure"><div className="result-bar" aria-hidden="true"><span style={{ width: `${width}%` }} /></div><strong>{formatMetric(value, metric)}</strong></div>
      <div className={`result-delta ${favorable == null ? '' : favorable ? 'favorable' : 'unfavorable'}`}>{tone === 'crowd' ? 'Reference' : delta == null ? '—' : `${delta > 0 ? '+' : ''}${formatMetric(delta, metric)} vs crowd`}</div>
    </article>
  )
}

function QuestionCard({ item }: { item: QuestionIndexItem }) {
  return (
    <a className="question-card" href={`#/questions/${encodeURIComponent(item.id)}`}>
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

function TrajectoryPoint({ row, fallbackDate }: { row: TrajectoryRow; fallbackDate?: string }) {
  return (
    <article className="trajectory-point">
      <div className="trajectory-date"><span>t{row.stepIndex + 1}</span><strong>{shortDate(row.forecastDate ?? fallbackDate ?? null)}</strong></div>
      <ProbabilityBar label="Model" value={row.truthProbability} tone="model" />
      <ProbabilityBar label="Crowd" value={row.crowdProbability} tone="crowd" />
      <div className="point-score"><span>Brier</span><strong>{formatMetric(row.brier, 'brier')}</strong></div>
    </article>
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
  return <section className="state-page section-rule"><p className="eyebrow">Question not found</p><h1>This question is not in the current release.</h1><a className="button button-primary" href="#/questions">Browse all questions</a></section>
}

function useHashRoute() {
  const read = () => window.location.hash.slice(1) || '/overview'
  const [route, setRoute] = useState(read)
  useEffect(() => { const update = () => setRoute(read()); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update) }, [])
  return route
}

function crowdMetric(manifest: Manifest, metric: Metric) {
  if (metric === 'brier') return manifest.crowd.brier
  if (metric === 'accuracy') return manifest.crowd.accuracy
  return manifest.crowd.infoAlpha
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

function resultBarWidth(value: number | null, metric: Metric) {
  if (value == null) return 0
  if (metric === 'brier') return Math.max(2, Math.min(100, (1 - value / 0.65) * 100))
  if (metric === 'accuracy') return Math.max(2, Math.min(100, value * 100))
  return Math.max(2, Math.min(100, 50 + value * 100))
}

function formatMetric(value: number | null | undefined, metric: Metric) {
  if (value == null || Number.isNaN(value)) return '—'
  return metric === 'accuracy' ? `${(value * 100).toFixed(metricDetails[metric].decimals)}%` : value.toFixed(metricDetails[metric].decimals)
}

function sourceLabel(source: SourceType) { return source === 'open' ? 'Open-source' : 'Closed-source' }
function modeLabel(mode: ForecastMode) { return mode === 'unknown' ? 'Mode unavailable' : mode[0].toUpperCase() + mode.slice(1) }
function humanize(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) }
function number(value: number) { return new Intl.NumberFormat('en-US').format(value) }
function percent(value: number | null | undefined, digits = 1) { return value == null ? '—' : `${(value * 100).toFixed(digits)}%` }
function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null }
function shortDate(value: string | null) { if (!value) return '—'; const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value); return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date) }

export default BenchmarkApp
