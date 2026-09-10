// Performance page — "how fit am I, really".
// Sections: overview tiles, race predictor w/ confidence, PR quality audit,
// power & HR analysis (FTP, zones, LT, cardiac drift, endurance score, tolerance).

function signed(v, suffix = "") {
  if (v === null || v === undefined) return `<span class="na">—</span>`;
  const sign = v > 0 ? "+" : "";
  return `${sign}${v}${suffix}`;
}

function shortDate(dateStr) {
  if (!dateStr) return "—";
  // Parse "YYYY-MM-DD" as a local calendar date (not UTC) to avoid an off-by-one
  // day shift when the browser's timezone is behind UTC.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function confidencePill(level) {
  const map = { High: "good", Medium: "warning", Low: "serious" };
  return el("span", { className: `pill ${map[level] || "neutral"}`, text: level || "—" });
}

// ---------------------------------------------------------------------------
// Section 1: Performance overview
// ---------------------------------------------------------------------------

function buildOverviewSection(data) {
  const section = el("section", { className: "page-section" });
  section.appendChild(sectionHeader("Performance overview"));

  const grid = el("div", { className: "tile-grid" });
  const vo2 = data.vo2max || {};
  grid.appendChild(tile(
    "VO2max (current)",
    fmt(vo2.current),
    `${signed(vo2.delta_90d)} over 90 days`,
    vo2.delta_90d > 0 ? "good" : vo2.delta_90d < 0 ? "warning" : "",
  ));

  const rp = data.race_predictions || {};
  const labels = { "5K": "5K predictor", "10K": "10K predictor", half_marathon: "Half predictor", marathon: "Marathon predictor" };
  Object.entries(labels).forEach(([key, label]) => {
    grid.appendChild(tile(label, fmt(rp[key]?.time), "Garmin race prediction"));
  });

  section.appendChild(grid);
  return section;
}

// ---------------------------------------------------------------------------
// Section 2: Race predictor with confidence range
// ---------------------------------------------------------------------------

