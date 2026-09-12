"""Build the cumulative static-site summaries and Hugging Face web assets.

Small, frequently used files are written to ``web/public/data`` for GitHub
Pages. Large per-question trajectories, notebooks, and detailed tool records
are written to ``.hf_web_staging/web`` for on-demand delivery from the public
Hugging Face dataset repository.
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import math
import pathlib
import random
import shutil
from typing import Any, Iterable

import pyarrow.parquet as pq


REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
WEB_ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = REPO_ROOT / ".hf_upload_staging"
DEFAULT_PUBLIC = WEB_ROOT / "public" / "data"
DEFAULT_HF_OUTPUT = REPO_ROOT / ".hf_web_staging"
HORIZON_BUCKETS = [
    ("le3", "≤ 3 days"),
    ("4to7", "4–7 days"),
    ("8to14", "8–14 days"),
    ("15to30", "15–30 days"),
    ("gt30", "> 30 days"),
]


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def write_json(path: pathlib.Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes((compact_json(value) + "\n").encode("utf-8"))


def read_json(path: pathlib.Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def number_or_none(value: Any) -> float | None:
    return float(value) if finite(value) else None


def integer_or_none(value: Any) -> int | None:
    return int(value) if finite(value) else None


def mean(values: Iterable[Any]) -> float | None:
    clean = [float(value) for value in values if finite(value)]
    return sum(clean) / len(clean) if clean else None


def date_value(value: str | None) -> dt.date | None:
    if not value:
        return None
    try:
        return dt.date.fromisoformat(value[:10])
    except ValueError:
        return None


def horizon_key(forecast_date: str | None, close_date: str | None) -> str:
    forecast = date_value(forecast_date)
    close = date_value(close_date)
    if forecast is None or close is None:
        return "unknown"
    days = max(0, (close - forecast).days)
    if days <= 3:
        return "le3"
    if days <= 7:
        return "4to7"
    if days <= 14:
        return "8to14"
    if days <= 30:
        return "15to30"
    return "gt30"


def safe_clean_directory(path: pathlib.Path) -> None:
    resolved = path.resolve()
    if resolved in {REPO_ROOT.resolve(), WEB_ROOT.resolve(), pathlib.Path(resolved.anchor)}:
        raise ValueError(f"Refusing to clean broad output path: {resolved}")
    if resolved.exists():
        shutil.rmtree(resolved)
    resolved.mkdir(parents=True, exist_ok=True)


def append_jsonl(path: pathlib.Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as stream:
        for row in rows:
            stream.write(compact_json(row) + "\n")


def read_jsonl(path: pathlib.Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as stream:
        return [json.loads(line) for line in stream if line.strip()]


def model_arm(run_id: str) -> str:
    arm = run_id.split(".forecast_eval.", 1)[0]
    return arm[:-5] if arm.endswith("-code") else arm


def model_label(run: dict[str, Any], paper_headlines: dict[tuple[str, str], dict[str, Any]]) -> str:
    headline = paper_headlines.get((model_arm(run["run_id"]), run["mode"]))
    if headline:
        label = str(headline["label"]).replace(" +recency", "").strip()
        if run["retrieval"] != "baseline" and "recency" not in label.lower():
            label += " · Recency"
        return label
    return str(run["model_name"])


def confidence_interval(event_values: dict[str, list[float]], seed: str, samples: int = 1000) -> dict[str, float | None]:
    clusters = [(sum(values), len(values)) for values in event_values.values() if values]
    if len(clusters) < 2:
        return {"lower": None, "upper": None}
    rng = random.Random(seed)
    estimates: list[float] = []
    for _ in range(samples):
        chosen = rng.choices(clusters, k=len(clusters))
        estimates.append(sum(total for total, _ in chosen) / sum(count for _, count in chosen))
    estimates.sort()

    def percentile(p: float) -> float:
        position = (len(estimates) - 1) * p
        lower = int(position)
        upper = min(lower + 1, len(estimates) - 1)
        return estimates[lower] + (estimates[upper] - estimates[lower]) * (position - lower)

    return {"lower": percentile(0.025), "upper": percentile(0.975)}


class Aggregate:
    def __init__(self) -> None:
        self.n_rows = 0
        self.questions: set[str] = set()
        self.values: dict[str, list[float]] = {"accuracy": [], "brier": [], "infoAlpha": []}
        self.by_event: dict[str, dict[str, list[float]]] = collections.defaultdict(
            lambda: {"accuracy": [], "brier": [], "infoAlpha": []}
        )

    def add(self, row: dict[str, Any]) -> None:
        self.n_rows += 1
        event_id = str(row["event_id"])
        self.questions.add(event_id)
        pairs = {
            "accuracy": row.get("accuracy"),
            "brier": row.get("brier"),
            "infoAlpha": row.get("info_alpha") if row.get("parse_ok") else None,
        }
        for metric, value in pairs.items():
            if finite(value):
                numeric = float(value)
                self.values[metric].append(numeric)
                self.by_event[event_id][metric].append(numeric)

    def output(self, *, intervals: bool = False, seed: str = "forecast-dojo") -> dict[str, Any]:
        n_scored = len(self.values["brier"])
        result: dict[str, Any] = {
            "nRows": self.n_rows,
            "nScored": n_scored,
            "nQuestions": len(self.questions),
            "coverage": n_scored / self.n_rows if self.n_rows else 0,
            "accuracy": mean(self.values["accuracy"]),
            "brier": mean(self.values["brier"]),
            "infoAlpha": mean(self.values["infoAlpha"]),
        }
        if intervals:
            result["intervals"] = {
                metric: confidence_interval(
                    {event: values[metric] for event, values in self.by_event.items()},
                    f"{seed}:{metric}",
                )
                for metric in ("accuracy", "brier", "infoAlpha")
            }
        return result


def detail_notebook_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "runId": row["run_id"],
        "modelName": row["model_name"],
        "mode": row["mode"],
        "retrieval": row["retrieval"],
        "rolloutIndex": int(row["rollout_index"]),
        "stepIndex": int(row["checkpoint_index"]),
        "forecastDate": row["forecast_date"],
        "notebook": row["notebook_text"],
        "characters": int(row["notebook_characters"]),
        "blockCount": int(row["block_count"]),
        "formatOk": bool(row["source_format_ok"]),
        "jsonValid": bool(row["json_valid"]),
    }


def detail_tool_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "runId": row["run_id"],
        "modelName": row["model_name"],
        "mode": row["mode"],
        "retrieval": row["retrieval"],
        "rolloutIndex": int(row["rollout_index"]),
        "stepIndex": int(row["checkpoint_index"]),
        "forecastDate": row["forecast_date"],
        "toolName": row["tool_name"],
        "canonicalTool": row["canonical_tool"],
        "known": bool(row["known_tool"]),
        "calls": int(row["calls"]),
        "successes": int(row["successes"]),
        "errors": int(row["errors"]),
        "parseErrors": int(row["parse_errors"]),
        "latencySeconds": float(row["latency_seconds"]),
    }


def write_detail_fragments(
    parquet_path: pathlib.Path,
    columns: list[str],
    parts_root: pathlib.Path,
    kind: str,
    transform,
    progress_every: int = 100_000,
) -> tuple[int, set[tuple[str, str, int, int, str]]]:
    count = 0
    notebook_keys: set[tuple[str, str, int, int, str]] = set()
    parquet = pq.ParquetFile(parquet_path)
    for batch in parquet.iter_batches(batch_size=10_000, columns=columns):
        grouped: dict[str, list[dict[str, Any]]] = collections.defaultdict(list)
        for raw in batch.to_pylist():
            event_id = str(raw["event_id"])
            grouped[event_id].append(transform(raw))
            if kind == "notebooks":
                notebook_keys.add(
                    (
                        str(raw["run_id"]),
                        event_id,
                        int(raw["rollout_index"]),
                        int(raw["checkpoint_index"]),
                        str(raw["forecast_date"]),
                    )
                )
            count += 1
        for event_id, rows in grouped.items():
            append_jsonl(parts_root / event_id / f"{kind}.jsonl", rows)
        if count and count % progress_every < len(batch):
            print(f"  staged {count:,} {kind} rows", flush=True)
    return count, notebook_keys


def tool_totals(tool_path: pathlib.Path) -> dict[str, collections.Counter]:
    totals: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    parquet = pq.ParquetFile(tool_path)
    for batch in parquet.iter_batches(batch_size=25_000, columns=["run_id", "canonical_tool", "calls"]):
        for row in batch.to_pylist():
            totals[str(row["run_id"])][str(row["canonical_tool"])] += int(row["calls"] or 0)
    return totals


def trajectory_row(
    row: dict[str, Any],
    run: dict[str, Any],
    display_name: str,
    notebook_keys: set[tuple[str, str, int, int, str]],
) -> dict[str, Any]:
    forecast = None
    raw_forecast = row.get("forecast_json")
    if raw_forecast:
        try:
            parsed = json.loads(raw_forecast)
            if isinstance(parsed, dict) and parsed:
                forecast = {str(key): float(value) for key, value in parsed.items() if finite(value)}
        except (TypeError, ValueError, json.JSONDecodeError):
            forecast = None
    key = (
        str(row["run_id"]),
        str(row["event_id"]),
        int(row["rollout_index"]),
        int(row["checkpoint_index"]),
        str(row["forecast_date"]),
    )
    return {
        "runId": row["run_id"],
        "modelName": display_name,
        "baseModel": run["model_name"],
        "sourceType": row["source_type"],
        "sourceRelease": row["source_release"],
        "protocol": "Historical · one repeat" if row["source_release"] == "2026-08" else "Current · four repeats",
        "retrieval": row["retrieval"],
        "recency": row["retrieval"] != "baseline",
        "mode": row["mode"],
        "eventId": str(row["event_id"]),
        "rolloutIndex": int(row["rollout_index"]),
        "stepIndex": int(row["checkpoint_index"]),
        "forecastDate": row["forecast_date"],
        "resolvedLabel": row["resolved_label"],
        "forecast": forecast,
        "brier": number_or_none(row.get("brier")),
        "accuracy": number_or_none(row.get("accuracy")),
        "infoAlpha": number_or_none(row.get("info_alpha")) if row.get("parse_ok") else None,
        "crowdProbability": number_or_none(row.get("crowd_probability")),
        "truthProbability": number_or_none(row.get("truth_probability")) if row.get("parse_ok") else None,
        "parseOk": bool(row.get("parse_ok")),
        "termination": row.get("termination"),
        "toolIterations": integer_or_none(row.get("tool_iterations")),
        "toolCalls": integer_or_none(row.get("tool_calls")),
        "cancelledToolCalls": integer_or_none(row.get("cancelled_tool_calls")),
        "modelCalls": integer_or_none(row.get("model_calls")),
        "inputTokens": integer_or_none(row.get("input_tokens")),
        "outputTokens": integer_or_none(row.get("output_tokens")),
        "cacheReadTokens": integer_or_none(row.get("cache_read_input_tokens")),
        "cacheHitRate": number_or_none(row.get("cache_hit_rate")),
        "modelLatencySeconds": number_or_none(row.get("model_latency_seconds")),
        "usdTotal": number_or_none(row.get("usd_total")) if number_or_none(row.get("usd_total")) not in (None, 0) else None,
        "notebookFormatOk": number_or_none(row.get("format_notebook_ok")),
        "notebookAvailable": key in notebook_keys,
    }


def research_summary(
    paper: dict[str, Any],
    summaries_by_arm_mode: dict[tuple[str, str], dict[str, Any]],
) -> dict[str, Any]:
    consistency = []
    for row in paper.get("consistency", []):
        run = summaries_by_arm_mode.get((row["arm"], row["mode"]))
        if not run:
            continue
        consistency.append(
            {
                "runId": run["id"],
                "modelName": run["modelName"],
                "sourceType": run["sourceType"],
                "mode": run["mode"],
                "retrieval": run["retrieval"],
                "nGroups": row["n_groups"],
                "nUsed": row["n_used"],
                "disagreement": row["tv_mean"],
                "brierSingle": row["brier_single"],
                "brierEnsemble": row["brier_ensemble"],
                "ensembleGain": row["ensemble_gain"],
                "accuracySingle": row["acc_single"],
                "accuracyEnsemble": row["acc_ensemble"],
            }
        )
    dynamics = []
    for row in paper.get("dynamics", []):
        run = summaries_by_arm_mode.get((row["arm"], "sequential"))
        if not run:
            continue
        dynamics.append(
            {
                "runId": run["id"],
                "modelName": run["modelName"],
                "sourceType": run["sourceType"],
                "retrieval": run["retrieval"],
                "nEpisodes": row["n_episodes"],
                "excessMovement": row["excess_movement"],
                "interval": {"lower": row["excess_movement_lo"], "upper": row["excess_movement_hi"]},
                "modelLeadDays": row["lead_days_all_agent"],
                "crowdLeadDays": row["lead_days_all_crowd"],
                "finalAccuracy": row["final_step_right"],
            }
        )
    recency = []
    for row in paper.get("recency", {}).get("per_arm", []):
        baseline = summaries_by_arm_mode.get((row["base"], row["mode"]))
        recency_run = next(
            (
                summary
                for (arm, mode), summary in summaries_by_arm_mode.items()
                if mode == row["mode"] and arm.startswith(f"{row['base']}-") and summary["retrieval"] != "baseline"
            ),
            None,
        )
        identity = recency_run or baseline
        if not identity:
            continue
        recency.append(
            {
                "modelName": identity["modelName"].replace(" · Recency", ""),
                "sourceType": identity["sourceType"],
                "mode": row["mode"],
                "nMatched": row.get("n_steps", 0),
                "brierDifference": row["d_brier"],
                "accuracyDifference": row["d_acc"],
                "infoAlphaDifference": row["d_alpha"],
                "intervals": {
                    "brierDifference": {"lower": row["d_brier_lo"], "upper": row["d_brier_hi"]},
                    "accuracyDifference": {"lower": row["d_acc_lo"], "upper": row["d_acc_hi"]},
                    "infoAlphaDifference": {"lower": row["d_alpha_lo"], "upper": row["d_alpha_hi"]},
                },
            }
        )
    return {"consistency": consistency, "dynamics": dynamics, "recency": recency}


def build(args: argparse.Namespace) -> None:
    source = args.source.resolve()
    public = args.public_output.resolve()
    hf_output = args.hf_output.resolve()
    required = {
        "forecasts": source / "data" / "forecasts" / "forecasts.parquet",
        "notebooks": source / "data" / "notebooks" / "notebooks.parquet",
        "questions_eval": source / "data" / "questions" / "eval.parquet",
        "questions_train": source / "data" / "questions" / "train.parquet",
        "runs": source / "data" / "runs" / "runs.parquet",
        "tools": source / "data" / "tool_usage" / "tool_usage.parquet",
        "paper": source / "analysis" / "metrics.json",
        "dataset_manifest": source / "dataset_manifest.json",
    }
    missing = [str(path) for path in required.values() if not path.is_file()]
    if missing:
        raise FileNotFoundError("Missing required source files:\n" + "\n".join(missing))

    print(f"Source: {source}", flush=True)
    print(f"GitHub Pages data: {public}", flush=True)
    print(f"Hugging Face web staging: {hf_output}", flush=True)
    safe_clean_directory(hf_output)
    parts_root = hf_output / "_parts"

    paper = read_json(required["paper"])
    dataset_manifest = read_json(required["dataset_manifest"])
    paper_headlines = {(row["arm"], row["mode"]): row for row in paper["headline"]}
    questions = pq.read_table(required["questions_train"]).to_pylist() + pq.read_table(required["questions_eval"]).to_pylist()
    question_by_id = {str(row["event_id"]): row for row in questions}
    evaluation_ids = {event_id for event_id, row in question_by_id.items() if row["split"] == "eval"}
    runs = pq.read_table(required["runs"]).to_pylist()
    run_by_id = {str(row["run_id"]): row for row in runs}
    display_by_run = {run_id: model_label(run, paper_headlines) for run_id, run in run_by_id.items()}

    print("Staging full notebook records…", flush=True)
    notebook_columns = [
        "run_id", "model_name", "mode", "retrieval", "event_id", "rollout_index",
        "checkpoint_index", "forecast_date", "notebook_text", "notebook_characters",
        "block_count", "source_format_ok", "json_valid",
    ]
    notebook_count, notebook_keys = write_detail_fragments(
        required["notebooks"], notebook_columns, parts_root, "notebooks", detail_notebook_row
    )

    print("Staging detailed tool records…", flush=True)
    tool_columns = [
        "run_id", "model_name", "mode", "retrieval", "event_id", "rollout_index",
        "checkpoint_index", "forecast_date", "tool_name", "canonical_tool", "known_tool",
        "calls", "successes", "errors", "parse_errors", "latency_seconds",
    ]
    tool_count, _ = write_detail_fragments(
        required["tools"], tool_columns, parts_root, "tools", detail_tool_row
    )
    per_run_tools = tool_totals(required["tools"])

    print("Reading cumulative forecasts and computing summaries…", flush=True)
    forecast_columns = [
        "source_release", "run_id", "model_name", "source_type", "mode", "retrieval",
        "event_id", "belief_kind", "domain", "rollout_index", "checkpoint_index",
        "forecast_date", "resolved_label", "forecast_json", "crowd_probability",
        "truth_probability", "brier", "accuracy", "info_alpha", "parse_ok", "termination",
        "tool_iterations", "tool_calls", "cancelled_tool_calls", "model_calls",
        "model_latency_seconds", "input_tokens", "output_tokens", "cache_read_input_tokens",
        "cache_hit_rate", "usd_total", "format_notebook_ok",
    ]
    forecast_rows = pq.read_table(required["forecasts"], columns=forecast_columns).to_pylist()
    rows_by_run: dict[str, list[dict[str, Any]]] = collections.defaultdict(list)
    rows_by_event: dict[str, list[dict[str, Any]]] = collections.defaultdict(list)
    overall: dict[str, Aggregate] = collections.defaultdict(Aggregate)
    by_domain: dict[tuple[str, str], Aggregate] = collections.defaultdict(Aggregate)
    by_type: dict[tuple[str, str], Aggregate] = collections.defaultdict(Aggregate)
    by_horizon: dict[tuple[str, str], Aggregate] = collections.defaultdict(Aggregate)

    for row in forecast_rows:
        run_id = str(row["run_id"])
        event_id = str(row["event_id"])
        rows_by_run[run_id].append(row)
        rows_by_event[event_id].append(row)
        overall[run_id].add(row)
        by_domain[(run_id, str(row["domain"]))].add(row)
        by_type[(run_id, str(row["belief_kind"]))].add(row)
        close_date = question_by_id.get(event_id, {}).get("close_date")
        by_horizon[(run_id, horizon_key(row.get("forecast_date"), close_date))].add(row)

    summaries: list[dict[str, Any]] = []
    for run in runs:
        run_id = str(run["run_id"])
        rows = rows_by_run.get(run_id, [])
        aggregate = overall[run_id].output()
        source_type = rows[0]["source_type"] if rows else "open"
        usd_values = [float(row["usd_total"]) for row in rows if finite(row.get("usd_total"))]
        priced = any(value > 0 for value in usd_values)
        tool_sum = per_run_tools.get(run_id, collections.Counter())
        notebook_values = [float(row["format_notebook_ok"]) for row in rows if finite(row.get("format_notebook_ok"))]
        expected = int(run["expected_rows"])
        observed = len(rows)
        summaries.append(
            {
                "id": run_id,
                "modelName": display_by_run[run_id],
                "baseModel": run["model_name"],
                "sourceType": source_type,
                "sourceRelease": run["source_release"],
                "protocol": "Historical · one repeat" if run["source_release"] == "2026-08" else "Current · four repeats",
                "retrieval": run["retrieval"],
                "recency": run["retrieval"] != "baseline",
                "mode": run["mode"],
                "file": pathlib.Path(str(run["source_file"])).name,
                "rolloutCount": int(run["rollout_count"]),
                "nRows": observed,
                "nScored": aggregate["nScored"],
                "nExpected": expected,
                "nMissing": max(0, expected - observed),
                "coverage": observed / expected if expected else 0,
                "responseRate": sum(bool(row.get("parse_ok")) for row in rows) / observed if observed else 0,
                "brier": aggregate["brier"],
                "accuracy": aggregate["accuracy"],
                "infoAlpha": aggregate["infoAlpha"],
                "complete": observed == expected,
                "totalToolCalls": sum(int(row.get("tool_calls") or 0) for row in rows),
                "avgToolCalls": mean(row.get("tool_calls") for row in rows),
                "avgSearchCalls": tool_sum.get("search", 0) / observed if observed else None,
                "avgScrapeCalls": tool_sum.get("scrape", 0) / observed if observed else None,
                "avgPythonCalls": tool_sum.get("python", 0) / observed if observed else None,
                "avgOtherToolCalls": tool_sum.get("other_or_invalid", 0) / observed if observed else None,
                "avgModelCalls": mean(row.get("model_calls") for row in rows),
                "totalInputTokens": sum(int(row.get("input_tokens") or 0) for row in rows),
                "avgInputTokens": mean(row.get("input_tokens") for row in rows),
                "totalOutputTokens": sum(int(row.get("output_tokens") or 0) for row in rows),
                "avgOutputTokens": mean(row.get("output_tokens") for row in rows),
                "totalCacheReadTokens": sum(int(row.get("cache_read_input_tokens") or 0) for row in rows),
                "avgModelLatencySeconds": mean(row.get("model_latency_seconds") for row in rows),
                "notebookValidRate": mean(notebook_values),
                "avgUsd": sum(usd_values) / observed if priced and observed else None,
                "totalUsd": sum(usd_values) if priced else None,
            }
        )
    summaries.sort(key=lambda row: (-(row["accuracy"] or -1), row["modelName"], row["mode"]))
    summary_by_id = {row["id"]: row for row in summaries}
    summaries_by_arm_mode = {(model_arm(row["id"]), row["mode"]): row for row in summaries}

    print("Writing compact GitHub Pages summaries…", flush=True)
    run_analysis = []
    domain_names = sorted({str(row["domain"]) for row in questions})
    belief_names = sorted({str(row["belief_kind"]) for row in questions})
    for summary in summaries:
        run_id = summary["id"]
        overall_result = overall[run_id].output(intervals=True, seed=run_id)
        domain_results = []
        for domain in domain_names:
            result = by_domain[(run_id, domain)].output()
            result.update({"key": domain, "label": domain.replace("_", " ").title()})
            domain_results.append(result)
        type_results = []
        for belief in belief_names:
            result = by_type[(run_id, belief)].output()
            result.update({"key": belief, "label": belief.replace("_", " ").title()})
            type_results.append(result)
        horizon_results = []
        for key, label in HORIZON_BUCKETS:
            result = by_horizon[(run_id, key)].output()
            result.update({"key": key, "label": label})
            horizon_results.append(result)
        run_analysis.append(
            {
                "runId": run_id,
                "modelName": summary["modelName"],
                "sourceType": summary["sourceType"],
                "mode": summary["mode"],
                "overall": overall_result,
                "byDomain": domain_results,
                "byQuestionType": type_results,
                "byHorizon": horizon_results,
                "bestQuestions": [],
                "worstQuestions": [],
            }
        )

    legacy_analysis_path = public / "analysis-summary.json"
    legacy_paired = []
    if legacy_analysis_path.is_file():
        try:
            legacy_paired = read_json(legacy_analysis_path).get("pairedModes", [])
        except (OSError, ValueError, json.JSONDecodeError):
            legacy_paired = []
    paired_modes = [row for row in legacy_paired if row.get("sequentialRunId") in summary_by_id]
    for row in paper.get("memory", []):
        independent = summaries_by_arm_mode.get((row["arm"], "independent"))
        sequential = summaries_by_arm_mode.get((row["arm"], "sequential"))
        if not independent or not sequential:
            continue
        paired_modes.append(
            {
                "modelName": independent["modelName"],
                "sourceType": independent["sourceType"],
                "sequentialRunId": sequential["id"],
                "independentRunId": independent["id"],
                "nMatched": row["n_pairs"],
                "nQuestions": len(evaluation_ids),
                "accuracyDifference": row["d_acc"],
                "brierDifference": row["d_brier"],
                "infoAlphaDifference": row["d_alpha"],
                "sequentialWinRate": None,
                "intervals": {
                    "accuracyDifference": {"lower": row["d_acc_lo"], "upper": row["d_acc_hi"]},
                    "brierDifference": {"lower": row["d_brier_lo"], "upper": row["d_brier_hi"]},
                    "infoAlphaDifference": {"lower": row["d_alpha_lo"], "upper": row["d_alpha_hi"]},
                },
                "byDomain": [],
                "byHorizon": [],
            }
        )

    analysis = {
        "schemaVersion": 2,
        "generatedAt": dataset_manifest["generated_at"],
        "bootstrap": {"method": "question-clustered percentile", "confidenceLevel": 0.95, "samples": 1000},
        "horizonBuckets": [{"key": key, "label": label} for key, label in HORIZON_BUCKETS],
        "domains": domain_names,
        "questionTypes": belief_names,
        "findings": {
            "bestRunId": summaries[0]["id"] if summaries else None,
            "bestOpenRunId": next((row["id"] for row in summaries if row["sourceType"] == "open"), None),
            "sequentialAccuracyWins": sum(
                1 for row in paired_modes if finite(row.get("accuracyDifference")) and row["accuracyDifference"] > 0
            ),
            "independentAccuracyWins": sum(
                1 for row in paired_modes if finite(row.get("accuracyDifference")) and row["accuracyDifference"] < 0
            ),
            "pairedModelCount": len(paired_modes),
            "closestDomain": None,
        },
        "runs": run_analysis,
        "pairedModes": paired_modes,
        "research": research_summary(paper, summaries_by_arm_mode),
    }

    weighted_crowd_count = sum(int(row.get("n_crowd") or 0) for row in paper["headline"])
    crowd_accuracy = (
        sum(float(row["crowd_accuracy"]) * int(row["n_crowd"]) for row in paper["headline"]) / weighted_crowd_count
    )
    crowd_brier = (
        sum(float(row["crowd_brier"]) * int(row["n_crowd"]) for row in paper["headline"]) / weighted_crowd_count
    )
    split_counts = collections.Counter(str(row["split"]) for row in questions)
    domain_counts = collections.Counter(str(row["domain"]) for row in questions)
    belief_counts = collections.Counter(str(row["belief_kind"]) for row in questions)
    checkpoint_count = sum(len(row["forecast_dates"] or []) for row in questions)
    eval_checkpoint_count = sum(len(question_by_id[event]["forecast_dates"] or []) for event in evaluation_ids)
    web_base = f"https://huggingface.co/datasets/{args.hf_repo}/resolve/{args.hf_revision}/web/"
    manifest = {
        "version": "2026-09-10-cumulative",
        "label": "September 2026 update",
        "generatedAt": dataset_manifest["generated_at"],
        "questionCount": len(questions),
        "checkpointCount": checkpoint_count,
        "splitCounts": dict(sorted(split_counts.items())),
        "domainCounts": dict(sorted(domain_counts.items())),
        "beliefCounts": dict(sorted(belief_counts.items())),
        "questionChunks": 14,
        "resultRunCount": len(summaries),
        "evaluationQuestionCount": len(evaluation_ids),
        "evaluationCheckpointCount": eval_checkpoint_count,
        "modelCount": len({row["modelName"] for row in summaries}),
        "forecastCount": len(forecast_rows),
        "expectedForecastCount": sum(int(row["expected_rows"]) for row in runs),
        "missingForecastCount": sum(int(row["missing_rows"]) for row in runs),
        "scoringPolicy": "All observed forecasts; invalid answers receive recorded failure scores; missing rows are not imputed.",
        "crowd": {
            "name": "Market crowd",
            "brier": crowd_brier,
            "accuracy": crowd_accuracy,
            "infoAlpha": 0,
            "nRows": eval_checkpoint_count,
            "nScored": eval_checkpoint_count,
        },
        "huggingFace": {
            "repository": args.hf_repo,
            "datasetUrl": f"https://huggingface.co/datasets/{args.hf_repo}",
            "revision": args.hf_revision,
            "webBase": web_base,
        },
    }
    write_json(public / "manifest.json", manifest)
    write_json(public / "results-summary.json", summaries)
    write_json(public / "analysis-summary.json", analysis)

    print("Writing per-question Hugging Face assets…", flush=True)
    trajectories_root = hf_output / "web" / "trajectories"
    details_root = hf_output / "web" / "details"
    for index, event_id in enumerate(sorted(evaluation_ids), start=1):
        rows = [
            trajectory_row(row, run_by_id[str(row["run_id"])], display_by_run[str(row["run_id"])], notebook_keys)
            for row in rows_by_event.get(event_id, [])
        ]
        rows.sort(key=lambda row: (row["modelName"], row["mode"], row["runId"], row["rolloutIndex"], row["stepIndex"]))
        write_json(trajectories_root / f"{event_id}.json", rows)
        notebooks = read_jsonl(parts_root / event_id / "notebooks.jsonl")
        tools = read_jsonl(parts_root / event_id / "tools.jsonl")
        notebooks.sort(key=lambda row: (row["runId"], row["rolloutIndex"], row["stepIndex"]))
        tools.sort(key=lambda row: (row["runId"], row["rolloutIndex"], row["stepIndex"], row["canonicalTool"]))
        write_json(details_root / f"{event_id}.json", {"eventId": event_id, "notebooks": notebooks, "tools": tools})
        if index % 50 == 0 or index == len(evaluation_ids):
            print(f"  wrote {index:,}/{len(evaluation_ids):,} questions", flush=True)

    shutil.rmtree(parts_root)
    hf_manifest = {
        "schemaVersion": 1,
        "generatedAt": dataset_manifest["generated_at"],
        "questions": len(evaluation_ids),
        "forecastRows": len(forecast_rows),
        "notebookRows": notebook_count,
        "toolRows": tool_count,
        "paths": {"trajectories": "web/trajectories/{event_id}.json", "details": "web/details/{event_id}.json"},
    }
    write_json(hf_output / "web" / "manifest.json", hf_manifest)
    (hf_output / "web" / "README.md").write_text(
        "# Forecast Dojo web assets\n\n"
        "These generated files support the static Forecast Dojo website. Trajectories load when a question is opened; "
        "full notebook and tool records load only when requested. Source Parquet tables remain authoritative.\n",
        encoding="utf-8",
    )

    local_size = sum(path.stat().st_size for path in public.glob("*.json"))
    hf_size = sum(path.stat().st_size for path in (hf_output / "web").rglob("*") if path.is_file())
    print(
        f"Done: {len(summaries):,} runs, {len(forecast_rows):,} forecasts, "
        f"{notebook_count:,} notebooks, {tool_count:,} tool rows.",
        flush=True,
    )
    print(f"Top-level GitHub JSON: {local_size / 1024 / 1024:.2f} MiB", flush=True)
    print(f"Hugging Face web assets: {hf_size / 1024 / 1024:.2f} MiB", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=pathlib.Path, default=DEFAULT_SOURCE)
    parser.add_argument("--public-output", type=pathlib.Path, default=DEFAULT_PUBLIC)
    parser.add_argument("--hf-output", type=pathlib.Path, default=DEFAULT_HF_OUTPUT)
    parser.add_argument("--hf-repo", default="FinEredium1/Forecast-Dojo")
    parser.add_argument("--hf-revision", default="main")
    build(parser.parse_args())
