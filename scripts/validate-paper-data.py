"""Check the paper snapshot's scores, catalogue, and browser assets."""
import collections
import json
import math
from pathlib import Path

import pyarrow.parquet as pq
from paper_analysis import score_row

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / 'web/public/data'
SOURCE = ROOT / '.hf_paper_upload_staging'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def close(a, b):
    assert math.isclose(a, b, abs_tol=1e-10), (a, b)


# Targeted scoring cases: exact labels, fractional ties, clipping, normalization,
# unsupported labels, parser rejection and empty positive mass.
question = {'options': ['YES', 'NO']}
cases = [
    ({'YES': .5, 'NO': .5}, True, .5, .5),
    ({'YES': 2, 'NO': -1}, True, 0, 1),
    ({'yes': 1}, True, 2, 0),
    ({'YES': .1, 'NO': .9}, False, .5, .5),
    ({'YES': 0, 'NO': -1}, True, .5, .5),
    ({'YES': .2, 'NO': .8, 'other': 1}, True, 1.22, 0),
]
for p, parsed, brier, accuracy in cases:
    r = {'forecast_json': json.dumps(p), 'parse_ok': parsed, 'resolved_label': 'YES', 'crowd_probability': .5}
    score_row(r, question)
    close(r['brier'], brier)
    close(r['accuracy'], accuracy)

manifest = read(PUBLIC / 'manifest.json')
source_manifest = read(SOURCE / 'dataset_manifest.json')
summaries = read(PUBLIC / 'results-summary.json')
analysis = read(PUBLIC / 'analysis-summary.json')
index = read(PUBLIC / 'questions-index.json')
questions = pq.read_table(SOURCE / 'data/questions/train.parquet').to_pylist() + pq.read_table(SOURCE / 'data/questions/eval.parquet').to_pylist()
by_id = {q['event_id']: q for q in questions}
assert len(by_id) == len(index) == manifest['questionCount'] == 1568
assert sum(i['checkpointCount'] for i in index) == manifest['checkpointCount'] == 6122
assert collections.Counter(q['split'] for q in questions) == {'train': 1338, 'eval': 230}
assert len(list((PUBLIC / 'questions').glob('*.json'))) == manifest['questionChunks'] == 16
assert {i['id'] for i in index} == set(by_id)
for chunk in {i['chunk'] for i in index}:
    for q in read(PUBLIC / 'questions' / chunk):
        source = by_id[q['id']]
        assert q['forecastDates'] == source['forecast_dates']
        assert q['crowdProbabilities'] == source['crowd_probabilities']
        assert q['body'] == source['body'] and q['options'] == source['options']

assert len(summaries) == len(analysis['runs']) == manifest['resultRunCount'] == 36
assert len({s['modelName'] for s in summaries}) == manifest['modelCount'] == 12
assert collections.Counter((s['retrieval'], s['mode']) for s in summaries) == {('baseline', 'independent'): 12, ('baseline', 'sequential'): 12, ('none', 'independent'): 12}
assert sum(s['nRows'] for s in summaries) == manifest['forecastCount'] == 114746
assert sum(s['nMissing'] for s in summaries) == manifest['missingForecastCount'] == 22
assert len(analysis['pairedModes']) == 12
assert all(s['avgUsd'] is None for s in summaries if s['sourceType'] == 'open')

