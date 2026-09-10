// Workouts page: (1) execution grading for real structured sessions, and
// (2) a fully client-side, in-memory workout builder. No backend, no writes.

// ---------------------------------------------------------------------
// small pace/time helpers (all times as "M:SS" strings, M unbounded)
// ---------------------------------------------------------------------

function paceStrToSec(str) {
  if (!str) return null;
  const m = /^(\d+):([0-5]\d)$/.exec(String(str).trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function secToPaceStr(sec) {
  if (sec === null || sec === undefined || !isFinite(sec) || sec < 0) return "—";
  sec = Math.round(sec);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// low end of a "7:30-8:00/mi" style range; "" if absent/unparseable
function paceRangeLow(rangeStr) {
  if (!rangeStr) return "";
  const m = /^(\d+:\d{2})\s*-\s*(\d+:\d{2})\/mi$/.exec(String(rangeStr).trim());
  return m ? m[1] : "";
}

// pulls "6:45/mi target" -> 405 (seconds); null if the string isn't a real target
function parseTargetPaceSec(target) {
  if (!target) return null;
  const m = /(\d+:\d{2})\s*\/\s*mi\s*target/i.exec(target);
  return m ? paceStrToSec(m[1]) : null;
}

const SEGMENT_TYPES = [
  "warmup", "easy", "marathon_pace", "tempo", "threshold",
  "interval_vo2max", "recovery_jog", "cooldown",
];

const SEGMENT_LABELS = {
  warmup: "Warmup",
  easy: "Easy",
  marathon_pace: "Marathon Pace",
  tempo: "Tempo",
  threshold: "Threshold",
  interval_vo2max: "Interval (VO2max)",
  recovery_jog: "Recovery Jog",
  cooldown: "Cooldown",
};

function typeLabel(t) {
  return SEGMENT_LABELS[t] || t;
}

function formatDateStr(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

// ---------------------------------------------------------------------
// Section 1 — workout execution grading
// ---------------------------------------------------------------------

function renderGradedWorkoutCard(w) {
  const header = el("div", { className: "workout-card-header" }, [
    el("div", { className: "workout-card-title" }, [
      el("div", { className: "name", text: w.name || "Untitled workout" }),
      el("div", { className: "date", text: formatDateStr(w.date) }),
    ]),
    el("div", { className: "workout-card-badges" }, [
      el("span", { className: `pill ${pillClass(w.overall_grade)}`, text: w.overall_grade || "—" }),
      ...(w.garmin_training_effect_label
        ? [
            el("span", { className: "pill neutral", text: `Garmin TE: ${w.garmin_training_effect_label}` }),
          ]
        : []),
    ]),
  ]);

  const children = [header];

  children.push(el("div", { className: "workout-card-reason", text: w.reason || "" }));

  if (w.garmin_training_effect_label) {
    children.push(el("div", {
      className: "te-note",
      text: "Garmin's own effort-label classification for this activity — separate from the segment grading below.",
    }));
  }

  // segment table
  const rows = (w.segments || []).map((seg) => {
    const targetSec = parseTargetPaceSec(seg.target);
    const actualSec = paceStrToSec(seg.pace_per_mi);
    let indicator = `<span class="na">–</span>`;
    if (targetSec !== null && actualSec !== null) {
      const onTarget = Math.abs(actualSec - targetSec) <= 15;
      indicator = onTarget ? "✅" : "⚠️";
    }
    const targetHtml = (seg.target === "no fixed target logged" || !seg.target)
      ? `<span class="na">${seg.target || "—"}</span>`
      : seg.target;

    return el("tr", {}, [
      el("td", { text: seg.label || "—" }),
      el("td", { className: "mono", html: fmt(seg.distance_mi != null ? seg.distance_mi.toFixed(2) : null, " mi") }),
      el("td", { className: "mono", html: fmt(seg.pace_per_mi, "/mi") }),
      el("td", { className: "mono", html: fmt(seg.avg_hr, " bpm") }),
      el("td", { html: targetHtml }),
      el("td", { className: "indicator", html: indicator }),
    ]);
  });

  const table = el("div", { className: "data-table-wrap" }, [
    el("table", { className: "data-table" }, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", { text: "Segment" }),
          el("th", { text: "Distance" }),
          el("th", { text: "Pace/mi" }),
          el("th", { text: "Avg HR" }),
          el("th", { text: "Target" }),
          el("th", { text: "On target?" }),
        ]),
      ]),
      el("tbody", {}, rows),
    ]),
  ]);
  children.push(table);

  if (w.note) {
    children.push(el("div", { className: "workout-note", text: w.note }));
  }

  return el("div", { className: "card workout-card" }, children);
}

