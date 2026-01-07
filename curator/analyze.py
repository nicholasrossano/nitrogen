import os, json, argparse, re, datetime as dt, traceback
from pathlib import Path
from typing import Dict, Any, Tuple, List, Optional
import pandas as pd
import matplotlib.pyplot as plt

from tools.bigquery_client import run_sql_text
# Firestore fallback for finetuning logs (no extra file needed)
from google.cloud import firestore
from google.oauth2 import service_account


# ─────────── Plain-text rendering ───────────
def to_plain_text(md: str) -> str:
    text = re.sub(r'(?m)^\s*#{1,6}\s*', '', md)
    text = text.replace('**', '').replace('_', '').replace('`', '')
    lines = []
    for line in text.splitlines():
        s = line.strip()
        if s.startswith('|'):
            if set(s) <= set('|- '):
                continue
            cells = [c.strip() for c in s.strip('|').split('|')]
            lines.append('  • ' + '  |  '.join(cells))
        else:
            lines.append(line)
    return '\n'.join(lines).strip()

BASE_DIR = Path(__file__).resolve().parent
MANIFEST_PATH = BASE_DIR / "schemas/_manifest.json"

# ───────────────────────── Manifest helpers ─────────────────────────
def load_manifest() -> Dict[str, Any]:
    path = MANIFEST_PATH
    if not path.exists():
        return {"datasets": []}
    try:
        return json.loads(path.read_text())
    except Exception:
        return {"datasets": []}

def iter_tables(manifest: Dict[str, Any]):
    for ds_name, ds in (manifest.get("datasets") or {}).items():
        for t in ds.get("tables", []):
            yield {
                "dataset": ds_name,
                "name": t.get("name"),
                "table": t.get("table"),
                "type": t.get("type", "TABLE"),
                "time_field": t.get("time_field"),
                "columns": t.get("columns", []),
            }

def columns_map(entry: Dict[str, Any]) -> Dict[str, str]:
    return {c["name"]: c.get("type", "") for c in (entry.get("columns") or [])}

def pick_time_field(entry: Dict[str, Any]) -> Optional[str]:
    if entry.get("time_field"):
        return entry["time_field"]
    for c in (entry.get("columns") or []):
        if c.get("type") in ("TIMESTAMP", "DATETIME"):
            return c["name"]
    return None

