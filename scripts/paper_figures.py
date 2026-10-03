"""Paper-aligned stage, training, and memory-cost figures for the website.

Figure 2(a) is recomputed from recorded forecasts using Appendix B.6.
Table 4 is explicitly paper-reported: its SFT trajectories are not in the
current results archive. Cost pairs follow Table 12's per-record averages.
"""
from __future__ import annotations

import collections
import statistics

import numpy as np


PAPER_URL = 'https://arxiv.org/pdf/2609.28876v1'
CONDITIONS = [
    ('no-tools', 'No tools', 'none', 'independent'),
    ('memory-free', 'Memory-free', 'baseline', 'independent'),
    ('memory-on', 'Memory-on', 'baseline', 'sequential'),
]


def stage_index(index, step_count):
    """Right-closed thirds: [0, 1/3], (1/3, 2/3], (2/3, 1]."""
    if step_count < 3 or not 0 <= index < step_count:
        raise ValueError('Stage analysis requires a valid index in a 3+ step episode')
    if 3 * index <= step_count - 1:
        return 0
    if 3 * index <= 2 * (step_count - 1):
        return 1
    return 2


def forecast_stages(rows_by_run, summaries, questions, bootstrap_samples=4000):
    series = []
    for key, label, retrieval, mode in CONDITIONS:
        runs = sorted([s for s in summaries if s['retrieval'] == retrieval and s['mode'] == mode], key=lambda s: s['id'])
        if not runs:
            raise ValueError(f'Missing condition: {label}')
        events_by_model = []
        for run in runs:
            events = collections.defaultdict(lambda: [[], [], []])
            for row in rows_by_run[run['id']]:
                # This is Figure 2(a)'s agent support, not all Table 3 rows.
                if row['crowd_probability'] is None:
                    continue
                event = row['event_id']
                step = stage_index(row['checkpoint_index'], len(questions[event]['forecast_dates']))
                events[event][step].append(row['brier'])
            events_by_model.append({e: v for e, v in events.items() if all(v)})
        # Shared event support makes each condition a matched, equal-weight
        # comparison across models. In paper v1 every model retains 223 events.
        event_ids = sorted(set.intersection(*(set(v) for v in events_by_model)))
        if not event_ids:
            raise ValueError(f'No complete three-stage events for {label}')
        matrix = np.array([[[statistics.mean(v) for v in model[e]] for e in event_ids]
                           for model in events_by_model])
        model_means = matrix.mean(axis=1)
        # One draw resamples complete events and keeps the model panel intact.
        event_means = matrix.mean(axis=0)
        rng = np.random.default_rng(0)
        draws = rng.integers(0, len(event_ids), size=(bootstrap_samples, len(event_ids)))
        lower, upper = np.quantile(event_means[draws].mean(axis=1), [.025, .975], axis=0)
        points = []
        for i, stage in enumerate(['Early', 'Middle', 'Late']):
            points.append({
                'stage': stage, 'brier': float(model_means[:, i].mean()),
                'interval': {'lower': float(lower[i]), 'upper': float(upper[i])},
                'modelRange': {'lower': float(model_means[:, i].min()), 'upper': float(model_means[:, i].max())},
                'nForecasts': sum(len(model[e][i]) for model in events_by_model for e in event_ids),
            })
        series.append({'id': key, 'label': label, 'nModels': len(runs), 'nEvents': len(event_ids), 'points': points})
    return {'sourceUrl': PAPER_URL + '#page=8', 'aggregation': 'Equal weight per event, then per model; four repeats pooled within each stage.',
            'bootstrapSamples': bootstrap_samples, 'series': series}


def memory_cost(summaries):
    pairs = []
    research = [s for s in summaries if s['retrieval'] == 'baseline']
    for free in research:
        if free['mode'] != 'independent' or free['sourceType'] != 'closed' or not free.get('avgUsd'):
            continue
        on = next((s for s in research if s['modelName'] == free['modelName'] and s['mode'] == 'sequential'), None)
        if not on or not on.get('avgUsd'):
            continue
        pairs.append({'modelName': free['modelName'], 'memoryFree': free['avgUsd'], 'memoryOn': on['avgUsd'],
                      'reduction': 1 - on['avgUsd'] / free['avgUsd'], 'recordedFree': free['nRows'], 'recordedOn': on['nRows']})
    pairs.sort(key=lambda p: -p['reduction'])
    free_models = [s for s in research if s['mode'] == 'independent']
    quality_improved = sum(any(on['modelName'] == free['modelName'] and on['mode'] == 'sequential' and
                               on['brier'] < free['brier'] for on in research) for free in free_models)
    return {'sourceUrl': PAPER_URL + '#page=21', 'pairs': pairs,
            'medianReduction': statistics.median(p['reduction'] for p in pairs),
            'qualityImprovedModels': quality_improved, 'qualityModelCount': len(free_models)}


def paper_figures_summary(rows_by_run, summaries, questions):
    return {
        'forecastStages': forecast_stages(rows_by_run, summaries, questions),
        'memoryCost': memory_cost(summaries),
        'training': {
            'source': 'Paper-reported results, Table 4; not recomputed from the benchmark archive.',
            'sourceUrl': PAPER_URL + '#page=10',
            'modelName': 'Qwen3-30B-A3B-Thinking-2507',
            'nEvents': 230, 'nForecasts': 3188,
            'trainingEvents': 1028, 'trainingSteps': 3965,
            'metrics': [
                {'id': 'brier', 'label': 'Brier score', 'direction': 'lower', 'base': .924, 'sft': .749,
                 'pairedDifference': -.176, 'interval': {'lower': -.214, 'upper': -.139}},
                {'id': 'accuracy', 'label': 'Accuracy', 'direction': 'higher', 'base': .348, 'sft': .428,
                 'pairedDifference': .081, 'interval': {'lower': .051, 'upper': .112}},
            ],
            'baseToolCalls': 1.4, 'sftToolCalls': 3.7,
        },
    }
