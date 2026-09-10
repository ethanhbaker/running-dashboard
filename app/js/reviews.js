// Reviews page — narrative/reflective, not a metrics dump.
// Section 1: last completed week's review (weekly_review).
// Section 2: coach's take — a short Q&A style narrative (coachs_take).

function parseLocalDate(ymd) {
  if (!ymd) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function formatDateRange(startStr, endStr) {
  const start = parseLocalDate(startStr);
  const end = parseLocalDate(endStr);
  if (!start || !end) return fmt(null);
  const startFmt = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const endFmt = end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${startFmt} - ${endFmt}`;
}

function reviewRow(label, value) {
  return el("div", { className: "card" }, [
    el("div", { className: "tile-label", text: label }),
    el("div", {
      attrs: { style: "font-size:14px; line-height:1.55; color:var(--text-primary);" },
      html: value !== null && value !== undefined && value !== "" ? value : `<span class="na">&mdash;</span>`,
    }),
  ]);
}

function buildWeeklyReviewSection(review) {
  const section = el("section", { className: "page-section" });
  const dateRange = formatDateRange(review.week_start, review.week_end);
  section.appendChild(sectionHeader("Weekly review", dateRange));

  const t = review.totals || {};
  const grid = el("div", { className: "tile-grid" });
  grid.appendChild(tile("Miles", fmt(t.miles, " mi")));
  grid.appendChild(tile("Runs", fmt(t.runs)));
  grid.appendChild(tile("Avg pace", fmt(t.avg_pace, "/mi")));
  grid.appendChild(tile("Avg HR", fmt(t.avg_hr, " bpm")));
  section.appendChild(grid);

  const rowsGrid = el("div", {
    className: "card-grid",
    attrs: { style: "margin-top:14px;" },
  }, [
    reviewRow("Biggest positive", review.biggest_positive),
    reviewRow("Main risk / concern", review.main_risk),
    reviewRow("Fitness trend", review.fitness_trend_read),
    reviewRow("Standout workout", review.standout_workout),
    reviewRow("Recommended adjustment", review.recommended_adjustment),
    reviewRow("Next week's objective", review.next_week_objective),
  ]);
  section.appendChild(rowsGrid);

  // In-progress week note — visually separated so it's never mistaken for
  // part of the completed week's stats above.
  const inProgress = el("div", {
    attrs: {
      style: "margin-top:20px; padding-top:16px; border-top:1px dashed var(--border);",
    },
  }, [
    el("div", { className: "tile-label", text: "This week so far" }),
    el("div", {
      className: "muted",
      attrs: { style: "font-size:13px; line-height:1.5;" },
      text: review.in_progress_week_note || "—",
    }),
  ]);
  section.appendChild(inProgress);

  return section;
}

function coachTakeBlock(item, isLast) {
  return el("div", {
    attrs: {
      style: `padding-bottom:16px; margin-bottom:16px;${isLast ? "" : " border-bottom:1px solid var(--border);"}`,
    },
  }, [
    el("div", {
      attrs: {
        style: "font-family:var(--font-display); font-weight:700; text-transform:uppercase; letter-spacing:0.03em; font-size:12px; color:var(--text-muted); margin-bottom:6px;",
      },
      text: item.question || "—",
    }),
    el("p", {
      attrs: { style: "margin:0 0 6px; font-size:14px; line-height:1.6; color:var(--text-primary);" },
      text: item.text || "—",
    }),
    el("div", {
      attrs: { style: "font-size:12px; font-style:italic; color:var(--text-muted);" },
      text: item.based_on ? `based on ${item.based_on}` : "—",
    }),
  ]);
}

function buildCoachsTakeSection(coachsTake) {
  const section = el("section", { className: "page-section" });
  section.appendChild(sectionHeader("Coach's take"));

  const card = el("div", {
    className: "card",
    attrs: { style: "max-width:760px;" },
  });

  const items = coachsTake || [];
  if (items.length === 0) {
    card.appendChild(el("div", { className: "empty-state", text: "No coach's take available." }));
  } else {
    items.forEach((item, i) => {
      card.appendChild(coachTakeBlock(item, i === items.length - 1));
    });
  }

  section.appendChild(card);
  return section;
}

function renderReviews(data, meta) {
  const main = document.getElementById("main");
  if (!data) {
    main.appendChild(el("div", { className: "empty-state", text: "No review data available." }));
    return;
  }
  if (data.weekly_review) {
    main.appendChild(buildWeeklyReviewSection(data.weekly_review));
  }
  if (data.coachs_take) {
    main.appendChild(buildCoachsTakeSection(data.coachs_take));
  }
  if (!data.weekly_review && !data.coachs_take) {
    main.appendChild(el("div", { className: "empty-state", text: "No review data available." }));
  }
}

initPage("reviews.json", renderReviews);
