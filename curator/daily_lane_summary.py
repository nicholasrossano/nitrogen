import argparse
import datetime as dt
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from zoneinfo import ZoneInfo

import pandas as pd

from tools.bigquery_client import run_sql_text


BASE_DIR = Path(__file__).resolve().parent


@dataclass
class TimeWindow:
    label: str
    local_start: dt.datetime
    local_end: dt.datetime
    utc_start: dt.datetime
    utc_end: dt.datetime


def _default_timezone() -> ZoneInfo:
    tz_name = os.environ.get("REPORT_TIMEZONE", "America/Los_Angeles")
    try:
        return ZoneInfo(tz_name)
    except Exception:
        return ZoneInfo("UTC")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Daily summary for unified scan lanes")
    parser.add_argument("--date", help="Date to summarize (YYYY-MM-DD). Defaults to yesterday in report timezone.")
    parser.add_argument("--timezone", help="IANA timezone identifier. Overrides REPORT_TIMEZONE.")
    return parser.parse_args()


def _target_window(args: argparse.Namespace) -> TimeWindow:
    tz = ZoneInfo(args.timezone) if args.timezone else _default_timezone()
    now = dt.datetime.now(tz)
    if args.date:
        target_date = dt.date.fromisoformat(args.date)
    else:
        target_date = now.date() - dt.timedelta(days=1)

    start_local = dt.datetime.combine(target_date, dt.time.min).replace(tzinfo=tz)
    end_local = start_local + dt.timedelta(days=1)
    start_utc = start_local.astimezone(dt.timezone.utc)
    end_utc = end_local.astimezone(dt.timezone.utc)
    label = target_date.isoformat()
    return TimeWindow(label, start_local, end_local, start_utc, end_utc)


def _table_fqn(default_name: str, env_key: str) -> str:
    project = os.environ.get("BQ_PROJECT", "ponder-f84ce")
    dataset = os.environ.get("BQ_ANALYTICS_DATASET", "analytics")
    table = os.environ.get(env_key, default_name)
    return f"{project}.{dataset}.{table}"


def _fetch_stats(window: TimeWindow) -> pd.DataFrame:
    stats_fqn = _table_fqn("unified_scan_adapter_stats", "UNIFIED_SCAN_ADAPTER_TABLE")
    sql = f"""
    SELECT
      run_id,
      adapter_id,
      run_started_at,
      started_at,
      finished_at,
      duration_ms,
      planned_target,
      effective_target,
      raw_rows,
      processed,
      cards_saved,
      cooldown,
      no_body,
      press_none,
      press_empty,
      press_short,
      save_fail,
      unhandled
    FROM `{stats_fqn}`
    WHERE run_started_at >= @start AND run_started_at < @end
    """
    df, _ = run_sql_text(sql, {"start": window.utc_start, "end": window.utc_end})
    return df


def _fetch_events(window: TimeWindow) -> pd.DataFrame:
    events_fqn = _table_fqn("unified_scan_adapter_events", "UNIFIED_SCAN_ADAPTER_EVENT_TABLE")
    sql = f"""
    SELECT
      run_id,
      adapter_id,
      event_type,
      occurred_at,
      message,
      error_class,
      http_status,
      source_url,
      metadata
    FROM `{events_fqn}`
    WHERE occurred_at >= @start AND occurred_at < @end
    """
    df, _ = run_sql_text(sql, {"start": window.utc_start, "end": window.utc_end})
    return df


_NUMERIC_COLS = [
    "duration_ms",
    "planned_target",
    "effective_target",
    "raw_rows",
    "processed",
    "cards_saved",
    "cooldown",
    "no_body",
    "press_none",
    "press_empty",
    "press_short",
    "save_fail",
    "unhandled",
]


def _prep_stats(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    df = df.copy()
    for col in _NUMERIC_COLS:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0).astype(int)
    return df


def _parse_metadata(val) -> Dict[str, Any]:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return {}
    if isinstance(val, dict):
        return val
    if isinstance(val, str):
        val = val.strip()
        if not val:
            return {}
        try:
            return json.loads(val)
        except Exception:
            return {"value": val}
    return {"value": str(val)}


