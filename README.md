# Forecast Dojo website

This is a frontend-only research website. GitHub Pages serves the application,
questions, and compact cumulative summaries. Hugging Face serves full
per-question forecasts, tool records, and belief notebooks on demand.

There is one evolving benchmark site. Monthly updates extend the same charts
and question library; they do not create a separate page or selector for each
month.

## Data layout

| Location | Published content | Why |
| --- | --- | --- |
| `public/data/` | Manifest, run summaries, analysis summary, question index, and question chunks | Small and immediately available on GitHub Pages |
| Hugging Face `web/trajectories/` | One model-trajectory file per evaluation question | Loaded only when a question is opened |
| Hugging Face `web/details/` | Full published notebooks and per-tool success/error/latency rows | Loaded only after the visitor requests full process records |
| Hugging Face `data/` | Authoritative Parquet tables | Download and reproducibility |

The 20M+ article CC-News corpus, retrieval indexes, search queries, raw model
responses, credentials, and infrastructure configuration are not part of the
website bundle.

## Run locally

From this `web` directory:

```powershell
npm ci
npm run dev -- --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173/#/overview`. `npm ci` is needed after a fresh clone
or dependency change, not on every run. Stop the server with `Ctrl+C` in its
terminal.

The Overview, Results, Method, and question index use local files. Evaluation
question trajectories require the generated `web/` assets to be present in the
public Hugging Face dataset.

## Build a cumulative monthly update

The source dataset staging directory is `.hf_upload_staging/` at the repository
root. It must contain the `questions`, `runs`, `forecasts`, `notebooks`, and
`tool_usage` Parquet configurations plus `analysis/metrics.json`.

From this `web` directory:

```powershell
npm run data:site
npm run build
```

`data:site` writes:

- compact files to `public/data/` for GitHub Pages;
- large browser-friendly files to ignored `.hf_web_staging/web/` for Hugging
  Face.

The exporter validates required inputs, derives checkpoint indices from the
canonical dataset, keeps all historical and current runs in one summary, and
bootstraps metric intervals by question. It cleans only the dedicated
`.hf_web_staging` output directory.

## Upload the generated Hugging Face web assets

After reviewing `.hf_web_staging/web/`, run this from the repository root:

```powershell
& 'C:\Users\21980\.local\bin\hf.exe' upload 'FinEredium1/Forecast-Dojo' '.hf_web_staging' '.' --repo-type dataset --commit-message 'Update Forecast Dojo web assets'
```

This command is intentionally not part of the build and is never run by GitHub
Pages. Do not add `--create-pr` unless you want a Hub pull request; a draft pull
request must be published before it can be merged.

## Scoring contract

- Accuracy and Brier use all observed forecast rows. Invalid recorded answers
  retain their recorded failure scores.
- Missing expected rows are reported as missing and are not imputed.
- Information alpha uses valid forecasts with an available crowd probability.
- Coverage is observed rows divided by expected rows.
- Confidence intervals resample whole questions so repeated dates and rollouts
  from one question stay correlated.
- Historical one-repeat and current four-repeat protocols remain labeled in the
  cumulative charts.

## Static hosting

The workflow at `.github/workflows/pages.yml` runs `npm ci` and `npm run build`.
Hash routes (`#/results`, `#/questions`, and so on) work on GitHub Pages without
server rewrites. The site fetches the public Hugging Face files directly in the
browser and needs no API key or backend.
