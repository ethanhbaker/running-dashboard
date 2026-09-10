// Hand-rolled inline-SVG chart primitives. No external charting library.
// All functions return an SVG element you can append to the DOM.
// A single shared tooltip div (#chart-tooltip) is created lazily and reused.

const CHART_COLORS = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7", "--s8"];

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function ensureTooltip() {
  let tt = document.getElementById("chart-tooltip");
  if (!tt) {
    tt = document.createElement("div");
    tt.id = "chart-tooltip";
    tt.className = "chart-tooltip";
    document.body.appendChild(tt);
  }
  return tt;
}

function showTooltip(evt, html) {
  const tt = ensureTooltip();
  tt.innerHTML = html;
  tt.style.display = "block";
  const x = evt.clientX + 14;
  const y = evt.clientY + 14;
  tt.style.left = `${x}px`;
  tt.style.top = `${y}px`;
}

function hideTooltip() {
  const tt = document.getElementById("chart-tooltip");
  if (tt) tt.style.display = "none";
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  return node;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  let n;
  if (norm <= 1) n = 1;
  else if (norm <= 2) n = 2;
  else if (norm <= 5) n = 5;
  else n = 10;
  return n * mag;
}

function baseSvg(width, height) {
  return svgEl("svg", { viewBox: `0 0 ${width} ${height}`, width: "100%", preserveAspectRatio: "xMidYMid meet" });
}

function drawYAxisGrid(svg, { x0, x1, yTop, yBottom, maxVal, minVal = 0, ticks = 4, formatter = (v) => Math.round(v) }) {
  const grid = cssVar("--grid");
  const axis = cssVar("--axis");
  const muted = cssVar("--text-muted");
  for (let i = 0; i <= ticks; i++) {
    const val = minVal + ((maxVal - minVal) * i) / ticks;
    const y = yBottom - ((yBottom - yTop) * i) / ticks;
    svg.appendChild(svgEl("line", { x1: x0, x2: x1, y1: y, y2: y, stroke: grid, "stroke-width": 1 }));
    svg.appendChild(svgEl("text", { x: x0 - 8, y: y + 3, "text-anchor": "end", "font-size": 10, fill: muted }, ));
    const t = svg.lastChild;
    t.textContent = formatter(val);
  }
  svg.appendChild(svgEl("line", { x1: x0, x2: x0, y1: yTop, y2: yBottom, stroke: axis, "stroke-width": 1 }));
}

/**
 * Simple bar chart.
 * data: [{label, value, color?}]
 */
function barChart(data, opts = {}) {
  const width = opts.width || 640;
  const height = opts.height || 260;
  const pad = { top: 16, right: 16, bottom: 36, left: 44 };
  const x0 = pad.left, x1 = width - pad.right, yTop = pad.top, yBottom = height - pad.bottom;
  const maxVal = niceMax(Math.max(...data.map((d) => d.value), opts.minMax || 0));
  const svg = baseSvg(width, height);
  drawYAxisGrid(svg, { x0, x1, yTop, yBottom, maxVal, formatter: opts.yFormatter });

  const bw = (x1 - x0) / data.length;
  const barGap = Math.max(2, bw * 0.18);
  data.forEach((d, i) => {
    const bx = x0 + i * bw + barGap / 2;
    const bwidth = bw - barGap;
    const bh = maxVal > 0 ? ((yBottom - yTop) * d.value) / maxVal : 0;
    const by = yBottom - bh;
    const color = d.color ? cssVar(d.color) : cssVar("--s1");
    const rect = svgEl("rect", { x: bx, y: by, width: bwidth, height: Math.max(bh, 0), fill: color, rx: 2 });
    rect.style.cursor = "pointer";
    rect.addEventListener("mousemove", (e) => showTooltip(e,
      `<span class="swatch" style="background:${color}"></span>${d.label}: <b>${d.tooltip || d.value}</b>`));
    rect.addEventListener("mouseleave", hideTooltip);
    svg.appendChild(rect);
    if (data.length <= 40) {
      const label = svgEl("text", {
        x: bx + bwidth / 2, y: yBottom + 16, "text-anchor": "middle", "font-size": 9.5, fill: cssVar("--text-muted"),
      });
      label.textContent = d.label;
      svg.appendChild(label);
    }
  });
  return svg;
}

/**
 * Grouped bar chart with optional per-band target tick marks.
 * groups: [{label, bars: [{key, value, color}]}]
 * targetBands: {key: {min, max}} - draws tick marks for the target band per series key
 */
