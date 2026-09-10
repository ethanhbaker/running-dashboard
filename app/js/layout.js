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

function lastPulledText(meta) {
  return meta?.generated_at ? new Date(meta.generated_at).toLocaleString() : "—";
}

// Re-applies the parts of the header/footer that depend on meta.json
// (the date line and the "last pulled" timestamp) without touching nav.
function updateLayoutMeta(meta) {
  const dateEl = document.getElementById("header-date");
  if (dateEl) {
    dateEl.textContent = parseLocalDate(meta?.data_as_of || Date.now()).toLocaleDateString(undefined, {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
  }
  const pulledEl = document.getElementById("footer-last-pulled");
  if (pulledEl) pulledEl.textContent = lastPulledText(meta);
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
        <span id="header-date">${dateStr}</span>
        <span class="legend">
          <span class="legend-item"><span class="legend-dot garmin"></span>Garmin-recorded</span>
          <span class="legend-item"><span class="legend-dot coach"></span>Coach interpretation</span>
        </span>
        <button type="button" id="refresh-data-btn" class="refresh-btn" title="Re-fetch the latest computed data/dashboard/*.json and re-render this page. This does NOT pull new data from Garmin - run the refresh pipeline (refresh/PULL.md) for that first.">
          <span class="refresh-btn-icon">&#8635;</span> Refresh
        </button>
      </div>
    </div>`;

  header.querySelector("#refresh-data-btn").addEventListener("click", (e) => refreshDashboardData(e.currentTarget));

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
      Data from Garmin Connect, last pulled <span id="footer-last-pulled">${lastPulledText(meta)}</span>.<br>
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

let _currentPageFile = null;
let _currentRenderFn = null;

function runRender(data, meta) {
  const main = document.querySelector(".app-main");
  if (main) main.innerHTML = "";
  try {
    _currentRenderFn(data, meta);
  } catch (e) {
    console.error(e);
    if (main) main.innerHTML += `<div class="empty-state">Something went wrong rendering this page: ${e.message}</div>`;
  }
}

async function initPage(pageDataFile, renderFn) {
  _currentPageFile = pageDataFile;
  _currentRenderFn = renderFn;
  const meta = await loadJSON("../data/dashboard/meta.json");
  renderLayout(meta || {});
  const data = pageDataFile ? await loadJSON(`../data/dashboard/${pageDataFile}`) : null;
  runRender(data, meta);
}

// Re-fetches meta.json + this page's data file (both already requested with
// cache: "no-store", so this always reflects whatever is currently on disk
// under data/dashboard/) and re-renders in place. Wired to the header's
// "Refresh" button. This reads already-computed files - it does not itself
// contact Garmin or run refresh/compute.py.
async function refreshDashboardData(button) {
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="refresh-btn-icon spinning">&#8635;</span> Refreshing…`;
  try {
    const meta = await loadJSON("../data/dashboard/meta.json");
    updateLayoutMeta(meta || {});
    const data = _currentPageFile ? await loadJSON(`../data/dashboard/${_currentPageFile}`) : null;
    runRender(data, meta);
    button.innerHTML = `<span class="refresh-btn-icon">&#10003;</span> Updated`;
  } catch (e) {
    console.error(e);
    button.innerHTML = `<span class="refresh-btn-icon">&#33;</span> Failed`;
  } finally {
    setTimeout(() => {
      button.innerHTML = original;
      button.disabled = false;
    }, 1500);
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
