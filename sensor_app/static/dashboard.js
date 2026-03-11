"use strict";
let isDarkMode = false;
let stopped = false;
// Offset (ms) to align the header clock with server time: serverMs = Date.now() + serverTimeOffset
let serverTimeOffset = 0;
// Global parameter for number formatting
const DECIMAL_POINTS = 2;

// Plot chrome colours — read from CSS custom properties so both themes
// are defined in dashboard.css.  Refreshed on dark-mode toggle.
let plotTheme = {};
function readPlotTheme() {
  const cs = getComputedStyle(document.documentElement);
  plotTheme = {
    axis:  cs.getPropertyValue('--plot-axis').trim(),
    grid:  cs.getPropertyValue('--plot-grid').trim(),
    sep:   cs.getPropertyValue('--plot-separator').trim(),
    tick:  cs.getPropertyValue('--plot-tick').trim(),
    label: cs.getPropertyValue('--plot-label').trim(),
    trail: cs.getPropertyValue('--plot-trail').trim(),
  };
}
readPlotTheme();

// Header clock
let clockInterval = null;
(function() {
  const el = document.getElementById("header_clock");
  if (!el) return;
  function tick() {
    if (stopped) { clearInterval(clockInterval); return; }
    const d = new Date(Date.now() + serverTimeOffset);
    const pad = (n, w) => String(n).padStart(w || 2, '0');
    el.textContent = d.getFullYear() + '/' + pad(d.getMonth()+1) + '/' + pad(d.getDate())
      + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
      + '.' + pad(d.getMilliseconds(), 3);
  }
  tick();
  clockInterval = setInterval(tick, 50);
})();

// sensorUnits is injected by the Jinja template before this script loads

function displayName(key) {
  const unit = sensorUnits[key];
  return unit ? key + " [" + unit + "]" : key;
}
// Global variable to hold the latest sensor data (from the /data endpoint)
let sensorData = {};

// Plot data arrays (dynamically built)
let plotData = [[]]; // Start with just timestamps, series added dynamically
let MAX_PLOT_POINTS = 10000; // Overridden by config if available

// Track which series are enabled (built dynamically)
let enabledSeries = {};

// Track discovered numeric sensors
let numericSensors = [];
let plotInitialized = false;

// Color palette for plot series
const seriesColors = ['red', 'blue', 'green', 'orange', 'purple', 'brown', 'pink', 'gray', 'cyan', 'magenta'];

// Initialize plot (discovers sensors, sets plotInitialized)
function initializePlot() {
  if (numericSensors.length === 0) return;
  plotInitialized = true;
}

// ===== Nice tick generation (1-2-5 sequence) =====
function niceTicks(lo, hi, maxTicks) {
  const range = hi - lo;
  if (range <= 0) return [lo];
  const rawStep = range / maxTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let step;
  if (norm <= 1) step = 1 * mag;
  else if (norm <= 2) step = 2 * mag;
  else if (norm <= 5) step = 5 * mag;
  else step = 10 * mag;
  const first = Math.ceil(lo / step) * step;
  const ticks = [];
  for (let v = first; v <= hi + step * 0.001; v += step) {
    ticks.push(v);
  }
  return ticks;
}

function niceTickFormat(val, step) {
  const decimals = step >= 1 ? 0 : Math.max(1, -Math.floor(Math.log10(step)));
  return val.toFixed(Math.max(decimals, 1));
}