# Published Table 3: all 36 model/condition means, to reported precision.
# Columns below are Brier, accuracy (%), Information-alpha.
table = {
 'GPT-5.6 Sol': [( .650,47.03,-.422),(.554,56.36,-.138),(.546,57.59,-.104)],
 'GPT-5.5': [(.698,43.85,-.603),(.564,57.69,-.186),(.571,57.68,-.198)],
 'GPT-5.4': [(.708,41.34,-.633),(.586,53.12,-.237),(.583,52.87,-.222)],
 'Opus 4.8 max': [(.725,40.30,-.643),(.589,52.63,-.254),(.605,50.94,-.300)],
 'Opus 4.6': [(.762,35.16,-.788),(.603,52.35,-.282),(.598,53.32,-.263)],
 'GLM-5': [(.731,38.54,-.686),(.625,50.02,-.372),(.632,49.96,-.398)],
 'Qwen3.5 397B': [(.759,36.54,-.796),(.639,48.49,-.422),(.643,48.90,-.441)],
 'Kimi K2.5': [(.773,36.30,-.837),(.637,49.37,-.420),(.658,48.07,-.439)],
 'MiniMax M2.5': [(.758,35.68,-.797),(.654,46.87,-.461),(.640,47.19,-.413)],
 'DeepSeek V3.2': [(.805,34.34,-.991),(.655,47.73,-.464),(.666,47.65,-.508)],
 'gpt-oss-120b': [(.896,32.44,-1.378),(.699,41.95,-.594),(.696,43.03,-.584)],
 'Nemotron 3 Super': [(.882,30.84,-1.516),(.695,43.49,-.743),(.688,44.89,-.720)],
}
for s in summaries:
    condition = 0 if s['retrieval'] == 'none' else 1 if s['mode'] == 'independent' else 2
    expected = table[s['modelName']][condition]
    assert (round(s['brier'], 3), round(s['accuracy'] * 100, 2), round(s['infoAlpha'], 3)) == expected, s['id']

assets = ROOT / '.hf_paper_web_staging/web' / manifest['version']
asset_manifest = read(assets / 'manifest.json')
assert asset_manifest['sourceArchiveSha256'] == source_manifest['source_archive_sha256']
assert manifest['version'] in manifest['huggingFace']['webBase']
eval_ids = {q['event_id'] for q in questions if q['split'] == 'eval'}
assert {p.stem for p in (assets / 'trajectories').glob('*.json')} == eval_ids
assert {p.stem for p in (assets / 'details').glob('*.json')} == eval_ids
totals = collections.Counter()
run_rows = collections.defaultdict(list)
for event in eval_ids:
    rows = read(assets / 'trajectories' / (event + '.json'))
    detail = read(assets / 'details' / (event + '.json'))
    totals.update({'forecasts': len(rows), 'notebooks': len(detail['notebooks']), 'tools': len(detail['tools'])})
    keys = {(r['runId'], r['rolloutIndex'], r['stepIndex'], r['forecastDate']) for r in rows}
    assert len(keys) == len(rows)
    assert all((r['runId'], r['rolloutIndex'], r['stepIndex'], r['forecastDate']) in keys for r in detail['notebooks'] + detail['tools'])
    for row in rows:
        assert row['forecastDate'] == by_id[event]['forecast_dates'][row['stepIndex']]
        close(sum(row['forecast'].values()), 1)
        run_rows[row['runId']].append(row)
        if not row['parseOk']:
            k = len(by_id[event]['options'])
            close(row['brier'], 1 - 1/k)
            close(row['accuracy'], 1/k)
            assert row['truthProbability'] == 1/k
for s in summaries:
    rows = run_rows[s['id']]
    for metric in ['brier', 'accuracy', 'infoAlpha']:
        values = [r[metric] for r in rows if r[metric] is not None]
        close(sum(values) / len(values), s[metric])
assert totals == {'forecasts': 114746, 'notebooks': 37134, 'tools': 218073}
for run in analysis['runs']:
    summary = next(s for s in summaries if s['id'] == run['runId'])
    close(run['overall']['coverage'], summary['coverage'])
    assert sum(v['nRows'] for v in run['byDomain']) == summary['nRows']
    for metric in ['accuracy', 'brier', 'infoAlpha']:
        bounds = run['overall']['intervals'][metric]
        assert bounds['lower'] <= bounds['upper']
for row in analysis['research']['murphy']:
    close(row['reliability'] - row['resolution'] + row['uncertainty'] + row['binningResidual'], row['brier'])

report = {'snapshot': manifest['version'], 'questions': len(index), 'conditions': len(summaries),
          'browserAssetRows': dict(totals), 'paperTable3': 'All 36 model/condition means match reported precision',
          'scoringCases': len(cases), 'status': 'passed'}
path = ROOT / 'output/paper-data-update/validation.json'
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, indent=2))
