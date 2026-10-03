"""Check stage boundaries, event weighting, and published figure values."""
from pathlib import Path
import json

from paper_figures import CONDITIONS, forecast_stages, memory_cost, stage_index


assert [stage_index(i, 4) for i in range(4)] == [0, 0, 1, 2]
assert [stage_index(i, 7) for i in range(7)] == [0, 0, 0, 1, 1, 2, 2]
for index, steps in [(0, 2), (-1, 3), (3, 3)]:
    try:
        stage_index(index, steps)
    except ValueError:
        pass
    else:
        raise AssertionError('Invalid step accepted')

# Four repeats on a 3-step event and one repeat on a 4-step event must
# contribute equal event weight. A third event loses its middle-stage
# market probability and must not leak into any stage of the cohort.
questions = {e: {'forecast_dates': list(range(n))} for e, n in [('a', 3), ('b', 4), ('c', 3)]}
rows, summaries = {}, []
for key, _, retrieval, mode in CONDITIONS:
    summaries.append({'id': key, 'retrieval': retrieval, 'mode': mode})
    rows[key] = [
        {'event_id': e, 'checkpoint_index': i, 'brier': v,
         'crowd_probability': None if e == 'c' and i == 1 else .5}
        for e, values, repeats in [('a', [.9, .6, .3], 4), ('b', [0, .2, .4, .6], 1), ('c', [1, 1, 1], 4)]
        for _ in range(repeats) for i, v in enumerate(values)
    ]
for series in forecast_stages(rows, summaries, questions, bootstrap_samples=100)['series']:
    assert series['nEvents'] == 2
    for point, expected in zip(series['points'], [.5, .5, .45]):
        assert abs(point['brier'] - expected) < 1e-12

root = Path(__file__).resolve().parents[2]
public = root / 'web/public/data'
analysis = json.loads((public / 'analysis-summary.json').read_text(encoding='utf-8'))
summaries = json.loads((public / 'results-summary.json').read_text(encoding='utf-8'))
figures = analysis['paperFigures']
expected = {'no-tools': [.770, .769, .769], 'memory-free': [.670, .647, .606], 'memory-on': [.671, .653, .612]}
for series in figures['forecastStages']['series']:
    assert (series['nModels'], series['nEvents']) == (12, 223)
    assert [round(p['brier'], 3) for p in series['points']] == expected[series['id']]
    for point in series['points']:
        assert point['interval']['lower'] <= point['brier'] <= point['interval']['upper']
        assert point['modelRange']['lower'] <= point['brier'] <= point['modelRange']['upper']
        assert point['nForecasts'] > 0

cost = figures['memoryCost']
assert cost == memory_cost(summaries)
assert len(cost['pairs']) == 5 and round(cost['medianReduction'] * 100) == 24
assert (cost['qualityImprovedModels'], cost['qualityModelCount']) == (6, 12)
table12 = {'GPT-5.6 Sol': (4.45, 3.38), 'GPT-5.5': (5.85, 3.90), 'GPT-5.4': (4.49, 3.52),
           'Opus 4.8 max': (2.74, 2.02), 'Opus 4.6': (2.91, 2.66)}
for pair in cost['pairs']:
    assert (round(pair['memoryFree'], 2), round(pair['memoryOn'], 2)) == table12[pair['modelName']]
    assert pair['reduction'] > 0
training = figures['training']
assert (training['nEvents'], training['nForecasts']) == (230, 3188)
assert training['source'].startswith('Paper-reported')
brier, accuracy = training['metrics']
assert (brier['base'], brier['sft'], brier['pairedDifference']) == (.924, .749, -.176)
assert (accuracy['base'], accuracy['sft'], accuracy['pairedDifference']) == (.348, .428, .081)
print('Passed: stage boundaries, equal event weight, cohort support, Figure 2(a), Table 4, and Table 12.')