// ===== Animated Scatter Plot (Canvas 2D, requestAnimationFrame) =====
const animScatter = (function() {
  const canvas = document.getElementById("animated_scatter_canvas");
  if (!canvas) return null;
  const ctx = canvas.getContext("2d", { alpha: true });
  const dpr = window.devicePixelRatio || 1;
  ctx.imageSmoothingEnabled = true;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // State
  let prevPoint = null;   // {x, y} - where we're interpolating FROM
  let targetPoint = null; // {x, y} - where we're interpolating TO
  let currentPoint = null; // {x, y} - the smoothly interpolated display position
  let lerpT = 1;          // 0..1 interpolation fraction (1 = arrived at target)

  const TRAIL_MAX = 700;
  let trail = [];          // array of {x, y} historical points

  // Auto-scaling with smooth transition
  let currentBounds = { minX: 20, maxX: 30, minY: 40, maxY: 80 };
  let targetBounds = { minX: 20, maxX: 30, minY: 40, maxY: 80 };

  // Layout constants
  const PAD_LEFT = 50;
  const PAD_BOTTOM = 40;
  const PAD_TOP = 15;
  const PAD_RIGHT = 15;

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
  }

  function getMode() {
    const el = document.querySelector('input[name="anim_scatter_option"]:checked');
    return el ? el.value : "1min";
  }

  function pushTarget(x, y) {
    if (targetPoint !== null && currentPoint) {
      trail.push({ x: currentPoint.x, y: currentPoint.y });
      if (trail.length > TRAIL_MAX) trail.shift();
      prevPoint = { x: currentPoint.x, y: currentPoint.y };
    } else {
      prevPoint = { x, y };
    }
    targetPoint = { x, y };
    lerpT = 0;
  }

  function mapX(x, w) {
    const t = (x - currentBounds.minX) / (currentBounds.maxX - currentBounds.minX);
    return PAD_LEFT + t * (w - PAD_LEFT - PAD_RIGHT);
  }

  function mapY(y, h) {
    const t = (y - currentBounds.minY) / (currentBounds.maxY - currentBounds.minY);
    return h - PAD_BOTTOM - t * (h - PAD_TOP - PAD_BOTTOM);
  }

  function drawAxes(w, h) {
    ctx.save();
    ctx.strokeStyle = plotTheme.axis;
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(PAD_LEFT * dpr, PAD_TOP * dpr);
    ctx.lineTo(PAD_LEFT * dpr, (h - PAD_BOTTOM) * dpr);
    ctx.lineTo((w - PAD_RIGHT) * dpr, (h - PAD_BOTTOM) * dpr);
    ctx.stroke();

    ctx.fillStyle = plotTheme.tick;
    ctx.font = (10 * dpr) + "px 'DIN', sans-serif";

    // X ticks (nice increments)
    const xTicks = niceTicks(currentBounds.minX, currentBounds.maxX, 5);
    const xStep = xTicks.length > 1 ? xTicks[1] - xTicks[0] : 1;
    ctx.textAlign = "center";
    for (const val of xTicks) {
      const px = mapX(val, w) * dpr;
      ctx.fillText(niceTickFormat(val, xStep), px, (h - PAD_BOTTOM + 15) * dpr);
    }

    // Y ticks (nice increments)
    const yTicks = niceTicks(currentBounds.minY, currentBounds.maxY, 5);
    const yStep = yTicks.length > 1 ? yTicks[1] - yTicks[0] : 1;
    ctx.textAlign = "right";
    for (const val of yTicks) {
      const py = mapY(val, h) * dpr;
      ctx.fillText(niceTickFormat(val, yStep), (PAD_LEFT - 5) * dpr, py + 3 * dpr);
    }

    // Axis labels
    ctx.fillStyle = plotTheme.label;
    ctx.font = (11 * dpr) + "px 'DIN', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(SCATTER_CONFIG.x, (PAD_LEFT + (w - PAD_LEFT - PAD_RIGHT) / 2) * dpr, (h - 5) * dpr);

    ctx.save();
    ctx.translate(12 * dpr, (PAD_TOP + (h - PAD_TOP - PAD_BOTTOM) / 2) * dpr);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(SCATTER_CONFIG.y, 0, 0);
    ctx.restore();

    ctx.restore();
  }

  // Build visible points from plotData for the chosen mode
  function getVisiblePoints() {
    const cpuIdx = sensorToSeriesMap[SCATTER_CONFIG.y];
    const ambientIdx = sensorToSeriesMap[SCATTER_CONFIG.x];
    if (!cpuIdx || !ambientIdx || !plotInitialized) return null;
    const dataLen = plotData[0].length;
    if (dataLen === 0) return null;

    const mode = getMode();
    const lastTime = plotData[0][dataLen - 1];
    const window = mode === "1min" ? 60 : 1800; // 1 min or 30 min
    const cutoff = lastTime - window;
    let startIdx = 0;
    for (let i = dataLen - 1; i >= 0; i--) {
      if (plotData[0][i] < cutoff) { startIdx = i + 1; break; }
    }

    const pts = [];
    // Subsample in "30min" mode if too many points
    let step = 1;
    const count = dataLen - startIdx;
    if (mode === "30min" && count > 600) {
      step = Math.ceil(count / 600);
    }
    for (let i = startIdx; i < dataLen; i += step) {
      const idx = (step > 1 && i + step >= dataLen) ? dataLen - 1 : i;
      const ax = plotData[ambientIdx][idx];
      const ay = plotData[cpuIdx][idx];
      if (ax != null && ay != null && !isNaN(ax) && !isNaN(ay)) {
        pts.push({ x: ax, y: ay });
      }
      if (idx === dataLen - 1) break;
    }
    return pts;
  }

  function draw() {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      resizeCanvas();
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Advance interpolation (ease toward 1)
    if (lerpT < 1) {
      lerpT = Math.min(1, lerpT + 0.08);
    }

    if (targetPoint && prevPoint) {
      const t = lerpT * lerpT * (3 - 2 * lerpT);
      currentPoint = {
        x: lerp(prevPoint.x, targetPoint.x, t),
        y: lerp(prevPoint.y, targetPoint.y, t)
      };
    }

    // Build visible points from plotData based on mode
    const visiblePts = getVisiblePoints();

    // Compute target bounds from visible data
    if (visiblePts && visiblePts.length > 0) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of visiblePts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      if (currentPoint) {
        if (currentPoint.x < minX) minX = currentPoint.x;
        if (currentPoint.x > maxX) maxX = currentPoint.x;
        if (currentPoint.y < minY) minY = currentPoint.y;
        if (currentPoint.y > maxY) maxY = currentPoint.y;
      }
      const padX = Math.max((maxX - minX) * 0.1, 0.5);
      const padY = Math.max((maxY - minY) * 0.1, 0.5);
      targetBounds = { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY };
    }

    // Smoothly transition bounds
    currentBounds.minX = lerp(currentBounds.minX, targetBounds.minX, 0.05);
    currentBounds.maxX = lerp(currentBounds.maxX, targetBounds.maxX, 0.05);
    currentBounds.minY = lerp(currentBounds.minY, targetBounds.minY, 0.05);
    currentBounds.maxY = lerp(currentBounds.maxY, targetBounds.maxY, 0.05);

    drawAxes(w, h);

    if (!currentPoint && trail.length === 0) {
      requestAnimationFrame(draw);
      return;
    }

    // Use trail (actual animated positions) for drawing, not raw plotData
    const fullTrail = currentPoint ? trail.concat([currentPoint]) : trail;
    const totalPts = fullTrail.length;

    // Fade floor: "1min" fades to 0%, "30min" fades to 20%
    const fadeFloor = getMode() === "30min" ? 0.2 : 0;

    // Draw trail lines with fading
    if (totalPts > 1) {
      for (let i = 0; i < totalPts - 1; i++) {
        const ratio = totalPts > 2 ? i / (totalPts - 2) : 1;
        const alpha = fadeFloor + ratio * (0.7 - fadeFloor);
        ctx.beginPath();
        ctx.strokeStyle = `rgba(${plotTheme.trail}, ${alpha})`;
        ctx.lineWidth = 1.5 * dpr;
        ctx.moveTo(mapX(fullTrail[i].x, w) * dpr, mapY(fullTrail[i].y, h) * dpr);
        ctx.lineTo(mapX(fullTrail[i + 1].x, w) * dpr, mapY(fullTrail[i + 1].y, h) * dpr);
        ctx.stroke();
      }
    }

    // Draw trail dots with fading (exclude last — that's the red dot)
    for (let i = 0; i < totalPts - 1; i++) {
      const ratio = totalPts > 2 ? i / (totalPts - 2) : 1;
      const alpha = fadeFloor + ratio * (0.65 - fadeFloor);
      const px = mapX(fullTrail[i].x, w) * dpr;
      const py = mapY(fullTrail[i].y, h) * dpr;
      ctx.beginPath();
      ctx.arc(px, py, 2.5 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${plotTheme.trail}, ${alpha})`;
      ctx.fill();
    }

    // Draw current point (red dot on top)
    if (currentPoint) {
      const cx = mapX(currentPoint.x, w) * dpr;
      const cy = mapY(currentPoint.y, h) * dpr;
      ctx.beginPath();
      ctx.arc(cx, cy, 4 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 0, 0, 0.8)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 0, 0, 1)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();
    }

    requestAnimationFrame(draw);
  }

  // Start the animation loop
  resizeCanvas();
  requestAnimationFrame(draw);

  return { pushTarget };
})();

function updateAnimatedScatter() {
  if (!animScatter) return;
  const cpuIdx = sensorToSeriesMap[SCATTER_CONFIG.y];
  const ambientIdx = sensorToSeriesMap[SCATTER_CONFIG.x];
  if (!cpuIdx || !ambientIdx) return;
  const len = plotData[0].length;
  if (len === 0) return;
  const ambient = plotData[ambientIdx][len - 1];
  const cpu = plotData[cpuIdx][len - 1];
  if (ambient != null && cpu != null && !isNaN(ambient) && !isNaN(cpu)) {
    animScatter.pushTarget(ambient, cpu);
  }
}

// ===== Animated Time Series (Canvas 2D, requestAnimationFrame) =====
const animTS = (function() {
  const canvas = document.getElementById("animated_ts_canvas");
  if (!canvas) return null;
  const ctx = canvas.getContext("2d", { alpha: true });
  const dpr = window.devicePixelRatio || 1;
  ctx.imageSmoothingEnabled = true;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const PAD_LEFT = 50;
  const PAD_BOTTOM = 30;
  const PAD_TOP = 10;
  const PAD_RIGHT = 100;

  // Per-series state for smooth interpolation
  let seriesTargets = {};  // key -> target value
  let seriesCurrent = {};  // key -> current animated value
  let targetTime = 0;      // latest sample timestamp (target)
  let currentTime = 0;     // smoothly interpolated timestamp

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
  }

  function pushValues(values, time) {
    for (const key in values) {
      if (seriesCurrent[key] === undefined) {
        seriesCurrent[key] = values[key];
      }
      seriesTargets[key] = values[key];
    }
    if (time !== undefined) {
      if (currentTime === 0) currentTime = time;
      targetTime = time;
    }
  }

  function getMode() {
    const el = document.querySelector('input[name="anim_ts_option"]:checked');
    return el ? el.value : "1min";
  }

  const SUBPLOT_HEIGHT = 180;
  const GAP = 8;
  let panelResizePending = false;

  function draw() {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      resizeCanvas();
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Advance interpolation for each series and time
    for (const key in seriesTargets) {
      if (seriesCurrent[key] !== undefined) {
        seriesCurrent[key] = lerp(seriesCurrent[key], seriesTargets[key], 0.3);
      }
    }
    if (targetTime > 0) {
      currentTime = lerp(currentTime, targetTime, 0.3);
    }

    if (!plotInitialized || plotData[0].length < 2) {
      requestAnimationFrame(draw);
      return;
    }

    // Group enabled series by unit
    const activeGroups = {};
    for (let si = 0; si < numericSensors.length; si++) {
      const key = numericSensors[si];
      if (enabledSeries[key] === false) continue;
      const unit = sensorUnits[key] || "?";
      if (!activeGroups[unit]) activeGroups[unit] = [];
      activeGroups[unit].push({ key, si });
    }

    const groupKeys = Object.keys(activeGroups);
    const numGroups = groupKeys.length;

    if (numGroups === 0) {
      requestAnimationFrame(draw);
      return;
    }

    // Dynamically adjust canvas height
    const desiredHeight = Math.max(200, numGroups * SUBPLOT_HEIGHT);
    if (Math.abs(h - desiredHeight) > 5) {
      canvas.style.height = desiredHeight + "px";
      resizeCanvas();
      panelResizePending = false; // maxHeight:'none' handles resize naturally
    }

    // Compute visible time range
    const mode = getMode();
    const dataLen = plotData[0].length;
    const lastDataTime = plotData[0][dataLen - 1];

    let tMax, tMin;
    let startIdx = 0;
    if (mode === "1min") {
      // Smooth-scrolling: use interpolated time so the window slides fluidly
      tMax = currentTime;
      tMin = currentTime - 60;
      for (let i = dataLen - 1; i >= 0; i--) {
        if (plotData[0][i] < tMin) { startIdx = i + 1; break; }
      }
    } else {
      // "30min" mode: show last 30 minutes, no interpolation
      tMax = lastDataTime;
      tMin = lastDataTime - 1800;
      for (let i = dataLen - 1; i >= 0; i--) {
        if (plotData[0][i] < tMin) { startIdx = i + 1; break; }
      }
    }

    const visibleLen = dataLen - startIdx;
    if (visibleLen < 2) {
      requestAnimationFrame(draw);
      return;
    }

    const tRange = tMax - tMin || 1;
    const plotW = w - PAD_LEFT - PAD_RIGHT;
    const mapX = (t) => (PAD_LEFT + (t - tMin) / tRange * plotW) * dpr;

    let step = 1;
    if (mode === "30min" && visibleLen > 600) {
      step = Math.ceil(visibleLen / 600);
    }

    // Compute sub-plot regions
    const totalGap = (numGroups - 1) * GAP;
    const availH = h - PAD_TOP - PAD_BOTTOM - totalGap;
    const subH = availH / numGroups;

    // Draw each unit group
    for (let gi = 0; gi < numGroups; gi++) {
      const unit = groupKeys[gi];
      const seriesInGroup = activeGroups[unit];
      const isBottom = (gi === numGroups - 1);

      const spTop = PAD_TOP + gi * (subH + GAP);
      const spBottom = spTop + subH;

      // Local Y range for this group (use step to match line drawing granularity)
      let yMin = Infinity, yMax = -Infinity;
      for (const { key, si } of seriesInGroup) {
        const seriesArr = plotData[si + 1];
        for (let i = startIdx; i < dataLen; i += step) {
          const v = seriesArr[i];
          if (v != null && !isNaN(v)) {
            if (v < yMin) yMin = v;
            if (v > yMax) yMax = v;
          }
        }
        // Always include the last point (may be skipped by step)
        const vLast = seriesArr[dataLen - 1];
        if (vLast != null && !isNaN(vLast)) {
          if (vLast < yMin) yMin = vLast;
          if (vLast > yMax) yMax = vLast;
        }
        const cur = seriesCurrent[key];
        if (cur != null) {
          if (cur < yMin) yMin = cur;
          if (cur > yMax) yMax = cur;
        }
      }

      if (!isFinite(yMin) || !isFinite(yMax)) continue;
      const yPad = Math.max((yMax - yMin) * 0.08, 0.1);
      yMin -= yPad;
      yMax += yPad;

      const localMapY = (v) => (spTop + (1 - (v - yMin) / (yMax - yMin)) * subH) * dpr;

      // Separator line between sub-plots
      if (gi > 0) {
        ctx.strokeStyle = plotTheme.sep;
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        ctx.moveTo(PAD_LEFT * dpr, (spTop - GAP / 2) * dpr);
        ctx.lineTo((w - PAD_RIGHT) * dpr, (spTop - GAP / 2) * dpr);
        ctx.stroke();
      }

      // Y axis line (+ bottom line only on bottom sub-plot)
      ctx.strokeStyle = plotTheme.axis;
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT * dpr, spTop * dpr);
      ctx.lineTo(PAD_LEFT * dpr, spBottom * dpr);
      if (isBottom) {
        ctx.lineTo((w - PAD_RIGHT) * dpr, spBottom * dpr);
      }
      ctx.stroke();

      // Y ticks and grid
      ctx.fillStyle = plotTheme.tick;
      ctx.font = (10 * dpr) + "px 'DIN', sans-serif";
      ctx.textAlign = "right";
      const yTicks = niceTicks(yMin, yMax, 4);
      const yTickStep = yTicks.length > 1 ? yTicks[1] - yTicks[0] : 1;
      for (const val of yTicks) {
        const py = localMapY(val);
        ctx.fillText(niceTickFormat(val, yTickStep), (PAD_LEFT - 5) * dpr, py + 3 * dpr);
        ctx.strokeStyle = plotTheme.grid;
        ctx.beginPath();
        ctx.moveTo(PAD_LEFT * dpr, py);
        ctx.lineTo((w - PAD_RIGHT) * dpr, py);
        ctx.stroke();
      }

      // Unit label (rotated on Y axis)
      ctx.save();
      ctx.fillStyle = plotTheme.label;
      ctx.font = (11 * dpr) + "px 'DIN', sans-serif";
      ctx.textAlign = "center";
      ctx.translate(12 * dpr, ((spTop + spBottom) / 2) * dpr);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText("[" + unit + "]", 0, 0);
      ctx.restore();

      // X axis time labels (bottom sub-plot only)
      if (isBottom) {
        ctx.textAlign = "center";
        ctx.fillStyle = plotTheme.tick;
        ctx.font = (10 * dpr) + "px 'DIN', sans-serif";
        const nTicksX = 5;
        for (let i = 0; i <= nTicksX; i++) {
          const t = lerp(tMin, tMax, i / nTicksX);
          const d = new Date(t * 1000);
          const label = d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'});
          ctx.fillText(label, mapX(t), (spBottom + 15) * dpr);
        }
      }

      // Catmull-Rom control points for segment from pts[i] to pts[i+1]
      function crCP(pts, i) {
        const p0 = pts[Math.max(0, i - 1)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(pts.length - 1, i + 2)];
        return {
          cp1x: p1.px + (p2.px - p0.px) / 6,
          cp1y: p1.py + (p2.py - p0.py) / 6,
          cp2x: p2.px - (p3.px - p1.px) / 6,
          cp2y: p2.py - (p3.py - p1.py) / 6
        };
      }

      // Draw series in this group
      const fadeFrac = 0.15; // sigmoidal fade: 0 at 0%, full at 15%
      const fadeCutoffT = tMin + tRange * fadeFrac;

      for (let li = 0; li < seriesInGroup.length; li++) {
        const { key, si } = seriesInGroup[li];
        const color = seriesColors[li % seriesColors.length];
        const seriesArr = plotData[si + 1];
        const curVal = seriesCurrent[key];

        // Collect visible points
        const pts = [];
        for (let i = startIdx; i < dataLen; i += step) {
          const idx = (step > 1 && i + step >= dataLen) ? dataLen - 1 : i;
          const v = seriesArr[idx];
          if (v != null && !isNaN(v)) {
            pts.push({ px: mapX(plotData[0][idx]), py: localMapY(v), t: plotData[0][idx] });
          }
          if (idx === dataLen - 1) break;
        }
        // Interpolated tip (both time and value are smoothly interpolated)
        if (pts.length > 0 && curVal != null && !isNaN(curVal)) {
          const tipT = (mode === "1min" ? currentTime : lastDataTime) + 0.3;
          pts.push({ px: mapX(tipT), py: localMapY(curVal), t: tipT });
        }
        if (pts.length < 2) continue;

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5 * dpr;

        // Find index where fade zone ends
        let fadeEndIdx = 0;
        while (fadeEndIdx < pts.length && pts[fadeEndIdx].t < fadeCutoffT) fadeEndIdx++;

        // Draw fade zone segment-by-segment with sigmoidal alpha (Catmull-Rom curves)
        if (fadeEndIdx > 0) {
          const fadeEnd = Math.min(fadeEndIdx + 1, pts.length);
          for (let j = 1; j < fadeEnd; j++) {
            const segT = (pts[j - 1].t + pts[j].t) / 2;
            const f = Math.max(0, Math.min(1, (segT - tMin) / (fadeCutoffT - tMin)));
            const alpha = f * f * (3 - 2 * f); // smoothstep sigmoid
            ctx.globalAlpha = alpha;
            const cp = crCP(pts, j - 1);
            ctx.beginPath();
            ctx.moveTo(pts[j - 1].px, pts[j - 1].py);
            ctx.bezierCurveTo(cp.cp1x, cp.cp1y, cp.cp2x, cp.cp2y, pts[j].px, pts[j].py);
            ctx.stroke();
          }
        }

        // Draw remaining (non-faded) portion as single smooth path
        ctx.globalAlpha = 1.0;
        if (fadeEndIdx < pts.length) {
          const solidStart = Math.max(0, fadeEndIdx - 1); // overlap by 1 for continuity
          ctx.beginPath();
          ctx.moveTo(pts[solidStart].px, pts[solidStart].py);
          for (let j = solidStart; j < pts.length - 1; j++) {
            const cp = crCP(pts, j);
            ctx.bezierCurveTo(cp.cp1x, cp.cp1y, cp.cp2x, cp.cp2y, pts[j + 1].px, pts[j + 1].py);
          }
          ctx.stroke();
        }

        // Dot and floating label
        if (curVal != null && !isNaN(curVal)) {
          const tipT = (mode === "1min" ? currentTime : lastDataTime) + 0.3;
          const dotX = mapX(tipT);
          const dotY = localMapY(curVal);
          ctx.beginPath();
          ctx.arc(dotX, dotY, 3 * dpr, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.font = (10 * dpr) + "px 'DIN', sans-serif";
          ctx.textAlign = "left";
          ctx.fillStyle = color;
          ctx.fillText(displayName(key) + " " + curVal.toFixed(3), dotX + 6 * dpr, dotY + 4 * dpr);
        }
      }
    }

    requestAnimationFrame(draw);
  }

  resizeCanvas();
  requestAnimationFrame(draw);

  return { pushValues };
})();

function updateAnimatedTS() {
  if (!animTS || !plotInitialized) return;
  const len = plotData[0].length;
  if (len === 0) return;
  const values = {};
  numericSensors.forEach((key, idx) => {
    const v = plotData[idx + 1][len - 1];
    if (v != null && !isNaN(v)) values[key] = v;
  });
  animTS.pushValues(values, plotData[0][len - 1]);
}

function seriesColor(key, si) {
  // Group by unit and return the index within that group
  const unit = sensorUnits[key] || "?";
  let idx = 0;
  for (let i = 0; i < numericSensors.length; i++) {
    if (numericSensors[i] === key) break;
    if ((sensorUnits[numericSensors[i]] || "?") === unit) idx++;
  }
  return seriesColors[idx % seriesColors.length];
}

function updateLegend() {
  if (!plotInitialized) return;
  const legendBody = document.getElementById("legend_table_body");
  const len = plotData[0].length;
  let html = "";
  numericSensors.forEach((key, idx) => {
    const value = len > 0 ? plotData[idx + 1][len - 1] : null;
    const displayValue = (value != null && !isNaN(value)) ? value.toFixed(DECIMAL_POINTS) : "-";
    const color = seriesColor(key, idx);
    const unit = sensorUnits[key] || "";
    html += `<tr><td style="color:${color}">${key}</td><td>${unit}</td><td>${displayValue}</td></tr>`;
  });
  legendBody.innerHTML = html;
}

// Format numeric values using DECIMAL_POINTS
function formatValue(value) {
  if (typeof value === "number") {
    return value.toFixed(DECIMAL_POINTS);
  }
  return value;
}

// Cache for table rows to avoid unnecessary DOM manipulation
const tableRowCache = {
  sensors: new Map(),
  controls: new Map()
};

// Map sensor keys to plot series indices (built dynamically)
let sensorToSeriesMap = {};

// Optimized table update - only updates changed cells with checkboxes for all instruments
function updateTableRow(tbody, cache, key, value) {
  let row = cache.get(key);
  const isNumeric = typeof parseFloat(value) === 'number' && !isNaN(parseFloat(value));
  const isPlottable = isNumeric; // All numeric values are plottable

  if (!row) {
    // Create new row
    row = tbody.insertRow();
    row.dataset.key = key;
    const keyCell = row.insertCell();
    const unitCell = row.insertCell();
    const valueCell = row.insertCell();
    const checkboxCell = row.insertCell();

    keyCell.textContent = key;
    unitCell.textContent = sensorUnits[key] || "";
    valueCell.textContent = value;

    // Add checkbox for ALL instruments (enable only if plottable)
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isPlottable && enabledSeries[key];
    checkbox.disabled = !isPlottable || !isNumeric;

    if (isPlottable && isNumeric) {
      checkbox.addEventListener('change', function() {
        enabledSeries[key] = this.checked;
      });
    }
    checkboxCell.appendChild(checkbox);

    cache.set(key, { row, valueCell, checkboxCell, checkbox });
  } else {
    // Update only if value changed
    const formattedValue = String(value);
    if (row.valueCell.textContent !== formattedValue) {
      row.valueCell.textContent = formattedValue;
    }
  }
}

// Update the sensor readings table - optimized version
function updateDataTables(data) {
  const tbody = document.getElementById("sensor_table_body");
  const tbody2 = document.getElementById("command_actual");

  // Update sensors
  for (const key in data.sensors) {
    let value = data.sensors[key];
    if (typeof value === "number") {
      value = formatValue(value);
    } else if (typeof value === "object" && value !== null) {
      value = JSON.stringify(value, (k, v) =>
        typeof v === "number" ? parseFloat(v.toFixed(DECIMAL_POINTS)) : v
      );
    }
    updateTableRow(tbody, tableRowCache.sensors, key, value);
  }

  // Update controls
  for (const key in data.controls) {
    let value = data.controls[key];
    if (typeof value === "number") {
      value = formatValue(value);
    } else if (typeof value === "object" && value !== null) {
      value = JSON.stringify(value, (k, v) =>
        typeof v === "number" ? parseFloat(v.toFixed(DECIMAL_POINTS)) : v
      );
    }
    updateTableRow(tbody2, tableRowCache.controls, key, value);
  }
}



// This function is called whenever any control is updated.
function updateControl(key, value) {
  const commandData = {};
  commandData[key] = value;
  fetch('/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(commandData)
  })
  .then(response => response.json())
  .then(data => {
    // Update the indicator dot next to the control.
    const indicator = document.getElementById("controls_" + key + "_indicator");
    if (indicator) {
      indicator.innerHTML = (data.controls[key] == value)
        ? '<span class="indicator-dot match"></span>'
        : '<span class="indicator-dot mismatch"></span>';
    }
  })
  .catch(err => console.error("Error updating control:", err));
}


// Control config defaults — overridden by settings from /config endpoint
let controlConfig = {
  sliders: [],
  segments: [],
  textInputs: [
    { key: "file_name", label: "Log Filename", defaultValue: "junk.csv" },
    { key: "sample_frequency_hz", label: "Sample Freq (Hz)", defaultValue: 10 },
    { key: "log_subsample", label: "Log Subsample (N)", defaultValue: 10 }
  ],
  checkboxes: [
    { key: "append", label: "Append to file", defaultValue: false }
  ]
};

let controls = {};

// Fetch config and apply settings before starting the dashboard
fetch('/config')
  .then(r => r.json())
  .then(cfg => {
    const s = cfg.settings || {};
    // Apply dashboard settings from config
    if (s["Max Plot Points"]) MAX_PLOT_POINTS = Number(s["Max Plot Points"]) || 10000;
    if (s["Poll Interval (ms)"]) POLL_INTERVAL = Number(s["Poll Interval (ms)"]) || 100;
    // Apply control defaults from config
    const csvFile = s["CSV Log File"];
    const sampleFreq = s["Sample Frequency (Hz)"];
    const logSub = s["Log Subsample"];
    if (csvFile) controlConfig.textInputs[0].defaultValue = String(csvFile);
    if (sampleFreq) controlConfig.textInputs[1].defaultValue = sampleFreq;
    if (logSub) controlConfig.textInputs[2].defaultValue = logSub;
  })
  .catch(err => console.warn("Could not fetch /config, using defaults:", err))
  .finally(() => {
    controls = makeControlPanel("controls", controlConfig);
    fetchSensorData();
  });

// Cache for last sent command values to avoid unnecessary updates
let lastCommandValues = {};
let commandCheckCounter = 0;

// Optimized command sending - only send when values actually change
function sendCommandIfChanged(controls) {
  commandCheckCounter++;
  // Only check every 10 fetches (1 second at 100ms interval) to reduce overhead
  if (commandCheckCounter < 10) return;
  commandCheckCounter = 0;

  let changed = false;
  const commandData = {};

  for (let key in controls) {
    let control = controls[key];
    if (!control) continue;

    let value;
    if (typeof control.getValue === "function") {
      value = control.getValue();
    } else if (control instanceof HTMLInputElement) {
      value = control.type === "checkbox" ? control.checked : control.value;
    } else if (control instanceof HTMLSelectElement) {
      value = control.value;
    }

    // Only include changed values
    if (lastCommandValues[key] !== value) {
      commandData[key] = value;
      lastCommandValues[key] = value;
      changed = true;
    }
  }

  // Only send if something changed
  if (changed) {
    fetch('/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(commandData)
    })
    .then(response => response.json())
    .then(data => console.log("Command update:", data))
    .catch(err => console.error("Error sending update:", err));
  }
}

// Track first data fetch to initialize panel heights after content loads
let firstFetchComplete = false;

// Fetch sensor data and update everything
// Track last server timestamp for fetching new plot data
let lastDataTimestamp = 0;

let POLL_INTERVAL = 100; // Overridden by config if available

function fetchSensorData() {
  if (stopped) return;
  fetch('/data_since/' + lastDataTimestamp)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(data => {
      const samples = data.samples;
      sensorData = data;

      // Send commands only when they change (throttled)
      sendCommandIfChanged(controls);

      // Discover numeric sensors and initialize plot FIRST if needed
      if (!plotInitialized) {
        numericSensors = [];
        sensorToSeriesMap = {};
        Object.keys(data.sensors).forEach(key => {
          const value = data.sensors[key];
          const isNumeric = typeof parseFloat(value) === 'number' && !isNaN(parseFloat(value));
          if (isNumeric) {
            numericSensors.push(key);
            sensorToSeriesMap[key] = numericSensors.length;
            enabledSeries[key] = true;
            plotData.push([]);
          }
        });
        initializePlot();
      }

      // Update tables with optimized DOM manipulation (after plot is initialized)
      updateDataTables(data);

      // Update control indicators
      updateControlIndicatorsDynamic(controls, data.controls, "controls");

      // Add ALL new samples to plot (catches up after background throttling)
      if (samples.length > 0) {
        samples.forEach(sample => {
          plotData[0].push(sample.timestamp);
          numericSensors.forEach((key, index) => {
            const value = parseFloat(sample.sensors[key]);
            plotData[index + 1].push(value);
          });
        });
        lastDataTimestamp = samples[samples.length - 1].timestamp;
        // Sync header clock to server time (server timestamp is seconds)
        serverTimeOffset = lastDataTimestamp * 1000 - Date.now();
      }

      // Implement data retention limit
      if (plotData[0].length > MAX_PLOT_POINTS) {
        const removeCount = plotData[0].length - MAX_PLOT_POINTS + 1000;
        plotData.forEach(series => series.splice(0, removeCount));
      }

      updateLegend();
      updateAnimatedScatter();
      updateAnimatedTS();

      // Update experiment panels (from experiment.js)
      if (typeof updatePIDStatus === 'function' && data.pid_status) {
        updatePIDStatus(data.pid_status);
      }
      if (typeof updateInterlockStatus === 'function' && data.tripped_interlocks) {
        updateInterlockStatus(data.tripped_interlocks, data.sensors);
      }
      if (typeof updateOutputSliders === 'function' && data.sensors) {
        updateOutputSliders(data.sensors);
      }
      if (typeof updateStepSeriesStatus === 'function' && data.step_series) {
        updateStepSeriesStatus(data.step_series);
      }

      if (!firstFetchComplete) {
        firstFetchComplete = true;
      }
    })
    .catch(err => {
      console.error('Error fetching sensor data:', err);
    })
    .finally(() => {
      // Schedule next poll only after this one completes (sequential, no pile-up)
      setTimeout(fetchSensorData, POLL_INTERVAL);
    });
}

// fetchSensorData() is called from the /config fetch .finally() block above

// Font size step functionality
const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 22;
const FONT_SIZE_STEP = 1;
let currentFontSize = 14; // Default

function applyFontSize(size) {
  currentFontSize = Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, size));
  document.body.style.fontSize = currentFontSize + 'px';
}

document.getElementById('font_decrease').addEventListener('click', function() {
  applyFontSize(currentFontSize - FONT_SIZE_STEP);
});

document.getElementById('font_increase').addEventListener('click', function() {
  applyFontSize(currentFontSize + FONT_SIZE_STEP);
});

// Set initial font size
applyFontSize(14);

// Dark mode toggle
document.getElementById('dark_mode_toggle').addEventListener('click', function() {
  isDarkMode = !isDarkMode;
  document.body.classList.toggle('dark-mode', isDarkMode);
  readPlotTheme();
  this.innerHTML = isDarkMode ? '&#9788;' : '&#9789;';
});

// Collapse a panel: snapshot height then animate to 0
function collapsePanel(panel) {
  if (panel.classList.contains('collapsed')) return;
  panel.style.maxHeight = panel.scrollHeight + 'px';
  // Force reflow so the browser registers the explicit value before transitioning
  panel.offsetHeight; // eslint-disable-line no-unused-expressions
  panel.classList.add('collapsed');
}

// Expand a panel: animate from 0 to scrollHeight, then release to 'none'
function expandPanel(panel) {
  if (!panel.classList.contains('collapsed')) return;
  panel.classList.remove('collapsed');
  panel.style.maxHeight = panel.scrollHeight + 'px';
  function onEnd(e) {
    if (e.propertyName === 'max-height' && !panel.classList.contains('collapsed')) {
      panel.style.maxHeight = 'none';
    }
    panel.removeEventListener('transitionend', onEnd);
  }
  panel.addEventListener('transitionend', onEnd);
}

// Hide All / Show All panels functionality
document.getElementById('hide_all_panels').addEventListener('click', function() {
  document.querySelectorAll('.panel-body-collapsible').forEach(collapsePanel);
  document.querySelectorAll('.toggle-icon').forEach(icon => {
    icon.textContent = '+';
  });
});

document.getElementById('show_all_panels').addEventListener('click', function() {
  document.querySelectorAll('.panel-body-collapsible').forEach(expandPanel);
  document.querySelectorAll('.toggle-icon').forEach(icon => {
    icon.textContent = '−';
  });
});

// Panel toggle functionality
document.querySelectorAll('.toggle-panel').forEach(button => {
  button.addEventListener('click', function() {
    const targetId = this.getAttribute('data-target');
    const targetBody = document.getElementById(targetId);
    const icon = this.querySelector('.toggle-icon');

    if (targetBody.classList.contains('collapsed')) {
      expandPanel(targetBody);
      icon.textContent = '−';
    } else {
      collapsePanel(targetBody);
      icon.textContent = '+';
    }
  });
});

// Function to initialize/update panel heights (ensures all panels start expanded)
function initializePanelHeights() {
  document.querySelectorAll('.panel-body-collapsible').forEach(panel => {
    panel.classList.remove('collapsed');
    panel.style.maxHeight = 'none';
    const button = document.querySelector(`[data-target="${panel.id}"]`);
    if (button) {
      const icon = button.querySelector('.toggle-icon');
      if (icon) icon.textContent = '−';
    }
  });
}

// Initialize panel heights after a short delay to ensure content is rendered
setTimeout(initializePanelHeights, 100);

// Drag and Drop functionality for panel reorganization
let draggedElement = null;

document.querySelectorAll('.draggable-panel').forEach(panel => {
  panel.addEventListener('dragstart', function(e) {
    draggedElement = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
  });

  panel.addEventListener('dragend', function(e) {
    this.classList.remove('dragging');
    // Remove drag-over class from all panels
    document.querySelectorAll('.draggable-panel').forEach(p => {
      p.classList.remove('drag-over');
    });
  });

  panel.addEventListener('dragover', function(e) {
    if (e.preventDefault) {
      e.preventDefault(); // Allows drop
    }
    e.dataTransfer.dropEffect = 'move';
    return false;
  });

  panel.addEventListener('dragenter', function(e) {
    if (this !== draggedElement) {
      this.classList.add('drag-over');
    }
  });

  panel.addEventListener('dragleave', function(e) {
    this.classList.remove('drag-over');
  });

  panel.addEventListener('drop', function(e) {
    if (e.stopPropagation) {
      e.stopPropagation(); // Stops browser from redirecting
    }

    if (draggedElement !== this) {
      // Get the column containers
      const draggedCol = draggedElement.closest('.dashboard-col');
      const dropCol = this.closest('.dashboard-col');

      if (draggedCol === dropCol) {
        // Reorder within same column
        const allPanels = Array.from(draggedCol.querySelectorAll('.draggable-panel'));
        const draggedIndex = allPanels.indexOf(draggedElement);
        const dropIndex = allPanels.indexOf(this);

        if (draggedIndex < dropIndex) {
          this.parentNode.insertBefore(draggedElement, this.nextSibling);
        } else {
          this.parentNode.insertBefore(draggedElement, this);
        }
      } else {
        // Move between columns - insert before the target
        dropCol.insertBefore(draggedElement, this);
      }

    }

    this.classList.remove('drag-over');
    return false;
  });
});

// Allow dropping into empty columns
document.querySelectorAll('.dashboard-col').forEach(col => {
  col.addEventListener('dragover', function(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });

  col.addEventListener('drop', function(e) {
    e.preventDefault();
    if (draggedElement && e.target === this) {
      this.appendChild(draggedElement);
    }
  });
});

// ===== Save Figure / Stop =====

function generateTimestamp() {
  const d = new Date();
  const pad = (n, w) => String(n).padStart(w || 2, '0');
  return d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate())
    + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

function downloadCanvas(canvas, filename) {
  return new Promise(function(resolve) {
    canvas.toBlob(function(blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(function() { URL.revokeObjectURL(url); resolve(); }, 200);
    }, 'image/png');
  });
}

/**
 * Render the full time-series plot (ALL buffered data) to an offscreen canvas
 * and trigger a PNG download.
 */
function saveFullTimeSeries(stamp) {
  if (!plotInitialized || plotData[0].length < 2) return Promise.resolve();

  // Group enabled series by unit (same logic as animTS draw)
  const activeGroups = {};
  for (let si = 0; si < numericSensors.length; si++) {
    const key = numericSensors[si];
    if (enabledSeries[key] === false) continue;
    const unit = sensorUnits[key] || "?";
    if (!activeGroups[unit]) activeGroups[unit] = [];
    activeGroups[unit].push({ key, si });
  }
  const groupKeys = Object.keys(activeGroups);
  const numGroups = groupKeys.length;
  if (numGroups === 0) return Promise.resolve();

  const SUBPLOT_H = 220;
  const GAP = 12;
  const PAD_LEFT = 60, PAD_RIGHT = 120, PAD_TOP = 16, PAD_BOTTOM = 40;
  const W = 1600;
  const H = PAD_TOP + PAD_BOTTOM + numGroups * SUBPLOT_H + (numGroups - 1) * GAP;

  const offscreen = document.createElement('canvas');
  offscreen.width = W;
  offscreen.height = H;
  const ctx = offscreen.getContext('2d');

  // Background
  const bgColor = isDarkMode ? '#1a1a2e' : '#ffffff';
  const textColor = isDarkMode ? '#ccccdd' : '#333333';
  const gridColor = isDarkMode ? '#2a2a4e' : '#eeeeee';
  const axisColor = isDarkMode ? '#444444' : '#cccccc';
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, W, H);

  // Full data range
  const dataLen = plotData[0].length;
  const tMin = plotData[0][0];
  const tMax = plotData[0][dataLen - 1];
  const tRange = tMax - tMin || 1;
  const plotW = W - PAD_LEFT - PAD_RIGHT;
  const mapX = (t) => PAD_LEFT + (t - tMin) / tRange * plotW;

  // Downsample if too many points
  let step = 1;
  if (dataLen > 3000) step = Math.ceil(dataLen / 3000);

  const totalGap = (numGroups - 1) * GAP;
  const availH = H - PAD_TOP - PAD_BOTTOM - totalGap;
  const subH = availH / numGroups;

  for (let gi = 0; gi < numGroups; gi++) {
    const unit = groupKeys[gi];
    const seriesInGroup = activeGroups[unit];
    const isBottom = (gi === numGroups - 1);

    const spTop = PAD_TOP + gi * (subH + GAP);
    const spBottom = spTop + subH;

    // Y range
    let yMin = Infinity, yMax = -Infinity;
    for (const { si } of seriesInGroup) {
      const arr = plotData[si + 1];
      for (let i = 0; i < dataLen; i += step) {
        const v = arr[i];
        if (v != null && !isNaN(v)) {
          if (v < yMin) yMin = v;
          if (v > yMax) yMax = v;
        }
      }
    }
    if (!isFinite(yMin) || !isFinite(yMax)) continue;
    const yPad = Math.max((yMax - yMin) * 0.08, 0.1);
    yMin -= yPad;
    yMax += yPad;

    const localMapY = (v) => spTop + (1 - (v - yMin) / (yMax - yMin)) * subH;

    // Separator
    if (gi > 0) {
      ctx.strokeStyle = axisColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, spTop - GAP / 2);
      ctx.lineTo(W - PAD_RIGHT, spTop - GAP / 2);
      ctx.stroke();
    }

    // Y axis
    ctx.strokeStyle = axisColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD_LEFT, spTop);
    ctx.lineTo(PAD_LEFT, spBottom);
    if (isBottom) ctx.lineTo(W - PAD_RIGHT, spBottom);
    ctx.stroke();

    // Y ticks + grid
    ctx.fillStyle = textColor;
    ctx.font = "12px 'DIN', sans-serif";
    ctx.textAlign = "right";
    const yTicks = niceTicks(yMin, yMax, 4);
    const yTickStep = yTicks.length > 1 ? yTicks[1] - yTicks[0] : 1;
    for (const val of yTicks) {
      const py = localMapY(val);
      ctx.fillText(niceTickFormat(val, yTickStep), PAD_LEFT - 6, py + 4);
      ctx.strokeStyle = gridColor;
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, py);
      ctx.lineTo(W - PAD_RIGHT, py);
      ctx.stroke();
    }

    // Unit label
    ctx.save();
    ctx.fillStyle = textColor;
    ctx.font = "13px 'DIN', sans-serif";
    ctx.textAlign = "center";
    ctx.translate(14, (spTop + spBottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("[" + unit + "]", 0, 0);
    ctx.restore();

    // X axis labels (bottom only)
    if (isBottom) {
      ctx.textAlign = "center";
      ctx.fillStyle = textColor;
      ctx.font = "11px 'DIN', sans-serif";
      const nTicksX = 8;
      for (let i = 0; i <= nTicksX; i++) {
        const t = tMin + (tMax - tMin) * i / nTicksX;
        const d = new Date(t * 1000);
        const label = d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'});
        ctx.fillText(label, mapX(t), spBottom + 18);
      }
    }

    // Draw series
    for (let li = 0; li < seriesInGroup.length; li++) {
      const { key, si } = seriesInGroup[li];
      const color = seriesColors[li % seriesColors.length];
      const arr = plotData[si + 1];

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < dataLen; i += step) {
        const v = arr[i];
        if (v == null || isNaN(v)) continue;
        const px = mapX(plotData[0][i]);
        const py = localMapY(v);
        if (!started) { ctx.moveTo(px, py); started = true; }
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Label at right edge
      const lastVal = arr[dataLen - 1];
      if (lastVal != null && !isNaN(lastVal)) {
        ctx.fillStyle = color;
        ctx.font = "11px 'DIN', sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(key + " " + lastVal.toFixed(2), W - PAD_RIGHT + 6, localMapY(lastVal) + 4);
      }
    }
  }

  return downloadCanvas(offscreen, "timeseries_" + stamp + ".png");
}

/**
 * Capture a screenshot of the full page and trigger a PNG download.
 */
function saveScreenshot(stamp) {
  if (typeof html2canvas !== 'function') {
    console.warn("html2canvas not loaded, skipping screenshot");
    return Promise.resolve();
  }
  return html2canvas(document.body, {
    backgroundColor: isDarkMode ? '#1a1a2e' : '#f8f9fa',
    scale: 1,
    useCORS: true,
    logging: false,
  }).then(function(canvas) {
    return downloadCanvas(canvas, "screenshot_" + stamp + ".png");
  });
}

/**
 * Save both figures (time-series + screenshot).
 */
function saveFigures() {
  const stamp = generateTimestamp();
  return saveFullTimeSeries(stamp).then(function() {
    // Small gap between downloads so the browser doesn't block the second one
    return new Promise(function(resolve) { setTimeout(resolve, 300); });
  }).then(function() {
    return saveScreenshot(stamp);
  });
}

// Save Figure button
document.getElementById('save_figure_btn').addEventListener('click', function() {
  this.disabled = true;
  const btn = this;
  saveFigures()
    .catch(function(err) { console.warn("Save figure error:", err); })
    .finally(function() {
      btn.disabled = false;
    });
});

// Stop button
document.getElementById('stop_btn').addEventListener('click', function() {
  this.disabled = true;
  stopped = true;
  saveFigures()
    .catch(function(err) { console.warn("Save figure error:", err); })
    .then(function() {
      return new Promise(function(resolve) { setTimeout(resolve, 1000); });
    }).then(function() {
      return fetch('/stop', { method: 'POST' });
    }).catch(function() {
      // Server killed itself — expected
    }).finally(function() {
      document.title = 'Stopped';
    });
});
