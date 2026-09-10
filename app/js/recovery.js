// Recovery & Risk page — the two cautionary-tale cards (ACWR injury risk, HRV illness risk)
// plus the trend charts and real, prewritten flag sentences that back them up.

// ---- small local helpers (each page file is loaded standalone, so no cross-file reuse) ----

function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function shortDate(dateStr) {
  const d = parseLocalDate(dateStr);
  return d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : dateStr;
}

function statusLevel(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).toUpperCase();
  const bad = ["LOW", "POOR", "UNBALANCED", "UNPRODUCTIVE", "DETRAINING", "OVERREACHING", "STRAINED", "CRITICAL", "VERY_LOW", "FAIR"];
  const okGood = ["HIGH", "GOOD", "BALANCED", "OPTIMAL", "PRODUCTIVE", "RESTED", "PEAKING", "MAINTAINING", "EXCELLENT"];
  if (okGood.some((x) => s.includes(x))) return "good";
  if (bad.some((x) => s.includes(x))) return "warning";
  return "";
}

function fmtRange(arr, suffix = "") {
  if (!Array.isArray(arr) || arr.length < 2 || arr[0] == null || arr[1] == null) return fmt(null);
  return `${arr[0]}${suffix}–${arr[1]}${suffix}`;
}

function dateIndexFormatter(dates) {
  return (val) => {
    let idx = Math.round(val);
    if (idx < 0) idx = 0;
    if (idx > dates.length - 1) idx = dates.length - 1;
    return shortDate(dates[idx]);
  };
}

function sleepQualifierColor(qualifier) {
  const q = (qualifier || "").toUpperCase();
  if (q === "EXCELLENT" || q === "GOOD") return "--good";
  if (q === "FAIR") return "--warning";
  if (q === "POOR") return "--critical";
  return "--s1";
}

function checklistPillInfo(status) {
  const s = (status || "").toLowerCase();
  if (s.includes("not available")) return { cls: "neutral", label: "N/A" };
  if (s === "ok" || s.includes(" ok") || s.startsWith("ok")) return { cls: "good", label: "OK" };
  return { cls: "warning", label: "Flagged" };
}

function legendRow(items) {
  // items: [{color, label}]
  return el("div", { className: "chart-legend-row" }, items.map((it) =>
    el("span", { className: "chart-legend-item" }, [
      el("span", { className: "chart-legend-swatch", attrs: { style: `background:var(${it.color});` } }),
      el("span", { text: it.label }),
    ])
  ));
}

// ---- Section 1: Recovery ----

function buildHrvChartCard(hrvTrend) {
  const card = el("div", { className: "card chart-card" });
  card.appendChild(el("h3", { text: "HRV — 30 day trend" }));
  if (!hrvTrend || hrvTrend.length === 0) {
    card.appendChild(el("div", { className: "empty-state", text: "No HRV trend data available." }));
    return card;
  }
  const dates = hrvTrend.map((d) => d.date);
  const series = [
    {
      name: "Nightly HRV",
      color: "--s1",
      points: hrvTrend.map((d, i) => ({
        x: i,
        y: d.last_night_avg_hrv_ms,
        label: `${fmt(d.last_night_avg_hrv_ms, "ms")} · ${fmt(d.status)} (${shortDate(d.date)})`,
      })),
    },
    {
      name: "7-day rolling avg",
      color: "--s4",
      points: hrvTrend.map((d, i) => ({
        x: i,
        y: d.weekly_avg_hrv_ms,
        label: `${fmt(d.weekly_avg_hrv_ms, "ms")} avg (${shortDate(d.date)})`,
      })),
    },
  ];
  const wrap = el("div", { className: "chart-wrap" });
  wrap.appendChild(lineChart(series, { xTickCount: 6, xFormatter: dateIndexFormatter(dates), yFormatter: (v) => Math.round(v) }));
  card.appendChild(wrap);
  card.appendChild(legendRow([
    { color: "--s1", label: "Nightly HRV" },
    { color: "--s4", label: "7-day rolling avg" },
  ]));
  return card;
}

function buildSleepChartCard(sleepRange) {
  const card = el("div", { className: "card chart-card" });
  card.appendChild(el("h3", { text: "Sleep score — last 14 nights" }));
  if (!sleepRange || sleepRange.length === 0) {
    card.appendChild(el("div", { className: "empty-state", text: "No sleep data available." }));
    return card;
  }
  const barData = sleepRange.map((d) => ({
    label: shortDate(d.date),
    value: d.sleep_score,
    color: sleepQualifierColor(d.sleep_score_qualifier),
    tooltip: `${fmt(d.sleep_score)} (${fmt(d.sleep_score_qualifier)}) · ${d.sleep_hours != null ? d.sleep_hours + "h slept" : "—"}`,
  }));
  const wrap = el("div", { className: "chart-wrap" });
  wrap.appendChild(barChart(barData, { minMax: 100 }));
  card.appendChild(wrap);
  card.appendChild(legendRow([
    { color: "--good", label: "Excellent / Good" },
    { color: "--warning", label: "Fair" },
    { color: "--critical", label: "Poor" },
  ]));
  return card;
}

