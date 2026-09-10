// Today page — the daily check-in. Short and action-oriented:
// 1) what matters today, 2) readiness recommendation + drivers, 3) today's snapshot tiles.

function mdBoldToHtml(line) {
  // Convert "**bold**" markdown spans to <strong>, and normalize the leading "->" arrow.
  return line
    .replace(/^->\s*/, "&#8594; ")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function statusLevel(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).toUpperCase();
  const bad = ["LOW", "POOR", "UNBALANCED", "UNPRODUCTIVE", "DETRAINING", "OVERREACHING", "STRAINED"];
  const okGood = ["HIGH", "GOOD", "BALANCED", "OPTIMAL", "PRODUCTIVE", "RESTED", "PEAKING", "MAINTAINING"];
  if (bad.some((x) => s.includes(x))) return "warning";
  if (okGood.some((x) => s.includes(x))) return "good";
  return "";
}

function trContextNote(ctx) {
  if (!ctx) return "";
  if (ctx === "AFTER_WAKEUP_RESET") {
    return "Wake-up reading only — not yet updated with today's activity.";
  }
  if (ctx === "UPDATE_REALTIME_VARIABLES") {
    return "Updated with real-time data after today's activity.";
  }
  return `Context: ${ctx}`;
}

function buildCalloutsSection(data) {
  const section = el("section", { className: "page-section" });
  section.appendChild(sectionHeader("What matters today"));
  const callout = el("div", { className: "callout" });
  (data.callouts || []).forEach((line) => {
    callout.appendChild(el("p", { html: mdBoldToHtml(line) }));
  });
  if (!data.callouts || data.callouts.length === 0) {
    callout.appendChild(el("p", { className: "muted", text: "No callouts available for today." }));
  }
  section.appendChild(callout);
  return section;
}

function buildNextScheduledBlock(nextSession) {
  if (!nextSession) {
    return el("div", { attrs: { style: "text-align:right;" } }, [
      el("div", { className: "tile-label", text: "Next scheduled" }),
      el("div", { className: "na", text: "—" }),
    ]);
  }
  // Parse the y-m-d string as local calendar date (avoid UTC-parse off-by-one).
  const [y, m, d] = (nextSession.date || "").split("-").map(Number);
  const dateStr = (y && m && d)
    ? new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    : nextSession.date;
  const mins = nextSession.estimated_duration_seconds
    ? Math.round(nextSession.estimated_duration_seconds / 60)
    : null;
  return el("div", { attrs: { style: "text-align:right;" } }, [
    el("div", { className: "tile-label", text: "Next scheduled" }),
    el("div", {
      attrs: { style: "font-family:var(--font-display); font-weight:800; font-size:16px; color:var(--text-secondary);" },
      text: nextSession.name || "—",
    }),
    el("div", {
      className: "muted",
      attrs: { style: "font-size:12px; margin-top:2px;" },
      html: `${dateStr}${mins ? ` &middot; ~${mins} min` : ""} &middot; <em>scheduled, not yet completed</em>`,
    }),
  ]);
}

