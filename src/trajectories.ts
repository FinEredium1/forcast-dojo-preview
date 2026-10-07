import type { TrajectoryRow } from './types'

export function probabilityForOutcome(row: TrajectoryRow, outcome: string): number | null {
  if (row.forecast) return row.forecast[outcome] ?? 0
  return outcome === row.resolvedLabel ? row.truthProbability : null
}

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
    const answered = group.filter(r => r.forecast && Object.values(r.forecast).some(v => v > 0))
    const forecast: Record<string, number> = {}
    for (const row of answered) {
      const total = Object.values(row.forecast!).filter(v => v > 0).reduce((a, b) => a + b, 0)
      for (const [option, probability] of Object.entries(row.forecast!)) {
        if (probability > 0) forecast[option] = (forecast[option] ?? 0) + probability / total / answered.length
      }
    }
    const truth = forecast[first.resolvedLabel ?? ''] ?? 0
    const crowd = group.find(r => r.crowdProbability != null)?.crowdProbability ?? null
    const mean = (values: Array<number | null>) => {
      const available = values.filter((v): v is number => v != null)
      return available.length ? available.reduce((a, b) => a + b, 0) / available.length : null
    }
    return {
      runId: first.runId, modelName: first.modelName, baseModel: first.baseModel, sourceType: first.sourceType,
      mode: first.mode, retrieval: first.retrieval, eventId: first.eventId, rolloutIndex: -1,
      stepIndex: first.stepIndex, forecastDate: first.forecastDate, resolvedLabel: first.resolvedLabel,
      forecast: answered.length ? forecast : null, truthProbability: answered.length ? truth : null,
      brier: mean(group.map(r => r.brier)), accuracy: mean(group.map(r => r.accuracy)),
      infoAlpha: mean(group.map(r => r.infoAlpha)),
      crowdProbability: crowd, parseOk: group.every(r => r.parseOk), termination: null,
      repeatCount: group.length, fallbackCount: group.filter(r => !r.parseOk).length,
    }
  }).sort((a, b) => a.stepIndex - b.stepIndex)
}