function buildBodyBatteryChartCard(bodyBattery) {
  const card = el("div", { className: "card chart-card" });
  card.appendChild(el("h3", { text: "Body battery — charged vs. drained (20 days)" }));
  if (!bodyBattery || bodyBattery.length === 0) {
    card.appendChild(el("div", { className: "empty-state", text: "No body battery data available." }));
    return card;
  }
  const groups = bodyBattery.map((d) => ({
    label: shortDate(d.date),
    bars: [
      { key: "charged", value: d.charged, color: "--s3", tooltip: `+${fmt(d.charged)} charged${d.note ? ` — ${d.note}` : ""}` },
      { key: "drained", value: d.drained, color: "--s2", tooltip: `-${fmt(d.drained)} drained${d.note ? ` — ${d.note}` : ""}` },
    ],
  }));
  const wrap = el("div", { className: "chart-wrap" });
  wrap.appendChild(groupedBarChart(groups, ["charged", "drained"], { width: 760 }));
  card.appendChild(wrap);
  card.appendChild(legendRow([
    { color: "--s3", label: "Charged" },
    { color: "--s2", label: "Drained" },
  ]));
  // surface any day-notes (e.g. race day) below the chart, since the chart tooltip is easy to miss
  const notedDays = bodyBattery.filter((d) => d.note);
  if (notedDays.length) {
    const noteEl = el("div", { className: "risk-note" });
    notedDays.forEach((d) => {
      noteEl.appendChild(el("div", { text: `${shortDate(d.date)}: ${d.note}` }));
    });
    card.appendChild(noteEl);
  }
  return card;
}

function buildRespirationChartCard(respirationTrend) {
  if (!respirationTrend || respirationTrend.length === 0) return null;
  const card = el("div", { className: "card chart-card" });
  card.appendChild(el("h3", { text: "Respiration rate — sleep avg (compact)" }));
  const dates = respirationTrend.map((d) => d.date);
  const series = [{
    name: "Breaths/min",
    color: "--s7",
    points: respirationTrend.map((d, i) => ({
      x: i,
      y: d.avg_sleep_breaths_per_min,
      label: `${fmt(d.avg_sleep_breaths_per_min)} breaths/min (${shortDate(d.date)})`,
    })),
  }];
  const wrap = el("div", { className: "chart-wrap" });
  wrap.appendChild(lineChart(series, { height: 140, xTickCount: 6, xFormatter: dateIndexFormatter(dates), yFormatter: (v) => v.toFixed(0) }));
  card.appendChild(wrap);
  return card;
}

function buildFlagsCard(flags) {
  const card = el("div", { className: "card" });
  card.appendChild(el("h3", { className: "risk-card-title", text: "What the numbers actually mean" }));
  const callout = el("div", { className: "callout" });
  if (flags && flags.length) {
    flags.forEach((f) => callout.appendChild(el("p", { className: "flag-line", text: f })));
  } else {
    callout.appendChild(el("p", { className: "muted", text: "No flags generated for this refresh." }));
  }
  card.appendChild(callout);
  return card;
}

function buildRecoverySection(data) {
  const section = el("section", { className: "page-section" });
  section.appendChild(sectionHeader("Recovery", "HRV, sleep &amp; body battery — last 2-4 weeks"));
  const charts = data.recovery_charts || {};
  const stack = el("div", { className: "recovery-stack" });
  stack.appendChild(buildHrvChartCard(charts.hrv_trend_30d));
  stack.appendChild(buildSleepChartCard(charts.sleep_range_14d));
  stack.appendChild(buildBodyBatteryChartCard(charts.body_battery_20d));
  const respCard = buildRespirationChartCard(charts.respiration_trend);
  if (respCard) stack.appendChild(respCard);
  stack.appendChild(buildFlagsCard(data.flags));
  section.appendChild(stack);
  return section;
}

// ---- Section 2: Risk signals ----

