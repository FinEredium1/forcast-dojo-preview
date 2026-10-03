import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { PaperFiguresSummary } from './types'

const colors = { 'no-tools': '#857b70', 'memory-free': '#7052b8', 'memory-on': '#398774' }
const count = (value: number) => value.toLocaleString('en-US')
const money = (value: number) => `$${value.toFixed(2)}`

function SourceDetails({ href, children }: { href: string; children: ReactNode }) {
  return <details className="paper-figure-method"><summary>Methods &amp; source</summary><div>{children}<a href={href} target="_blank" rel="noopener noreferrer">View in the paper ↗</a></div></details>
}

export function ForecastStagesFigure({ data }: { data: PaperFiguresSummary['forecastStages'] }) {
  const [active, setActive] = useState({ id: 'memory-free', stage: 2 })
  const selected = data.series.find(series => series.id === active.id) ?? data.series[0]
  const point = selected.points[active.stage]
  const free = data.series.find(series => series.id === 'memory-free')!
  const values = data.series.flatMap(series => series.points.map(p => p.brier))
  const min = Math.floor((Math.min(...values) - .02) / .05) * .05
  const max = Math.ceil((Math.max(...values) + .02) / .05) * .05
  const y = (value: number) => (value - min) / (max - min) * 100
  const x = (stage: number, series: number) => 10 + stage * 40 + (series - 1) * 2
  const ticks = Array.from({ length: Math.round((max - min) / .05) + 1 }, (_, i) => min + i * .05)
  return <section className="paper-result-figure paper-stage-figure" id="results-forecast-stages" aria-labelledby="forecast-stages-title">
    <div className="paper-result-heading"><div><p className="eyebrow">Forecast evolution</p><h2 id="forecast-stages-title">Forecasts improve as events unfold</h2></div><div className="paper-result-takeaway"><strong>{free.points[0].brier.toFixed(3)} <span>→</span> {free.points[2].brier.toFixed(3)}</strong><span>Memory-free Brier ↓</span></div></div>
    <div className="paper-series-legend" role="group" aria-label="Highlight a forecasting condition">
      {data.series.map(series => <button type="button" key={series.id} aria-pressed={selected.id === series.id} style={{ '--series-color': colors[series.id] } as CSSProperties} onClick={() => setActive({ id: series.id, stage: active.stage })}><i className={series.id} />{series.label}</button>)}
      <span>{free.nModels} models · {free.nEvents} events · Brier ↓</span>
    </div>
    <figure className="paper-stage-chart">
      <div className="paper-stage-y-axis" aria-hidden="true">{ticks.map(tick => <span key={tick} style={{ bottom: `${y(tick)}%` }}>{tick.toFixed(2)}</span>)}</div>
      <div className="paper-stage-plot">
        {ticks.map(tick => <div className="paper-stage-gridline" key={tick} style={{ bottom: `${y(tick)}%` }} />)}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {data.series.map((series, s) => <polyline key={series.id} points={series.points.map((p, i) => `${x(i, s)},${100 - y(p.brier)}`).join(' ')} fill="none" stroke={colors[series.id]} strokeWidth={selected.id === series.id ? 4 : 3} strokeDasharray={series.id === 'no-tools' ? '8 7' : series.id === 'memory-free' ? '10 5' : undefined} vectorEffect="non-scaling-stroke" />)}
        </svg>
        {data.series.flatMap((series, s) => series.points.map((p, i) => <button type="button" className={`paper-stage-point${active.id === series.id && active.stage === i ? ' selected' : ''}`} key={`${series.id}-${i}`} style={{ left: `${x(i, s)}%`, bottom: `${y(p.brier)}%`, '--series-color': colors[series.id] } as CSSProperties} aria-label={`${series.label}, ${p.stage}: Brier ${p.brier.toFixed(3)}, 95% event-bootstrap confidence interval ${p.interval.lower.toFixed(3)} to ${p.interval.upper.toFixed(3)}`} aria-pressed={active.id === series.id && active.stage === i} onMouseEnter={() => setActive({ id: series.id, stage: i })} onFocus={() => setActive({ id: series.id, stage: i })} onClick={() => setActive({ id: series.id, stage: i })}><span /></button>))}
        {['Early', 'Middle', 'Late'].map((label, i) => <span className="paper-stage-x-label" key={label} style={{ left: `${10 + i * 40}%` }}>{label}</span>)}
      </div>
      <figcaption className="paper-stage-readout" aria-live="polite"><span style={{ color: colors[selected.id] }}><b>{selected.label}</b> · {point.stage}</span><strong>{point.brier.toFixed(3)} <small>Brier</small></strong><span>95% CI {point.interval.lower.toFixed(3)}–{point.interval.upper.toFixed(3)}</span></figcaption>
    </figure>
    <SourceDetails href={data.sourceUrl}>
      <p>Stages are thirds of relative forecast-step position: [0, ⅓], (⅓, ⅔], (⅔, 1]. Each event receives equal weight, then the 12 model means are averaged. Recorded unusable forecasts use uniform probabilities; missing records are excluded. Only dates with an available market probability and events represented in all three stages contribute. Intervals resample whole events {count(data.bootstrapSamples)} times.</p>
      <div className="paper-figure-table-scroll"><table><caption>Brier by forecast stage</caption><thead><tr><th>Condition</th><th>Early</th><th>Middle</th><th>Late</th></tr></thead><tbody>{data.series.map(series => <tr key={series.id}><th scope="row">{series.label}</th>{series.points.map(p => <td key={p.stage}>{p.brier.toFixed(3)}</td>)}</tr>)}</tbody></table></div>
    </SourceDetails>
  </section>
}

