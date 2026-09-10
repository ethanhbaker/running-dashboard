---
name: refresh-dashboard
description: Pull fresh Garmin Connect data via the garmin-manual MCP server and recompute the running dashboard's coaching JSON. Use when the user asks to refresh, update, or re-pull the running dashboard's data.
---

# Refresh the running dashboard

This project (`running-dashboard/`) is a self-updating training-coach
dashboard. Refreshing it is two steps:

1. **Pull** — call the `garmin-manual` MCP tools listed in `refresh/PULL.md`
   and save each result into `data/raw/*.json` in the shapes documented
   there. Append (don't overwrite) `data/raw/race_predictions_history.json`
   with today's `get_race_predictions` snapshot — it's a rolling history
   used for the Performance page's confidence-range feature.
2. **Compute** — run `python refresh/compute.py` from the project root. It
   reads everything under `data/raw/` and writes `data/dashboard/*.json`.

Read `refresh/PULL.md` in full before starting — it has the exact tool list,
what to save from each, and notes on handling large tool results that get
saved to a temp file instead of returned inline.

After both steps finish, mention which raw files were refreshed and confirm
`compute.py` ran without errors. If the user wants to see the result, start
the local server (`.claude/launch.json`, config name "dashboard") and open
`app/today.html`.