function buildAcwrCard(acwr) {
  const card = el("div", { className: "card" });
  card.appendChild(el("h3", { className: "risk-card-title", text: "Injury risk — Acute:Chronic Workload Ratio (ACWR)" }));

  const grid = el("div", { className: "tile-grid" });
  grid.appendChild(tile(
    "Current ACWR",
    fmt(acwr.current),
    `<span class="pill ${pillClass(statusLevel(acwr.status))}">${fmt(acwr.status)}</span>`,
  ));
  grid.appendChild(tile("Percent of optimal", fmt(acwr.percent_of_optimal, "%"), "of the sweet-spot band"));
  grid.appendChild(tile("Sweet spot", fmtRange(acwr.sweet_spot), "ACWR target range"));
  grid.appendChild(tile("Caution ceiling", fmt(acwr.caution_ceiling), "above this = elevated injury risk"));
  card.appendChild(grid);

  if (acwr.trend_30d && acwr.trend_30d.length) {
    const dates = acwr.trend_30d.map((d) => d.date);
    const sweetSpot = acwr.sweet_spot || [];
    const chartWrap = el("div", { className: "chart-wrap", attrs: { style: "margin-top:16px;" } });
    const bands = (sweetSpot.length === 2) ? [{ yMin: sweetSpot[0], yMax: sweetSpot[1], color: "--good", label: "sweet spot" }] : [];
    chartWrap.appendChild(lineChart(
      [{ name: "ACWR", color: "--s1", points: acwr.trend_30d.map((d, i) => ({ x: i, y: d.acwr, label: `${fmt(d.acwr)} (${shortDate(d.date)})` })) }],
      { xTickCount: 6, xFormatter: dateIndexFormatter(dates), yFormatter: (v) => v.toFixed(1), bands },
    ));
    card.appendChild(chartWrap);
  }

  // positive note — the whole point of not letting a risk page sound only alarmed
  if (acwr.sweet_spot_positive_note) {
    card.appendChild(el("div", { className: "callout positive", attrs: { style: "margin-top:16px;" } }, [
      el("p", { text: acwr.sweet_spot_positive_note }),
    ]));
  }

  if (acwr.what_acwr_cant_see) {
    card.appendChild(el("div", { className: "callout", attrs: { style: "margin-top:12px;" } }, [
      el("p", { html: `<strong>Blind spot:</strong> ${acwr.what_acwr_cant_see}` }),
    ]));
  }

  if (acwr.historical_status_note) {
    card.appendChild(el("div", { className: "risk-note", attrs: { style: "margin-top:12px;" } }, [
      el("span", { html: `<strong>Historical context:</strong> ${acwr.historical_status_note}` }),
    ]));
  }

  if (acwr.methodology_caveats) {
    card.appendChild(el("div", { className: "callout caution", attrs: { style: "margin-top:12px;" } }, [
      el("p", { html: `<strong>Methodology caveats:</strong> ${acwr.methodology_caveats}` }),
    ]));
  }

  return card;
}

function buildIllnessCard(illness) {
  const card = el("div", { className: "card" });
  card.appendChild(el("h3", { className: "risk-card-title", text: "Illness risk — HRV" }));

  const grid = el("div", { className: "tile-grid" });
  grid.appendChild(tile(
    "Last night's HRV",
    fmt(illness.last_night_hrv, "ms"),
    `<span class="pill ${pillClass(statusLevel(illness.last_night_status))}">${fmt(illness.last_night_status)}</span>`,
  ));
  grid.appendChild(tile("Personal baseline (mean)", fmt(illness.personal_baseline_mean, "ms")));
  grid.appendChild(tile("Personal baseline range", fmtRange(illness.personal_baseline_range, "ms"), "mean ± 1 stdev, 22 nights"));
  grid.appendChild(tile("7-day avg", fmt(illness.weekly_avg, "ms")));
  card.appendChild(grid);

  if (illness.supporting_checklist && illness.supporting_checklist.length) {
    const checklistWrap = el("div", { className: "card", attrs: { style: "margin-top:16px; padding:12px 16px;" } });
    checklistWrap.appendChild(el("div", { className: "tile-label", text: "Supporting signals", attrs: { style: "margin-bottom:4px;" } }));
    illness.supporting_checklist.forEach((c) => {
      const info = checklistPillInfo(c.status);
      checklistWrap.appendChild(el("div", { className: "checklist-row" }, [
        el("span", { text: c.signal }),
        el("span", {}, [
          el("span", { className: `pill ${info.cls}`, text: info.label }),
          el("span", { className: "muted", attrs: { style: "margin-left:8px; font-size:12px;" }, text: c.status || "" }),
        ]),
      ]));
    });
    card.appendChild(checklistWrap);
  }

  if (illness.methodology) {
    card.appendChild(el("div", { className: "callout", attrs: { style: "margin-top:16px;" } }, [
      el("p", { text: illness.methodology }),
    ]));
  }

  return card;
}

function buildRiskSection(data) {
  const section = el("section", { className: "page-section" });
  section.appendChild(sectionHeader("Risk signals", "Two cautionary-tale readings, both grounded in real numbers"));
  const grid = el("div", { className: "card-grid risk-card-grid" });
  grid.appendChild(buildAcwrCard(data.acwr || {}));
  grid.appendChild(buildIllnessCard(data.illness_risk || {}));
  section.appendChild(grid);
  return section;
}

function renderRecovery(data, meta) {
  const main = document.getElementById("main");
  if (!data) {
    main.appendChild(el("div", { className: "empty-state", text: "No recovery data available." }));
    return;
  }
  main.appendChild(buildRecoverySection(data));
  main.appendChild(buildRiskSection(data));
}

initPage("recovery.json", renderRecovery);