# ───────────────────────── Range helpers ─────────────────────────
def parse_range(range_expr: Optional[str], start: Optional[str], end: Optional[str], window: Optional[int]) -> Tuple[dt.datetime, dt.datetime, str]:
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)

    if start or end:
        s = dt.datetime.fromisoformat(start) if start else (now - dt.timedelta(days=window or 7))
        e = dt.datetime.fromisoformat(end)   if end   else now
        label = f"{s.isoformat()} – {e.isoformat()}"
        return s, e, label

    if window:
        s = now - dt.timedelta(days=window)
        return s, now, f"last {window}d"

    if range_expr:
        e = range_expr.strip().lower()
        if e in ("7d","last 7d","last7","last week"): return now-dt.timedelta(days=7), now, "last 7d"
        if e in ("14d","last 14d"): return now-dt.timedelta(days=14), now, "last 14d"
        if e in ("30d","last 30d","last month"): return now-dt.timedelta(days=30), now, "last month"
        if e in ("last quarter",): return now-dt.timedelta(days=90), now, "last quarter"
        if e in ("this month","mtd"):
            s = now.replace(day=1, hour=0, minute=0, second=0)
            return s, now, "this month"
        if e in ("this quarter","qtd"):
            q_start = ((now.month-1)//3)*3 + 1
            s = now.replace(month=q_start, day=1, hour=0, minute=0, second=0)
            return s, now, "this quarter"

    s = now - dt.timedelta(days=7)
    return s, now, "last 7d"

# ───────────────────────── Render helpers ─────────────────────────
def md_table(df: pd.DataFrame, max_rows: int = 12) -> str:
    if df is None or df.empty: return "_No rows._"
    df = df.head(max_rows).copy()
    cols = list(df.columns)
    rows = [[str(x) for x in row] for row in df.itertuples(index=False)]

    # autosize columns
    widths = [max(len(cols[i]), max((len(r[i]) for r in rows), default=0)) for i in range(len(cols))]
    def fmt(cells):
        return "|" + "|".join(str(cells[i]).ljust(widths[i]) for i in range(len(cells))) + "|"
    sep = "|-" + "-|-".join("-"*w for w in widths) + "-|"
    return "\n".join([fmt(cols), sep] + [fmt(r) for r in rows])

def chart_daily(df: pd.DataFrame, path: Path):
    if df is None or df.empty: return
    x = pd.to_datetime(df["day"])
    plt.figure()
    plt.plot(x, df["approved"]); plt.plot(x, df["rejected"])
    plt.title("Daily approvals vs rejections"); plt.xlabel("day"); plt.ylabel("count")
    plt.tight_layout(); plt.savefig(path); plt.close()

def chart_reasons(df: pd.DataFrame, path: Path, top: int = 8):
    if df is None or df.empty: return
    d = df.sort_values(df.columns[-1], ascending=False).head(top)
    plt.figure()
    plt.bar(d[d.columns[0]], d[d.columns[-1]])
    plt.title("Top rejection reasons"); plt.xticks(rotation=45, ha="right")
    plt.tight_layout(); plt.savefig(path); plt.close()

# ───────────────────────── Table classifiers ─────────────────────────
_reason_regex = re.compile(r"(?i)^(reason(_code)?|rejection_reason|reject_reason).*")
_fatal_regex  = re.compile(r"(?i)^(is_)?fatal$")
_latency_re   = re.compile(r"(?i)(duration|latency)")
_ga4_ds_re    = re.compile(r"^analytics_\d+$")

def is_cards_like(entry):
    cols = columns_map(entry)
    return "status" in cols and (("topic" in cols) or ("topic_id" in cols)) and pick_time_field(entry)

def cards_cols(entry):
    cols = columns_map(entry)
    time_col   = pick_time_field(entry)
    topic_col  = "topic" if "topic" in cols else ("topic_id" if "topic_id" in cols else None)
    reason_col = next((c for c in cols if _reason_regex.match(c)), None)
    sources_col= "sources" if "sources" in cols else None

    gaps = []
    for c in ("title","summary","url","image_url"):
        if c not in cols: gaps.append(c)
    return time_col, topic_col, reason_col, sources_col, gaps

def is_finetune_like(entry):
    cols = columns_map(entry)
    return ("status" in cols or "loss" in cols or "metrics" in cols) and pick_time_field(entry)

def is_ga4_dataset(ds_name: str) -> bool:
    return bool(_ga4_ds_re.match(ds_name or ""))

def is_user_action_like(entry):
    cols = columns_map(entry)
    return (("action" in cols) or ("event" in cols) or ("type" in cols)) and pick_time_field(entry)

def is_crashlytics_like(entry):
    name = (entry.get("name") or "").lower()
    return "crash" in name or "crashlytics" in name

def is_performance_like(entry):
    name = (entry.get("name") or "").lower()
    return "perf" in name or "performance" in name

# ───────────────────────── SQL builders ─────────────────────────
def q_cards_daily(table, tf):
    return f"""
    with d as (
      select
        date({tf}) as day,
        count(*) as total,
        sum(case when status = 'APPROVED' then 1 else 0 end) as approved,
        sum(case when status = 'REJECTED' then 1 else 0 end) as rejected
      from `{table}`
      where {tf} between @start_ts and @end_ts
      group by 1
    )
    select day, total, approved, rejected
    from d
    order by day asc
    """

def q_cards_reasons(table, tf, reason_col):
    return f"""
    select {reason_col} as reason, count(*) as n
    from `{table}`
    where {tf} between @start_ts and @end_ts and status = 'REJECTED'
    group by 1
    order by n desc
    """

def q_cards_light(table, tf, topic_expr, gaps, sources_col):
    gaps_select = ", ".join(f"({c} is null) as gap_{c}" for c in gaps) if gaps else "false as gap_none"
    sources_sel = f", {sources_col} as sources" if sources_col else ""
    return f"""
    select
      {tf} as ts,
      {topic_expr} as {('topic' if topic_expr!='topic' else 'topic')},
      status,
      {gaps_select}
      {sources_sel}
    from `{table}`
    where {tf} between @start_ts and @end_ts
    """

def q_ft_overview(table, tf):
    return f"""
    select
      date({tf}) as day,
      count(*) as n,
      sum(case when status in ('ok','success','completed') then 1 else 0 end) as ok,
      sum(case when status in ('error','failed') then 1 else 0 end) as err
    from `{table}`
    where {tf} between @start_ts and @end_ts
    group by 1
    order by day asc
    """

def q_ga4_events(ds, tf):
    return f"""
    select
      parse_date('%Y%m%d', event_date) as day,
      coalesce(event_name, '(none)') as event_name,
      count(*) as n
    from `{ds}.events_*`
    where _table_suffix between format_date('%Y%m%d', date(@start_ts))
                           and format_date('%Y%m%d', date(@end_ts))
    group by 1,2
    order by day asc, n desc
    """

def q_user_actions(table, tf):
    return f"""
    select
      date({tf}) as day,
      coalesce(action, event, type, '(none)') as action,
      count(*) as n
    from `{table}`
    where {tf} between @start_ts and @end_ts
    group by 1,2
    order by day asc, n desc
    """

def q_crash_daily(table, tf, fatal_col):
    return f"""
    select
      date({tf}) as day,
      count(*) as n,
      sum(case when {fatal_col} then 1 else 0 end) as fatal
    from `{table}`
    where {tf} between @start_ts and @end_ts
    group by 1
    order by day asc
    """

def q_perf_overview(table, tf):
    return f"""
    select
      date({tf}) as day,
      avg(cast(value as float64)) as avg_value
    from `{table}`
    where {tf} between @start_ts and @end_ts
    group by 1
    order by day asc
    """

# ───────────────────────── GA4 helpers ─────────────────────────
_ga4_date_col = "event_date"
_ga4_ts_col   = "event_timestamp"

def ga4_dataset_name(manifest: Dict[str, Any]) -> Optional[str]:
    for ds in (manifest.get("datasets") or []):
        if isinstance(ds, dict) and is_ga4_dataset(ds.get("dataset") or ""):
            return ds.get("dataset")
    return None

# ───────────────────────── Firestore helpers ─────────────────────────
def get_firestore_client() -> firestore.Client:
    raw = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON")
    proj = os.environ.get("BQ_PROJECT")
    if raw:
        creds = service_account.Credentials.from_service_account_info(json.loads(raw))
        return firestore.Client(project=proj, credentials=creds)
    return firestore.Client(project=proj)

def firestore_ts_to_dt(v):
    try:
        from google.cloud.firestore_v1._helpers import DatetimeWithNanoseconds
        if isinstance(v, DatetimeWithNanoseconds):
            return v if v.tzinfo else v.replace(tzinfo=dt.timezone.utc)
    except Exception:
        pass
    if isinstance(v, dict) and {"_seconds","_nanoseconds"} <= set(v.keys()):
        d = dt.datetime.fromtimestamp(v["_seconds"] + v["_nanoseconds"]/1e9, tz=dt.timezone.utc)
        return d
    return v

# ───────────────────────── Main analysis ─────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--range", dest="range_expr")
    ap.add_argument("--start"); ap.add_argument("--end"); ap.add_argument("--window", type=int)
    ap.add_argument("--sections", default="cards,finetuning,ga4,user_actions,crashlytics,performance")
    args = ap.parse_args()

    manifest = load_manifest()
    project  = os.environ["BQ_PROJECT"]
    start_ts, end_ts, label = parse_range(args.range_expr, args.start, args.end, args.window)
    params = {"start_ts": start_ts, "end_ts": end_ts}

    want      = set(s.strip() for s in args.sections.split(",") if s.strip())
    sections  = []
    warnings  = []

    # ----- CARDS -----
    if "cards" in want:
        try:
            # prefer explicit table if provided
            bq_cards = os.environ.get("BQ_TABLE_CARDS")
            cards = [t for t in iter_tables(manifest) if is_cards_like(t)]
            if bq_cards:
                cards = [t for t in cards if t.get("table") == bq_cards] or cards

            if not cards:
                sections.append("### Cards\n_No cards-like table found._")
            else:
                t = cards[0]
                time_col, topic_col, reason_col, sources_col, gaps = cards_cols(t)
                daily_df, _ = run_sql_text(q_cards_daily(t["table"], time_col), params)
                if daily_df is None: daily_df = pd.DataFrame(columns=["day","total","approved","rejected"])
                if not daily_df.empty:
                    daily_df = daily_df.assign(**{"rejection_rate(%)": lambda d: (d["rejected"]/d["total"].replace(0,1)*100).round(1)})
                    chart_daily(daily_df[["day","approved","rejected"]].copy(), BASE_DIR/"daily.png")
                daily_md = md_table(daily_df[["day","total","approved","rejected","rejection_rate(%)"]] if "rejection_rate(%)" in daily_df else daily_df)

                if reason_col:
                    reasons_df, _ = run_sql_text(q_cards_reasons(t["table"], time_col, reason_col), params)
                    reasons_md = md_table(reasons_df.rename(columns={"n":"count"})) if (reasons_df is not None and not reasons_df.empty) else "_No rejected rows / reasons in window._"
                    if reasons_df is not None and not reasons_df.empty:
                        chart_reasons(reasons_df, BASE_DIR/"reasons.png")
                else:
                    reasons_md = "_No reason column detected; skipped._"

                topic_expr = topic_col if topic_col == "topic" else topic_col
                light_df, _ = run_sql_text(q_cards_light(t["table"], time_col, topic_expr, gaps, sources_col), params)
                if light_df is not None and not light_df.empty:
                    light_df = light_df.rename(columns={topic_col:"topic"}) if topic_col != "topic" else light_df
                    agg = (light_df.assign(total=1).groupby("topic", as_index=False)
                           .agg(total=("total","sum"), rejected=("status", lambda s:(s=="REJECTED").sum())))
                    agg["rej_rate(%)"] = (agg["rejected"]/agg["total"].replace(0,1)*100).round(1)
                    hotspots_md = md_table(agg.sort_values(["rej_rate(%)","rejected","total"], ascending=[False,False,False]).head(12))
                else:
                    hotspots_md = "_No rows in window._"

                gaps_present = [g for g in gaps if ("gap_"+g) in (light_df.columns if (light_df is not None and not light_df.empty) else [])]
                if gaps_present and light_df is not None and not light_df.empty:
                    gap_cols = ["gap_"+g for g in gaps_present]
                    grp = light_df.assign(total=1).groupby(gap_cols, as_index=False).agg(total=("total","sum")).sort_values("total", ascending=False)
                    gap_md = md_table(grp)
                else:
                    gap_md = "_No gap columns found_"

                sections.append(
                    "### Cards\n" +
                    "**Daily approvals vs rejections**\n" + daily_md + "\n\n" +
                    "**Top rejection reasons**\n" + reasons_md + "\n\n" +
                    "**Hotspots by topic**\n" + hotspots_md + "\n\n" +
                    "**Gaps present**\n" + gap_md
                )
        except Exception as e:
            warnings.append(f"Cards section failed: {e}")

    # ----- FINETUNING -----
    if "finetuning" in want:
        try:
            ft = [t for t in iter_tables(manifest) if is_finetune_like(t)]
            if not ft:
                sections.append("### Finetuning\n_No finetuning-like tables found._")
            else:
                t = ft[0]
                tf = pick_time_field(t) or "ts"
                df, _ = run_sql_text(q_ft_overview(t["table"], tf), params)
                df = df if df is not None else pd.DataFrame(columns=["day","n","ok","err"])
                ft_md = md_table(df.rename(columns={"n":"total","ok":"ok","err":"errors"}))
                sections.append("### Finetuning\n" + ft_md)
        except Exception as e:
            warnings.append(f"Finetuning section failed: {e}")

    # ----- GA4 -----
    if "ga4" in want:
        try:
            ds = ga4_dataset_name(manifest)
            if not ds:
                sections.append("### GA4\n_No GA4 dataset detected._")
            else:
                df, _ = run_sql_text(q_ga4_events(ds, _ga4_ts_col), params)
                md = md_table(df if df is not None else pd.DataFrame(columns=["day","event_name","n"]))
                sections.append("### GA4\n" + md)
        except Exception as e:
            warnings.append(f"GA4 section failed: {e}")

    # ----- USER ACTIONS -----
    if "user_actions" in want:
        try:
            ua = [t for t in iter_tables(manifest) if is_user_action_like(t)]
            if not ua:
                sections.append("### User actions\n_No user-action-like tables found._")
            else:
                t = ua[0]
                tf = pick_time_field(t) or "ts"
                df, _ = run_sql_text(q_user_actions(t["table"], tf), params)
                md = md_table(df if df is not None else pd.DataFrame(columns=["day","action","n"]))
                sections.append("### User actions\n" + md)
        except Exception as e:
            warnings.append(f"User actions section failed: {e}")

    # ----- CRASHLYTICS -----
    if "crashlytics" in want:
        try:
            crash = [t for t in iter_tables(manifest) if is_crashlytics_like(t)]
            if not crash:
                sections.append("### Crashlytics\n_No crash tables detected._")
            else:
                t = crash[0]
                tf = pick_time_field(t) or "ts"
                fatal_col = next((c for c in ("is_fatal","fatal","isFatal") if c in columns_map(t)), "is_fatal")
                df, _ = run_sql_text(q_crash_daily(t["table"], tf, fatal_col), params)
                md = md_table((df if df is not None else pd.DataFrame(columns=["day","n","fatal"])).rename(columns={"n":"total","fatal":"fatal"}))
                sections.append("### Crashlytics\n" + md)
        except Exception as e:
            warnings.append(f"Crashlytics section failed: {e}")

    # ----- PERFORMANCE -----
    if "performance" in want:
        try:
            perf = [t for t in iter_tables(manifest) if is_performance_like(t)]
            if not perf:
                sections.append("### Performance\n_No performance-like tables detected._")
            else:
                out = []
                shown = 0
                for t in perf:
                    if shown >= 2: break
                    cols = columns_map(t); tf = pick_time_field(t)
                    df, _ = run_sql_text(q_perf_overview(t["table"], tf), params)
                    if df is None or df.empty: continue
                    out.append("**" + (t.get("name") or t.get("table")) + "**\n" + md_table(df.rename(columns={"avg_value":"avg"})))
                    shown += 1
                sections.append("### Performance\n" + ("\n\n".join(out) if out else "_No perf rows in window._"))
        except Exception as e:
            warnings.append(f"Performance section failed: {e}")

    # ----- assemble & emit -----
    header = f"# Curator Report\n\n_Window: {label}_\n"
    if warnings:
        sections.append("\n### Warnings\n" + "\n".join(f"- {w}" for w in warnings))
    report = header + "\n\n".join(sections) + "\n"
    (BASE_DIR/"report.md").write_text(report, encoding="utf-8")
    use_plain = os.getenv("CURATOR_THREAD_PLAIN", "0") == "1"
    if use_plain:
        text_report = to_plain_text(report)
        try:
            (BASE_DIR/"report.txt").write_text(text_report, encoding="utf-8")
        except Exception:
            pass
        print(text_report)
    else:
        print(report)
if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        err = f"# Curator Report\n\n## Fatal error\n- {e}\n{traceback.format_exc()}"
        (BASE_DIR/"report.md").write_text(err, encoding="utf-8")
        if os.getenv("CURATOR_THREAD_PLAIN", "0") == "1":
            print(to_plain_text(err))
        else:
            print(err)
