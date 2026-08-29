# Forecast Dojo frontend

Static research website for comparing longitudinal LLM forecasts with contemporaneous prediction-market crowd probabilities.

## What the frontend publishes

- The complete question index and individual question records.
- Model and crowd probabilities at each forecasting checkpoint.
- Resolution outcomes and public evaluation metrics.
- Model source category, forecast mode, run metadata, coverage, and release version.

The site deliberately does **not** publish raw model reasoning, belief notebooks, provider logs, the CC-News corpus, article text, or retrieval indexes.

## Local development

From `web/`:

```powershell
npm ci
npm run dev
```

The site uses hash routes (`#/results`, `#/questions`, and so on), so every route works on static hosting without rewrite rules.

## Build a monthly data release

1. Update `data.release.json` with the release version, label, and crowd baseline.
2. Make sure the latest model result JSONL files are in the result directories you want to publish.
3. From `web/`, generate the static public bundle:

```powershell
npm run data:build -- --train '..\..\forecast_train.jsonl' --eval '..\..\forecast_eval.jsonl' --results '..\results-n=1' --results '..\results-qwen-n=1'
```

Add another `--results <directory>` argument for each additional model-result directory. The exporter recreates `public/data/`, chunks the question and trajectory records, and strips private reasoning fields.

4. Inspect `public/data/manifest.json` and `public/data/results-summary.json`.
5. Verify the production build:

```powershell
npm run build
```

6. Commit the updated `public/data/` files with the code changes for that release.

## GitHub Pages

The workflow at `.github/workflows/pages.yml` builds and deploys the site after changes reach `main`. It can also be run manually from the Actions tab.

For the first deployment, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. The workflow supplies the repository base path to Vite automatically, so the same build works for project Pages and account Pages URLs.

Only the roughly 5 MiB browser-safe bundle is deployed. Keep the 20-million-article CC-News corpus and its retrieval indexes in research storage, not in Git or GitHub Pages.
