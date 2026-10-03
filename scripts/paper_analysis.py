"""Recompute website analysis using Appendix B.3/B.4 of paper v1.

Raw logged scores are retained in the canonical Hub dataset. Website scores
are computed from exact-label probability reports, with uniform fallback for
recorded unusable reports. Missing records are never manufactured.
"""
from __future__ import annotations

import collections
import itertools
import json
import math
from typing import Any


def score_distribution(p: dict[str, float], truth: str) -> tuple[float, float]:
    brier = sum(value * value for value in p.values()) + 1 - 2 * p.get(truth, 0)
    maximum = max(p.values())
    tops = {key for key, value in p.items() if value == maximum}
    return brier, (1 / len(tops) if truth in tops else 0)


def score_row(row: dict[str, Any], question: dict[str, Any]) -> None:
    raw = json.loads(row['forecast_json'] or '{}')
    p = {key: max(0.0, float(value)) for key, value in raw.items()
         if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)}
    mass = sum(p.values())
    usable = bool(row['parse_ok']) and mass > 0
    if usable:
        p = {key: value / mass for key, value in p.items()}
    else:
        options = question['options']
        p = {label: 1 / len(options) for label in options}
    truth = row['resolved_label']
    row['usable'] = usable
    row['scored_distribution'] = p
    row['brier'], row['accuracy'] = score_distribution(p, truth)
    row['truth_probability'] = p.get(truth, 0)
    market = row['crowd_probability']
    row['info_alpha'] = (math.log(max(p.get(truth, 0), .001)) - math.log(max(market, .001))
                         if market is not None and math.isfinite(market) else None)


def identity(summary: dict[str, Any]) -> dict[str, Any]:
    return {key: summary[key] for key in ('modelName', 'sourceType', 'mode', 'retrieval')} | {'runId': summary['id']}


def paired_modes(rows_by_run, summaries, questions, interval):
    pairs = []
    research = [s for s in summaries if s['retrieval'] == 'baseline']
    for independent in research:
        if independent['mode'] != 'independent':
            continue
        sequential = next(s for s in research if s['modelName'] == independent['modelName'] and s['mode'] == 'sequential')
        key = lambda r: (r['event_id'], r['forecast_date'], r['rollout_index'])
        free = {key(r): r for r in rows_by_run[independent['id']]}
        on = {key(r): r for r in rows_by_run[sequential['id']]}
        matched = sorted(free.keys() & on.keys())
        differences = collections.defaultdict(lambda: collections.defaultdict(list))
        wins = []
        for k in matched:
            a, b = free[k], on[k]
            for metric, source in [('accuracyDifference', 'accuracy'), ('brierDifference', 'brier'), ('infoAlphaDifference', 'info_alpha')]:
                if a[source] is not None and b[source] is not None:
                    differences[metric][k[0]].append(b[source] - a[source])
            wins.append(float(b['brier'] < a['brier']))
        flat_mean = lambda clusters: sum(sum(v) for v in clusters.values()) / sum(len(v) for v in clusters.values()) if clusters else None
        pairs.append({
            'modelName': independent['modelName'], 'sourceType': independent['sourceType'],
            'independentRunId': independent['id'], 'sequentialRunId': sequential['id'],
            'nMatched': len(matched), 'nQuestions': len({k[0] for k in matched}),
            **{metric: flat_mean(clusters) for metric, clusters in differences.items()},
            'sequentialWinRate': sum(wins) / len(wins),
            'intervals': {metric: interval(dict(clusters), sequential['id'] + metric) for metric, clusters in differences.items()},
            'byDomain': [], 'byHorizon': [],
        })
    return pairs