export function TrainingFigure({ data }: { data: PaperFiguresSummary['training'] }) {
  return <section className="paper-result-figure paper-training-figure" id="results-training" aria-labelledby="training-title">
    <div className="paper-result-heading"><div><p className="eyebrow">Training proof of concept</p><h2 id="training-title">Train better forecasting agents</h2></div><div className="paper-result-takeaway"><strong>{count(data.nEvents)}</strong><span>held-out events</span></div></div>
    <p className="paper-training-model">{data.modelName} <span>· Base → Dojo SFT</span></p>
    <div className="paper-training-metrics">{data.metrics.map(metric => {
      const formatted = (v: number) => metric.id === 'accuracy' ? `${(v * 100).toFixed(1)}%` : v.toFixed(3)
      const difference = metric.id === 'accuracy' ? `+${(metric.pairedDifference * 100).toFixed(1)} pts` : metric.pairedDifference.toFixed(3)
      const bounds = metric.id === 'accuracy' ? `+${(metric.interval.lower * 100).toFixed(1)} to +${(metric.interval.upper * 100).toFixed(1)} pts` : `${metric.interval.lower.toFixed(3)} to ${metric.interval.upper.toFixed(3)}`
      return <figure className="paper-training-metric" key={metric.id} aria-label={`${metric.label}: base ${formatted(metric.base)}, Dojo SFT ${formatted(metric.sft)}, paired difference ${difference}, 95% confidence interval ${bounds}`}>
        <h3>{metric.label} <span>{metric.direction === 'lower' ? '↓' : '↑'}</span></h3>
        {[{ label: 'Base', value: metric.base, kind: 'base' }, { label: '+ Dojo SFT', value: metric.sft, kind: 'sft' }].map(row => <div className={`paper-training-row ${row.kind}`} key={row.kind}><span>{row.label}</span><div className="paper-training-track" aria-hidden="true"><i style={{ width: `${row.value * 100}%` }} /></div><strong>{formatted(row.value)}</strong></div>)}
        <figcaption><strong>{difference}</strong><span>paired improvement<br /><small>95% CI {bounds}</small></span></figcaption>
      </figure>
    })}</div>
    <div className="paper-figure-footnote"><span>{count(data.nForecasts)} held-out forecasts</span><span>Paper-reported results · Table 4</span></div>
    <SourceDetails href={data.sourceUrl}>
      <p>{data.source} The student is fine-tuned on trajectories from {count(data.trainingEvents)} training events ({count(data.trainingSteps)} forecast steps), then evaluated on later, separate events. Paired differences are computed before rounding, so they can differ from subtracting the displayed means. Confidence intervals resample whole events. Unusable recorded reports receive uniform probabilities.</p>
      <p>Tool calls increase from {data.baseToolCalls.toFixed(1)} to {data.sftToolCalls.toFixed(1)} per forecast. This is one supervised fine-tuning proof of concept.</p>
    </SourceDetails>
  </section>
}

