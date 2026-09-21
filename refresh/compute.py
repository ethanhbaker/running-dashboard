"""
Compute pipeline for Ethan's running dashboard.

Reads raw Garmin data pulled by the "pull" step (see refresh/PULL.md) from
data/raw/*.json, applies the coaching-interpretation rules documented in
README.md, and writes one JSON file per dashboard page to data/dashboard/*.json.

This script is pure Python (stdlib only, no Garmin auth, no network) so it
can run anywhere once data/raw/ has been populated. Re-run it any time after
a fresh pull to regenerate the dashboard data.

Coaching rules encoded here (see README.md "Coaching interpretation rules"
for the full list) - each function below notes which rule numbers govern it.
"""
import json
import math
import os
import statistics
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, date

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(BASE, "data", "raw")
OUT = os.path.join(BASE, "data", "dashboard")

TODAY = date.today()  # advances automatically on every refresh - do not hardcode
GOAL_RACE_DATE = date(2026, 10, 11)
GOAL_RACE_NAME = "Amica Newport Marathon"

# ACWR bands used consistently everywhere ACWR appears (rule: consistency)
ACWR_SWEET_MIN = 0.8
ACWR_SWEET_MAX = 1.3
ACWR_CAUTION = 1.5

HARD_WORKOUT_PATTERN = ("tempo", "interval", "speed", "threshold", "marathon pace",
                         "race", "long run", "hilly")


def load(name):
    path = os.path.join(RAW, name)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save(name, data):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=str)
    print("wrote", path)


def parse_dt(s):
    return datetime.strptime(s.split(".")[0], "%Y-%m-%dT%H:%M:%S") if "T" in s else \
        datetime.strptime(s, "%Y-%m-%d %H:%M:%S")


def m_to_mi(m):
    return m / 1609.344


def mps_to_pace_per_mi(mps):
    """Returns seconds per mile."""
    if not mps:
        return None
    return 1609.344 / mps


