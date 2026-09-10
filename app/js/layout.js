// Shared header / nav / footer, injected into every page.
// Each page sets <body data-page="today|training|workouts|performance|marathon|recovery|reviews">

const NAV_PAGES = [
  { id: "today", label: "Today", href: "today.html" },
  { id: "training", label: "Training", href: "training.html" },
  { id: "workouts", label: "Workouts", href: "workouts.html" },
  { id: "performance", label: "Performance", href: "performance.html" },
  { id: "marathon", label: "Marathon", href: "marathon.html" },
  { id: "recovery", label: "Recovery & Risk", href: "recovery.html" },
  { id: "reviews", label: "Reviews", href: "reviews.html" },
];

// Parses a "YYYY-MM-DD" string as a LOCAL date (not UTC midnight), avoiding
// the classic off-by-one where new Date("2026-09-09") renders as the previous
// day in timezones behind UTC. Falls back to plain Date parsing for anything
// that isn't a bare date string (e.g. full ISO timestamps).
function parseLocalDate(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(value);
}

function renderLayout(meta) {
  const current = document.body.dataset.page;
  const dateStr = parseLocalDate(meta?.data_as_of || Date.now()).toLocaleDateString(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const header = document.createElement("header");
  header.className = "app-header";
  header.innerHTML = `
    <div class="app-header-inner">
      <div>
        <div class="app-title display">${meta?.athlete_name || "Ethan"}'s Training</div>
      </div>
      <div class="app-header-meta">
        <span>${dateStr}</span>
        <span class="legend">
          <span class="legend-item"><span class="legend-dot garmin"></span>Garmin-recorded</span>
          <span class="legend-item"><span class="legend-dot coach"></span>Coach interpretation</span>
        </span>
      </div>
    </div>`;

  const nav = document.createElement("nav");
  nav.className = "app-nav";
  const navInner = document.createElement("div");
  navInner.className = "app-nav-inner";
  NAV_PAGES.forEach((p) => {
    const a = document.createElement("a");
    a.href = p.href;
    a.textContent = p.label;
    if (p.id === current) a.classList.add("active");
    navInner.appendChild(a);
  });
  nav.appendChild(navInner);

  const footer = document.createElement("footer");
  footer.className = "app-footer";
  footer.innerHTML = `
    <div class="max-w">
      Data from Garmin Connect, last pulled ${meta?.generated_at ? new Date(meta.generated_at).toLocaleString() : "—"}.<br>
      Scheduled/planned sessions only ever appear as schedule context, never as completed-run stats.
      Garmin fields not available for this account are omitted rather than estimated.
    </div>`;

  document.body.insertBefore(nav, document.body.firstChild);
  document.body.insertBefore(header, document.body.firstChild);
  document.body.appendChild(footer);
}

async function loadJSON(path) {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch (e) {
    console.warn("failed to load", path, e);
    return null;
  }
}

async function initPage(pageDataFile, renderFn) {
  const meta = await loadJSON("../data/dashboard/meta.json");
  renderLayout(meta || {});
  const data = pageDataFile ? await loadJSON(`../data/dashboard/${pageDataFile}`) : null;
  try {
    renderFn(data, meta);
  } catch (e) {
    console.error(e);
    const main = document.querySelector(".app-main");
    if (main) main.innerHTML += `<div class="empty-state">Something went wrong rendering this page: ${e.message}</div>`;
  }
}

// ---- small formatting helpers shared across pages ----

function fmt(val, suffix = "") {
  if (val === null || val === undefined || val === "—") {
    return `<span class="na">—</span>`;
  }
  return `${val}${suffix}`;
}

function pillClass(level) {
  return { good: "good", warning: "warning", serious: "serious", critical: "critical" }[level] || "neutral";
}

function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.html !== undefined) node.innerHTML = opts.html;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.attrs) Object.entries(opts.attrs).forEach(([k, v]) => node.setAttribute(k, v));
  children.forEach((c) => node.appendChild(c));
  return node;
}

function tile(label, value, footnote = "", footnoteLevel = "") {
  return el("div", { className: "tile" }, [
    el("div", { className: "tile-label", text: label }),
    el("div", { className: "tile-value", html: value }),
    footnote ? el("div", { className: `tile-footnote ${footnoteLevel}`, html: footnote }) : el("span"),
  ]);
}

function sectionHeader(title, note = "") {
  return el("div", { className: "section-header" }, [
    el("h2", { text: title }),
    note ? el("div", { className: "section-note", html: note }) : el("span"),
  ]);
}
