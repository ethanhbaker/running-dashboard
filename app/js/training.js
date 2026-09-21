// Training page: rolling training log — "how's training going lately".
// Reads data/dashboard/training.json (see refresh/compute.py build_training / build_calendar).

const CAL_TYPE_COLOR = {
  rest: "var(--grid)",
  easy: "var(--s1)",
  tempo: "var(--s4)",
  hard: "var(--s8)",
  long: "var(--s3)",
  race: "var(--s2)",
};

const CAL_TYPE_LABEL = {
  rest: "Rest",
  easy: "Easy",
  tempo: "Tempo",
  hard: "Hard",
  long: "Long",
  race: "Race",
};

function shortDate(dateStr) {
  if (!dateStr || dateStr === "—") return "—";
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
}

function longDate(dateStr) {
  if (!dateStr || dateStr === "—") return "—";
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function teLabelPill(label) {
  if (label === null || label === undefined || label === "—") {
    return `<span class="na">—</span>`;
  }
  const cls = { AEROBIC_BASE: "neutral", TEMPO: "warning", VO2MAX: "serious" }[label] || "neutral";
  return `<span class="pill ${cls}">${label}</span>`;
}

function acwrLevel(status) {
  if (status === "OPTIMAL") return "good";
  if (status === "LOW") return "warning";
  if (status === "HIGH") return "serious";
  return "";
}

// ---------------------------------------------------------------------
// Section 1: Running summary
// ---------------------------------------------------------------------

function renderSummarySection(data) {
  const s = data.summary;
  const section = el("section", { className: "page-section" });
  section.appendChild(sectionHeader("Running summary"));

  const tiles = el("div", { className: "tile-grid" }, [
    tile("This Week", fmt(s.this_week.miles, " mi"), `${s.this_week.runs} run${s.this_week.runs === 1 ? "" : "s"}`),
    tile("Last 7 Days", fmt(s.last_7_days.miles, " mi"), `${s.last_7_days.runs} run${s.last_7_days.runs === 1 ? "" : "s"}`),
    tile("This Month", fmt(s.this_month.miles, " mi"), `${s.this_month.runs} run${s.this_month.runs === 1 ? "" : "s"}`),
    tile("Year to Date", fmt(s.ytd.miles, " mi"), `${s.ytd.runs} run${s.ytd.runs === 1 ? "" : "s"}`),
    tile("Avg Pace (30d)", fmt(s.avg_pace_30d, "/mi")),
    tile("Avg HR (30d)", fmt(s.avg_hr_30d, " bpm")),
    tile("Elevation Gain (7d)", fmt(s.elevation_gain_7d_ft, " ft")),
    tile("Elevation Gain (Month)", fmt(s.elevation_gain_month_ft, " ft")),
  ]);
  section.appendChild(tiles);

  // Weekly mileage for the year — wide chart, scrolls horizontally.
  const weeklyData = data.weekly_mileage.map((w) => ({
    label: shortDate(w.week_start),
    value: w.miles,
    tooltip: `${w.miles}mi (wk of ${longDate(w.week_start)})`,
  }));
  const weeklyWidth = Math.max(760, weeklyData.length * 22);
  const weeklyWrap = el("div", { className: "card", attrs: { style: "margin-top:16px;" } });
  weeklyWrap.appendChild(el("div", { className: "tile-label", text: `Weekly mileage — ${weeklyData.length} weeks` }));
  const weeklyChartWrap = el("div", { className: "chart-wrap", attrs: { style: "margin-top:8px;" } });
  const weeklySvg = barChart(weeklyData, { width: weeklyWidth, height: 220 });
  weeklySvg.style.width = `${weeklyWidth}px`;
  weeklyChartWrap.appendChild(weeklySvg);
  weeklyWrap.appendChild(weeklyChartWrap);
  section.appendChild(weeklyWrap);

  // Daily mileage, last 30 days.
  const dailyData = data.daily_mileage_30d.map((d) => ({
    label: shortDate(d.date),
    value: d.miles,
    tooltip: `${d.miles}mi (${longDate(d.date)})`,
  }));
  const dailyWrap = el("div", { className: "card", attrs: { style: "margin-top:16px;" } });
  dailyWrap.appendChild(el("div", { className: "tile-label", text: "Daily mileage — last 30 days" }));
  const dailyChartWrap = el("div", { className: "chart-wrap", attrs: { style: "margin-top:8px;" } });
  const dailySvg = barChart(dailyData, { width: 760, height: 220 });
  dailyChartWrap.appendChild(dailySvg);
  dailyWrap.appendChild(dailyChartWrap);
  section.appendChild(dailyWrap);

  return section;
}

// ---------------------------------------------------------------------
// Section 2: Training consistency calendar
// ---------------------------------------------------------------------

function restStreakReadOn(days) {
  if (days <= 0) return "No rest days in this window.";
  if (days <= 2) return "A short, normal break between sessions — not a concern.";
  if (days <= 5) {
    return "A stretch like this right after a hard block or long run usually reads as a planned down-week, not a red flag — worth a quick check only if it wasn't planned.";
  }
  if (days <= 9) {
    return "Longer than a typical planned recovery gap — worth confirming this was intentional (taper, travel, minor niggle) rather than training slipping.";
  }
  return "A streak this long is unusual for an in-training athlete and worth a direct check-in on why.";
}

function renderCalendarSection(data) {
  const cal = data.calendar;
  const section = el("section", { className: "page-section" });
  section.appendChild(sectionHeader("Training consistency calendar", `Last ${cal.cells.length} days`));

  const card = el("div", { className: "card" });
  const grid = el("div", { className: "cal-grid" });

  cal.cells.forEach((c) => {
    const color = CAL_TYPE_COLOR[c.type] || "var(--grid)";
    const cellClass = c.type === "race" ? "cal-cell cal-race" : "cal-cell";
    const cell = el("div", {
      className: cellClass,
      attrs: { style: `background:${color};` },
    });
    if (c.type === "race") {
      cell.appendChild(el("span", { className: "cal-star", text: "★" }));
    }
    const namesHtml = c.names && c.names.length
      ? c.names.map((n) => `<div>${n}</div>`).join("")
      : "<div>—</div>";
    const tooltipHtml = `<span class="swatch" style="background:${color}"></span>${longDate(c.date)}: <b>${CAL_TYPE_LABEL[c.type] || c.type}</b>, ${c.miles}mi${namesHtml !== "<div>—</div>" ? `<br>${namesHtml}` : ""}`;
    cell.addEventListener("mousemove", (e) => showTooltip(e, tooltipHtml));
    cell.addEventListener("mouseleave", hideTooltip);
    cell.addEventListener("click", (e) => showTooltip(e, tooltipHtml));
    grid.appendChild(cell);
  });
  card.appendChild(grid);

  const legend = el("div", { className: "cal-legend" });
  Object.keys(CAL_TYPE_LABEL).forEach((type) => {
    legend.appendChild(el("div", { className: "cal-legend-item" }, [
      el("span", { className: "cal-legend-swatch", attrs: { style: `background:${CAL_TYPE_COLOR[type]};` } }),
      el("span", { text: CAL_TYPE_LABEL[type] }),
    ]));
  });
  card.appendChild(legend);

  card.appendChild(el("div", { className: "cal-note", text: cal.note }));
  section.appendChild(card);

  // Rolling stats + rest streak read.
  const statsTiles = el("div", { className: "tile-grid", attrs: { style: "margin-top:16px;" } }, [
    tile("Rolling 7d", fmt(cal.rolling_7d_mi, " mi")),
    tile("Rolling 28d", fmt(cal.rolling_28d_mi, " mi")),
    tile("Rolling 90d", fmt(cal.rolling_90d_mi, " mi")),
  ]);
  section.appendChild(statsTiles);

  const streakCard = el("div", { className: "callout", attrs: { style: "margin-top:16px;" } });
  streakCard.appendChild(el("p", {
    html: `Longest rest streak in this window: <b>${fmt(cal.longest_rest_streak_days, cal.longest_rest_streak_days === 1 ? " day" : " days")}</b>, ending ${longDate(cal.longest_rest_streak_end)}.`,
  }));
  streakCard.appendChild(el("p", { className: "rest-streak-note", text: restStreakReadOn(cal.longest_rest_streak_days) }));
  section.appendChild(streakCard);

  return section;
}

// ---------------------------------------------------------------------
// Section 3: Recent runs table
// ---------------------------------------------------------------------

function renderRecentRunsSection(data) {
  const section = el("section", { className: "page-section" });
  section.appendChild(sectionHeader("Recent runs"));

  const cols = [
    "Date", "Name", "Note", "Distance", "Duration", "Pace", "Avg HR", "Max HR",
    "Elev Gain", "TE", "TE Label", "Cadence", "Event",
  ];

  const rowsHtml = data.recent_runs.map((r) => `
    <tr>
      <td>${fmt(shortDate(r.date))}</td>
      <td>${fmt(r.name)}</td>
      <td>${r.note ? r.note : `<span class="na">—</span>`}</td>
      <td class="mono">${fmt(r.distance_mi, " mi")}</td>
      <td class="mono">${fmt(r.duration)}</td>
      <td class="mono">${fmt(r.pace_per_mi, "/mi")}</td>
      <td class="mono">${fmt(r.avg_hr, " bpm")}</td>
      <td class="mono">${fmt(r.max_hr, " bpm")}</td>
      <td class="mono">${fmt(r.elevation_gain_ft, " ft")}</td>
      <td class="mono">${fmt(r.training_effect)}</td>
      <td>${teLabelPill(r.training_effect_label)}</td>
      <td class="mono">${fmt(r.cadence, " spm")}</td>
      <td>${fmt(r.event_type)}</td>
    </tr>`).join("");

  const tableWrap = el("div", { className: "data-table-wrap card" });
  tableWrap.innerHTML = `
    <table class="data-table">
      <thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
  section.appendChild(tableWrap);

  return section;
}

// ---------------------------------------------------------------------
// Section 4: Training load
// ---------------------------------------------------------------------

function renderLoadSection(data) {
  const load = data.load;
  const section = el("section", { className: "page-section" });
  section.appendChild(sectionHeader("Training load"));

  const tiles = el("div", { className: "tile-grid" }, [
    tile("ATL (Acute Load)", fmt(load.atl)),
    tile("CTL (Chronic Load)", fmt(load.ctl)),
    tile("ACWR", fmt(load.acwr), `${fmt(load.acwr_status)} · ${fmt(load.acwr_percent, "%")} of optimal band`, acwrLevel(load.acwr_status)),
    tile("Training Status", fmt(load.training_status), `Fitness trend: ${fmt(load.fitness_trend)}`),
  ]);
  section.appendChild(tiles);

  // Load focus grouped bar chart with target bands.
  const focusKeys = ["aerobic_low", "aerobic_high", "anaerobic"];
  const focusLabels = { aerobic_low: "Aerobic Low", aerobic_high: "Aerobic High", anaerobic: "Anaerobic" };
  const statusColor = { below: "--warning", within: "--good", above: "--s8" };
  const bars = focusKeys.map((key) => {
    const b = load.load_focus[key] || {};
    return {
      key,
      value: b.load ?? 0,
      color: statusColor[b.status] || "--s1",
      tooltip: `${focusLabels[key]}: ${b.load} (target ${b.target_min}-${b.target_max}, ${b.status})`,
    };
  });
  const targetBands = {};
  focusKeys.forEach((key) => {
    const b = load.load_focus[key] || {};
    if (b.target_min !== undefined && b.target_max !== undefined) {
      targetBands[key] = { min: b.target_min, max: b.target_max };
    }
  });

  const focusCard = el("div", { className: "card", attrs: { style: "margin-top:16px;" } });
  focusCard.appendChild(el("div", { className: "tile-label", text: "Load focus vs target bands (dashed lines = target)" }));
  const focusChartWrap = el("div", { className: "chart-wrap", attrs: { style: "margin-top:8px;" } });
  const focusSvg = groupedBarChart(
    [{ label: "Load Focus", bars }],
    focusKeys,
    { width: 480, height: 260, targetBands }
  );
  focusChartWrap.appendChild(focusSvg);
  focusCard.appendChild(focusChartWrap);
  section.appendChild(focusCard);

  // Load focus flags as callout lines.
  if (load.load_focus_flags && load.load_focus_flags.length) {
    const flagsCallout = el("div", { className: "callout", attrs: { style: "margin-top:16px;" } });
    load.load_focus_flags.forEach((f) => {
      const level = f.includes(" below ") ? "warning" : f.includes(" above ") ? "serious" : "";
      const dotHtml = level ? `<span class="load-flag-dot text-${level}">●</span>` : "";
      flagsCallout.appendChild(el("p", { className: "load-flag-line", html: `${dotHtml}${f}` }));
    });
    section.appendChild(flagsCallout);
  }

  // ATL vs CTL trend line.
  const trend = load.atl_ctl_trend_9wk || [];
  if (trend.length) {
    const atlSeries = {
      name: "ATL",
      color: "--s8",
      points: trend.map((t) => ({ x: Date.parse(t.date), y: t.atl, label: `${shortDate(t.date)}: ATL ${t.atl}` })),
    };
    const ctlSeries = {
      name: "CTL",
      color: "--s1",
      points: trend.map((t) => ({ x: Date.parse(t.date), y: t.ctl, label: `${shortDate(t.date)}: CTL ${t.ctl}` })),
    };
    const trendCard = el("div", { className: "card", attrs: { style: "margin-top:16px;" } });
    trendCard.appendChild(el("div", { className: "tile-label", text: `ATL vs CTL — last ${trend.length} days` }));
    const trendChartWrap = el("div", { className: "chart-wrap", attrs: { style: "margin-top:8px;" } });
    const trendSvg = lineChart([atlSeries, ctlSeries], {
      width: 800,
      height: 260,
      xTickCount: 6,
      xFormatter: (v) => new Date(v).toLocaleDateString(undefined, { month: "numeric", day: "numeric" }),
      yFormatter: (v) => Math.round(v),
    });
    trendChartWrap.appendChild(trendSvg);
    trendCard.appendChild(trendChartWrap);
    section.appendChild(trendCard);
  }

  return section;
}

// ---------------------------------------------------------------------
// Section 5: Route heatmap (real GPS tracks, no map-tile dependency)
// ---------------------------------------------------------------------

const HEAT_STROKE = "rgba(217, 73, 31, 0.14)";

function buildRouteHeatmapSvg(loc) {
  const svg = svgEl("svg", {
    viewBox: `0 0 ${loc.viewbox_width} ${loc.viewbox_height}`,
    width: "100%",
    preserveAspectRatio: "xMidYMid meet",
  });
  loc.routes.forEach((route) => {
    if (route.length < 2) return;
    const d = route.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");
    svg.appendChild(svgEl("path", {
      d, fill: "none", stroke: HEAT_STROKE, "stroke-width": 1.6,
      "stroke-linecap": "round", "stroke-linejoin": "round",
    }));
  });
  return svg;
}

function renderRouteHeatmapSection(heatData) {
  const section = el("section", { className: "page-section" });
  section.appendChild(sectionHeader("Route heatmap", "Real GPS tracks - brighter where a route repeats"));

  if (!heatData || !heatData.available) {
    section.appendChild(el("div", {
      className: "empty-state",
      text: (heatData && heatData.note) || "Route heatmap not available - no GPX tracks have been pulled yet.",
    }));
    return section;
  }

  const grid = el("div", { className: "card-grid" });
  Object.entries(heatData.locations).forEach(([name, loc]) => {
    const card = el("div", { className: "card" });
    card.appendChild(el("div", {
      className: "tile-label",
      text: `${name} — ${loc.run_count} run${loc.run_count === 1 ? "" : "s"}, ${loc.total_distance_mi}mi`,
    }));
    if (loc.date_range) {
      card.appendChild(el("div", {
        className: "section-note", attrs: { style: "text-align:left;margin-bottom:8px;" },
        text: `${longDate(loc.date_range[0])} – ${longDate(loc.date_range[1])}`,
      }));
    }
    const chartWrap = el("div", { className: "chart-wrap" });
    chartWrap.appendChild(buildRouteHeatmapSvg(loc));
    card.appendChild(chartWrap);
    grid.appendChild(card);
  });
  section.appendChild(grid);
  section.appendChild(el("div", { className: "cal-note", attrs: { style: "margin-top:10px;" }, text: heatData.note }));

  return section;
}

// ---------------------------------------------------------------------

async function renderTraining(data, meta) {
  const main = document.getElementById("main");
  if (!data) {
    main.appendChild(el("div", { className: "empty-state", text: "Training data isn't available right now." }));
    return;
  }

  main.appendChild(renderSummarySection(data));
  main.appendChild(renderCalendarSection(data));
  main.appendChild(renderRecentRunsSection(data));
  main.appendChild(renderLoadSection(data));

  try {
    const heatData = await loadJSON("../data/dashboard/route_heatmap.json");
    main.appendChild(renderRouteHeatmapSection(heatData));
  } catch (e) {
    console.error(e);
    main.appendChild(el("div", { className: "empty-state", text: "Route heatmap failed to load." }));
  }
}

initPage("training.json", renderTraining);