function buildDriversTable(drivers) {
  const wrap = el("div", { className: "data-table-wrap" });
  const table = el("table", { className: "data-table" });
  const thead = el("thead", {}, [
    el("tr", {}, [
      el("th", { text: "Driver" }),
      el("th", { text: "Value" }),
      el("th", { text: "Points" }),
      el("th", { text: "Status" }),
      el("th", { text: "Note" }),
    ]),
  ]);
  const tbody = el("tbody");
  (drivers || []).forEach((d) => {
    const isUnavailable = d.value === null || d.value === undefined;
    const statusPill = el("span", {
      className: `pill ${isUnavailable ? "neutral" : d.flagged ? "warning" : "good"}`,
      text: isUnavailable ? "N/A" : d.flagged ? "Flagged" : "OK",
    });
    tbody.appendChild(el("tr", {}, [
      el("td", { text: d.driver }),
      el("td", { html: fmt(d.value) }),
      el("td", { text: String(d.points) }),
      el("td", {}, [statusPill]),
      el("td", { text: d.note || "—" }),
    ]));
  });
  table.appendChild(thead);
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function buildReadinessSection(data) {
  const r = data.readiness || {};
  const section = el("section", { className: "page-section" });
  section.appendChild(sectionHeader("Daily readiness"));

  const card = el("div", { className: "card" });

  const topRow = el("div", {
    attrs: { style: "display:flex; align-items:flex-start; justify-content:space-between; flex-wrap:wrap; gap:16px; margin-bottom:18px;" },
  }, [
    el("div", {}, [
      el("span", { className: `pill ${pillClass(r.level)}`, text: r.recommendation || "—" }),
      el("div", {
        attrs: { style: "margin-top:8px; font-size:13px; color:var(--text-secondary);" },
        text: `${r.score ?? "—"} caution point${r.score === 1 ? "" : "s"}`,
      }),
    ]),
    buildNextScheduledBlock(r.next_session),
  ]);

  card.appendChild(topRow);
  card.appendChild(buildDriversTable(r.drivers));
  section.appendChild(card);
  return section;
}

function buildSnapshotSection(data) {
  const s = data.snapshot || {};
  const section = el("section", { className: "page-section" });
  section.appendChild(sectionHeader("Today snapshot"));

  const grid = el("div", { className: "tile-grid" });

  // Steps vs goal
  const stepsPct = (s.steps != null && s.step_goal) ? Math.round((s.steps / s.step_goal) * 100) : null;
  grid.appendChild(tile(
    "Steps",
    `${fmt(s.steps)} <span style="font-size:15px; color:var(--text-muted);">/ ${fmt(s.step_goal)}</span>`,
    stepsPct != null ? `${stepsPct}% of goal` : "",
  ));

  // Body battery
  grid.appendChild(tile(
    "Body battery",
    fmt(s.body_battery_level),
    (s.body_battery_charged != null || s.body_battery_drained != null)
      ? `+${fmt(s.body_battery_charged)} charged &middot; -${fmt(s.body_battery_drained)} drained`
      : "",
    statusLevel(s.body_battery_level),
  ));

  // Sleep
  grid.appendChild(tile(
    "Sleep score",
    fmt(s.sleep_score),
    s.sleep_hours != null ? `${s.sleep_hours}h slept last night` : "",
  ));

  // HRV
  grid.appendChild(tile(
    "HRV (last night)",
    s.hrv_last_night != null ? `${s.hrv_last_night}ms` : fmt(null),
    (s.hrv_status || s.hrv_weekly_avg != null)
      ? `${fmt(s.hrv_status)} &middot; weekly avg ${fmt(s.hrv_weekly_avg)}ms`
      : "",
    statusLevel(s.hrv_status),
  ));

  // Training readiness
  grid.appendChild(tile(
    "Training readiness",
    fmt(s.training_readiness_score),
    [s.training_readiness_feedback, trContextNote(s.training_readiness_context)].filter(Boolean).join(" &mdash; "),
    statusLevel(s.training_readiness_feedback),
  ));

  // Recovery time
  grid.appendChild(tile(
    "Recovery time",
    s.recovery_time_hours != null ? `${s.recovery_time_hours}h` : fmt(null),
    "Estimated time until fully recovered",
  ));

  // Training status / ACWR
  grid.appendChild(tile(
    "ACWR / training status",
    fmt(s.acwr),
    [fmt(s.acwr_status), fmt(s.training_status)].join(" &middot; "),
    statusLevel(s.acwr_status),
  ));

  // Resting HR — honestly not available
  grid.appendChild(tile(
    "Resting HR",
    fmt(null),
    s.resting_hr_note || "Not available this refresh.",
  ));

  section.appendChild(grid);
  return section;
}

function renderToday(data, meta) {
  const main = document.getElementById("main");
  if (!data) {
    main.appendChild(el("div", { className: "empty-state", text: "No data available for today." }));
    return;
  }
  main.appendChild(buildCalloutsSection(data));
  main.appendChild(buildReadinessSection(data));
  main.appendChild(buildSnapshotSection(data));
}

initPage("today.json", renderToday);
