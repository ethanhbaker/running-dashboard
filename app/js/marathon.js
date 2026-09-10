// Marathon page — everything specific to the current goal race
// (Amica Newport Marathon, 2026-10-11): readiness status for THIS block, plus
// the interactive race-day route/pace-split tool (built ahead of real GPX data).

// ---------------------------------------------------------------------------
// small formatting helpers
// ---------------------------------------------------------------------------

function marathonFmtDate(iso, opts) {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined,
    opts || { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function secToPace(sec) {
  if (sec === null || sec === undefined || !isFinite(sec)) return "—";
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function paceStrToSec(str) {
  if (!str) return null;
  const parts = String(str).trim().split(":");
  if (parts.length !== 2) return null;
  const m = parseInt(parts[0], 10);
  const s = parseInt(parts[1], 10);
  if (isNaN(m) || isNaN(s)) return null;
  return m * 60 + s;
}

function secToHMS(totalSec) {
  if (totalSec === null || totalSec === undefined || !isFinite(totalSec)) return "—";
  const s = Math.round(totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Section 1 — Marathon readiness
// ---------------------------------------------------------------------------

function buildReadinessTiles(data) {
  const grid = el("div", { className: "tile-grid" });

  // Countdown
  grid.appendChild(tile(
    "Race day countdown",
    data.countdown_days != null ? `${data.countdown_days}d` : fmt(null),
    `${fmt(data.race_name)} &middot; ${marathonFmtDate(data.race_date)}`,
  ));

  // Longest run this block
  const lr = data.longest_run_this_block;
  grid.appendChild(tile(
    "Longest run this block",
    lr && lr.distance_mi != null ? `${lr.distance_mi} mi` : fmt(null),
    lr ? `${marathonFmtDate(lr.date, { month: "short", day: "numeric" })} &middot; avg HR ${fmt(lr.avg_hr)}` : "No qualifying long run found.",
  ));

  // Marathon-pace volume note (verbatim, real prose from compute step)
  grid.appendChild(tile(
    "Marathon-pace volume",
    data.marathon_pace_volume_note ? "Limited" : fmt(null),
    data.marathon_pace_volume_note || "No marathon-pace data available.",
    "warning",
  ));

  // Injury interruptions
  const inj = data.injury_interruptions_this_block;
  grid.appendChild(tile(
    "Injury interruptions",
    inj != null ? String(inj) : fmt(null),
    inj === 0 ? "None this training block." : (inj != null ? `${inj} interruption${inj === 1 ? "" : "s"} this block.` : ""),
    inj === 0 ? "good" : (inj != null ? "warning" : ""),
  ));

  return grid;
}

function buildLongRunChart(data) {
  const wrap = el("div", { className: "chart-wrap" });
  const progression = data.long_run_progression || [];

  if (progression.length === 0) {
    wrap.appendChild(el("div", { className: "empty-state", text: "No long runs recorded for this training block yet." }));
    return wrap;
  }

  const chartData = progression.map((r) => ({
    label: marathonFmtDate(r.date, { month: "numeric", day: "numeric" }) + (r.is_race ? " ★" : ""),
    value: r.distance_mi,
    color: r.is_race ? "--s2" : "--s1",
    tooltip: `${r.name || "Run"} &mdash; ${r.distance_mi}mi, HR ${fmt(r.avg_hr)}`,
  }));

  wrap.appendChild(barChart(chartData, { yFormatter: (v) => `${Math.round(v)}mi` }));

  const legend = el("div", { className: "chart-legend" }, [
    el("span", { className: "legend-item" }, [
      el("span", { className: "legend-dot", attrs: { style: "background:var(--s1);" } }),
      el("span", { text: "Training long run" }),
    ]),
    el("span", { className: "legend-item" }, [
      el("span", { className: "legend-dot", attrs: { style: "background:var(--s2);" } }),
      el("span", { text: "Race (Garmin event_type = race, ★ on chart)" }),
    ]),
  ]);
  wrap.appendChild(legend);

  return wrap;
}

function taperPillLevel(status) {
  if (!status) return "";
  const s = status.toLowerCase();
  if (s.includes("not yet")) return "neutral";
  if (s.includes("deep")) return "serious";
  if (s.includes("early") || s.includes("taper")) return "warning";
  return "neutral";
}

function buildDetailCard(data) {
  const d = data.detail || {};
  const card = el("div", { className: "card" });

  // Weekly mileage consistency
  card.appendChild(el("div", { className: "detail-block" }, [
    el("div", { className: "tile-label", text: "Weekly mileage consistency" }),
    el("p", { text: d.weekly_mileage_consistency || "—" }),
  ]));
  card.appendChild(el("hr", { className: "detail-divider" }));

  // Marathon-pace volume adequacy
  card.appendChild(el("div", { className: "detail-block" }, [
    el("div", { className: "tile-label", text: "Marathon-pace volume adequacy" }),
    el("p", { text: d.marathon_pace_volume_adequacy || "—" }),
  ]));
  card.appendChild(el("hr", { className: "detail-divider" }));

  // Fueling practice status — explicit flag, not a neutral note
  card.appendChild(el("div", { className: "detail-block" }, [
    el("div", { className: "detail-block-head" }, [
      el("div", { className: "tile-label", text: "Fueling practice status" }),
      el("span", { className: "pill warning", text: "Not verified" }),
    ]),
    el("p", { text: d.fueling_practice_status || "—" }),
  ]));
  card.appendChild(el("hr", { className: "detail-divider" }));

  // Endurance vs speed readiness
  card.appendChild(el("div", { className: "detail-block" }, [
    el("div", { className: "tile-label", text: "Endurance vs. speed readiness" }),
    el("p", { text: d.endurance_vs_speed_readiness || "—" }),
  ]));
  card.appendChild(el("hr", { className: "detail-divider" }));

  // Taper status + underlying date math
  card.appendChild(el("div", { className: "detail-block" }, [
    el("div", { className: "detail-block-head" }, [
      el("div", { className: "tile-label", text: "Taper status" }),
      el("span", { className: `pill ${pillClass(taperPillLevel(d.taper_status)) || "neutral"}`, text: d.taper_status || "—" }),
    ]),
    el("div", { className: "taper-math", text: d.taper_math || "" }),
  ]));
  card.appendChild(el("hr", { className: "detail-divider" }));

  // Next key scheduled session — always rendered as upcoming, never completed
  const ns = d.next_key_session;
  const nextBlock = el("div", { className: "detail-block" }, [
    el("div", { className: "detail-block-head" }, [
      el("div", { className: "tile-label", text: "Next key scheduled session" }),
    ]),
  ]);
  if (ns) {
    const mins = ns.estimated_duration_seconds ? Math.round(ns.estimated_duration_seconds / 60) : null;
    nextBlock.appendChild(el("div", { className: "next-session-box" }, [
      el("span", { className: "pill neutral", text: "Scheduled — not yet completed" }),
      el("div", { className: "next-session-name", text: ns.name || "—" }),
      el("div", {
        className: "next-session-meta",
        html: `${marathonFmtDate(ns.date, { weekday: "short", month: "short", day: "numeric" })}` +
              `${ns.sport ? ` &middot; ${ns.sport}` : ""}` +
              `${mins ? ` &middot; ~${mins} min` : ""}`,
      }),
    ]));
  } else {
    nextBlock.appendChild(el("p", { className: "muted", text: "Nothing scheduled found." }));
  }
  card.appendChild(nextBlock);

  return card;
}

function buildReadinessSection(data) {
  const section = el("section", { className: "page-section" });
  section.appendChild(sectionHeader("Marathon readiness",
    `${fmt(data.race_name)} &middot; ${marathonFmtDate(data.race_date)}`));

  section.appendChild(buildReadinessTiles(data));

  const chartCard = el("div", { className: "card", attrs: { style: "margin-top:14px;" } }, [
    el("div", { className: "tile-label", text: "Long-run progression this block" }),
    buildLongRunChart(data),
  ]);
  section.appendChild(chartCard);

  section.appendChild(el("div", { attrs: { style: "margin-top:14px;" } }, [buildDetailCard(data)]));

  return section;
}

// ---------------------------------------------------------------------------
// Section 2 — Race-day route plan (interactive drag-to-adjust pace-split tool)
// ---------------------------------------------------------------------------

/**
 * Reusable interactive pace-split tool. Ready to use the moment real
 * GPX-derived per-mile course data exists for the goal race.
 *
 * @param {HTMLElement} container - element to render into (its content is replaced)
 * @param {Array<{mile:number, gradePct:number, defaultPaceSec:number, elevationFt:number}>} miles
 *   One entry per mile marker along the course, e.g.:
 *   { mile: 1, gradePct: 2.1, defaultPaceSec: 425, elevationFt: 12 }
 *   - mile: mile marker number (1-indexed)
 *   - gradePct: average grade over that mile, percent (+ up, - down)
 *   - defaultPaceSec: grade-adjusted suggested pace for that mile, in seconds/mile
 *   - elevationFt: elevation at that mile marker, in feet, for the backdrop profile
 * @param {Object} [opts]
 * @param {boolean} [opts.demo] - if true, renders a visible "demo data" badge
 */
function renderPaceSplitTool(container, miles, opts = {}) {
  container.innerHTML = "";
  if (!miles || miles.length === 0) {
    container.appendChild(el("div", { className: "empty-state", text: "No mile-by-mile course data to plot." }));
    return;
  }

  if (opts.demo) {
    container.appendChild(el("div", { className: "demo-banner", text: "Demo — illustrative, non-race data only" }));
  }

  // live, mutable per-mile pace state (seconds/mile). Starts at each mile's
  // grade-adjusted default; drags and presets override individual entries.
  const paceSec = miles.map((m) => m.defaultPaceSec);
  const overridden = miles.map(() => false);

  const n = miles.length;
  const defaultAvg = miles.reduce((a, m) => a + m.defaultPaceSec, 0) / n;

  // ---- controls (target pace + presets + reset) ----
  const controls = el("div", { className: "pace-tool-controls" });
  const targetLabel = el("label", { text: "Target avg pace (min/mi)" });
  const targetInput = el("input", { attrs: { type: "text", value: secToPace(defaultAvg) } });
  const targetWrap = el("div", {}, [targetLabel, targetInput]);

  const evenBtn = el("button", { className: "pace-tool-btn", text: "Even pace" });
  const negBtn = el("button", { className: "pace-tool-btn", text: "Negative split" });
  const posBtn = el("button", { className: "pace-tool-btn", text: "Conservative positive split" });
  const resetBtn = el("button", { className: "pace-tool-btn reset", text: "Reset to grade-adjusted default" });

  controls.appendChild(targetWrap);
  controls.appendChild(evenBtn);
  controls.appendChild(negBtn);
  controls.appendChild(posBtn);
  controls.appendChild(resetBtn);
  container.appendChild(controls);

  container.appendChild(el("div", {
    className: "pace-tool-note",
    text: "Neither preset is derived from Ethan's own completed-marathon data — this is his first marathon. " +
          "These are generic pacing shapes applied around your target, not a personalized prediction.",
  }));

  // ---- live summary readout ----
  const summary = el("div", { className: "pace-tool-summary" }, [
    el("div", {}, [
      el("div", { className: "stat-label", text: "Projected finish" }),
      el("div", { className: "stat-value", attrs: { "data-role": "finish" } }),
    ]),
    el("div", {}, [
      el("div", { className: "stat-label", text: "Average pace" }),
      el("div", { className: "stat-value", attrs: { "data-role": "avgpace" } }),
    ]),
  ]);
  container.appendChild(summary);
  const finishEl = summary.querySelector('[data-role="finish"]');
  const avgPaceEl = summary.querySelector('[data-role="avgpace"]');

  function updateSummary() {
    const total = paceSec.reduce((a, s) => a + s, 0);
    finishEl.textContent = secToHMS(total);
    avgPaceEl.textContent = `${secToPace(total / n)}/mi`;
  }

  // ---- chart geometry ----
  const width = 640, height = 280;
  const pad = { top: 16, right: 16, bottom: 30, left: 48 };
  const x0 = pad.left, x1 = width - pad.right, yTop = pad.top, yBottom = height - pad.bottom;

  const sx = (mileNum) => x0 + ((mileNum - miles[0].mile) / ((miles[n - 1].mile - miles[0].mile) || 1)) * (x1 - x0);

  let paceMin = Math.min(...miles.map((m) => m.defaultPaceSec)) - 30;
  let paceMax = Math.max(...miles.map((m) => m.defaultPaceSec)) + 30;
  if (paceMax - paceMin < 60) { paceMin -= 30; paceMax += 30; }

  // inverted: faster (smaller sec) pace renders higher on screen
  const paceToY = (pace) => {
    const t = (pace - paceMin) / ((paceMax - paceMin) || 1);
    return yTop + t * (yBottom - yTop);
  };
  const yToPace = (y) => {
    const t = (y - yTop) / (yBottom - yTop);
    return paceMin + t * (paceMax - paceMin);
  };

  const elevVals = miles.map((m) => m.elevationFt ?? 0);
  const elevMin = Math.min(...elevVals, 0);
  const elevMax = Math.max(...elevVals, elevMin + 1);
  const elevToY = (ft) => {
    const t = (ft - elevMin) / ((elevMax - elevMin) || 1);
    return yBottom - t * (yBottom - yTop) * 0.9;
  };

  const chartWrap = el("div", { className: "chart-wrap pace-tool-svg-wrap" });
  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}`, width: "100%", preserveAspectRatio: "xMidYMid meet" });

  const grid = cssVar("--grid");
  const axis = cssVar("--axis");
  const muted = cssVar("--text-muted");

  // y gridlines + labels (pace)
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const val = paceMin + ((paceMax - paceMin) * i) / ticks;
    const y = paceToY(val);
    svg.appendChild(svgEl("line", { x1: x0, x2: x1, y1: y, y2: y, stroke: grid, "stroke-width": 1 }));
    const t = svgEl("text", { x: x0 - 8, y: y + 3, "text-anchor": "end", "font-size": 10, fill: muted });
    t.textContent = `${secToPace(val)}`;
    svg.appendChild(t);
  }
  svg.appendChild(svgEl("line", { x1: x0, x2: x0, y1: yTop, y2: yBottom, stroke: axis, "stroke-width": 1 }));
  svg.appendChild(svgEl("line", { x1: x0, x2: x1, y1: yBottom, y2: yBottom, stroke: axis, "stroke-width": 1 }));

  // x-axis mile labels
  miles.forEach((m) => {
    const t = svgEl("text", { x: sx(m.mile), y: yBottom + 18, "text-anchor": "middle", "font-size": 9.5, fill: muted });
    t.textContent = `mi ${m.mile}`;
    svg.appendChild(t);
  });

  // shaded elevation-profile backdrop (area chart behind the pace line)
  const elevColor = cssVar("--s3");
  let elevPath = `M${sx(miles[0].mile)},${yBottom}`;
  miles.forEach((m) => { elevPath += ` L${sx(m.mile)},${elevToY(m.elevationFt ?? 0)}`; });
  elevPath += ` L${sx(miles[n - 1].mile)},${yBottom} Z`;
  svg.appendChild(svgEl("path", { d: elevPath, fill: elevColor, opacity: 0.14, stroke: "none" }));

  // pace line
  const paceLine = svgEl("path", { fill: "none", stroke: cssVar("--s1"), "stroke-width": 2 });
  svg.appendChild(paceLine);

  function pacePathD() {
    return miles.map((m, i) => `${i === 0 ? "M" : "L"}${sx(m.mile)},${paceToY(paceSec[i])}`).join(" ");
  }

  const circles = miles.map((m, i) => {
    const c = svgEl("circle", {
      cx: sx(m.mile), cy: paceToY(paceSec[i]), r: 6, fill: cssVar("--s1"),
      class: "pace-point",
    });
    c.style.touchAction = "none";
    svg.appendChild(c);
    return c;
  });

  function redraw() {
    paceLine.setAttribute("d", pacePathD());
    circles.forEach((c, i) => {
      c.setAttribute("cy", paceToY(paceSec[i]));
      c.classList.toggle("overridden", overridden[i]);
    });
    updateSummary();
  }

  // ---- dragging (Pointer Events, so touch works too) ----
  circles.forEach((c, i) => {
    c.addEventListener("pointerdown", (evt) => {
      c.setPointerCapture(evt.pointerId);
      c.dataset.dragging = "1";
    });
    c.addEventListener("pointermove", (evt) => {
      if (c.dataset.dragging !== "1") return;
      const rect = svg.getBoundingClientRect();
      const vb = svg.viewBox.baseVal;
      const relY = (evt.clientY - rect.top) / rect.height;
      let svgY = vb.y + relY * vb.height;
      svgY = Math.max(yTop, Math.min(yBottom, svgY));
      const newPace = Math.max(paceMin, Math.min(paceMax, yToPace(svgY)));
      paceSec[i] = newPace;
      overridden[i] = true;
      redraw();
    });
    const endDrag = (evt) => {
      if (c.dataset.dragging === "1") {
        try { c.releasePointerCapture(evt.pointerId); } catch (e) { /* noop */ }
      }
      c.dataset.dragging = "0";
    };
    c.addEventListener("pointerup", endDrag);
    c.addEventListener("pointercancel", endDrag);
    c.addEventListener("mousemove", (e) => showTooltip(e,
      `Mile ${miles[i].mile}: <b>${secToPace(paceSec[i])}/mi</b>`));
    c.addEventListener("mouseleave", hideTooltip);
  });

  chartWrap.appendChild(svg);
  container.appendChild(chartWrap);

  // ---- presets ----
  function applyEven(targetSec) {
    for (let i = 0; i < n; i++) { paceSec[i] = targetSec; overridden[i] = true; }
    redraw();
  }
  function applyLinearRamp(targetSec, offsetSec) {
    // Linear ramp from (target+offset) at mile 1 to (target-offset) at the last
    // mile. The average of a symmetric linear ramp equals its midpoint, so the
    // overall average pace stays equal to targetSec regardless of mile count.
    for (let i = 0; i < n; i++) {
      const frac = n > 1 ? i / (n - 1) : 0;
      paceSec[i] = (targetSec + offsetSec) - 2 * offsetSec * frac;
      overridden[i] = true;
    }
    redraw();
  }

  function currentTargetSec() {
    return paceStrToSec(targetInput.value) || defaultAvg;
  }

  evenBtn.addEventListener("click", () => applyEven(currentTargetSec()));
  negBtn.addEventListener("click", () => applyLinearRamp(currentTargetSec(), 15)); // slower first half, faster second half
  posBtn.addEventListener("click", () => applyLinearRamp(currentTargetSec(), -8)); // modest slowdown in second half
  resetBtn.addEventListener("click", () => {
    for (let i = 0; i < n; i++) { paceSec[i] = miles[i].defaultPaceSec; overridden[i] = false; }
    redraw();
  });

  redraw();
}

function buildRoutePlanSection(data) {
  const section = el("section", { className: "page-section" });
  section.appendChild(sectionHeader("Race-day route plan"));

  const card = el("div", { className: "card" });

  if (!data.route_plan_available) {
    card.appendChild(el("div", { className: "empty-state", text: data.route_plan_note ||
      "No course data available for this race yet." }));

    // Demo of the interactive tool, clearly labeled as illustrative/non-race
    // data so it can never be mistaken for a real pacing plan. Remove this
    // block (or just call renderPaceSplitTool with real GPX-derived miles)
    // once data/raw/course.gpx exists and the pull/compute has been re-run.
    const demoWrap = el("div", { className: "demo-wrap" });
    const demoMiles = [
      { mile: 1, gradePct: 0.5, defaultPaceSec: 480, elevationFt: 10 },
      { mile: 2, gradePct: 0.0, defaultPaceSec: 480, elevationFt: 10 },
      { mile: 3, gradePct: -0.5, defaultPaceSec: 480, elevationFt: 8 },
    ];
    renderPaceSplitTool(demoWrap, demoMiles, { demo: true });
    card.appendChild(demoWrap);
  } else {
    // Real path: data.route_plan_miles is expected to carry the GPX-derived
    // per-mile array in the shape documented on renderPaceSplitTool.
    const toolWrap = el("div");
    renderPaceSplitTool(toolWrap, data.route_plan_miles || []);
    card.appendChild(toolWrap);
  }

  section.appendChild(card);
  return section;
}

// ---------------------------------------------------------------------------

function renderMarathon(data, meta) {
  const main = document.getElementById("main");
  if (!data) {
    main.appendChild(el("div", { className: "empty-state", text: "No marathon data available." }));
    return;
  }
  main.appendChild(buildReadinessSection(data));
  main.appendChild(buildRoutePlanSection(data));
}

initPage("marathon.json", renderMarathon);