function groupedBarChart(groups, seriesKeys, opts = {}) {
  const width = opts.width || 640;
  const height = opts.height || 280;
  const pad = { top: 16, right: 16, bottom: 46, left: 48 };
  const x0 = pad.left, x1 = width - pad.right, yTop = pad.top, yBottom = height - pad.bottom;
  const allVals = groups.flatMap((g) => g.bars.map((b) => b.value));
  const targetVals = opts.targetBands ? Object.values(opts.targetBands).flatMap((b) => [b.min, b.max]) : [];
  const maxVal = niceMax(Math.max(...allVals, ...targetVals, 0));
  const svg = baseSvg(width, height);
  drawYAxisGrid(svg, { x0, x1, yTop, yBottom, maxVal, formatter: opts.yFormatter });

  const gw = (x1 - x0) / groups.length;
  groups.forEach((g, gi) => {
    const barW = (gw * 0.7) / g.bars.length;
    const groupStart = x0 + gi * gw + gw * 0.15;
    g.bars.forEach((b, bi) => {
      const bx = groupStart + bi * barW;
      const bh = maxVal > 0 ? ((yBottom - yTop) * b.value) / maxVal : 0;
      const by = yBottom - bh;
      const color = b.color ? cssVar(b.color) : cssVar(CHART_COLORS[bi % CHART_COLORS.length]);
      const rect = svgEl("rect", { x: bx, y: by, width: barW * 0.86, height: Math.max(bh, 0), fill: color, rx: 2 });
      rect.style.cursor = "pointer";
      rect.addEventListener("mousemove", (e) => showTooltip(e,
        `<span class="swatch" style="background:${color}"></span>${b.key}: <b>${b.tooltip || b.value}</b>`));
      rect.addEventListener("mouseleave", hideTooltip);
      svg.appendChild(rect);

      if (opts.targetBands && opts.targetBands[b.key]) {
        const tb = opts.targetBands[b.key];
        const yMin = yBottom - ((yBottom - yTop) * tb.min) / maxVal;
        const yMax = yBottom - ((yBottom - yTop) * tb.max) / maxVal;
        [yMin, yMax].forEach((ty) => {
          svg.appendChild(svgEl("line", {
            x1: bx - 2, x2: bx + barW * 0.86 + 2, y1: ty, y2: ty,
            stroke: cssVar("--text-secondary"), "stroke-width": 1.5, "stroke-dasharray": "3,2",
          }));
        });
      }
    });
    const label = svgEl("text", {
      x: x0 + gi * gw + gw / 2, y: yBottom + 16, "text-anchor": "middle", "font-size": 10.5, fill: cssVar("--text-muted"),
    });
    label.textContent = g.label;
    svg.appendChild(label);
  });
  return svg;
}

/**
 * Line chart with optional shaded reference band(s).
 * series: [{name, color, points: [{x, y, label?}]}]
 * bands: [{yMin, yMax, color?, label?}]  (drawn behind lines, in data-y units)
 * xLabels: array of tick labels evenly spaced across x domain, or a formatter fn(xVal)
 */