export function MemoryCostFigure({ data }: { data: PaperFiguresSummary['memoryCost'] }) {
  const maxCost = Math.ceil(Math.max(...data.pairs.flatMap(pair => [pair.memoryFree, pair.memoryOn])))
  const position = (v: number) => v / maxCost * 100
  return <section className="paper-result-figure paper-cost-figure" id="results-memory-cost" aria-labelledby="memory-cost-title">
    <div className="paper-result-heading"><div><p className="eyebrow">Research efficiency</p><h2 id="memory-cost-title">Belief notebooks reduce research cost</h2></div><div className="paper-result-takeaway"><strong>{Math.round(data.medianReduction * 100)}% <span>↓</span></strong><span>median cost reduction</span></div></div>
    <div className="paper-series-legend paper-cost-legend"><span><i className="memory-free" />Memory-free</span><span><i className="memory-on" />Memory-on</span><span>Estimated USD / forecast ↓</span></div>
    <figure className="paper-cost-chart">
      <div className="paper-cost-axis" aria-hidden="true"><span /><div>{[0, maxCost / 3, maxCost * 2 / 3, maxCost].map(tick => <span key={tick} style={{ left: `${position(tick)}%` }}>${tick.toFixed(0)}</span>)}</div><span>Reduction</span></div>
      {data.pairs.map(pair => <div className="paper-cost-row" key={pair.modelName} tabIndex={0} role="img" aria-label={`${pair.modelName}: memory-free ${money(pair.memoryFree)}, memory-on ${money(pair.memoryOn)}, ${(pair.reduction * 100).toFixed(1)}% lower estimated cost per forecast. ${count(pair.recordedFree)} and ${count(pair.recordedOn)} recorded forecasts, respectively.`}>
        <strong className="paper-cost-model">{pair.modelName.replace(/^Opus /, 'Claude Opus ').replace(/ max$/, '')}</strong>
        <div className="paper-cost-track" aria-hidden="true">
          {[0, maxCost / 3, maxCost * 2 / 3, maxCost].map(tick => <i className="paper-cost-gridline" key={tick} style={{ left: `${position(tick)}%` }} />)}
          <i className="paper-cost-connector" style={{ left: `${position(Math.min(pair.memoryFree, pair.memoryOn))}%`, width: `${position(Math.abs(pair.memoryFree - pair.memoryOn))}%` }} />
          <span className="paper-cost-endpoint memory-free" style={{ left: `${position(pair.memoryFree)}%` }}><i /><b>{money(pair.memoryFree)}</b></span>
          <span className="paper-cost-endpoint memory-on" style={{ left: `${position(pair.memoryOn)}%` }}><i /><b>{money(pair.memoryOn)}</b></span>
        </div>
        <strong className="paper-cost-reduction">−{Math.round(pair.reduction * 100)}%</strong>
      </div>)}
      <figcaption className="paper-figure-footnote"><span>{data.pairs.length} proprietary models</span><span>Quality is mixed: Brier improves for {data.qualityImprovedModels}/{data.qualityModelCount} models.</span></figcaption>
    </figure>
    <SourceDetails href={data.sourceUrl}>
      <p>Cost is the mean provider-estimated USD per recorded forecast, matching Table 12. These figures include initial and later forecast steps and exclude discarded retries. Each pair compares the same model in the two memory modes; the headline is the median of the five within-model percentage reductions. Open-weight costs are not compared across serving arrangements. The quality count covers all {data.qualityModelCount} models.</p>
    </SourceDetails>
  </section>
}