function renderGradedSection(gradedWorkouts) {
  const section = el("section", { className: "page-section" }, [
    sectionHeader("Workout execution score", "Structured sessions graded from typed splits (warmup/cooldown excluded)"),
  ]);

  if (!gradedWorkouts || gradedWorkouts.length === 0) {
    section.appendChild(el("div", { className: "empty-state", text: "No graded structured workouts yet." }));
    return section;
  }

  gradedWorkouts.forEach((w) => section.appendChild(renderGradedWorkoutCard(w)));
  return section;
}

// ---------------------------------------------------------------------
// Section 2 — workout builder
// ---------------------------------------------------------------------

function cloneSegments(segments) {
  return (segments || []).map((s) => ({ ...s }));
}

function buildBuilderSection(builder) {
  const defaults = builder.segment_defaults || {};
  let state = []; // in-memory only

  const section = el("section", { className: "page-section" }, [
    sectionHeader("Workout builder", "Segment paces are defaults pulled from Ethan's own recent structured sessions — edit anything"),
  ]);

  const card = el("div", { className: "card" });
  section.appendChild(card);

  // -- presets --
  const presetRow = el("div", { className: "preset-buttons" });
  (builder.presets || []).forEach((preset) => {
    const btn = el("button", { className: "btn", text: preset.name, attrs: { type: "button" } });
    btn.addEventListener("click", () => {
      state = cloneSegments(preset.segments);
      renderRows();
    });
    presetRow.appendChild(btn);
  });
  card.appendChild(presetRow);

  // -- segment rows --
  const listEl = el("div", { className: "segment-list" });
  card.appendChild(listEl);

  const addBtn = el("button", { className: "btn btn-primary", text: "+ Add segment", attrs: { type: "button" } });
  const actions = el("div", { className: "builder-actions" }, [addBtn]);
  card.appendChild(actions);
  addBtn.addEventListener("click", () => {
    state.push({ type: "easy", distance_mi: 1, pace: paceRangeLow(defaults.easy && defaults.easy.pace_range), repeat: 1 });
    renderRows();
  });

  // -- summary tiles --
  card.appendChild(el("div", { className: "builder-subhead", text: "Session summary" }));
  const summaryGrid = el("div", { className: "tile-grid" });
  card.appendChild(summaryGrid);

  // -- export --
  const exportLabel = el("div", { className: "builder-subhead", text: "Plain-text export (copy/paste anywhere — nothing here is sent to Garmin)" });
  const exportBox = el("textarea", { className: "export-box", attrs: { readonly: "readonly", spellcheck: "false" } });
  card.appendChild(exportLabel);
  card.appendChild(exportBox);

  function computeSummary() {
    let totalDist = 0;
    let totalSec = 0;
    state.forEach((seg) => {
      const reps = Number(seg.repeat) > 0 ? Number(seg.repeat) : 1;
      const dist = Number(seg.distance_mi) || 0;
      const paceSec = paceStrToSec(seg.pace);
      totalDist += dist * reps;
      if (paceSec !== null) totalSec += dist * reps * paceSec;
    });
    const avgPaceSec = totalDist > 0 ? totalSec / totalDist : null;
    return { totalDist, totalSec, avgPaceSec };
  }

  function updateSummaryAndExport() {
    const { totalDist, totalSec, avgPaceSec } = computeSummary();

    summaryGrid.innerHTML = "";
    summaryGrid.appendChild(tile("Total distance", fmt(totalDist ? totalDist.toFixed(2) : null, " mi")));
    summaryGrid.appendChild(tile("Est. total time", fmt(totalSec ? `${secToPaceStr(totalSec)}` : null)));
    summaryGrid.appendChild(tile("Avg pace", fmt(avgPaceSec ? `${secToPaceStr(avgPaceSec)}` : null, "/mi")));

    const formatMi = (n) => {
      let s = (Number(n) || 0).toFixed(2);
      if (s.endsWith("0")) s = s.slice(0, -1);
      if (s.endsWith(".")) s += "0";
      return s;
    };
    const lines = state.map((seg) => {
      const reps = Number(seg.repeat) > 0 ? Number(seg.repeat) : 1;
      const dist = formatMi(seg.distance_mi);
      const repStr = reps > 1 ? ` x${reps}` : "";
      const paceStr = seg.pace ? `${seg.pace}/mi` : "—/mi";
      const noteStr = seg.note ? ` (${seg.note})` : "";
      return `${typeLabel(seg.type)}${repStr}: ${dist}mi @ ${paceStr}${noteStr}`;
    });
    const totalsLine = `Total: ${totalDist.toFixed(2)}mi, ~${secToPaceStr(totalSec)} elapsed, avg pace ${secToPaceStr(avgPaceSec)}/mi`;
    exportBox.value = lines.length ? `${lines.join("\n")}\n\n${totalsLine}` : "No segments yet.";
  }

  function renderRows() {
    listEl.innerHTML = "";
    if (state.length === 0) {
      listEl.appendChild(el("div", { className: "empty-state", text: "No segments yet — load a preset or add one." }));
    }
    state.forEach((seg, idx) => listEl.appendChild(buildRow(seg, idx)));
    updateSummaryAndExport();
  }

  function buildRow(seg, idx) {
    const row = el("div", { className: "segment-row" });

    // type select
    const typeField = el("div", { className: "segment-field type" });
    typeField.appendChild(el("label", { text: "Type" }));
    const select = el("select", {});
    SEGMENT_TYPES.forEach((t) => {
      const opt = el("option", { text: typeLabel(t), attrs: { value: t } });
      if (t === seg.type) opt.setAttribute("selected", "selected");
      select.appendChild(opt);
    });
    typeField.appendChild(select);
    row.appendChild(typeField);

    // repeat
    const repeatField = el("div", { className: "segment-field repeat" });
    repeatField.appendChild(el("label", { text: "Repeat" }));
    const repeatInput = el("input", { attrs: { type: "number", min: "1", step: "1", value: seg.repeat || 1 } });
    repeatField.appendChild(repeatInput);
    row.appendChild(repeatField);

    // distance
    const distField = el("div", { className: "segment-field distance" });
    distField.appendChild(el("label", { text: "Distance (mi)" }));
    const distInput = el("input", { attrs: { type: "number", min: "0", step: "0.1", value: seg.distance_mi != null ? seg.distance_mi : "" } });
    distField.appendChild(distInput);
    row.appendChild(distField);

    // pace
    const paceField = el("div", { className: "segment-field pace" });
    paceField.appendChild(el("label", { text: "Pace /mi" }));
    const paceInput = el("input", { attrs: { type: "text", placeholder: "M:SS", value: seg.pace || "" } });
    paceField.appendChild(paceInput);
    row.appendChild(paceField);

    // remove
    const removeWrap = el("div", { className: "segment-remove-wrap" });
    const removeBtn = el("button", { className: "btn btn-remove", html: "✕", attrs: { type: "button", "aria-label": "Remove segment" } });
    removeWrap.appendChild(removeBtn);
    row.appendChild(removeWrap);

    // basis note
    const basisEl = el("div", { className: "segment-basis" });
    row.appendChild(basisEl);

    // preset note, if any
    if (seg.note) {
      row.appendChild(el("div", { className: "segment-preset-note muted", text: `Note: ${seg.note}` }));
    }

    function refreshBasis() {
      const def = defaults[seg.type];
      if (!def) { basisEl.textContent = ""; return; }
      let text = def.basis || "";
      if (!def.pace_range) {
        text += " Pace field left free-entry — no real observed pace to default from.";
      }
      basisEl.textContent = text;
    }
    refreshBasis();

    select.addEventListener("change", () => {
      seg.type = select.value;
      const def = defaults[seg.type];
      const low = def ? paceRangeLow(def.pace_range) : "";
      seg.pace = low;
      paceInput.value = low;
      refreshBasis();
      updateSummaryAndExport();
    });
    repeatInput.addEventListener("input", () => {
      seg.repeat = parseInt(repeatInput.value, 10) || 1;
      updateSummaryAndExport();
    });
    distInput.addEventListener("input", () => {
      seg.distance_mi = parseFloat(distInput.value) || 0;
      updateSummaryAndExport();
    });
    paceInput.addEventListener("input", () => {
      seg.pace = paceInput.value;
      updateSummaryAndExport();
    });
    removeBtn.addEventListener("click", () => {
      state.splice(idx, 1);
      renderRows();
    });

    return row;
  }

  renderRows();

  // -- write-access note --
  section.appendChild(el("div", { className: "callout", html: `<p>${builder.write_access_note || ""}</p>` }));

  return section;
}

// ---------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------

function renderWorkouts(data, meta) {
  const main = document.getElementById("main");
  if (!data) {
    main.innerHTML = `<div class="empty-state">No workout data available.</div>`;
    return;
  }

  main.appendChild(renderGradedSection(data.graded_workouts));

  if (data.builder) {
    main.appendChild(buildBuilderSection(data.builder));
  }
}

initPage("workouts.json", renderWorkouts);
