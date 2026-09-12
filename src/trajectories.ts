import type { TrajectoryRow } from './types'

export function averageRepeats(rows: TrajectoryRow[]): TrajectoryRow[] {
  const dates = new Map<string, TrajectoryRow[]>()
  for (const row of rows) {
    const key = row.forecastDate ?? String(row.stepIndex)
    const group = dates.get(key) ?? []
    group.push(row)
    dates.set(key, group)
  }
  return [...dates.values()].map(group => {
    const first = group[0]
    const answered = group.filter(r => r.parseOk && r.forecast && Object.values(r.forecast).some(v => v > 0))
    const forecast: Record<string, number> = {}
    for (const row of answered) {
      const total = Object.values(row.forecast!).filter(v => v > 0).reduce((a, b) => a + b, 0)
      for (const [option, probability] of Object.entries(row.forecast!)) {
        if (probability > 0) forecast[option] = (forecast[option] ?? 0) + probability / total / answered.length
      }
    }
    const truth = forecast[first.resolvedLabel ?? ''] ?? 0
    const maximum = Math.max(...Object.values(forecast))
    const ties = Object.values(forecast).filter(v => v === maximum).length
    const crowd = group.find(r => r.crowdProbability != null)?.crowdProbability ?? null
    return {
      runId: first.runId, modelName: first.modelName, baseModel: first.baseModel, sourceType: first.sourceType,
      recency: first.recency, mode: first.mode, eventId: first.eventId, rolloutIndex: -1,
      stepIndex: first.stepIndex, forecastDate: first.forecastDate, resolvedLabel: first.resolvedLabel,
      forecast: answered.length ? forecast : null, truthProbability: answered.length ? truth : null,
      brier: answered.length ? 1 - 2 * truth + Object.values(forecast).reduce((sum, p) => sum + p * p, 0) : null,
      accuracy: answered.length ? truth === maximum ? 1 / ties : 0 : null,
      infoAlpha: answered.length && crowd != null ? Math.log(Math.max(.001, truth) / Math.max(.001, crowd)) : null,
      crowdProbability: crowd, parseOk: answered.length > 0, termination: null, repeatCount: answered.length,
    }
  }).sort((a, b) => a.stepIndex - b.stepIndex)
}