function secToTimeStr(sec) {
  if (sec === null || sec === undefined) return "—";
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function buildConfidenceCards(rpc) {
  const grid = el("div", { className: "card-grid" });
  const labels = { "5K": "5K", "10K": "10K", half_marathon: "Half marathon", marathon: "Marathon" };
  Object.entries(labels).forEach(([key, label]) => {
    const d = rpc[key];
    if (!d) return;
    const card = el("div", { className: "card" });
    card.appendChild(el("div", {
      attrs: { style: "display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px;" },
    }, [
      el("div", { attrs: { style: "font-family:var(--font-display); font-weight:800; font-size:15px; text-transform:uppercase;" }, text: label }),
      confidencePill(d.confidence),
    ]));
    card.appendChild(el("div", {
      attrs: { style: "font-family:var(--font-display); font-weight:800; font-size:24px;" },
      html: fmt(d.current),
    }));
    let rangeText;
    if (d.range_seconds) {
      rangeText = `Range: ${secToTimeStr(d.range_seconds[0])} – ${secToTimeStr(d.range_seconds[1])}`;
    } else {
      rangeText = "Range not yet available — needs more prediction history.";
    }
    card.appendChild(el("div", {
      className: "tile-footnote",
      attrs: { style: "margin-top:6px;" },
      html: rangeText,
    }));
    card.appendChild(el("div", {
      className: "muted",
      attrs: { style: "font-size:11px; margin-top:4px;" },
      text: `(from ${d.snapshots_used} snapshot${d.snapshots_used === 1 ? "" : "s"})`,
    }));
    grid.appendChild(card);
  });
  return grid;
}

function buildPaceHrScatter() {
  const wrap = el("div", { attrs: { style: "margin-top:16px;" } });
  wrap.appendChild(el("div", { attrs: { style: "font-size:13px; font-weight:600; margin-bottom:8px;" }, text: "Pace vs. heart rate (trailing 90 days)" }));
  wrap.appendChild(el("div", { className: "empty-state", text: "Not available in this data pull — no per-run pace/HR series is included in performance.json for this refresh." }));
  wrap.appendChild(el("div", {
    className: "muted",
    attrs: { style: "font-size:12px; margin-top:6px;" },
    text: "A full 90-day pace-vs-HR scatter needs a dedicated data pull (per-run splits or timezone-series) not included in this refresh — worth adding to the next refresh pass.",
  }));
  return wrap;
}

function buildRacePredictorSection(data) {
  const rpc = data.race_prediction_confidence || {};
  const section = el("section", { className: "page-section" });
  section.appendChild(sectionHeader("Race predictor with confidence range"));

  const card = el("div", { className: "card" });
  card.appendChild(buildConfidenceCards(rpc));
  if (rpc.methodology) {
    card.appendChild(el("div", {
      className: "muted",
      attrs: { style: "font-size:12px; margin-top:14px; border-top:1px solid var(--border); padding-top:10px;" },
      text: rpc.methodology,
    }));
  }
  card.appendChild(buildPaceHrScatter());
  section.appendChild(card);

  if (data.fitness_verdict) {
    const callout = el("div", { className: "callout", attrs: { style: "margin-top:14px;" } });
    callout.appendChild(el("p", { text: data.fitness_verdict }));
    section.appendChild(callout);
  }

  return section;
}

// ---------------------------------------------------------------------------
// Section 3: PR quality
// ---------------------------------------------------------------------------

function buildPrCard(title, pr, isUnofficial) {
  const card = el("div", { className: "card" });
  card.appendChild(el("div", {
    attrs: { style: "display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:10px;" },
  }, [
    el("div", { attrs: { style: "font-family:var(--font-display); font-weight:800; font-size:16px; text-transform:uppercase;" }, text: title }),
    el("span", { className: `pill ${isUnofficial ? "warning" : "good"}`, text: isUnofficial ? "Unofficial" : "Official" }),
  ]));
  if (pr.name) {
    card.appendChild(el("div", { className: "muted", attrs: { style: "font-size:12px; margin-bottom:8px;" }, text: pr.name }));
  }
  card.appendChild(el("div", {
    attrs: { style: "font-family:var(--font-display); font-weight:800; font-size:28px; margin-bottom:8px;" },
    text: fmt(pr.time),
  }));

  const rows = [
    ["Distance", pr.distance_km ? `${pr.distance_km} km` : "—"],
    ["Date", shortDate(pr.date)],
    ["Avg HR", pr.avg_hr ? `${pr.avg_hr} bpm` : "—"],
    ["Elevation gain", pr.elevation_gain_m != null ? `${pr.elevation_gain_m} m` : "—"],
    ["Weather", fmt(pr.weather)],
    ["Pace", pr.pace_per_mi ? `${pr.pace_per_mi}/mi` : "—"],
  ];
  const dl = el("div", { attrs: { style: "font-size:13px; display:grid; grid-template-columns: auto 1fr; gap:4px 10px;" } });
  rows.forEach(([k, v]) => {
    dl.appendChild(el("div", { className: "muted", text: k }));
    dl.appendChild(el("div", { html: v }));
  });
  card.appendChild(dl);

  if (isUnofficial) {
    if (pr.why_not_official) {
      card.appendChild(el("div", {
        className: "muted",
        attrs: { style: "font-size:12px; margin-top:10px; border-top:1px solid var(--border); padding-top:8px;" },
        html: `<strong>Why not official:</strong> ${pr.why_not_official}`,
      }));
    }
    if (pr.reconstruction_method) {
      card.appendChild(el("div", {
        className: "muted",
        attrs: { style: "font-size:12px; margin-top:6px;" },
        html: `<strong>Reconstruction:</strong> ${pr.reconstruction_method}`,
      }));
    }
  }
  return card;
}

function buildPrOtherTable(list) {
  const wrap = el("div", { className: "data-table-wrap" });
  const table = el("table", { className: "data-table" });
  const thead = el("thead", {}, [
    el("tr", {}, [el("th", { text: "Record" }), el("th", { text: "Value" })]),
  ]);
  const tbody = el("tbody");
  (list || []).forEach((r) => {
    tbody.appendChild(el("tr", {}, [
      el("td", { text: r.record_type }),
      el("td", { text: r.value }),
    ]));
  });
  table.appendChild(thead);
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function buildPrQualitySection(data) {
  const pq = data.pr_quality || {};
  const section = el("section", { className: "page-section" });
  section.appendChild(sectionHeader("PR quality"));

  const grid = el("div", { className: "card-grid" });
  if (pq.official) grid.appendChild(buildPrCard("Official PR — Half Marathon", pq.official, false));
  if (pq.unofficial_better_quality) grid.appendChild(buildPrCard("Unofficial — Better Quality Effort", pq.unofficial_better_quality, true));
  section.appendChild(grid);

  if (pq.verdict) {
    const callout = el("div", { className: "callout", attrs: { style: "margin-top:14px; border-left-color: var(--warning);" } });
    callout.appendChild(el("p", { text: pq.verdict }));
    section.appendChild(callout);
  }

  if (pq.other_prs_unaudited && pq.other_prs_unaudited.length) {
    const noteWrap = el("div", { attrs: { style: "margin-top:16px;" } });
    noteWrap.appendChild(el("div", {
      className: "muted",
      attrs: { style: "font-size:12px; margin-bottom:8px;" },
      text: "Other personal records below have not been quality-audited the same way as the half marathon (course/weather/HR cross-check).",
    }));
    noteWrap.appendChild(buildPrOtherTable(pq.other_prs_unaudited));
    section.appendChild(noteWrap);
  }

  return section;
}

// ---------------------------------------------------------------------------
// Section 4: Power & HR analysis
// ---------------------------------------------------------------------------

function buildFtpCard(ftp) {
  const card = el("div", { className: "card" });
  card.appendChild(el("div", { attrs: { style: "font-family:var(--font-display); font-weight:800; font-size:15px; text-transform:uppercase; margin-bottom:10px;" }, text: "FTP estimate" }));
  const grid = el("div", { className: "tile-grid", attrs: { style: "margin-bottom:12px;" } });
  grid.appendChild(tile("FTP", ftp.ftp_estimate_w != null ? `${ftp.ftp_estimate_w}W` : fmt(null), ftp.ftp_note || ""));
  grid.appendChild(tile("Power-to-weight", fmt(ftp.power_to_weight, " W/kg")));
  grid.appendChild(tile("Weight used", ftp.weight_kg != null ? `${ftp.weight_kg} kg` : fmt(null), ftp.weight_date ? `as of ${shortDate(ftp.weight_date)}` : ""));
  card.appendChild(grid);
  if (ftp.single_activity_note) {
    card.appendChild(el("div", { className: "pill serious", attrs: { style: "margin-bottom:6px;" }, text: "Single-effort caveat" }));
    card.appendChild(el("div", { attrs: { style: "font-size:13px; color:var(--text-secondary);" }, text: ftp.single_activity_note }));
  }
  return card;
}

function buildHrZonesCard(hz) {
  const card = el("div", { className: "card" });
  card.appendChild(el("div", { attrs: { style: "font-family:var(--font-display); font-weight:800; font-size:15px; text-transform:uppercase; margin-bottom:10px;" }, text: "HR zones" }));

  card.appendChild(el("div", {
    attrs: { style: "display:flex; align-items:center; gap:8px; margin-bottom:6px;" },
  }, [
    el("span", { text: "Garmin configured profile:" }),
    el("span", { className: `pill ${hz.garmin_configured_profile_present ? "good" : "neutral"}`, text: hz.garmin_configured_profile_present ? "Present" : "Not present" }),
  ]));

  const gp = hz.garmin_configured_profile;
  if (gp) {
    const zoneRows = [
      ["Zone 1 floor", gp.zone1Floor], ["Zone 2 floor", gp.zone2Floor], ["Zone 3 floor", gp.zone3Floor],
      ["Zone 4 floor", gp.zone4Floor], ["Zone 5 floor", gp.zone5Floor], ["Max HR used", gp.maxHeartRateUsed],
      ["LT HR used", gp.lactateThresholdHeartRateUsed],
    ];
    const dl = el("div", { attrs: { style: "font-size:12px; display:grid; grid-template-columns: auto 1fr; gap:3px 10px; margin-bottom:12px;" } });
    zoneRows.forEach(([k, v]) => {
      dl.appendChild(el("div", { className: "muted", text: k }));
      dl.appendChild(el("div", { html: fmt(v, v != null ? " bpm" : "") }));
    });
    card.appendChild(dl);
  }

  card.appendChild(el("div", { attrs: { style: "font-size:13px; font-weight:600; margin-bottom:4px; margin-top:8px;" }, text: "Personal history (governs judgment in this app)" }));
  const grid = el("div", { className: "tile-grid", attrs: { style: "margin-bottom:10px;" } });
  grid.appendChild(tile("Personal easy HR", hz.personal_easy_hr_range ? `${hz.personal_easy_hr_range[0]}–${hz.personal_easy_hr_range[1]}` : fmt(null), "bpm"));
  grid.appendChild(tile("Personal hard HR", hz.personal_hard_hr_range ? `${hz.personal_hard_hr_range[0]}–${hz.personal_hard_hr_range[1]}` : fmt(null), "bpm"));
  card.appendChild(grid);

  if (hz.basis) {
    card.appendChild(el("div", { className: "muted", attrs: { style: "font-size:12px;" }, text: hz.basis }));
  }
  return card;
}

function buildLactateCard(lt) {
  const card = el("div", { className: "card" });
  card.appendChild(el("div", { attrs: { style: "font-family:var(--font-display); font-weight:800; font-size:15px; text-transform:uppercase; margin-bottom:10px;" }, text: "Lactate threshold" }));

  const grid = el("div", { className: "tile-grid", attrs: { style: "margin-bottom:12px;" } });
  grid.appendChild(tile("LT heart rate", lt.lt_hr_bpm != null ? `${lt.lt_hr_bpm} bpm` : fmt(null), lt.lt_hr_is_stale ? "flagged stale" : "current"));
  grid.appendChild(tile(
    "Garmin LT pace (per mi)",
    lt.flagged_as_error
      ? `<span style="text-decoration:line-through; color:var(--text-muted);">${fmt(lt.garmin_lt_pace_per_mi)}</span>`
      : fmt(lt.garmin_lt_pace_per_mi),
  ));
  grid.appendChild(tile(
    "Substituted pace range",
    lt.substituted_pace_range_per_mi ? `${lt.substituted_pace_range_per_mi[0]}–${lt.substituted_pace_range_per_mi[1]}` : fmt(null),
    lt.substituted_pace_range_per_mi ? "per mile, trustworthy value" : "",
  ));
  card.appendChild(grid);

  if (lt.flagged_as_error) {
    card.appendChild(el("span", { className: "pill critical", attrs: { style: "margin-bottom:8px; display:inline-block;" }, text: "Likely Garmin data error" }));
  }
  if (lt.basis) {
    card.appendChild(el("div", { attrs: { style: "font-size:13px; color:var(--text-secondary); margin-top:6px;" }, text: lt.basis }));
  }
  return card;
}

function buildCardiacDriftCard(cd) {
  const card = el("div", { className: "card" });
  card.appendChild(el("div", { attrs: { style: "font-family:var(--font-display); font-weight:800; font-size:15px; text-transform:uppercase; margin-bottom:10px;" }, text: "Cardiac drift" }));

  const goodDrift = cd.drift_percent != null && cd.drift_percent < 5;
  const grid = el("div", { className: "tile-grid", attrs: { style: "margin-bottom:10px;" } });
  grid.appendChild(tile("1st half avg HR", cd.first_half_avg_hr != null ? `${cd.first_half_avg_hr} bpm` : fmt(null)));
  grid.appendChild(tile("2nd half avg HR", cd.second_half_avg_hr != null ? `${cd.second_half_avg_hr} bpm` : fmt(null)));
  grid.appendChild(tile("1st half pace", cd.first_half_pace ? `${cd.first_half_pace}/mi` : fmt(null)));
  grid.appendChild(tile("2nd half pace", cd.second_half_pace ? `${cd.second_half_pace}/mi` : fmt(null)));
  grid.appendChild(tile("Drift", cd.drift_percent != null ? `${cd.drift_percent}%` : fmt(null), goodDrift ? "under 5% threshold" : "", goodDrift ? "good" : "warning"));
  card.appendChild(grid);

  if (cd.verdict) {
    card.appendChild(el("div", {
      className: `pill ${goodDrift ? "good" : "warning"}`,
      attrs: { style: "margin-bottom:6px; display:inline-block;" },
      text: goodDrift ? "Good news" : "Watch this",
    }));
    card.appendChild(el("div", { attrs: { style: "font-size:13px; color:var(--text-secondary);" }, text: cd.verdict }));
  }
  if (cd.methodology) {
    card.appendChild(el("div", { className: "muted", attrs: { style: "font-size:12px; margin-top:8px;" }, text: cd.methodology }));
  }
  if (cd.date) {
    card.appendChild(el("div", { className: "muted", attrs: { style: "font-size:11px; margin-top:6px;" }, text: `From the ${shortDate(cd.date)} long run.` }));
  }
  return card;
}

function nextTierInfo(current, thresholds) {
  if (current == null || !thresholds) return null;
  for (const [name, val] of Object.entries(thresholds)) {
    if (val > current) {
      return { name, gap: Math.round((val - current) * 10) / 10 };
    }
  }
  return null;
}

function buildEnduranceCard(es) {
  const card = el("div", { className: "card" });
  card.appendChild(el("div", { attrs: { style: "font-family:var(--font-display); font-weight:800; font-size:15px; text-transform:uppercase; margin-bottom:10px;" }, text: "Endurance score" }));

  const next = nextTierInfo(es.current, es.thresholds);
  const grid = el("div", { className: "tile-grid", attrs: { style: "margin-bottom:12px;" } });
  grid.appendChild(tile("Current score", fmt(es.current)));
  grid.appendChild(tile("Classification", es.classification ? es.classification.replace(/_/g, " ") : fmt(null)));
  grid.appendChild(tile(
    "Next tier",
    next ? next.name.replace(/_/g, " ") : fmt(null),
    next ? `${next.gap} points to go` : "",
  ));
  card.appendChild(grid);

  const weekly = es.weekly_breakdown || [];
  if (weekly.length > 1) {
    const points = weekly.map((w, i) => ({ x: i, y: w.avg_score, label: `${shortDate(w.week_start)}: ${w.avg_score}` }));
    const chartWrap = el("div", { className: "chart-wrap" });
    chartWrap.appendChild(lineChart([{ name: "Weekly avg score", color: "--s3", points }], {
      xTickCount: Math.min(5, weekly.length - 1),
      xFormatter: (v) => {
        const idx = Math.round(v);
        return weekly[idx] ? shortDate(weekly[idx].week_start).replace(/, \d{4}$/, "") : "";
      },
    }));
    card.appendChild(chartWrap);
  }
  return card;
}

function buildToleranceCard(rt) {
  const card = el("div", { className: "card" });
  card.appendChild(el("div", { attrs: { style: "font-family:var(--font-display); font-weight:800; font-size:15px; text-transform:uppercase; margin-bottom:10px;" }, text: "Running tolerance" }));
  const grid = el("div", { className: "tile-grid" });
  grid.appendChild(tile("Latest tolerance", rt.latest_tolerance_km != null ? `${rt.latest_tolerance_km} km` : fmt(null), "distance-based load capacity"));
  const trend = rt.trend || [];
  const latest = trend[trend.length - 1];
  if (latest) {
    grid.appendChild(tile("Load ratio", fmt(latest.load_ratio)));
    grid.appendChild(tile("This week's distance", latest.distance_km != null ? `${latest.distance_km} km` : fmt(null)));
  }
  card.appendChild(grid);
  return card;
}

function buildPowerHrSection(data) {
  const section = el("section", { className: "page-section" });
  section.appendChild(sectionHeader("Power & HR analysis"));

  const grid = el("div", { className: "card-grid" });
  if (data.ftp) grid.appendChild(buildFtpCard(data.ftp));
  if (data.hr_zones) grid.appendChild(buildHrZonesCard(data.hr_zones));
  if (data.lactate_threshold) grid.appendChild(buildLactateCard(data.lactate_threshold));
  if (data.cardiac_drift) grid.appendChild(buildCardiacDriftCard(data.cardiac_drift));
  if (data.endurance_score) grid.appendChild(buildEnduranceCard(data.endurance_score));
  if (data.running_tolerance) grid.appendChild(buildToleranceCard(data.running_tolerance));
  section.appendChild(grid);

  if (data.acwr_vs_tolerance_note) {
    const callout = el("div", { className: "callout", attrs: { style: "margin-top:14px;" } });
    callout.appendChild(el("p", { text: data.acwr_vs_tolerance_note }));
    section.appendChild(callout);
  }

  return section;
}

// ---------------------------------------------------------------------------

function renderPerformance(data, meta) {
  const main = document.getElementById("main");
  if (!data) {
    main.appendChild(el("div", { className: "empty-state", text: "No performance data available." }));
    return;
  }
  main.appendChild(buildOverviewSection(data));
  main.appendChild(buildRacePredictorSection(data));
  main.appendChild(buildPrQualitySection(data));
  main.appendChild(buildPowerHrSection(data));
}

initPage("performance.json", renderPerformance);
