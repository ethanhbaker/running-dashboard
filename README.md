# Ethan's Running Dashboard

A self-updating, multi-page training-coach dashboard built from Ethan's real
Garmin Connect data — replacing a hand-maintained claude.ai Artifact that
used to be manually re-run and re-published after every data refresh.

## How it's built

- **Data refresh** is split into two steps (see [`refresh/PULL.md`](refresh/PULL.md)
  for the full how-to):
  1. **Pull** — a Claude Code session with the `garmin-manual` MCP server
     calls Garmin Connect tools directly and saves raw responses to
     `data/raw/*.json`. No Garmin username/password ever touches this repo's
     code — authentication lives entirely inside that already-connected MCP
     server.
  2. **Compute** — `refresh/compute.py`, a dependency-free Python script,
     reads `data/raw/*.json`, applies the coaching-interpretation rules
     below, and writes one JSON file per page to `data/dashboard/*.json`.
- **Frontend** is plain, dependency-free multi-page HTML/CSS/JS — one
  `.html` file per page under `app/`, sharing a design system
  (`app/css/style.css`), a hand-rolled SVG chart library
  (`app/js/charts.js`), and shared header/nav/footer logic
  (`app/js/layout.js`). No build step, no framework, no charting library.
  Every chart is inline SVG.

```
running-dashboard/
├── data/
│   ├── raw/           # raw Garmin pulls (gitignored - personal data)
│   │   └── workout_splits/
│   └── dashboard/     # computed, coaching-ready JSON (gitignored)
├── refresh/
│   ├── PULL.md         # how to run the pull step
│   └── compute.py      # pure-Python coaching logic -> data/dashboard/*.json
├── app/
│   ├── index.html      # redirects to today.html
│   ├── today.html / training.html / workouts.html / performance.html /
│   │   marathon.html / recovery.html / reviews.html
│   ├── css/style.css   # design tokens, light + dark theme
│   └── js/
│       ├── layout.js   # shared header/nav/footer + fetch helpers
│       ├── charts.js   # bar/grouped-bar/line/scatter SVG chart primitives
│       └── <page>.js   # one render module per page
└── README.md
```

## Running it locally

**1. Refresh the data** (see `refresh/PULL.md` for the full tool list):

```bash
# inside a Claude Code session with the garmin-manual MCP connected:
#   "run the pull step per refresh/PULL.md, then run compute.py"

# or, once data/raw/ is populated, just re-run the compute step directly:
python refresh/compute.py
```