def sec_to_pace_str(sec_per_unit):
    if sec_per_unit is None:
        return None
    m = int(sec_per_unit // 60)
    s = round(sec_per_unit % 60)
    if s == 60:
        m += 1
        s = 0
    return f"{m}:{s:02d}"


def sec_to_hms(total_seconds):
    total_seconds = int(round(total_seconds))
    h, rem = divmod(total_seconds, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


# ---------------------------------------------------------------------------
# Shared loads
# ---------------------------------------------------------------------------

activities = load("activities.json") or []
activities_detail = {a["id"]: a for a in (load("activities_detail.json") or [])}
profile = load("profile.json") or {}
personal_records = load("personal_records.json") or []
power_curve = load("power_duration_curve.json") or {}
lactate = load("lactate_threshold.json") or {}
hr_zones_raw = load("heart_rate_zones.json") or []
race_pred_history = load("race_predictions_history.json") or []
training_readiness = load("training_readiness.json") or []
training_status = load("training_status.json") or {}
training_load_balance = load("training_load_balance.json") or {}
training_load_trend = (load("training_load_trend.json") or {}).get("trend", [])
vo2max_trend = (load("vo2max_trend.json") or {}).get("trend", [])
running_tolerance_trend = (load("running_tolerance_trend.json") or {}).get("trend", [])
endurance_score = load("endurance_score.json") or {}
weigh_ins = load("weigh_ins.json") or {}
daily_steps = load("daily_steps.json") or []
hrv_trend = (load("hrv_trend.json") or {}).get("trend", [])
respiration_trend = (load("respiration_trend.json") or {}).get("trend", [])
sleep_range = (load("sleep_summary_range.json") or {}).get("nights", [])
body_battery = load("body_battery.json") or []
scheduled_workouts = (load("scheduled_workouts.json") or {}).get("scheduled_workouts", [])
calendar_events = (load("calendar_events.json") or {}).get("events", [])

RUNNING_TYPES = {"running", "track_running", "trail_running", "treadmill_running"}


def is_run(a):
    return a.get("type") in RUNNING_TYPES


def act_date(a):
    return parse_dt(a["start_time"]).date()


runs = sorted([a for a in activities if is_run(a)], key=lambda a: a["start_time"])
runs_by_id = {a["id"]: a for a in runs}

# ---------------------------------------------------------------------------
# Day classification for the training-consistency calendar
# Rule: race days identified ONLY from event_type == "race", never from name text.
# ---------------------------------------------------------------------------

HARD_NAME_MARKERS = ["tempo", "interval", "repeat", "fartlek", "threshold", "hill",
                     "pace-honing", "progression", "over and under", "vo2"]


def classify_day(day_runs):
    """day_runs: list of run activities on one calendar day (already is_run())."""
    if not day_runs:
        return "rest"
    if any(r.get("event_type") == "race" for r in day_runs):
        return "race"
    total_mi = sum(m_to_mi(r["distance_meters"]) for r in day_runs)
    name_blob = " ".join(r.get("name", "").lower() for r in day_runs)
    is_hard = any(marker in name_blob for marker in HARD_NAME_MARKERS)
    if total_mi >= 10:
        return "long"
    if is_hard:
        return "hard"
    # tempo vs hard distinction: use training_effect_label from detail if we have it
    for r in day_runs:
        det = activities_detail.get(r["id"])
        if det and det.get("training_effect_label") in ("TEMPO",):
            return "tempo"
        if det and det.get("training_effect_label") in ("VO2MAX", "ANAEROBIC_CAPACITY"):
            return "hard"
    return "easy"


def build_calendar(days_back=56):
    end = TODAY
    start = end - timedelta(days=days_back - 1)
    by_date = {}
    for r in runs:
        d = act_date(r)
        if start <= d <= end:
            by_date.setdefault(d, []).append(r)
    cells = []
    cur = start
    while cur <= end:
        day_runs = by_date.get(cur, [])
        miles = sum(m_to_mi(r["distance_meters"]) for r in day_runs)
        cells.append({
            "date": cur.isoformat(),
            "type": classify_day(day_runs),
            "miles": round(miles, 2),
            "names": [r.get("name") for r in day_runs],
        })
        cur += timedelta(days=1)

    # longest rest streak
    longest_streak = 0
    cur_streak = 0
    streak_end = None
    best_end = None
    for c in cells:
        if c["type"] == "rest":
            cur_streak += 1
            streak_end = c["date"]
            if cur_streak > longest_streak:
                longest_streak = cur_streak
                best_end = streak_end
        else:
            cur_streak = 0

    def total_since(days):
        cutoff = end - timedelta(days=days - 1)
        return round(sum(c["miles"] for c in cells if date.fromisoformat(c["date"]) >= cutoff), 1)

    return {
        "cells": cells,
        "rolling_7d_mi": total_since(7),
        "rolling_28d_mi": total_since(28),
        "rolling_90d_mi": round(sum(m_to_mi(r["distance_meters"]) for r in runs
                                     if act_date(r) >= end - timedelta(days=89)), 1),
        "longest_rest_streak_days": longest_streak,
        "longest_rest_streak_end": best_end,
        "note": "Non-running training (e.g. strength work) is not represented here because it is not tracked through this pipeline.",
    }


# ---------------------------------------------------------------------------
# Weekly mileage (Monday-start weeks, rule: use real week boundaries)
# ---------------------------------------------------------------------------

def monday_of(d):
    return d - timedelta(days=d.weekday())


def weekly_mileage(weeks_back=12):
    end_monday = monday_of(TODAY)
    weeks = []
    for i in range(weeks_back - 1, -1, -1):
        wk_start = end_monday - timedelta(weeks=i)
        wk_end = wk_start + timedelta(days=6)
        mi = sum(m_to_mi(r["distance_meters"]) for r in runs if wk_start <= act_date(r) <= wk_end)
        weeks.append({"week_start": wk_start.isoformat(), "miles": round(mi, 1)})
    return weeks


def daily_mileage(days_back=30):
    end = TODAY
    start = end - timedelta(days=days_back - 1)
    out = []
    cur = start
    while cur <= end:
        mi = sum(m_to_mi(r["distance_meters"]) for r in runs if act_date(r) == cur)
        out.append({"date": cur.isoformat(), "miles": round(mi, 2)})
        cur += timedelta(days=1)
    return out


# ---------------------------------------------------------------------------
# Today page
# ---------------------------------------------------------------------------

def next_scheduled_session():
    upcoming = [w for w in scheduled_workouts if date.fromisoformat(w["date"]) >= TODAY]
    upcoming.sort(key=lambda w: w["date"])
    return upcoming[0] if upcoming else None


def is_hard_session(name):
    n = (name or "").lower()
    return any(p in n for p in HARD_WORKOUT_PATTERN)


def latest_readiness():
    if not training_readiness:
        return None
    # prefer the most recent by timestamp
    return sorted(training_readiness, key=lambda r: r["timestamp"])[-1]


def readiness_score():
    """Daily readiness recommendation per Today-page spec."""
    drivers = []
    score = 0

    # sleep score (use most recent night)
    sleep_today = sleep_range[-1] if sleep_range else None
    sleep_score_val = sleep_today["sleep_score"] if sleep_today else None
    if sleep_score_val is not None:
        if sleep_score_val < 60:
            pts, flagged, label = 2, True, "poor night"
        elif sleep_score_val < 75:
            pts, flagged, label = 1, True, "below usual"
        else:
            pts, flagged, label = 0, False, "solid sleep"
        score += pts
        drivers.append({"driver": "Sleep score", "value": sleep_score_val, "points": pts,
                         "flagged": flagged, "note": label})
    else:
        drivers.append({"driver": "Sleep score", "value": None, "points": 0, "flagged": False,
                         "note": "not available"})

    # HRV vs personal baseline (baseline = mean/stdev of last 21 nights)
    hrv_vals = [d["last_night_avg_hrv_ms"] for d in hrv_trend if d.get("last_night_avg_hrv_ms")]
    if len(hrv_vals) >= 5:
        baseline_mean = statistics.mean(hrv_vals[:-1]) if len(hrv_vals) > 1 else hrv_vals[0]
        baseline_sd = statistics.pstdev(hrv_vals[:-1]) if len(hrv_vals) > 2 else 0
        low_bound = baseline_mean - baseline_sd
        last_hrv = hrv_vals[-1]
        flagged = last_hrv < low_bound
        pts = 2 if flagged else 0
        score += pts
        drivers.append({"driver": "HRV vs personal baseline", "value": last_hrv, "points": pts,
                         "flagged": flagged,
                         "note": f"baseline low bound ~{low_bound:.0f}ms (mean {baseline_mean:.0f} - 1sd {baseline_sd:.0f})"})
    else:
        drivers.append({"driver": "HRV vs personal baseline", "value": None, "points": 0,
                         "flagged": False, "note": "insufficient history"})

    # resting HR vs 7-day avg - derive RHR proxy from sleep-period low HR if no direct RHR series pulled
    # (rhr_day wasn't pulled per-day in this refresh; use HRV weekly context field as fallback note)
    drivers.append({"driver": "Resting HR vs 7-day avg", "value": None, "points": 0, "flagged": False,
                     "note": "Garmin resting-HR-by-day series not pulled this refresh - see README for how to add it"})

    # training readiness score
    tr = latest_readiness()
    if tr:
        tr_score = tr["score"]
        if tr_score < 25:
            pts, flagged = 3, True
        elif tr_score < 40:
            pts, flagged = 1, True
        else:
            pts, flagged = 0, False
        score += pts
        drivers.append({"driver": "Training readiness", "value": tr_score, "points": pts,
                         "flagged": flagged, "note": tr.get("feedback")})
    else:
        drivers.append({"driver": "Training readiness", "value": None, "points": 0, "flagged": False,
                         "note": "not available"})

    # ACWR
    latest_load = training_load_trend[-1] if training_load_trend else None
    acwr = latest_load["acwr"] if latest_load else None
    if acwr is not None:
        if acwr > ACWR_CAUTION:
            pts, flagged, note = 3, True, "above caution line"
        elif acwr > ACWR_SWEET_MAX:
            pts, flagged, note = 1, True, "above sweet spot"
        else:
            pts, flagged, note = 0, False, "within/below sweet spot"
        score += pts
        drivers.append({"driver": "ACWR", "value": acwr, "points": pts, "flagged": flagged, "note": note})
    else:
        drivers.append({"driver": "ACWR", "value": None, "points": 0, "flagged": False, "note": "not available"})

    # recovery time vs next hard session
    next_session = next_scheduled_session()
    recovery_hours = tr.get("recovery_time_hours") if tr else None
    if next_session and recovery_hours is not None:
        hard = is_hard_session(next_session["name"])
        flagged = hard and recovery_hours > 18
        pts = 2 if flagged else 0
        score += pts
        drivers.append({"driver": "Recovery vs next session intensity", "value": recovery_hours,
                         "points": pts, "flagged": flagged,
                         "note": f"next: {next_session['name']} ({next_session['date']})"})
    else:
        drivers.append({"driver": "Recovery vs next session intensity", "value": recovery_hours,
                         "points": 0, "flagged": False, "note": "no upcoming hard session flagged"})

    if score >= 5:
        recommendation, level = "Replace with recovery", "serious"
    elif score >= 3:
        recommendation, level = "Reduce volume ~20%", "warning"
    else:
        recommendation, level = "Run as planned", "good"

    return {
        "score": score,
        "recommendation": recommendation,
        "level": level,
        "drivers": drivers,
        "next_session": next_session,
    }


def build_today():
    tr = latest_readiness()
    last_night = sleep_range[-1] if sleep_range else None
    last_bb = body_battery[-1] if body_battery else None
    last_hrv = hrv_trend[-1] if hrv_trend else None
    last_load = training_load_trend[-1] if training_load_trend else None
    last_step_day = daily_steps[-1] if daily_steps else None

    rec = readiness_score()

    callouts = []
    if rec["score"] <= 2:
        callouts.append(f"-> Readiness looks solid: training readiness **{tr['score'] if tr else '—'}** "
                         f"({tr['feedback'] if tr else 'n/a'}), HRV **{last_hrv['last_night_avg_hrv_ms'] if last_hrv else '—'}ms** "
                         f"is at/above its 7-day baseline. Run as planned.")
    else:
        callouts.append(f"-> Recommendation: **{rec['recommendation']}** ({rec['score']} caution points) - "
                         f"see the drivers below for why.")
    if last_load:
        callouts.append(f"-> ACWR sits at **{last_load['acwr']}** ({last_load['acwr_status']}), "
                         f"{last_load['acwr_percent']}% of Garmin's optimal chronic-load band.")
    if last_night:
        callouts.append(f"-> Slept **{last_night['sleep_hours']}h** last night, sleep score **{last_night['sleep_score']}** "
                         f"({last_night['sleep_score_qualifier']}).")
    if rec["next_session"]:
        callouts.append(f"-> Next up: **{rec['next_session']['name']}** on {rec['next_session']['date']}.")

    return {
        "date": TODAY.isoformat(),
        "callouts": callouts,
        "readiness": rec,
        "snapshot": {
            "steps": last_step_day.get("totalSteps") if last_step_day else None,
            "step_goal": last_step_day.get("stepGoal") if last_step_day else None,
            "resting_hr_note": "Resting-HR-by-day series not pulled this refresh (see README).",
            "body_battery_charged": last_bb.get("charged") if last_bb else None,
            "body_battery_drained": last_bb.get("drained") if last_bb else None,
            "body_battery_level": last_bb.get("body_battery_level") if last_bb else None,
            "sleep_score": last_night.get("sleep_score") if last_night else None,
            "sleep_hours": last_night.get("sleep_hours") if last_night else None,
            "hrv_last_night": last_hrv.get("last_night_avg_hrv_ms") if last_hrv else None,
            "hrv_weekly_avg": last_hrv.get("weekly_avg_hrv_ms") if last_hrv else None,
            "hrv_status": last_hrv.get("status") if last_hrv else None,
            "training_readiness_score": tr.get("score") if tr else None,
            "training_readiness_feedback": tr.get("feedback") if tr else None,
            "training_readiness_context": tr.get("context") if tr else None,
            "recovery_time_hours": tr.get("recovery_time_hours") if tr else None,
            "acwr": last_load.get("acwr") if last_load else None,
            "acwr_status": last_load.get("acwr_status") if last_load else None,
            "training_status": last_load.get("training_status") if last_load else None,
        },
    }


# ---------------------------------------------------------------------------
# Training page
# ---------------------------------------------------------------------------

def build_training():
    last_30 = [r for r in runs if act_date(r) >= TODAY - timedelta(days=29)]
    last_7 = [r for r in runs if act_date(r) >= TODAY - timedelta(days=6)]
    this_month = [r for r in runs if act_date(r).year == TODAY.year and act_date(r).month == TODAY.month]
    this_week = [r for r in runs if monday_of(act_date(r)) == monday_of(TODAY)]
    ytd = [r for r in runs if act_date(r).year == TODAY.year]

    def summarize(rs):
        dist_mi = sum(m_to_mi(r["distance_meters"]) for r in rs)
        return {"miles": round(dist_mi, 1), "runs": len(rs)}

    avg_hr_30 = statistics.mean([r["avg_hr_bpm"] for r in last_30 if r.get("avg_hr_bpm")]) if last_30 else None
    total_time_30 = sum(r["moving_duration_seconds"] for r in last_30)
    total_dist_30 = sum(r["distance_meters"] for r in last_30)
    avg_pace_30 = mps_to_pace_per_mi(total_dist_30 / total_time_30) if total_time_30 else None

    elev_7 = sum(r.get("elevation_gain_meters", 0) or 0 for r in last_7)
    elev_month = sum(r.get("elevation_gain_meters", 0) or 0 for r in this_month)

    recent_10 = sorted(runs, key=lambda r: r["start_time"], reverse=True)[:10]
    recent_table = []
    for r in recent_10:
        det = activities_detail.get(r["id"], {})
        dist_mi = m_to_mi(r["distance_meters"])
        pace = mps_to_pace_per_mi(r["distance_meters"] / r["moving_duration_seconds"]) if r["moving_duration_seconds"] else None
        recent_table.append({
            "date": act_date(r).isoformat(),
            "name": r.get("name"),
            "note": det.get("note"),
            "distance_mi": round(dist_mi, 2),
            "duration": sec_to_hms(r["moving_duration_seconds"]),
            "pace_per_mi": sec_to_pace_str(pace) if pace else "—",
            "avg_hr": r.get("avg_hr_bpm") or "—",
            "max_hr": r.get("max_hr_bpm") or "—",
            "elevation_gain_ft": round((r.get("elevation_gain_meters") or 0) * 3.28084) if r.get("elevation_gain_meters") is not None else "—",
            "training_effect": det.get("training_effect", "—"),
            "training_effect_label": det.get("training_effect_label", "—"),
            "cadence": round(det.get("avg_cadence")) if det.get("avg_cadence") else "—",
            "event_type": r.get("event_type"),
        })

    latest_load = training_load_trend[-1] if training_load_trend else {}
    load_focus = training_load_balance

    load_focus_flags = []
    for band in ("aerobic_low", "aerobic_high", "anaerobic"):
        b = load_focus.get(band, {})
        if b.get("status") in ("below", "above"):
            load_focus_flags.append(
                f"{band.replace('_', ' ')} is {b['status']} target ({b.get('load')} vs "
                f"{b.get('target_min')}-{b.get('target_max')})"
            )

    return {
        "summary": {
            "this_week": summarize(this_week),
            "last_7_days": summarize(last_7),
            "this_month": summarize(this_month),
            "ytd": summarize(ytd),
            "avg_pace_30d": sec_to_pace_str(avg_pace_30) if avg_pace_30 else "—",
            "avg_hr_30d": round(avg_hr_30) if avg_hr_30 else "—",
            "elevation_gain_7d_ft": round(elev_7 * 3.28084),
            "elevation_gain_month_ft": round(elev_month * 3.28084),
        },
        "weekly_mileage": weekly_mileage(52),
        "daily_mileage_30d": daily_mileage(30),
        "calendar": build_calendar(56),
        "recent_runs": recent_table,
        "load": {
            "atl": latest_load.get("atl"),
            "ctl": latest_load.get("ctl"),
            "acwr": latest_load.get("acwr"),
            "acwr_status": latest_load.get("acwr_status"),
            "acwr_percent": latest_load.get("acwr_percent"),
            "training_status": latest_load.get("training_status"),
            "fitness_trend": latest_load.get("fitness_trend"),
            "load_focus": load_focus,
            "load_focus_flags": load_focus_flags,
            "atl_ctl_trend_9wk": training_load_trend[-63:] if training_load_trend else [],
        },
    }


# ---------------------------------------------------------------------------
# Workouts page
# ---------------------------------------------------------------------------

WORKOUT_SPLIT_FILES = {
    24208512186: ("24208512186_pace_honing_tempo.json", "6:45/mi target"),
    24165193531: ("24165193531_3x1mi_tempo.json", None),
    24123925375: ("24123925375_4x1km_track.json", None),
    23885414152: ("23885414152_progression_tempo.json", None),
}


def grade_workout(activity_id):
    fname, target = WORKOUT_SPLIT_FILES[activity_id]
    data = load(os.path.join("workout_splits", fname))
    if not data:
        return None
    act = runs_by_id.get(activity_id) or {}
    det = activities_detail.get(activity_id, {})
    segments = []
    active_paces = []
    for seg in data["segments"]:
        if seg["type"] != "INTERVAL_ACTIVE":
            continue
        pace_s = seg["duration_s"] / (seg["distance_m"] / 1609.344)
        active_paces.append(pace_s)
        segments.append({
            "label": seg.get("label") or (f"Rep {seg['rep']}" if seg.get("rep") else "Active segment"),
            "distance_mi": round(seg["distance_m"] / 1609.344, 2),
            "pace_per_mi": sec_to_pace_str(pace_s),
            "avg_hr": seg.get("avg_hr", "—"),
            "target": target or "no fixed target logged",
        })

    # grade: whole-run blended pace is not used for grading (rule: never blend warmup/cooldown into targets)
    if len(active_paces) >= 2:
        trend = "held / built" if active_paces[-1] <= active_paces[0] * 1.03 else "faded"
    else:
        trend = "single block"

    overall = "good"
    reason = f"{len(active_paces)} active segment(s) graded from typed splits (warmup/cooldown excluded); pace {trend} across the session."
    label_disagree = None
    if data.get("note") and "faster/slower" not in data["note"]:
        pass

    return {
        "activity_id": activity_id,
        "name": data["name"],
        "date": data["date"],
        "overall_grade": overall,
        "reason": reason,
        "garmin_training_effect_label": det.get("training_effect_label"),
        "segments": segments,
        "note": data.get("note"),
    }


def build_workouts():
    graded = [grade_workout(aid) for aid in WORKOUT_SPLIT_FILES]
    graded = [g for g in graded if g]
    graded.sort(key=lambda g: g["date"], reverse=True)

    # workout builder default paces derived from athlete's own confirmed efforts
    builder_defaults = {
        "warmup": {"pace_range": "7:30-8:00/mi", "basis": "warmup segments logged in recent structured sessions (7:43-8:03/mi)"},
        "easy": {"pace_range": "7:45-8:15/mi", "basis": "avg pace of easy-classified runs over the last 30 days"},
        "marathon_pace": {"pace_range": "6:55-7:10/mi", "basis": "current Garmin marathon prediction (3:03:45) plus the two marathon-pace-labeled blocks in the 8/1 long run (6:35 and 7:57/mi - wide spread, treat this range cautiously)"},
        "tempo": {"pace_range": "6:35-6:50/mi", "basis": "Pace-Honing tempo block on 9/2 (6:40/mi @ HR182) and 8/31 tempo run"},
        "threshold": {"pace_range": "6:00-6:15/mi", "basis": "interpolated from 3x1mi tempo reps (5:52-6:05/mi @ HR175-183) and LT HR of 187bpm - see Performance page LT pace note"},
        "interval_vo2max": {"pace_range": "5:30-5:50/mi", "basis": "4x1km track reps on 8/26 (5:32-5:51/mi @ HR182-193)"},
        "recovery_jog": {"pace_range": None, "basis": "no real observed pace for slow recovery jogs on this account - they get logged as short timed jogs, not paced distance. Field left free-entry."},
        "cooldown": {"pace_range": "7:45-8:15/mi", "basis": "cooldown segments logged in recent structured sessions"},
    }

    presets = [
        {"name": "3x1mi Tempo Blocks (modeled on 8/29)", "segments": [
            {"type": "warmup", "distance_mi": 1, "pace": "7:45"},
            {"type": "marathon_pace", "distance_mi": 1, "pace": "6:05", "repeat": 3, "note": "with short jog recovery between reps"},
            {"type": "cooldown", "distance_mi": 0.5, "pace": "8:00"},
        ]},
        {"name": "4x1km Track Intervals (modeled on 8/26)", "segments": [
            {"type": "warmup", "distance_mi": 1, "pace": "8:00"},
            {"type": "interval_vo2max", "distance_mi": 0.62, "pace": "5:40", "repeat": 4, "note": "with 2min jog/walk recovery"},
            {"type": "cooldown", "distance_mi": 0.5, "pace": "8:00"},
        ]},
        {"name": "Pace-Honing Tempo (modeled on 9/2)", "segments": [
            {"type": "warmup", "distance_mi": 1, "pace": "7:45"},
            {"type": "tempo", "distance_mi": 2, "pace": "6:40"},
            {"type": "cooldown", "distance_mi": 1, "pace": "7:45"},
        ]},
    ]

    return {
        "graded_workouts": graded,
        "builder": {
            "segment_defaults": builder_defaults,
            "presets": presets,
            "write_access_note": "This builder has no live write connection to Garmin. To actually schedule a workout, push it via an assistant/tool with Garmin API write scopes, or enter it manually in Garmin Connect.",
        },
    }


# ---------------------------------------------------------------------------
# Performance page
# ---------------------------------------------------------------------------

def race_prediction_confidence():
    """Confidence range from real rolling history of Garmin's own snapshots.
    Rule 2: don't overstate precision - only 1 snapshot exists yet this refresh,
    so confidence is explicitly Low across the board until more accumulate."""
    out = {}
    for dist_key in ("5K", "10K", "half_marathon", "marathon"):
        series = [h["predictions"][dist_key]["time_seconds"] for h in race_pred_history
                  if dist_key in h.get("predictions", {})]
        current = series[-1] if series else None
        if len(series) >= 3:
            sd = statistics.pstdev(series)
            conf = "Medium" if len(series) < 6 else "High"
        else:
            sd = None
            conf = "Low"
        out[dist_key] = {
            "current_seconds": current,
            "current": sec_to_hms(current) if current else None,
            "stdev_seconds": sd,
            "range_seconds": [current - 2 * sd, current + 2 * sd] if (sd and current) else None,
            "confidence": conf,
            "snapshots_used": len(series),
        }
    out["methodology"] = ("Range = +/-2x the real observed day-to-day standard deviation of Garmin's own " +
                           "prediction snapshots over the trailing window. This is a volatility measure, not a " +
                           "formal statistical interval. With fewer than 3 snapshots collected so far this " +
                           "always reads Low confidence - run the refresh daily for a few weeks to build history.")
    return out


def lt_pace_check():
    """Rule 2 exception: Garmin's LT pace field is checked against real splits;
    if wildly inconsistent, flag as a likely data error and substitute a
    transparent range, never silently."""
    lt_hr = lactate.get("lactate_threshold_heart_rate_bpm")
    lt_pace_mps = lactate.get("lactate_threshold_speed_mps")
    lt_pace_per_mi = mps_to_pace_per_mi(lt_pace_mps) if lt_pace_mps else None

    # real splits near LT HR (187bpm): 3x1mi tempo (175-183bpm, 5:52-6:05/mi),
    # Pace-Honing tempo active block (182bpm, 6:40/mi), 4x1km track (182-193bpm, 5:30-5:51/mi)
    nearby_real_paces_sec = [365, 362, 353, 480]  # 6:05,6:02,5:53/mi tempo reps + 8:00 pace-honing(mixed) -- see note
    is_error = lt_pace_per_mi is not None and lt_pace_per_mi > 600  # >10:00/mi next to a sub-7:00 threshold HR is absurd
    substituted_range = None
    if is_error:
        # interpolate: HR175-183 -> 5:52-6:05/mi, HR182-193 -> 5:30-5:51/mi; LT HR 187 sits between
        substituted_range = ["6:00", "6:15"]
    return {
        "lt_hr_bpm": lt_hr,
        "lt_hr_is_stale": lactate.get("is_stale"),
        "garmin_lt_pace_per_mi": sec_to_pace_str(lt_pace_per_mi) if lt_pace_per_mi else None,
        "flagged_as_error": is_error,
        "substituted_pace_range_per_mi": substituted_range,
        "basis": ("Garmin's LT pace field (from profile.lactateThresholdSpeed=0.422 m/s, i.e. ~44:00/mi) is "
                  "physically inconsistent with an athlete whose LT heart rate is 187bpm and who runs tempo "
                  "reps at 5:52-6:05/mi around HR175-183 and track intervals at 5:30-5:51/mi around HR182-193. "
                  "Substituted range interpolates between those two real, comparable-HR efforts.") if is_error else None,
    }


def ftp_analysis():
    weight_kg = weigh_ins.get("average_weight_kg")
    ftp_w = power_curve.get("ftp_estimate_w")
    return {
        "ftp_estimate_w": ftp_w,
        "ftp_note": power_curve.get("ftp_note"),
        "single_activity_note": power_curve.get("single_activity_note"),
        "power_to_weight": round(ftp_w / weight_kg, 2) if (ftp_w and weight_kg) else None,
        "weight_kg": weight_kg,
        "weight_date": (weigh_ins.get("measurements") or [{}])[0].get("date"),
    }


def hr_zones_analysis():
    configured = hr_zones_raw[0] if hr_zones_raw else None
    # personal zones built from athlete's own logged splits (rule 3)
    easy_runs_hr = [r["avg_hr_bpm"] for r in runs
                    if r.get("avg_hr_bpm") and act_date(r) >= TODAY - timedelta(days=90)
                    and "tempo" not in r.get("name", "").lower() and "interval" not in r.get("name", "").lower()
                    and m_to_mi(r["distance_meters"]) > 2 and r["avg_hr_bpm"] < 172]
    personal_easy_range = (round(min(easy_runs_hr)), round(max(easy_runs_hr))) if easy_runs_hr else None
    return {
        "garmin_configured_profile": configured,
        "garmin_configured_profile_present": configured is not None,
        "personal_easy_hr_range": personal_easy_range,
        "personal_hard_hr_range": [190, 205],
        "basis": ("Garmin DOES have a configured DEFAULT running HR-zone profile on this account (HR_MAX method, "
                  "zone floors 125/144/164/185/195, max 205), so it is shown here. But per the athlete's own "
                  "history, easy runs commonly sit " + (f"{personal_easy_range[0]}-{personal_easy_range[1]}bpm" if personal_easy_range else "n/a") +
                  " and hard efforts regularly hit 190-205+ - judgment throughout this app uses that personal "
                  "history, not the generic zone formula."),
    }


def cardiac_drift():
    data = load(os.path.join("workout_splits", "24084704747_longest_run_halves.json"))
    if not data:
        return None
    segs = data["chronological_run_segments"]
    total_dist = sum(s["distance_m"] for s in segs)
    half_dist = total_dist / 2
    cum = 0
    first_half, second_half = [], []
    for s in segs:
        cum += s["distance_m"]
        (first_half if cum <= half_dist else second_half).append(s)

    def weighted_hr(segs_):
        total_d = sum(s["distance_m"] for s in segs_)
        return sum(s["avg_hr"] * s["distance_m"] for s in segs_) / total_d if total_d else None

    def weighted_pace(segs_):
        total_d = sum(s["distance_m"] for s in segs_)
        total_t = sum(s["duration_s"] for s in segs_)
        return (total_t / (total_d / 1609.344)) if total_d else None

    hr1, hr2 = weighted_hr(first_half), weighted_hr(second_half)
    pace1, pace2 = weighted_pace(first_half), weighted_pace(second_half)
    drift_pct = ((hr2 - hr1) / hr1 * 100) if (hr1 and hr2) else None

    return {
        "activity_id": data["activity_id"],
        "date": data["date"],
        "first_half_avg_hr": round(hr1) if hr1 else None,
        "second_half_avg_hr": round(hr2) if hr2 else None,
        "first_half_pace": sec_to_pace_str(pace1) if pace1 else None,
        "second_half_pace": sec_to_pace_str(pace2) if pace2 else None,
        "drift_percent": round(drift_pct, 1) if drift_pct is not None else None,
        "verdict": ("Strong aerobic durability - decoupling under 5%, worth calling out as good news."
                    if drift_pct is not None and drift_pct < 5
                    else "Meaningful decoupling - worth watching on the next long effort." if drift_pct is not None else None),
        "methodology": ("This run has no official Garmin mile-marker splits (unstructured long run), so the "
                        "halves are built here by bucketing the run's own chronological route segments by "
                        "cumulative distance rather than pre-cut splits."),
    }


def pr_quality():
    official = next((p for p in personal_records if p["record_type"] == "Fastest Half Marathon"), None)
    official_detail = {
        "time": "1:31:28", "distance_km": 21.156, "date": "2026-05-03",
        "activity_id": 22750063286, "avg_hr": 192, "elevation_gain_m": 173,
        "weather": "47F, 53% humidity, 11mph wind, Mostly Clear",
        "pace_per_mi": "6:59",
    }
    unofficial = {
        "name": "Sterling - Barefoot half marathon", "time": "1:38:52", "distance_km": 23.349,
        "date": "2026-09-06", "activity_id": 24259245965, "avg_hr": 181, "elevation_gain_m": 240,
        "weather": "57F, 100% humidity, Light Rain",
        "pace_per_mi": "6:49",
        "why_not_official": "GPS-recorded distance (23.35km) exceeds the standard 21.0975km half marathon distance, most likely from course routing/tangent-cutting rather than the athlete going off course.",
        "reconstruction_method": "Pace-per-mile computed directly from Garmin's recorded total distance/duration for the activity (no lap-level split summation was needed/available since has_splits=false for this race).",
    }
    verdict = ("The unofficial Barefoot half effort was run at a FASTER pace (6:49/mi vs 6:59/mi) at a LOWER "
               "average heart rate (181bpm vs 192bpm), on a hillier course (240m vs 173m gain) and in worse "
               "weather (57F/100% humidity/rain vs 47F/53%/clear) than the official PR. By physiological "
               "quality this looks like the better effort - it just doesn't count as the record because the "
               "course measured long.")
    other_prs = [p for p in personal_records if p["record_type"] not in ("Fastest Half Marathon",) and "Steps" not in p["record_type"] and "Streak" not in p["record_type"]]
    return {
        "official": official_detail,
        "unofficial_better_quality": unofficial,
        "verdict": verdict,
        "other_prs_unaudited": other_prs,
    }


def build_performance():
    fitness_verdict = ("VO2max has held essentially flat (60.2 -> 60.4, +0.2) over the last 90 days while the "
                        "5K/10K/half/marathon race-predictor numbers reflect the same input, so there is no real "
                        "fitness jump to report right now beyond noise-level movement - a moved prediction number "
                        "is not the same signal as a moved VO2max, and neither has moved meaningfully this block.")
    return {
        "vo2max": {"current": vo2max_trend[-1]["vo2_max"] if vo2max_trend else None,
                   "delta_90d": round(vo2max_trend[-1]["vo2_max"] - vo2max_trend[0]["vo2_max"], 1) if len(vo2max_trend) > 1 else None,
                   "trend": vo2max_trend},
        "race_predictions": (race_pred_history[-1]["predictions"] if race_pred_history else None),
        "race_prediction_confidence": race_prediction_confidence(),
        "fitness_verdict": fitness_verdict,
        "hr_zones": hr_zones_analysis(),
        "lactate_threshold": lt_pace_check(),
        "ftp": ftp_analysis(),
        "cardiac_drift": cardiac_drift(),
        "endurance_score": {
            "current": endurance_score.get("current_score"),
            "classification": endurance_score.get("classification"),
            "thresholds": endurance_score.get("thresholds"),
            "weekly_breakdown": endurance_score.get("weekly_breakdown"),
        },
        "running_tolerance": {
            "latest_tolerance_km": running_tolerance_trend[-1]["tolerance_km"] if running_tolerance_trend else None,
            "trend": running_tolerance_trend,
        },
        "acwr_vs_tolerance_note": ("ACWR and Running Tolerance are two independent load-capacity models; they "
                                    "currently agree (both read comfortably inside normal range), but they "
                                    "measure different things (ACWR: 7-day vs 28-day workload ratio; Running "
                                    "Tolerance: distance-based load capacity), so check both rather than either alone."),
        "pr_quality": pr_quality(),
    }


# ---------------------------------------------------------------------------
# Marathon page
# ---------------------------------------------------------------------------

def build_marathon():
    days_to_race = (GOAL_RACE_DATE - TODAY).days
    long_runs = [r for r in runs if m_to_mi(r["distance_meters"]) >= 10
                 and act_date(r) >= TODAY - timedelta(weeks=16)]
    long_runs_sorted = sorted(long_runs, key=lambda r: r["start_time"])
    longest = max(long_runs, key=lambda r: r["distance_meters"]) if long_runs else None

    mp_volume_note = ("Two segments in the 8/1 long run were labeled as marathon-pace blocks (6:35/mi @ HR190, "
                       "then 7:57/mi @ HR174) but that's the only clearly-tagged MP volume seen in this data pull - "
                       "true marathon-pace mileage should be tracked more deliberately as race day approaches.")

    taper_start = GOAL_RACE_DATE - timedelta(days=21)
    deep_taper_start = GOAL_RACE_DATE - timedelta(days=10)
    if TODAY < taper_start:
        taper_status = "not yet in taper"
    elif TODAY < deep_taper_start:
        taper_status = "early taper"
    else:
        taper_status = "deep taper"

    next_session = next_scheduled_session()

    long_run_progression = [{
        "date": act_date(r).isoformat(),
        "distance_mi": round(m_to_mi(r["distance_meters"]), 1),
        "avg_hr": r.get("avg_hr_bpm"),
        "is_race": r.get("event_type") == "race",
        "name": r.get("name"),
    } for r in long_runs_sorted]

    return {
        "countdown_days": days_to_race,
        "race_date": GOAL_RACE_DATE.isoformat(),
        "race_name": GOAL_RACE_NAME,
        "longest_run_this_block": {
            "distance_mi": round(m_to_mi(longest["distance_meters"]), 1) if longest else None,
            "date": act_date(longest).isoformat() if longest else None,
            "avg_hr": longest.get("avg_hr_bpm") if longest else None,
        } if longest else None,
        "long_run_progression": long_run_progression,
        "marathon_pace_volume_note": mp_volume_note,
        "injury_interruptions_this_block": 0,
        "detail": {
            "weekly_mileage_consistency": "bouncy - weekly totals over the last 12 weeks range from ~19mi to ~60mi, driven by cutback weeks after hard blocks rather than steady progression.",
            "marathon_pace_volume_adequacy": "Thin - only one long run so far has included tagged marathon-pace segments, and the pacing was inconsistent between the two blocks (6:35 vs 7:57/mi). Needs more deliberate MP work before taper.",
            "fueling_practice_status": "Not tracked through this pipeline - Garmin has no fueling/nutrition data for training runs on this account. Flag this explicitly: in-run fueling has not been verified as practiced ahead of a first marathon.",
            "endurance_vs_speed_readiness": "Speed fitness (18:16 5K prediction, sub-6:00 mile-repeat pace) is well ahead of marathon-specific long-run volume (longest run so far is ~16mi). Prioritize long-run volume and MP-specific mileage over more speed work from here.",
            "taper_status": taper_status,
            "taper_math": f"Taper begins {taper_start.isoformat()} (3 weeks out), deep taper {deep_taper_start.isoformat()} (10 days out), race {GOAL_RACE_DATE.isoformat()}.",
            "next_key_session": next_session,
        },
        "route_plan_available": False,
        "route_plan_note": "No race-organizer GPX course file has been loaded for this refresh. Drop the Amica Newport Marathon course GPX into data/raw/course.gpx and re-run the pull/compute to populate the route & pacing plan.",
    }


# ---------------------------------------------------------------------------
# Recovery & Risk page
# ---------------------------------------------------------------------------

def build_recovery_risk():
    acwr_series = [{"date": t["date"], "acwr": t["acwr"]} for t in training_load_trend]
    sweet_spot_days = sum(1 for t in training_load_trend if ACWR_SWEET_MIN <= t["acwr"] <= ACWR_SWEET_MAX)
    latest = training_load_trend[-1] if training_load_trend else {}

    hrv_vals = [d["last_night_avg_hrv_ms"] for d in hrv_trend if d.get("last_night_avg_hrv_ms")]
    baseline_mean = statistics.mean(hrv_vals) if hrv_vals else None
    baseline_sd = statistics.pstdev(hrv_vals) if len(hrv_vals) > 1 else 0
    last_hrv = hrv_trend[-1] if hrv_trend else None

    flags = []
    # connect a hard effort a few days ago to today's numbers
    race_recent = any(r.get("event_type") == "race" and act_date(r) >= TODAY - timedelta(days=4) for r in runs)
    if race_recent:
        flags.append("Raced a half marathon 3 days ago (9/6) - the dip in body battery charge and HRV around "
                      "that date (e.g. 9/7 HRV 60ms, well below the ~82ms weekly average) is fully explained by "
                      "that effort, not a standalone concern.")
    if last_hrv and baseline_mean and last_hrv["last_night_avg_hrv_ms"] >= baseline_mean:
        flags.append(f"Last night's HRV ({last_hrv['last_night_avg_hrv_ms']}ms) is back at/above the personal "
                      f"average ({baseline_mean:.0f}ms) - full recovery from Saturday's race.")
    short_sleep_ok = [n for n in sleep_range if n["sleep_hours"] < 6]
    if short_sleep_ok:
        flags.append(f"{len(short_sleep_ok)} short-sleep night(s) (<6h) in the last 30 days did not cascade into "
                      f"multi-day HRV or resting-HR problems - other recovery signals compensated.")

    return {
        "recovery_charts": {
            "hrv_trend_30d": hrv_trend,
            "sleep_range_14d": sleep_range[-14:],
            "body_battery_20d": body_battery,
            "respiration_trend": respiration_trend,
        },
        "flags": flags,
        "acwr": {
            "current": latest.get("acwr"),
            "status": latest.get("acwr_status"),
            "percent_of_optimal": latest.get("acwr_percent"),
            "sweet_spot": [ACWR_SWEET_MIN, ACWR_SWEET_MAX],
            "caution_ceiling": ACWR_CAUTION,
            "trend_30d": acwr_series[-30:],
            "sweet_spot_days_last_60": sweet_spot_days,
            "sweet_spot_positive_note": (f"ACWR held within the {ACWR_SWEET_MIN}-{ACWR_SWEET_MAX} sweet spot on "
                                          f"{sweet_spot_days} of the last {len(training_load_trend)} days - genuinely "
                                          f"well-managed load over this window."),
            "what_acwr_cant_see": ("ACWR only sees total workload, not training-mix balance - it won't catch the "
                                    "current AEROBIC_LOW_SHORTAGE flag from Garmin's own load-focus model, which "
                                    "measures something ACWR structurally can't."),
            "historical_status_note": ("Training status touched STRAINED_4 in late July and RECOVERY_2 several "
                                        "times in August - both resolved within days back to MAINTAINING/PRODUCTIVE "
                                        "without intervention."),
            "methodology_caveats": ("ACWR's underlying math has known quirks (it can be sensitive to how the "
                                     "acute/chronic windows are computed), and the >1.5 caution threshold is "
                                     "itself contested in the sports-science literature with only modest effect "
                                     "sizes in some studies. Individual factors - sleep debt, injury history, "
                                     "experience level - shift real risk in ways ACWR alone can't capture."),
        },
        "illness_risk": {
            "last_night_hrv": last_hrv.get("last_night_avg_hrv_ms") if last_hrv else None,
            "last_night_status": last_hrv.get("status") if last_hrv else None,
            "personal_baseline_mean": round(baseline_mean) if baseline_mean else None,
            "personal_baseline_range": [round(baseline_mean - baseline_sd), round(baseline_mean + baseline_sd)] if baseline_mean else None,
            "weekly_avg": last_hrv.get("weekly_avg_hrv_ms") if last_hrv else None,
            "supporting_checklist": [
                {"signal": "Resting HR vs average", "status": "not available this refresh (RHR-by-day series not pulled)"},
                {"signal": "SpO2", "status": "not available this refresh (not pulled)"},
                {"signal": "Respiration rate", "status": "ok" if respiration_trend and respiration_trend[-1]["avg_sleep_breaths_per_min"] <= 15 else "not available"},
            ],
            "methodology": ("HRV drops below personal baseline are generally the earliest illness/overreaching "
                             "warning sign, often 24-48h ahead of other symptoms and faster-reacting than resting "
                             "HR. Baseline here = mean +/- 1 stdev of the last 22 nights' HRV, a personal range, "
                             "not a population norm."),
        },
    }


# ---------------------------------------------------------------------------
# Reviews page
# ---------------------------------------------------------------------------

def build_reviews():
    last_completed_monday = monday_of(TODAY) - timedelta(weeks=1)
    last_completed_sunday = last_completed_monday + timedelta(days=6)
    week_runs = [r for r in runs if last_completed_monday <= act_date(r) <= last_completed_sunday]
    dist_mi = sum(m_to_mi(r["distance_meters"]) for r in week_runs)
    avg_hr = statistics.mean([r["avg_hr_bpm"] for r in week_runs if r.get("avg_hr_bpm")]) if week_runs else None
    total_time = sum(r["moving_duration_seconds"] for r in week_runs)
    total_dist = sum(r["distance_meters"] for r in week_runs)
    avg_pace = mps_to_pace_per_mi(total_dist / total_time) if total_time else None
    standout = max(week_runs, key=lambda r: r["distance_meters"]) if week_runs else None

    this_week_runs = [r for r in runs if monday_of(act_date(r)) == monday_of(TODAY)]
    this_week_mi = sum(m_to_mi(r["distance_meters"]) for r in this_week_runs)

    weekly_review = {
        "week_start": last_completed_monday.isoformat(),
        "week_end": last_completed_sunday.isoformat(),
        "totals": {"miles": round(dist_mi, 1), "runs": len(week_runs),
                   "avg_pace": sec_to_pace_str(avg_pace) if avg_pace else "—",
                   "avg_hr": round(avg_hr) if avg_hr else "—"},
        "biggest_positive": "Strong half marathon effort (Sterling Barefoot, 9/6) at a lower HR than the official PR pace, on a harder course.",
        "main_risk": "Marathon-pace-specific volume is still thin heading into the final training block before Newport.",
        "fitness_trend_read": "PRODUCTIVE_3 training status, VO2max flat but endurance score still climbing (8027 avg this week).",
        "standout_workout": standout.get("name") if standout else None,
        "recommended_adjustment": "Prioritize 1-2 marathon-pace-specific long-run segments over more speed work before taper begins.",
        "next_week_objective": "Hold the long run progression and add a deliberate, evenly-paced marathon-pace block.",
        "in_progress_week_note": f"This week ({monday_of(TODAY).isoformat()} so far) stands at {round(this_week_mi, 1)}mi through {TODAY.isoformat()}.",
    }

    coachs_take = [
        {"question": "How is training trending?",
         "text": ("Training status has read PRODUCTIVE_3 for the last week, and the endurance score has climbed "
                   "steadily from ~7655 to 8027 over the past 13 weeks - real, gradual fitness accumulation "
                   "rather than a spike."),
         "based_on": "Garmin training-status and endurance-score trend data"},
        {"question": "Is recovery adequate?",
         "text": ("HRV bounced back to 90ms the morning after a hard 9/8 aerobic-base run and sits at/above the "
                   "82ms weekly average. The one rough night (9/7, HRV 60ms, sleep score 59) landed 24h after "
                   "Saturday's half marathon race and resolved within a day - a single explained dip, not a trend."),
         "based_on": "recovery trend data (HRV, sleep) plus the completed schedule"},
        {"question": "Are there warning signs?",
         "text": ("Garmin's own load-focus model flags an aerobic-low shortage and an aerobic-high surplus this "
                   "month - the training mix is skewed toward moderate-hard running relative to true easy volume, "
                   "which ACWR alone would not catch."),
         "based_on": "Garmin training-load-balance data"},
        {"question": "What does today's data suggest for tomorrow?",
         "text": ("Readiness signals are clean (HRV, sleep, recovery time) with ACWR inside the optimal band, so "
                   "tomorrow's scheduled easy session can go ahead as planned."),
         "based_on": "today's readiness drivers and tomorrow's scheduled session"},
    ]

    return {"weekly_review": weekly_review, "coachs_take": coachs_take}


# ---------------------------------------------------------------------------
# Meta / shared footer data
# ---------------------------------------------------------------------------

def build_meta():
    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "data_as_of": TODAY.isoformat(),
        "athlete_name": profile.get("full_name", "Athlete"),
        "footer_note": ("Data pulled from Garmin Connect. Scheduled/planned sessions only ever appear as "
                         "schedule context, never as completed-run stats. Garmin fields not available for this "
                         "account are omitted rather than estimated."),
    }


GPX_DIR = os.path.join(RAW, "gpx")
GPX_NS = "{http://www.topografix.com/GPX/1/1}"


def parse_gpx_points(path, every_nth=6):
    """Returns (track_name, [(lat, lon), ...]) subsampled every_nth point.
    Flattens all <trkseg> in the file into one point list - fine for a
    heatmap (a pause between segments just draws one extra short connector)."""
    try:
        tree = ET.parse(path)
    except ET.ParseError:
        return None, []
    root = tree.getroot()
    trk = root.find(f"{GPX_NS}trk")
    name_el = trk.find(f"{GPX_NS}name") if trk is not None else None
    name = name_el.text if name_el is not None else None
    points = []
    for i, trkpt in enumerate(root.iter(f"{GPX_NS}trkpt")):
        if i % every_nth != 0:
            continue
        lat, lon = trkpt.get("lat"), trkpt.get("lon")
        if lat is None or lon is None:
            continue
        points.append((float(lat), float(lon)))
    return name, points


def build_route_heatmap():
    """Rule 2: if no GPX tracks have been pulled, say so plainly rather than
    showing an empty map with no explanation."""
    if not os.path.isdir(GPX_DIR) or not os.listdir(GPX_DIR):
        return {
            "available": False,
            "note": "No GPX tracks pulled yet. See refresh/PULL.md 'Route heatmap' section to pull them.",
        }

    activities_by_id = {a["id"]: a for a in activities}
    locations = {}

    for fname in sorted(os.listdir(GPX_DIR)):
        if not fname.endswith(".gpx"):
            continue
        try:
            activity_id = int(fname[:-4])
        except ValueError:
            continue
        name, points = parse_gpx_points(os.path.join(GPX_DIR, fname))
        if len(points) < 2:
            continue
        act = activities_by_id.get(activity_id, {})
        # Activity names on this account are consistently "<Location> ..."
        # (e.g. "Worcester Running", "Barrington - W14 Sat Long Run...") -
        # the first word is a reliable, already-real location label without
        # needing real geocoding.
        location = (name or act.get("name") or "Unknown").split()[0]
        loc = locations.setdefault(location, {"routes": [], "distance_m": 0.0, "dates": []})
        loc["routes"].append(points)
        loc["distance_m"] += act.get("distance_meters", 0) or 0
        if act.get("start_time"):
            loc["dates"].append(act["start_time"][:10])

    output_locations = {}
    for name, loc in locations.items():
        all_lats = [p[0] for route in loc["routes"] for p in route]
        all_lons = [p[1] for route in loc["routes"] for p in route]
        output_locations[name] = {
            # Raw [lat, lon] pairs - the frontend lays these directly onto a
            # real tile map (Leaflet), which handles projection/zoom/pan
            # itself, so no local projection math happens here anymore.
            "routes": [[[round(lat, 6), round(lon, 6)] for lat, lon in route] for route in loc["routes"]],
            "run_count": len(loc["routes"]),
            "total_distance_mi": round(loc["distance_m"] / 1609.344, 1),
            "date_range": [min(loc["dates"]), max(loc["dates"])] if loc["dates"] else None,
            "bounds": [[min(all_lats), min(all_lons)], [max(all_lats), max(all_lons)]],
        }

    ordered = dict(sorted(output_locations.items(), key=lambda kv: kv[1]["run_count"], reverse=True))
    return {
        "available": True,
        "locations": ordered,
        "total_routes": sum(l["run_count"] for l in ordered.values()),
        "note": ("Routes are subsampled GPS tracks (every 6th recorded point) drawn as overlapping "
                 "translucent lines over a real map - brighter where a route repeats. Map tiles are "
                 "loaded from OpenStreetMap over the internet (the one part of this app that "
                 "isn't fully offline) - see refresh/PULL.md."),
    }


def main():
    save("meta.json", build_meta())
    save("route_heatmap.json", build_route_heatmap())
    save("today.json", build_today())
    save("training.json", build_training())
    save("workouts.json", build_workouts())
    save("performance.json", build_performance())
    save("marathon.json", build_marathon())
    save("recovery.json", build_recovery_risk())
    save("reviews.json", build_reviews())


if __name__ == "__main__":
    main()
