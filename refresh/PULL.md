# Data refresh — the "pull" step

This project's data refresh is split into two steps:

1. **Pull** (this document) — a Claude Code session with the `garmin-manual`
   MCP server connected calls Garmin Connect tools directly and saves the
   raw responses as JSON files under `data/raw/`. This step *must* run
   inside a session that has that MCP server available (Claude Desktop's
   Code tab, or any Claude Code session configured with the same MCP
   server) — it cannot run as a standalone script, because the Garmin
   authentication and API access lives inside that MCP server, not in this
   repo.
2. **Compute** (`refresh/compute.py`) — a plain, dependency-free Python
   script that reads `data/raw/*.json` and writes the interpreted,
   coaching-ready `data/dashboard/*.json` files the frontend actually
   reads. This step has no Garmin dependency and can run anywhere, any
   time, as often as you like, with no network access.

## Running the pull step

Open a Claude Code session in this repo with the `garmin-manual` MCP server
connected (it already is, in Claude Desktop) and ask it to run the refresh —
for example:

> Run the Garmin data refresh: pull fresh data per refresh/PULL.md into
> data/raw/, then run refresh/compute.py.

Claude will call the tools below and save each result into `data/raw/` in
the shapes `compute.py` expects (see the field names it reads via `load()`
calls near the top of `compute.py` if you need to match them exactly).

### Tools to call, and what to save

| Raw file | Tool(s) | Notes |
|---|---|---|
| `activities.json` | `get_activities` (paginate with `start`) | Merge/dedupe pages by `id`, sort by `start_time` desc. Keep ~90-180 days for the calendar/mileage charts; keep the full history if you want long PR context. |
| `activities_detail.json` | `get_activity` per recent/structured activity | At minimum, the last ~10 runs (for the Training page's recent-runs table: training_effect, cadence) plus any structured/named workouts you want graded on the Workouts page. |
| `workout_splits/<id>_<slug>.json` | `get_activity_typed_splits` | One file per structured workout you want graded. Keep only `INTERVAL_WARMUP/ACTIVE/RECOVERY/COOLDOWN` segments (drop `RWD_STAND`/`RWD_WALK` noise) — see the existing files in `data/raw/workout_splits/` for the exact trimmed shape `compute.py`'s `grade_workout()` expects. |
| `personal_records.json` | `get_personal_record` | |
| `power_duration_curve.json` | `get_power_duration_curve(activity_type="running")` | **Must** pass `activity_type="running"` — the tool defaults to cycling. |
| `lactate_threshold.json` | `get_lactate_threshold` | |
| `heart_rate_zones.json` | `get_heart_rate_zones` | |
| `race_predictions_history.json` | `get_race_predictions` | **Append**, don't overwrite — this is a rolling history file. Each refresh should add one `{prediction_date, predictions}` entry so the Performance page's confidence-range feature has something to compute a standard deviation from. Keep the trailing ~3 weeks. |
| `training_readiness.json` | `get_training_readiness(date=today)` | |
| `training_status.json` | `get_training_status(date=today)` | |
| `training_load_balance.json` | `get_training_load_balance(date=today)` | |
| `training_load_trend.json` | `get_training_load_trend` | ~60 days, max 90/call. |
| `vo2max_trend.json` | `get_vo2max_trend` | ~90 days max/call. |
| `running_tolerance_trend.json` | `get_running_tolerance_trend(aggregation="weekly")` | |
| `endurance_score.json` | `get_endurance_score` | |
| `weigh_ins.json` | `get_weigh_ins` | |
| `daily_steps.json` | `get_daily_steps` | |
| `hrv_trend.json` | `get_hrv_trend` | Max 30 days/call. |
| `respiration_trend.json` | `get_respiration_trend` | Max 30 days/call. |
| `sleep_summary_range.json` | `get_sleep_summary_range` | Max 90 nights/call. |
| `body_battery.json` | `get_body_battery` | |
| `scheduled_workouts.json` | `get_scheduled_workouts` | Cover the last ~2 weeks through the next ~6 weeks. |
| `calendar_events.json` | `get_calendar_events` | Cover the whole training block through the goal race, to catch the goal race itself. |
| `profile.json` | `get_full_name`, `get_user_profile`, `get_unit_system` | |
| **Not yet wired up** — `rhr_by_day` (for the Today-page resting-HR-vs-7-day-avg driver), `spo2` (illness-risk checklist), and a real 90-day per-run pace/HR series (for the Performance-page scatter chart) | `get_rhr_day` per day, `get_spo2_data` per day | Loop over the last 7-14 days; there's no range endpoint for these. Add the resulting files and extend `compute.py` accordingly if you want these gaps filled in. |
| `data/raw/course.gpx` | *(not an MCP call)* | Drop the goal race's official course GPX file here (from the race organizer) to activate the Marathon page's route/pacing plan. `compute.py` currently reports `route_plan_available: false` when this file is absent. |

### A note on token limits

Some of these tool calls return more data than fits in one response (Claude
Code will save the raw JSON to a temp file and tell you to process it with
`jq`/Python instead of reading it inline). When that happens, copy the saved
temp file into `data/raw/` and reshape it with a short Python snippet rather
than pasting the whole thing back into the conversation — this repo's
`data/raw/activities.json` was built exactly that way.

## Running the compute step

```bash
python refresh/compute.py
```

Reads everything under `data/raw/` and writes `data/dashboard/*.json`. Safe
to re-run any time; it has no side effects beyond overwriting those output
files. If a raw file is missing, the affected fields degrade to `null`/empty
rather than erroring — the frontend is built to show an honest "not
available" state for those, per the coaching rules in the main README.

## Suggested cadence

This is a daily-training-log tool — pulling once or twice a day is plenty.
To automate it, use Claude Code's own scheduling (the `schedule` skill /
`CronCreate`) to run a Claude Code session on a cron schedule that performs
the pull step above and then runs `compute.py`. Because the pull step needs
the `garmin-manual` MCP server, verify that server is available in whatever
context the scheduled run executes in before relying on it running
unattended — if it isn't, fall back to triggering the refresh manually
(just ask Claude Code to run it, as in the example above) whenever you want
fresh data.