**2. Serve the app** (any static file server works; a `.claude/launch.json`
config is included for Claude Code's browser preview):

```bash
python -m http.server 8420
# then open http://localhost:8420/app/today.html
```

The pages fetch `../data/dashboard/*.json` relative to their own location,
so the server must be started from the **project root** (not from inside
`app/`) so that both `app/` and `data/` are reachable.

## Page / route map

| Page | File | What it covers |
|---|---|---|
| Today | `app/today.html` | Daily check-in: "what matters today" callout, the daily readiness recommendation, today's snapshot tiles. |
| Training | `app/training.html` | Rolling log: summary stats, 8-week consistency calendar, recent-runs table, training load (ATL/CTL/ACWR/load-focus). |
| Workouts | `app/workouts.html` | Structured-session grading from real typed splits, plus the interactive workout builder. |
| Performance | `app/performance.html` | Fitness trend, race-prediction confidence ranges, PR quality audit, power & HR deep-dive (incl. the LT-pace data-error flag). |
| Marathon | `app/marathon.html` | Goal-race readiness tracking + the interactive GPX route/pacing tool (inactive until a course file is loaded — see `refresh/PULL.md`). |
| Recovery & Risk | `app/recovery.html` | Recovery trend charts + the ACWR and HRV/illness risk-signal cards. |
| Reviews | `app/reviews.html` | The weekly review and the narrative "coach's take". |

Each page is a real, independently-reachable file — plain browser
back/forward works, and the shared nav (top bar on desktop, collapses on
narrow screens) links every page to every other page.

## Where the coaching logic lives (so it stays auditable)

All interpretive/coaching logic is in **`refresh/compute.py`**, one
function per page (`build_today`, `build_training`, `build_workouts`,
`build_performance`, `build_marathon`, `build_recovery_risk`,
`build_reviews`) plus a few shared helpers above them
(`readiness_score`, `classify_day`, `grade_workout`, `cardiac_drift`,
`lt_pace_check`, `pr_quality`, `race_prediction_confidence`,
`hr_zones_analysis`). Every number the frontend shows was computed there,
from real `data/raw/` inputs — the HTML/JS files only render what
`compute.py` already decided; they do not re-derive or re-interpret
anything.

### Coaching interpretation rules encoded throughout

These governed every interpretive decision below and in `compute.py` —
keep them in mind before changing any coaching logic:

1. **Completed vs. planned vs. unconfirmed stays separate.** Scheduled
   workouts (`scheduled_workouts.json`) and calendar events are distinct
   data types from completed activities and are never merged into
   completed-run stats — only shown as schedule context (e.g. Today page's
   "next scheduled session").
2. **Missing data is stated, not invented** — e.g. the Today page's
   resting-HR driver, SpO2 in the illness-risk checklist, and the Marathon
   page's route plan all explicitly say "not available" rather than
   guessing. The one exception (per rule below) is a flagged, transparent
   substitution.
3. **The lactate-threshold pace exception**: Garmin's own `lactateThresholdSpeed`
   field is wildly inconsistent with this athlete's real splits (implies
   ~44:00/mi next to a 187bpm LT heart rate and 6:00/mi tempo efforts) —
   `lt_pace_check()` flags it as a likely data error and substitutes a
   range interpolated from real comparable-HR splits, showing the
   reasoning on the Performance page rather than silently swapping it.
4. **HR is judged against personal history, not generic zones** —
   `hr_zones_analysis()` builds personal easy/hard HR ranges from this
   athlete's own logged runs (~150s-160s easy, 190s-200+ hard), while also
   showing Garmin's configured zone profile since one does exist on this
   account (many accounts won't have one — check, don't assume).
5. **Context (weather, HRV, sleep, races) informs interpretation** — e.g.
   the Recovery page's `flags` explicitly connect a rough HRV night to the
   half-marathon race three days earlier rather than flagging it in
   isolation.
6. Never suggests making up missed mileage (not implemented anywhere —
   intentionally absent).
7. **Race days come only from Garmin's `event_type == "race"` field**,
   never from matching "race" in an activity name — `classify_day()` and
   the Marathon page's long-run-progression chart both rely on this field
   exclusively.
8. **Specific, not vague** — exact pace ranges, specific data-error
   substitutions, specific fueling-cadence gaps are called out by name
   throughout, not generic "run easy" advice.
9. Real-trend requirement before recommending a change — e.g. the Today
   readiness score only fires its "reduce volume" tier at real
   multi-driver thresholds, not a single soft reading.
10. Marathon-pace volume is tracked explicitly as thin/adequate
    (`marathon_pace_volume_adequacy`) rather than assumed fine.
11. **Every coach-style claim traces to its source** — the Reviews page's
    "coach's take" paragraphs each end with an italic "based on ___" line
    sourced straight from `build_reviews()`.

## Known gaps in this data pull (see `refresh/PULL.md` "not yet wired up")

- Resting-HR-by-day and SpO2 series aren't pulled yet (no range endpoint
  exists for either — they'd need a per-day loop). The Today readiness
  driver and illness-risk checklist both show an honest "not available"
  state for these until that's added.
- No 90-day per-run pace/HR series was pulled, so the Performance page's
  pace-vs-HR scatter chart currently shows an explicit empty state instead
  of fabricated points.
- No race-organizer GPX course file has been loaded yet, so the Marathon
  page's interactive route/pacing tool is built and ready but shows an
  empty state until `data/raw/course.gpx` exists.

None of these are silently papered over — each renders a clear "not
available" message per rule 2 above. Extend the pull step and `compute.py`
together to close them.