function lineChart(series, opts = {}) {
  const width = opts.width || 640;
  const height = opts.height || 260;
  const pad = { top: 16, right: 16, bottom: 30, left: 48 };
  const x0 = pad.left, x1 = width - pad.right, yTop = pad.top, yBottom = height - pad.bottom;

  const allPoints = series.flatMap((s) => s.points);
  const xs = allPoints.map((p) => p.x);
  const ys = allPoints.map((p) => p.y);
  const xMin = opts.xMin ?? Math.min(...xs);
  const xMax = opts.xMax ?? Math.max(...xs);
  let yMin = opts.yMin ?? Math.min(...ys, ...(opts.bands || []).map((b) => b.yMin));
  let yMax = opts.yMax ?? Math.max(...ys, ...(opts.bands || []).map((b) => b.yMax));
  if (opts.invertY) { [yMin, yMax] = [yMax, yMin]; }
  const yRange = (opts.yMax ?? Math.max(...ys, ...(opts.bands || []).map((b) => b.yMax))) -
                 (opts.yMin ?? Math.min(...ys, ...(opts.bands || []).map((b) => b.yMin))) || 1;

  const svg = baseSvg(width, height);
  const grid = cssVar("--grid");
  const axis = cssVar("--axis");
  const muted = cssVar("--text-muted");

  const sx = (x) => x0 + ((x - xMin) / (xMax - xMin || 1)) * (x1 - x0);
  const sy = (y) => {
    const trueMin = Math.min(yMin, yMax), trueMax = Math.max(yMin, yMax);
    const t = (y - trueMin) / ((trueMax - trueMin) || 1);
    return opts.invertY ? yTop + t * (yBottom - yTop) : yBottom - t * (yBottom - yTop);
  };

  // gridlines
  const ticks = opts.yTicks || 4;
  for (let i = 0; i <= ticks; i++) {
    const trueMin = Math.min(yMin, yMax), trueMax = Math.max(yMin, yMax);
    const val = trueMin + ((trueMax - trueMin) * i) / ticks;
    const y = sy(val);
    svg.appendChild(svgEl("line", { x1: x0, x2: x1, y1: y, y2: y, stroke: grid, "stroke-width": 1 }));
    const t = svgEl("text", { x: x0 - 8, y: y + 3, "text-anchor": "end", "font-size": 10, fill: muted });
    t.textContent = opts.yFormatter ? opts.yFormatter(val) : Math.round(val);
    svg.appendChild(t);
  }
  svg.appendChild(svgEl("line", { x1: x0, x2: x0, y1: yTop, y2: yBottom, stroke: axis, "stroke-width": 1 }));
  svg.appendChild(svgEl("line", { x1: x0, x2: x1, y1: yBottom, y2: yBottom, stroke: axis, "stroke-width": 1 }));

  // shaded bands (e.g. ACWR sweet spot)
  (opts.bands || []).forEach((b) => {
    const yA = sy(b.yMin), yB = sy(b.yMax);
    const rect = svgEl("rect", {
      x: x0, y: Math.min(yA, yB), width: x1 - x0, height: Math.abs(yA - yB),
      fill: b.color ? cssVar(b.color) : cssVar("--good"), opacity: 0.12,
    });
    svg.appendChild(rect);
    if (b.label) {
      const t = svgEl("text", { x: x1 - 4, y: Math.min(yA, yB) + 12, "text-anchor": "end", "font-size": 10, fill: muted });
      t.textContent = b.label;
      svg.appendChild(t);
    }
  });

  // x-axis labels
  const xTickCount = opts.xTickCount || 5;
  const xLabelFmt = opts.xFormatter || ((v) => v);
  for (let i = 0; i <= xTickCount; i++) {
    const val = xMin + ((xMax - xMin) * i) / xTickCount;
    const t = svgEl("text", { x: sx(val), y: yBottom + 18, "text-anchor": "middle", "font-size": 9.5, fill: muted });
    t.textContent = xLabelFmt(val);
    svg.appendChild(t);
  }

  series.forEach((s, si) => {
    const color = s.color ? cssVar(s.color) : cssVar(CHART_COLORS[si % CHART_COLORS.length]);
    const pts = s.points;
    if (pts.length > 1) {
      const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x)},${sy(p.y)}`).join(" ");
      svg.appendChild(svgEl("path", { d, fill: "none", stroke: color, "stroke-width": 2 }));
    }
    pts.forEach((p) => {
      const c = svgEl("circle", { cx: sx(p.x), cy: sy(p.y), r: 3, fill: color });
      c.style.cursor = "pointer";
      c.addEventListener("mousemove", (e) => showTooltip(e,
        `<span class="swatch" style="background:${color}"></span>${s.name}: <b>${p.label ?? p.y}</b>`));
      c.addEventListener("mouseleave", hideTooltip);
      svg.appendChild(c);
    });
  });

  return svg;
}

/**
 * Scatter chart.
 * points: [{x, y, color, label}]
 */
function scatterChart(points, opts = {}) {
  const width = opts.width || 640;
  const height = opts.height || 320;
  const pad = { top: 16, right: 16, bottom: 32, left: 48 };
  const x0 = pad.left, x1 = width - pad.right, yTop = pad.top, yBottom = height - pad.bottom;
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const xMin = opts.xMin ?? Math.min(...xs);
  const xMax = opts.xMax ?? Math.max(...xs);
  const yMin = opts.yMin ?? Math.min(...ys);
  const yMax = opts.yMax ?? Math.max(...ys);

  const svg = baseSvg(width, height);
  const sx = (x) => x0 + ((x - xMin) / (xMax - xMin || 1)) * (x1 - x0);
  const sy = (y) => yBottom - ((y - yMin) / (yMax - yMin || 1)) * (yBottom - yTop);

  drawYAxisGrid(svg, { x0, x1, yTop, yBottom, maxVal: yMax, minVal: yMin, formatter: opts.yFormatter });
  const xTickCount = opts.xTickCount || 5;
  const muted = cssVar("--text-muted");
  for (let i = 0; i <= xTickCount; i++) {
    const val = xMin + ((xMax - xMin) * i) / xTickCount;
    const t = svgEl("text", { x: sx(val), y: yBottom + 16, "text-anchor": "middle", "font-size": 9.5, fill: muted });
    t.textContent = opts.xFormatter ? opts.xFormatter(val) : Math.round(val);
    svg.appendChild(t);
  }

  points.forEach((p) => {
    const color = p.color ? cssVar(p.color) : cssVar("--s1");
    const c = svgEl("circle", { cx: sx(p.x), cy: sy(p.y), r: 3.5, fill: color, "fill-opacity": 0.75 });
    c.style.cursor = "pointer";
    c.addEventListener("mousemove", (e) => showTooltip(e, p.label || `${p.x}, ${p.y}`));
    c.addEventListener("mouseleave", hideTooltip);
    svg.appendChild(c);
  });

  return svg;
}