def research_summary(rows_by_run, summaries, questions, interval):
    consistency, murphy, dynamics = [], [], []
    for summary in summaries:
        if summary['retrieval'] != 'baseline':
            continue
        rows = rows_by_run[summary['id']]
        groups = collections.defaultdict(list)
        episodes = collections.defaultdict(dict)
        slots = []
        for r in rows:
            p = r['scored_distribution']
            groups[(r['event_id'], r['forecast_date'])].append(r)
            episodes[(r['event_id'], r['rollout_index'])][r['checkpoint_index']] = r
            # Include offered labels and any unsupported reported labels.
            labels = set(questions[r['event_id']]['options']) | set(p) | {r['resolved_label']}
            slots.extend((p.get(label, 0), float(label == r['resolved_label'])) for label in labels)
        complete = [g for g in groups.values() if len(g) == summary['rolloutCount']]
        tv, single_brier, ensemble_brier, single_accuracy, ensemble_accuracy = [], [], [], [], []
        for g in complete:
            labels = set().union(*(r['scored_distribution'] for r in g))
            vectors = [r['scored_distribution'] for r in g]
            tv.extend(.5 * sum(abs(a.get(k, 0) - b.get(k, 0)) for k in labels)
                      for a, b in itertools.combinations(vectors, 2))
            ensemble = {k: sum(p.get(k, 0) for p in vectors) / len(vectors) for k in labels}
            brier, accuracy = score_distribution(ensemble, g[0]['resolved_label'])
            ensemble_brier.append(brier)
            ensemble_accuracy.append(accuracy)
            single_brier.extend(r['brier'] for r in g)
            single_accuracy.extend(r['accuracy'] for r in g)
        avg = lambda v: sum(v) / len(v)
        consistency.append(identity(summary) | {
            'nGroups': len(groups), 'nUsed': len(complete), 'disagreement': avg(tv),
            'brierSingle': avg(single_brier), 'brierEnsemble': avg(ensemble_brier),
            'ensembleGain': avg(single_brier) - avg(ensemble_brier),
            'accuracySingle': avg(single_accuracy), 'accuracyEnsemble': avg(ensemble_accuracy),
        })

        # Exploratory pooled classwise Murphy components, ten equal-width bins.
        # Finite-bin residual is recorded: REL - RES + UNC alone is approximate.
        base = sum(y for _, y in slots) / len(slots)
        bins = collections.defaultdict(list)
        for p, y in slots:
            bins[min(9, int(p * 10))].append((p, y))
        rel = res = 0.0
        for values in bins.values():
            p = avg([v[0] for v in values])
            y = avg([v[1] for v in values])
            rel += len(values) * (p - y) ** 2 / len(rows)
            res += len(values) * (y - base) ** 2 / len(rows)
        unc = len(slots) / len(rows) * base * (1 - base)
        actual = avg([r['brier'] for r in rows])
        murphy.append(identity(summary) | {
            'reliability': rel, 'resolution': res, 'uncertainty': unc,
            'brier': actual, 'binningResidual': actual - (rel - res + unc),
            'n': len(slots), 'crowd': None,
        })

        # Paper endpoint convention: paired scheduled endpoints, average repeats
        # within an event, then weight represented events equally.
        by_event = collections.defaultdict(list)
        for (event, _), steps in episodes.items():
            last = len(questions[event]['forecast_dates']) - 1
            if 0 in steps and last in steps:
                by_event[event].append((steps[0]['brier'], steps[last]['brier']))
        first = {e: [avg([p[0] for p in v])] for e, v in by_event.items()}
        last = {e: [avg([p[1] for p in v])] for e, v in by_event.items()}
        gain = {e: [first[e][0] - last[e][0]] for e in first}
        dynamics.append(identity(summary) | {
            'nEpisodes': len(by_event), 'firstBrier': avg([v[0] for v in first.values()]),
            'lastBrier': avg([v[0] for v in last.values()]),
            'improvement': avg([v[0] for v in gain.values()]),
            'interval': interval(gain, summary['id'] + ':endpoints'),
        })
    return {'consistency': consistency, 'dynamics': dynamics, 'murphy': murphy}
