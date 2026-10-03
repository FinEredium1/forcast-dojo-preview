"""Refresh only the three paper figures, preserving existing Hub assets."""
from pathlib import Path
import argparse
import collections
import json

import pyarrow.parquet as pq

from paper_analysis import score_row
from paper_figures import paper_figures_summary


def main():
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=root / '.hf_paper_upload_staging')
    parser.add_argument('--public-output', type=Path, default=root / 'web/public/data')
    args = parser.parse_args()
    questions = {q['event_id']: q for q in pq.read_table(args.source / 'data/questions/eval.parquet').to_pylist()}
    columns = ['run_id', 'event_id', 'checkpoint_index', 'resolved_label', 'forecast_json', 'parse_ok', 'crowd_probability']
    rows_by_run = collections.defaultdict(list)
    for row in pq.read_table(args.source / 'data/forecasts/forecasts.parquet', columns=columns).to_pylist():
        score_row(row, questions[row['event_id']])
        rows_by_run[row['run_id']].append(row)
    summaries = json.loads((args.public_output / 'results-summary.json').read_text(encoding='utf-8'))
    analysis_path = args.public_output / 'analysis-summary.json'
    analysis = json.loads(analysis_path.read_text(encoding='utf-8'))
    analysis['paperFigures'] = paper_figures_summary(rows_by_run, summaries, questions)
    analysis_path.write_bytes((json.dumps(analysis, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n').encode('utf-8'))
    for series in analysis['paperFigures']['forecastStages']['series']:
        print(series['label'], series['nEvents'], [round(p['brier'], 3) for p in series['points']])
    print('Cost pairs:', len(analysis['paperFigures']['memoryCost']['pairs']))


if __name__ == '__main__':
    main()