def _prep_events(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    df = df.copy()
    df["metadata_dict"] = df.get("metadata").apply(_parse_metadata)
    return df


def _md_table(df: pd.DataFrame, max_rows: int = 10) -> str:
    if df is None or df.empty:
        return "_No rows._"
    display = df.head(max_rows).copy()
    cols = list(display.columns)
    rows = [[str(x) for x in row] for row in display.itertuples(index=False)]
    widths = [max(len(cols[i]), max((len(r[i]) for r in rows), default=0)) for i in range(len(cols))]

    def fmt(cells: Iterable[str]) -> str:
        return "|" + "|".join(str(cells[i]).ljust(widths[i]) for i in range(len(cells))) + "|"

    separator = "|-" + "-|-".join("-" * w for w in widths) + "-|"
    return "\n".join([fmt(cols), separator] + [fmt(r) for r in rows])


_plain_cleanup = re.compile(r"(?m)^\s*#{1,6}\s*")


def _to_plain_text(md: str) -> str:
    text = _plain_cleanup.sub("", md)
    text = text.replace("**", "").replace("_", "").replace("`", "")
    lines: List[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("|"):
            if set(stripped) <= set("|- "):
                continue
            cells = [c.strip() for c in stripped.strip("|").split("|")]
            lines.append("  • " + "  |  ".join(cells))
        else:
            lines.append(line)
    return "\n".join(lines).strip()


def _adapter_summary(stats_df: pd.DataFrame, events_df: pd.DataFrame) -> pd.DataFrame:
    if stats_df.empty:
        return stats_df

    grouped = stats_df.groupby("adapter_id").agg({
        "run_id": "nunique",
        "cards_saved": "sum",
        "processed": "sum",
        "raw_rows": "sum",
        "press_short": "sum",
        "press_none": "sum",
        "press_empty": "sum",
        "save_fail": "sum",
        "unhandled": "sum",
        "no_body": "sum",
        "cooldown": "sum",
    }).rename(columns={"run_id": "runs"})

    issue_cols = ["press_short", "press_none", "press_empty", "save_fail", "unhandled", "no_body"]
    grouped["issue_total"] = grouped[issue_cols].sum(axis=1)

    if not events_df.empty:
        event_counts = (
            events_df.groupby(["adapter_id", "event_type"]).size().unstack(fill_value=0)
        )
        for adapter, row in event_counts.iterrows():
            if adapter not in grouped.index:
                continue
            grouped.loc[adapter, "issue_total"] += int(row.get("fetch_error", 0)) + int(row.get("press_search_error", 0)) + int(row.get("fetch_empty", 0)) + int(row.get("fetch_below_target", 0)) + int(row.get("save_fail_no_citations", 0)) + int(row.get("save_fail_persist", 0)) + int(row.get("save_fail_source_requirements", 0)) + int(row.get("unhandled_exception", 0)) + int(row.get("contextualize_entities_error", 0))

    grouped["save_rate"] = grouped.apply(
        lambda r: f"{(r['cards_saved'] / r['processed'] * 100):.1f}%" if r["processed"] else "0.0%",
        axis=1,
    )
    grouped = grouped.sort_values(by=["issue_total", "cards_saved"], ascending=[False, False])
    return grouped


def _describe_event_group(event_type: str, df: pd.DataFrame) -> str:
    count = len(df)
    metas = [m for m in df.get("metadata_dict", []) if isinstance(m, dict)]

    def unique_strings(values: Iterable[str]) -> List[str]:
        seen = set()
        ordered: List[str] = []
        for v in values:
            if not v:
                continue
            if v not in seen:
                seen.add(v)
                ordered.append(v)
        return ordered

    summary: Optional[str] = None
    if event_type == "press_short":
        words = [m.get("word_count") for m in metas if isinstance(m.get("word_count"), (int, float))]
        mins = [m.get("min_words") for m in metas if isinstance(m.get("min_words"), (int, float))]
        if words:
            avg_words = sum(words) / len(words)
            min_words = mins[0] if mins else None
            summary = f"avg {avg_words:.0f} words" + (f" vs min {min_words}" if min_words else "")
    elif event_type in {"press_none", "press_empty"}:
        queries = []
        for m in metas:
            q = m.get("queries")
            if isinstance(q, (list, tuple)):
                queries.extend(q)
            elif isinstance(q, str):
                queries.append(q)
        if queries:
            top_queries = ", ".join(unique_strings(queries)[:3])
            summary = f"queries: {top_queries}"
    elif event_type == "press_search_error":
        classes = unique_strings(df.get("error_class", []))
        queries = []
        for m in metas:
            q = m.get("queries")
            if isinstance(q, (list, tuple)):
                queries.extend(q)
            elif isinstance(q, str):
                queries.append(q)
        q_summary = ", ".join(unique_strings(queries)[:2])
        parts = []
        if classes:
            parts.append(f"errors: {', '.join(classes)}")
        if q_summary:
            parts.append(f"queries: {q_summary}")
        summary = "; ".join(parts) if parts else None
    elif event_type in {"fetch_error", "contextualize_entities_error"}:
        classes = unique_strings(df.get("error_class", []))
        if classes:
            summary = f"errors: {', '.join(classes)}"
    elif event_type == "fetch_empty":
        targets = [m.get("target") for m in metas if isinstance(m.get("target"), (int, float))]
        if targets:
            avg_target = sum(targets) / len(targets)
            summary = f"avg target {avg_target:.0f}"
    elif event_type == "fetch_below_target":
        diffs = []
        for m in metas:
            raw = m.get("raw_rows")
            planned = m.get("planned_target")
            if isinstance(raw, (int, float)) and isinstance(planned, (int, float)) and planned:
                diffs.append((raw, planned))
        if diffs:
            avg_raw = sum(r for r, _ in diffs) / len(diffs)
            avg_plan = sum(p for _, p in diffs) / len(diffs)
            summary = f"avg rows {avg_raw:.1f} vs target {avg_plan:.1f}"
    elif event_type == "cooldown_skip":
        last_updates = [m.get("last_updated") for m in metas if m.get("last_updated")]
        if last_updates:
            summary = f"latest last_update {sorted(last_updates)[-1]}"
    elif event_type.startswith("save_fail"):
        messages = unique_strings(df.get("message", []))
        if messages:
            summary = messages[0]
    elif event_type == "unhandled_exception":
        summary = "see metadata stack traces"
    elif event_type == "no_body":
        summary = "LLM returned empty body"

    return f"{event_type}×{count}" + (f" ({summary})" if summary else "")


def _adapter_highlights(adapter_id: str, events_df: pd.DataFrame) -> List[str]:
    if events_df.empty:
        return []
    subset = events_df[events_df["adapter_id"] == adapter_id]
    if subset.empty:
        return []
    groups = []
    for event_type, group in subset.groupby("event_type"):
        groups.append((len(group), _describe_event_group(event_type, group)))
    groups.sort(key=lambda x: x[0], reverse=True)
    return [g for _, g in groups[:3] if g]


def _primary_event(adapter_id: str, events_df: pd.DataFrame) -> Optional[Tuple[str, pd.DataFrame]]:
    if events_df.empty:
        return None
    subset = events_df[events_df["adapter_id"] == adapter_id]
    if subset.empty:
        return None
    counts = subset.groupby("event_type").size().sort_values(ascending=False)
    if counts.empty:
        return None
    event_type = counts.index[0]
    group = subset[subset["event_type"] == event_type]
    return event_type, group


def _recommendation(adapter_id: str, stats_row: pd.Series, events_df: pd.DataFrame) -> str:
    primary = _primary_event(adapter_id, events_df)
    if not primary:
        return (
            f"Focus on `{adapter_id}` — {int(stats_row['issue_total'])} blocking events with no matching metadata. "
            "Review adapter logs for details."
        )
    event_type, group = primary
    count = len(group)
    metas = [m for m in group.get("metadata_dict", []) if isinstance(m, dict)]

    def avg(values: List[float]) -> Optional[float]:
        return sum(values) / len(values) if values else None

    if event_type == "press_short":
        words = [m.get("word_count") for m in metas if isinstance(m.get("word_count"), (int, float))]
        mins = [m.get("min_words") for m in metas if isinstance(m.get("min_words"), (int, float))]
        avg_words = avg(words)
        min_words = mins[0] if mins else None
        if avg_words:
            min_clause = f" vs threshold {int(min_words)}" if min_words else ""
            return (
                f"Adjust `{adapter_id}` press coverage — {count} cards stalled with ~{avg_words:.0f} words{min_clause}. "
                "Add richer sources or lower MIN_PRESS_WORDS for this lane."
            )
    elif event_type == "press_none":
        queries = []
        for m in metas:
            q = m.get("queries")
            if isinstance(q, (list, tuple)):
                queries.extend(q)
            elif isinstance(q, str):
                queries.append(q)
        preview = ", ".join(dict.fromkeys(queries)[:3])
        return (
            f"Tighten `{adapter_id}` search queries — {count} entities had zero press hits (e.g., {preview}). "
            "Review query templates or expand trusted sources."
        )
    elif event_type == "press_empty":
        return (
            f"Improve scraping for `{adapter_id}` — {count} press hits returned no body text. "
            "Check selector mappings or fallback extraction paths."
        )
    elif event_type == "press_search_error":
        classes = list(dict.fromkeys(group.get("error_class", [])))
        class_text = ", ".join(c for c in classes if c)
        return (
            f"Stabilize `{adapter_id}` press search — {count} errors ({class_text}). "
            "Validate API credentials and handle transient failures."
        )
    elif event_type == "fetch_error":
        classes = list(dict.fromkeys(group.get("error_class", [])))
        class_text = ", ".join(c for c in classes if c)
        return (
            f"Fix `{adapter_id}` fetch pipeline — {count} fetch errors ({class_text or 'see logs'}). "
            "Audit adapter.fetch and upstream responses."
        )
    elif event_type == "fetch_empty":
        targets = [m.get("target") for m in metas if isinstance(m.get("target"), (int, float))]
        avg_target = avg(targets)
        if avg_target:
            return (
                f"Expand `{adapter_id}` sources — fetch returned 0 rows {count} times despite target ≈{avg_target:.0f}. "
                "Confirm feeds are live or broaden discovery."
            )
        return (
            f"Expand `{adapter_id}` sources — fetch returned 0 rows {count} times. "
            "Confirm feeds are live or broaden discovery."
        )
    elif event_type == "fetch_below_target":
        diffs = []
        for m in metas:
            raw = m.get("raw_rows")
            planned = m.get("planned_target")
            if isinstance(raw, (int, float)) and isinstance(planned, (int, float)):
                diffs.append((raw, planned))
        if diffs:
            avg_raw = sum(r for r, _ in diffs) / len(diffs)
            avg_plan = sum(p for _, p in diffs) / len(diffs)
            return (
                f"Increase supply for `{adapter_id}` — only {avg_raw:.1f}/{avg_plan:.1f} rows per fetch across {count} runs. "
                "Consider widening sources or raising freshness windows."
            )
    elif event_type.startswith("save_fail"):
        return (
            f"Resolve save failures in `{adapter_id}` — {event_type} triggered {count} times. "
            "Inspect card validation and Firestore writes."
        )
    elif event_type == "no_body":
        return (
            f"Revisit prompts for `{adapter_id}` — the LLM returned empty bodies {count} times. "
            "Check schema guidance and prompt hints."
        )
    elif event_type == "unhandled_exception":
        return (
            f"Triage `{adapter_id}` exceptions — {count} unhandled errors captured. "
            "Inspect event metadata for stack traces."
        )
    elif event_type == "contextualize_entities_error":
        return (
            f"Repair `{adapter_id}` enrichment — contextualize_entities failed {count} times. "
            "Verify entity payloads and enrichment service."
        )

    return (
        f"Focus on `{adapter_id}` — {event_type} triggered {count} times. "
        "Review the lane configuration and recent logs."
    )


def _format_overview(stats_df: pd.DataFrame) -> List[str]:
    total_runs = int(stats_df["run_id"].nunique())
    adapter_invocations = len(stats_df)
    cards_saved = int(stats_df["cards_saved"].sum())
    processed = int(stats_df["processed"].sum())
    conversion = (cards_saved / processed * 100) if processed else 0.0
    return [
        f"- Runs: {total_runs}",
        f"- Adapter executions: {adapter_invocations}",
        f"- Cards saved: {cards_saved}",
        f"- Processed entities: {processed} (conversion {conversion:.1f}%)",
    ]


def _event_overview(events_df: pd.DataFrame) -> pd.DataFrame:
    if events_df.empty:
        return pd.DataFrame()
    counts = events_df.groupby("event_type").size().reset_index(name="count")
    return counts.sort_values("count", ascending=False)


def main():
    args = _parse_args()
    window = _target_window(args)
    stats_raw = _fetch_stats(window)
    stats_df = _prep_stats(stats_raw)
    events_raw = _fetch_events(window)
    events_df = _prep_events(events_raw)

    lines: List[str] = []
    lines.append(f"# Unified Scan Daily Summary ({window.label})")
    lines.append("")
    lines.append(
        f"Window: {window.local_start.strftime('%Y-%m-%d %H:%M %Z')} – {window.local_end.strftime('%Y-%m-%d %H:%M %Z')}"
    )
    lines.append("")

    if stats_df.empty:
        lines.append("_No unified scan runs found in this window._")
        report_md = "\n".join(lines)
        (BASE_DIR / "report.md").write_text(report_md)
        print(_to_plain_text(report_md))
        return

    overview = _format_overview(stats_df)
    lines.append("## Overview")
    lines.extend(overview)
    lines.append("")

    adapter_summary = _adapter_summary(stats_df, events_df)

    top_table = adapter_summary[[
        "runs",
        "cards_saved",
        "processed",
        "save_rate",
        "issue_total",
        "press_short",
        "press_none",
        "press_empty",
        "save_fail",
        "unhandled",
        "cooldown",
    ]].reset_index().rename(columns={"adapter_id": "adapter"})
    lines.append("## Adapter performance")
    lines.append(_md_table(top_table))
    lines.append("")

    issue_df = adapter_summary[adapter_summary["issue_total"] > 0]
    if not issue_df.empty:
        lines.append("## Problem areas")
        for adapter_id, row in issue_df.head(5).iterrows():
            highlight = _adapter_highlights(adapter_id, events_df)
            detail_parts = []
            for col in ["press_short", "press_none", "press_empty", "save_fail", "unhandled", "no_body"]:
                val = int(row.get(col, 0))
                if val:
                    detail_parts.append(f"{col.replace('_', ' ')}={val}")
            event_text = "; ".join(highlight)
            cooldown_note = f" cooldown={int(row['cooldown'])}" if int(row.get("cooldown", 0)) else ""
            bullet = f"- **{adapter_id}** — issue_total={int(row['issue_total'])}; "
            if detail_parts:
                bullet += ", ".join(detail_parts)
            else:
                bullet += "no detailed counters"
            if cooldown_note:
                bullet += ";" + cooldown_note
            if event_text:
                bullet += f". Signals: {event_text}."
            else:
                bullet += "."
            lines.append(bullet)
        lines.append("")

    event_overview = _event_overview(events_df)
    if not event_overview.empty:
        lines.append("## Event distribution")
        lines.append(_md_table(event_overview))
        lines.append("")

    recommendation: str
    if not issue_df.empty:
        top_adapter_id = issue_df.index[0]
        recommendation = _recommendation(top_adapter_id, issue_df.loc[top_adapter_id], events_df)
    else:
        recommendation = "Unified scan lanes ran clean yesterday — no blocking issues detected."

    lines.append("## Recommendation")
    lines.append(recommendation)

    report_md = "\n".join(lines)
    (BASE_DIR / "report.md").write_text(report_md)
    print(_to_plain_text(report_md))


if __name__ == "__main__":
    main()
