"use strict";
let isDarkMode = false;
let stopped = false;
// Offset (ms) to align the header clock with server time: serverMs = Date.now() + serverTimeOffset
let serverTimeOffset = 0;
// Global parameter for number formatting
const DECIMAL_POINTS = 2;

// Hz counters
let screenFrameCount = 0;
let instrumentFetchCount = 0;
let hzLastUpdate = performance.now();
(function updateHz() {
  const now = performance.now();
  const elapsed = (now - hzLastUpdate) / 1000;
  if (elapsed >= 1) {
    const sHz = Math.round(screenFrameCount / elapsed);
    const iHz = (instrumentFetchCount / elapsed).toFixed(1);
    const sEl = document.getElementById('screen_hz');
    const iEl = document.getElementById('instrument_hz');
    if (sEl) sEl.textContent = sHz + ' Hz';
    if (iEl) iEl.textContent = iHz + ' Hz';
    screenFrameCount = 0;
    instrumentFetchCount = 0;
    hzLastUpdate = now;
  }
  if (!stopped) requestAnimationFrame(updateHz);
})();

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
    if (stopped) {
      clearInterval(clockInterval);
      var p = document.getElementById('clock_pulse');
      if (p) p.classList.add('dead');
      return;
    }
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


// Amber
const amberLight = ["#FFF3E0","#FFE0B2","#FFCC80","#FFB74D","#FFA726","#F59016","#C46A08","#8C4503"];
const amberDark  = ["#8C4503","#A35504","#C46A08","#DA7C0E","#F59016","#FFA726","#FFB74D","#FFCC80"];

// Blue
const blueLight = ["#E3F2FD","#BBDEFB","#90CAF9","#64B5F6","#42A5F5","#1E88E5","#1565C0","#0D47A1"];
const blueDark  = ["#0D47A1","#1256B8","#1565C0","#1976D2","#1E88E5","#42A5F5","#64B5F6","#90CAF9"];

// Gray
const grayLight = ["#F5F5F5","#E0E0E0","#BDBDBD","#9E9E9E","#757575","#616161","#424242","#2B2B2B"];
const grayDark  = ["#2B2B2B","#373737","#424242","#545454","#616161","#757575","#9E9E9E","#BDBDBD"];

// Soft sci-fi (mixed categorical)
const scifiLight = ["#6FBFBF","#B07CC3","#D4896A","#8AA86E","#5B94C6","#C4A24E","#C77088","#7E8C9A"];
const scifiDark  = ["#8EDADA","#C99ADB","#E8A585","#A6C888","#7BB2E0","#DBBE68","#DB8DA2","#9AACBC"];

// Tactical console (mixed categorical)
const tacticalLight = ["#C43B3B","#1E88E5","#f0b444","#C476A8","#E8A54E","#D46A4A","#A09878","#4A6A3E"];
const tacticalDark  = ["#fb4040","#1E88E5","#ffce73","#E08CBC","#f9ec3c","#E8845E","#C4B898","#6A9050"];

// --- Selector ---
const palette = "scifi"; // "amber" | "blue" | "gray" | "scifi" | "tactical"

const palettes = {
  amber:    { light: amberLight,    dark: amberDark },
  blue:     { light: blueLight,     dark: blueDark },
  gray:     { light: grayLight,     dark: grayDark },
  scifi:    { light: scifiLight,    dark: scifiDark },
  tactical: { light: tacticalLight, dark: tacticalDark },
};

const seriesColorsLight = palettes[palette].light;
const seriesColorsDark  = palettes[palette].dark;


function getSeriesColors() { return isDarkMode ? seriesColorsDark : seriesColorsLight; }

// Strip .pv / .setpoint / .sp suffix to get the base name for color grouping
function seriesBaseName(key) {
  if (key.endsWith('.setpoint')) return key.slice(0, -'.setpoint'.length);
  if (key.endsWith('.pv')) return key.slice(0, -3);
  if (key.endsWith('.sp')) return key.slice(0, -3);
  return key;
}
function isSetpoint(key) { return key.endsWith('.setpoint') || key.endsWith('.sp'); }

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
function createAnimScatter(canvasId, radioName, scatterCfg) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  const ctx = canvas.getContext("2d", { alpha: true });
  const dpr = window.devicePixelRatio || 1;
  ctx.imageSmoothingEnabled = true;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // State
  let prevPoint = null;
  let targetPoint = null;
  let currentPoint = null;
  let lerpT = 1;
  let lastScatterFrame = 0;

  const TRAIL_MAX = 700;
  let trail = [];

  let currentBounds = { minX: 20, maxX: 30, minY: 40, maxY: 80 };
  let targetBounds = { minX: 20, maxX: 30, minY: 40, maxY: 80 };

  let cachedVisiblePts = null;
  let cachedVisibleBounds = null;

  const PAD_LEFT = 50;
  const PAD_BOTTOM = 40;
  const PAD_TOP = 0;
  const PAD_RIGHT = 0;

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
  }

  function getMode() {
    const el = document.querySelector('input[name="' + radioName + '"]:checked');
    return el ? el.value : "1min";
  }

  function pushTarget(x, y) {
    if (targetPoint && targetPoint.x === x && targetPoint.y === y) return;
    if (targetPoint !== null && currentPoint) {
      trail.push({ x: targetPoint.x, y: targetPoint.y });
      if (trail.length > TRAIL_MAX) trail.shift();
      prevPoint = { x: targetPoint.x, y: targetPoint.y };
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
    ctx.lineTo((w - PAD_RIGHT) * dpr, PAD_TOP * dpr);
    ctx.closePath();
    ctx.stroke();

    ctx.fillStyle = plotTheme.tick;
    ctx.font = (10 * dpr) + "px 'DIN', sans-serif";

    const xTicks = niceTicks(currentBounds.minX, currentBounds.maxX, 5);
    const xStep = xTicks.length > 1 ? xTicks[1] - xTicks[0] : 1;
    ctx.textAlign = "center";
    for (const val of xTicks) {
      const px = mapX(val, w) * dpr;
      ctx.fillText(niceTickFormat(val, xStep), px, (h - PAD_BOTTOM + 15) * dpr);
    }

    const yTicks = niceTicks(currentBounds.minY, currentBounds.maxY, 5);
    const yStep = yTicks.length > 1 ? yTicks[1] - yTicks[0] : 1;
    ctx.textAlign = "right";
    for (const val of yTicks) {
      const py = mapY(val, h) * dpr;
      ctx.fillText(niceTickFormat(val, yStep), (PAD_LEFT - 5) * dpr, py + 3 * dpr);
    }

    ctx.fillStyle = plotTheme.label;
    ctx.font = (11 * dpr) + "px 'DIN', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(scatterCfg.x, (PAD_LEFT + (w - PAD_LEFT - PAD_RIGHT) / 2) * dpr, (h - 5) * dpr);

    ctx.save();
    ctx.translate(12 * dpr, (PAD_TOP + (h - PAD_TOP - PAD_BOTTOM) / 2) * dpr);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(scatterCfg.y, 0, 0);
    ctx.restore();

    ctx.restore();
  }

  function rebuildVisibleCache() {
    cachedVisiblePts = getVisiblePoints();
    if (cachedVisiblePts && cachedVisiblePts.length > 0) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      var allPts = cachedVisiblePts.concat(trail, savedPointsOverlay);
      for (const p of allPts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const rangeX = maxX - minX || 1;
      const rangeY = maxY - minY || 1;
      const padX = rangeX * 0.15;
      const padY = rangeY * 0.15;
      cachedVisibleBounds = { minX: minX - padX, maxX: maxX + padX, minY: minY - padY, maxY: maxY + padY };
    } else {
      cachedVisibleBounds = null;
    }
  }

  function getVisiblePoints() {
    const cpuIdx = sensorToSeriesMap[scatterCfg.y];
    const ambientIdx = sensorToSeriesMap[scatterCfg.x];
    if (!cpuIdx || !ambientIdx || !plotInitialized) return null;
    const dataLen = plotData[0].length;
    if (dataLen === 0) return null;

    const mode = getMode();
    const lastTime = plotData[0][dataLen - 1];
    const window = mode === "1min" ? 60 : 1800;
    const cutoff = lastTime - window;
    let startIdx = 0;
    for (let i = dataLen - 1; i >= 0; i--) {
      if (plotData[0][i] < cutoff) { startIdx = i + 1; break; }
    }

    const pts = [];
    let step = 1;
    const count = dataLen - startIdx;
    if (count > 600) {
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

    const now = performance.now();
    const dt = lastScatterFrame ? (now - lastScatterFrame) / 1000 : 0.016;
    lastScatterFrame = now;
    if (lerpT < 1) {
      lerpT = Math.min(1, lerpT + dt / samplePeriodSec());
    }

    if (targetPoint && prevPoint) {
      const t = lerpT * lerpT * (3 - 2 * lerpT);
      currentPoint = {
        x: lerp(prevPoint.x, targetPoint.x, t),
        y: lerp(prevPoint.y, targetPoint.y, t)
      };
    }

    if (cachedVisibleBounds) {
      let tb = Object.assign({}, cachedVisibleBounds);
      if (currentPoint) {
        const padX = (tb.maxX - tb.minX) * 0.1 || 0.1;
        const padY = (tb.maxY - tb.minY) * 0.1 || 0.1;
        if (currentPoint.x < tb.minX + padX) tb.minX = currentPoint.x - padX;
        if (currentPoint.x > tb.maxX - padX) tb.maxX = currentPoint.x + padX;
        if (currentPoint.y < tb.minY + padY) tb.minY = currentPoint.y - padY;
        if (currentPoint.y > tb.maxY - padY) tb.maxY = currentPoint.y + padY;
      }
      const needsExpand = tb.minX < targetBounds.minX || tb.maxX > targetBounds.maxX ||
                          tb.minY < targetBounds.minY || tb.maxY > targetBounds.maxY;
      if (needsExpand) {
        targetBounds = tb;
      } else {
        const curRangeX = targetBounds.maxX - targetBounds.minX || 1;
        const curRangeY = targetBounds.maxY - targetBounds.minY || 1;
        const threshX = curRangeX * 0.03;
        const threshY = curRangeY * 0.03;
        if (Math.abs(tb.minX - targetBounds.minX) > threshX ||
            Math.abs(tb.maxX - targetBounds.maxX) > threshX ||
            Math.abs(tb.minY - targetBounds.minY) > threshY ||
            Math.abs(tb.maxY - targetBounds.maxY) > threshY) {
          targetBounds = tb;
        }
      }
    }

    function boundsLerp(cur, tgt, isExpanding) {
      return lerp(cur, tgt, isExpanding ? 0.15 : 0.04);
    }
    currentBounds.minX = boundsLerp(currentBounds.minX, targetBounds.minX, targetBounds.minX < currentBounds.minX);
    currentBounds.maxX = boundsLerp(currentBounds.maxX, targetBounds.maxX, targetBounds.maxX > currentBounds.maxX);
    currentBounds.minY = boundsLerp(currentBounds.minY, targetBounds.minY, targetBounds.minY < currentBounds.minY);
    currentBounds.maxY = boundsLerp(currentBounds.maxY, targetBounds.maxY, targetBounds.maxY > currentBounds.maxY);

    drawAxes(w, h);

    if (!currentPoint && trail.length === 0) {
      drawSavedPoints(w, h);
      requestAnimationFrame(draw);
      return;
    }

    const fullTrail = currentPoint ? trail.concat([currentPoint]) : trail;
    const totalPts = fullTrail.length;

    const fadeFloor = getMode() === "30min" ? 0.2 : 0;

    if (totalPts > 1) {
      const nBands = 4;
      ctx.lineWidth = 1.5 * dpr;
      const dotR = 2.5 * dpr;
      for (let b = 0; b < nBands; b++) {
        const bandLo = b / nBands;
        const bandHi = (b + 1) / nBands;
        const isLast = (b === nBands - 1);
        const bandMid = (bandLo + bandHi) / 2;
        const lineAlpha = fadeFloor + bandMid * (0.7 - fadeFloor);
        const dotAlpha = fadeFloor + bandMid * (0.65 - fadeFloor);
        ctx.strokeStyle = `rgba(${plotTheme.trail}, ${lineAlpha})`;
        ctx.beginPath();
        for (let i = 0; i < totalPts - 1; i++) {
          const ratio = totalPts > 2 ? i / (totalPts - 2) : 1;
          if (ratio >= bandLo && (isLast ? ratio <= bandHi : ratio < bandHi)) {
            ctx.moveTo(mapX(fullTrail[i].x, w) * dpr, mapY(fullTrail[i].y, h) * dpr);
            ctx.lineTo(mapX(fullTrail[i + 1].x, w) * dpr, mapY(fullTrail[i + 1].y, h) * dpr);
          }
        }
        ctx.stroke();
        ctx.fillStyle = `rgba(${plotTheme.trail}, ${dotAlpha})`;
        ctx.beginPath();
        for (let i = 0; i < totalPts - 1; i++) {
          const ratio = totalPts > 2 ? i / (totalPts - 2) : 1;
          if (ratio >= bandLo && (isLast ? ratio <= bandHi : ratio < bandHi)) {
            const px = mapX(fullTrail[i].x, w) * dpr;
            const py = mapY(fullTrail[i].y, h) * dpr;
            ctx.moveTo(px + dotR, py);
            ctx.arc(px, py, dotR, 0, Math.PI * 2);
          }
        }
        ctx.fill();
      }
    }

    if (currentPoint) {
      const cx = mapX(currentPoint.x, w) * dpr;
      const cy = mapY(currentPoint.y, h) * dpr;
      ctx.beginPath();
      ctx.arc(cx, cy, 5 * dpr, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 0, 0, 1)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 3.0 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 0, 0, 1)";
      ctx.fill();
    }

    drawSavedPoints(w, h);

    requestAnimationFrame(draw);
  }

  resizeCanvas();
  requestAnimationFrame(draw);

  function clear() {
    trail = [];
    prevPoint = null;
    targetPoint = null;
    currentPoint = null;
    lerpT = 1;
  }

  let savedPointsOverlay = [];

  function setSavedPoints(pts) {
    savedPointsOverlay = pts || [];
  }

  function drawSavedPoints(w, h) {
    if (savedPointsOverlay.length === 0) return;
    ctx.save();
    ctx.font = (9 * dpr) + "px 'DIN', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    for (const pt of savedPointsOverlay) {
      const px = mapX(pt.x, w) * dpr;
      const py = mapY(pt.y, h) * dpr;
      const r = 4 * dpr;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.strokeStyle = isDarkMode ? "rgba(255,255,255,0.9)" : "rgba(80,80,80,0.9)";
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();
      if (pt.label) {
        ctx.fillStyle = isDarkMode ? "#fff" : "rgba(80,80,80,0.9)";
        ctx.fillText(pt.label, px + r + 2 * dpr, py - 2 * dpr);
      }
    }
    ctx.restore();
  }

  return { pushTarget, clear, rebuildVisibleCache, setSavedPoints, config: scatterCfg };
}

// Create scatter plot instances from config
const animScatters = [];
if (typeof SCATTER_CONFIGS !== 'undefined') {
  SCATTER_CONFIGS.forEach(function(cfg, idx) {
    const instance = createAnimScatter(
      "animated_scatter_canvas_" + idx,
      "anim_scatter_option_" + idx,
      cfg
    );
    if (instance) animScatters.push(instance);
  });
}

function updateAnimatedScatter() {
  if (animScatters.length === 0) return;
  const len = plotData[0] ? plotData[0].length : 0;
  if (len === 0) return;

  for (var s = 0; s < animScatters.length; s++) {
    var sc = animScatters[s];
    sc.rebuildVisibleCache();
    var yIdx = sensorToSeriesMap[sc.config.y];
    var xIdx = sensorToSeriesMap[sc.config.x];
    if (!yIdx || !xIdx) continue;
    var xVal = plotData[xIdx][len - 1];
    var yVal = plotData[yIdx][len - 1];
    if (xVal != null && yVal != null && !isNaN(xVal) && !isNaN(yVal)) {
      sc.pushTarget(xVal, yVal);
    }

    // Update saved points overlay
    if (sensorData && sensorData.saved_points && sensorData.saved_points.length > 0) {
      var overlay = [];
      for (var i = 0; i < sensorData.saved_points.length; i++) {
        var sp = sensorData.saved_points[i];
        var sx = parseFloat(sp.sensors[sc.config.x]);
        var sy = parseFloat(sp.sensors[sc.config.y]);
        if (!isNaN(sx) && !isNaN(sy)) {
          overlay.push({ x: sx, y: sy, label: sp.label || "" });
        }
      }
      sc.setSavedPoints(overlay);
    }
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
  let lastFrameTime = 0;   // for delta-time-based lerp
  // Smooth rate: arrive ~95% at 90% of the measured sample interval,
  // so the animation fills nearly the whole gap between samples.
  function getSmoothRate() { return 3 / (0.9 * samplePeriodSec()); }

  // Cached Y-range per unit group — rebuilt on data arrival, reused across frames
  // { unit: { yMin, yMax } }
  let cachedYRanges = {};
  let yRangeStale = true;  // set true when new data arrives

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
    yRangeStale = true;
  }

  // Rebuild Y-range cache from visible data. Called once per data update, not per frame.
  function rebuildYRanges(activeGroups, groupKeys, startIdx, dataLen, step) {
    cachedYRanges = {};
    for (let gi = 0; gi < groupKeys.length; gi++) {
      const unit = groupKeys[gi];
      const seriesInGroup = activeGroups[unit];
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
      cachedYRanges[unit] = { yMin, yMax };
    }
    yRangeStale = false;
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

    // Advance interpolation for each series and time (frame-rate independent)
    const now = performance.now();
    const dt = lastFrameTime ? Math.min((now - lastFrameTime) / 1000, 0.1) : 0.016;
    lastFrameTime = now;
    const alpha = 1 - Math.exp(-getSmoothRate() * dt);
    for (const key in seriesTargets) {
      if (seriesCurrent[key] !== undefined) {
        seriesCurrent[key] = lerp(seriesCurrent[key], seriesTargets[key], alpha);
      }
    }
    if (targetTime > 0) {
      currentTime = lerp(currentTime, targetTime, alpha);
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
        if (plotData[0][i] < tMin) { startIdx = Math.max(0, i - 5); break; }
      }
    } else {
      // "30min" mode: show last 30 minutes, no interpolation
      tMax = lastDataTime;
      tMin = lastDataTime - 1800;
      for (let i = dataLen - 1; i >= 0; i--) {
        if (plotData[0][i] < tMin) { startIdx = Math.max(0, i - 5); break; }
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

    // Downsample to ~1 point per 2 CSS pixels (both modes)
    const maxPts = Math.min(600, Math.max(100, Math.round(plotW / 2)));
    let step = 1;
    if (visibleLen > maxPts) {
      step = Math.ceil(visibleLen / maxPts);
    }
    // Align startIdx to a multiple of step so the same data points are
    // selected regardless of how the sliding window shifts frame-to-frame.
    if (step > 1) {
      startIdx = Math.ceil(startIdx / step) * step;
    }

    // Compute sub-plot regions
    const totalGap = (numGroups - 1) * GAP;
    const availH = h - PAD_TOP - PAD_BOTTOM - totalGap;
    const subH = availH / numGroups;

    // Rebuild Y-range cache only when new data has arrived
    if (yRangeStale) {
      rebuildYRanges(activeGroups, groupKeys, startIdx, dataLen, step);
    }

    // Draw each unit group
    for (let gi = 0; gi < numGroups; gi++) {
      const unit = groupKeys[gi];
      const seriesInGroup = activeGroups[unit];
      const isBottom = (gi === numGroups - 1);

      const spTop = PAD_TOP + gi * (subH + GAP);
      const spBottom = spTop + subH;

      // Use cached Y range for this unit group
      const cached = cachedYRanges[unit];
      if (!cached) continue;
      let yMin = cached.yMin, yMax = cached.yMax;

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

      // Clip to subplot area so lines don't bleed past the Y-axis
      ctx.save();
      ctx.beginPath();
      ctx.rect(PAD_LEFT * dpr, spTop * dpr, (w - PAD_LEFT - PAD_RIGHT) * dpr, subH * dpr);
      ctx.clip();

      // Draw series in this group
      const seriesColors = getSeriesColors();
      const useSplines = (step === 1);

      // Assign colors by base name so .pv/.sp pairs share a color
      const baseNameColorMap = {};
      let colorIdx = 0;
      for (const { key } of seriesInGroup) {
        const base = seriesBaseName(key);
        if (!(base in baseNameColorMap)) {
          baseNameColorMap[base] = seriesColors[colorIdx % seriesColors.length];
          colorIdx++;
        }
      }

      for (let li = 0; li < seriesInGroup.length; li++) {
        const { key, si } = seriesInGroup[li];
        const color = baseNameColorMap[seriesBaseName(key)];
        const seriesArr = plotData[si + 1];
        const curVal = seriesCurrent[key];

        // Collect visible points
        const pts = [];
        for (let i = startIdx; i < dataLen; i += step) {
          const idx = (step > 1 && i + step >= dataLen) ? dataLen - 1 : i;
          const v = seriesArr[idx];
          if (v != null && !isNaN(v)) {
            pts.push({ px: mapX(plotData[0][idx]), py: localMapY(v) });
          }
          if (idx === dataLen - 1) break;
        }
        // Interpolated tip
        if (pts.length > 0 && curVal != null && !isNaN(curVal)) {
          const tipT = mode === "1min" ? currentTime : lastDataTime;
          pts.push({ px: mapX(tipT), py: localMapY(curVal) });
        }
        if (pts.length < 2) continue;

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5 * dpr;
        ctx.setLineDash(isSetpoint(key) ? [6 * dpr, 4 * dpr] : []);
        ctx.beginPath();
        ctx.moveTo(pts[0].px, pts[0].py);
        if (useSplines) {
          for (let j = 0; j < pts.length - 1; j++) {
            const cp = crCP(pts, j);
            ctx.bezierCurveTo(cp.cp1x, cp.cp1y, cp.cp2x, cp.cp2y, pts[j + 1].px, pts[j + 1].py);
          }
        } else {
          for (let j = 1; j < pts.length; j++) {
            ctx.lineTo(pts[j].px, pts[j].py);
          }
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore(); // end subplot clip

      // Dots and floating labels (outside clip so text in PAD_RIGHT area is visible)
      for (let li = 0; li < seriesInGroup.length; li++) {
        const { key } = seriesInGroup[li];
        const color = baseNameColorMap[seriesBaseName(key)];
        const curVal = seriesCurrent[key];
        if (curVal != null && !isNaN(curVal)) {
          const tipT = mode === "1min" ? currentTime : lastDataTime;
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

    screenFrameCount++;
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
  // Group by unit, assign colors by base name so .pv/.sp pairs share a color
  const unit = sensorUnits[key] || "?";
  const seenBases = new Set();
  let idx = 0;
  for (let i = 0; i < numericSensors.length; i++) {
    if (numericSensors[i] === key) break;
    if ((sensorUnits[numericSensors[i]] || "?") === unit) {
      const base = seriesBaseName(numericSensors[i]);
      if (!seenBases.has(base)) {
        seenBases.add(base);
        idx++;
      }
    }
  }
  // If this key's base was already counted, reuse the same index
  const myBase = seriesBaseName(key);
  if (seenBases.has(myBase)) {
    // Find the index assigned to that base
    let baseIdx = 0;
    const seen2 = new Set();
    for (let i = 0; i < numericSensors.length; i++) {
      if ((sensorUnits[numericSensors[i]] || "?") !== unit) continue;
      const b = seriesBaseName(numericSensors[i]);
      if (!seen2.has(b)) {
        if (b === myBase) { idx = baseIdx; break; }
        seen2.add(b);
        baseIdx++;
      }
    }
  }
  return getSeriesColors()[idx % getSeriesColors().length];
}

// Legend row cache: built once, then only value cells are updated
let legendRowCache = null; // [{valueCell: HTMLElement}]

function updateLegend() {
  if (!plotInitialized) return;
  const legendBody = document.getElementById("legend_table_body");
  const len = plotData[0].length;

  // Build rows once
  if (!legendRowCache) {
    legendRowCache = [];
    let html = "";
    numericSensors.forEach((key, idx) => {
      const color = seriesColor(key, idx);
      const unit = sensorUnits[key] || "";
      html += `<tr><td style="color:${color}">${key}</td><td>${unit}</td><td class="legend-val">-</td></tr>`;
    });
    legendBody.innerHTML = html;
    const cells = legendBody.querySelectorAll('.legend-val');
    cells.forEach(cell => legendRowCache.push({ valueCell: cell, lastValue: "" }));
  }

  // Update only changed value cells
  numericSensors.forEach((key, idx) => {
    const value = len > 0 ? plotData[idx + 1][len - 1] : null;
    const displayValue = (value != null && !isNaN(value)) ? value.toFixed(DECIMAL_POINTS) : "-";
    const entry = legendRowCache[idx];
    if (entry && entry.lastValue !== displayValue) {
      entry.valueCell.textContent = displayValue;
      entry.lastValue = displayValue;
    }
  });
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

    // Add square x-toggle for ALL instruments (enable only if plottable)
    const checkbox = document.createElement('span');
    checkbox.className = 'x-check';
    const checked = isPlottable && enabledSeries[key];
    checkbox.innerHTML = checked ? '&times;' : '&nbsp;';
    checkbox.dataset.checked = checked ? '1' : '0';

    if (isPlottable && isNumeric) {
      checkbox.style.cursor = 'pointer';
      checkbox.addEventListener('click', function() {
        const on = this.dataset.checked === '1';
        this.dataset.checked = on ? '0' : '1';
        this.innerHTML = on ? '&nbsp;' : '&times;';
        enabledSeries[key] = !on;
      });
    } else {
      checkbox.style.opacity = '0.3';
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
    { key: "note", label: "Note", defaultValue: "" },
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
    const configMap = {
      "CSV Log File": "file_name",
      "Sample Frequency (Hz)": "sample_frequency_hz",
      "Log Subsample": "log_subsample",
    };
    for (const [settingKey, controlKey] of Object.entries(configMap)) {
      if (s[settingKey] != null) {
        const input = controlConfig.textInputs.find(t => t.key === controlKey);
        if (input) input.defaultValue = s[settingKey];
      }
    }
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

// Measured sample period (ms) — tracks actual time between new data arrivals.
// Used by animation lerps so they fill the real inter-sample gap.
let measuredSamplePeriod = 0;
let _lastSampleArrival = 0;
// Best estimate of sample period in seconds (measured > configured > fallback)
function samplePeriodSec() {
  if (measuredSamplePeriod > 0) return measuredSamplePeriod / 1000;
  return POLL_INTERVAL / 1000;
}

let _lastPollHadData = false;
function fetchSensorData() {
  if (stopped) return;
  const fetchStart = performance.now();
  fetch('/data_since/' + lastDataTimestamp)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(data => {
      const fetchMs = performance.now() - fetchStart;
      const iEl = document.getElementById('instrument_hz');
      if (iEl) {
        // Warn if round-trip exceeds poll interval (poll is bottlenecked)
        if (fetchMs > POLL_INTERVAL * 1.5) {
          iEl.style.color = 'orange';
          iEl.title = 'Poll round-trip (' + Math.round(fetchMs) + 'ms) exceeds interval (' + POLL_INTERVAL + 'ms)';
        } else {
          iEl.style.color = '';
          iEl.title = '';
        }
      }
      const samples = data.samples;
      sensorData = data;
      instrumentFetchCount++;
      _lastPollHadData = samples.length > 0;

      // Restore pulse on successful fetch
      var pulse = document.getElementById('clock_pulse');
      if (pulse) pulse.classList.remove('dead');

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
        // Measure actual inter-sample period from wall-clock arrivals
        const nowMs = performance.now();
        if (_lastSampleArrival > 0) {
          const gap = nowMs - _lastSampleArrival;
          // Exponential moving average, clamped to reasonable range
          if (measuredSamplePeriod > 0) {
            measuredSamplePeriod = measuredSamplePeriod * 0.7 + gap * 0.3;
          } else {
            measuredSamplePeriod = gap;
          }
        }
        _lastSampleArrival = nowMs;

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

      // Trim only when significantly over limit (avoids frequent large splices)
      if (plotData[0].length > MAX_PLOT_POINTS * 1.2) {
        const removeCount = plotData[0].length - MAX_PLOT_POINTS;
        for (let s = 0; s < plotData.length; s++) {
          plotData[s] = plotData[s].slice(removeCount);
        }
      }

      updateLegend();
      updateAnimatedScatter();
      updateAnimatedTS();

      // Update experiment panels (from experiment.js)
      if (typeof updatePIDStatus === 'function' && data.pid_status) {
        updatePIDStatus(data.pid_status);
      }
      if (typeof updateInterlockStatus === 'function' && data.tripped_interlocks) {
        updateInterlockStatus(data.tripped_interlocks, data.sensors, data.latched_interlocks);
        var pulse = document.getElementById('clock_pulse');
        if (pulse) {
          pulse.classList.toggle('tripped', data.tripped_interlocks.length > 0);
        }
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
      var pulse = document.getElementById('clock_pulse');
      if (pulse) pulse.classList.add('dead');
    })
    .finally(() => {
      // Poll again quickly after receiving data (tight event response);
      // back off to POLL_INTERVAL when idle (no new samples).
      const delay = _lastPollHadData ? 10 : POLL_INTERVAL;
      setTimeout(fetchSensorData, delay);
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
  const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || (isDarkMode ? '#000000' : '#ffffff');
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

    // Clip to subplot area
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD_LEFT, spTop, plotW, subH);
    ctx.clip();

    // Assign colors by base name so .pv/.sp pairs share a color
    const dlBaseColorMap = {};
    let dlColorIdx = 0;
    for (const { key } of seriesInGroup) {
      const base = seriesBaseName(key);
      if (!(base in dlBaseColorMap)) {
        dlBaseColorMap[base] = getSeriesColors()[dlColorIdx % getSeriesColors().length];
        dlColorIdx++;
      }
    }

    // Draw series
    for (let li = 0; li < seriesInGroup.length; li++) {
      const { key, si } = seriesInGroup[li];
      const color = dlBaseColorMap[seriesBaseName(key)];
      const arr = plotData[si + 1];

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(isSetpoint(key) ? [6, 4] : []);
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
      ctx.setLineDash([]);
    }
    ctx.restore(); // end subplot clip

    // Labels at right edge (outside clip so they render in PAD_RIGHT)
    for (let li = 0; li < seriesInGroup.length; li++) {
      const { key, si } = seriesInGroup[li];
      const color = dlBaseColorMap[seriesBaseName(key)];
      const lastVal = plotData[si + 1][dataLen - 1];
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
    backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || (isDarkMode ? '#000000' : '#f8f9fa'),
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
// Save Point button
let savePointCount = 0;
document.getElementById('save_point_btn').addEventListener('click', function() {
  const btn = this;
  const noteEl = controls["note"];
  const noteVal = noteEl ? noteEl.value : "";
  fetch('/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: noteVal })
  }).then(function() {
    return fetch('/save_point', { method: 'POST' });
  }).then(function(r) { return r.json(); })
  .then(function(data) {
    console.log("Point saved to", data.file);
    savePointCount++;
    const counter = document.getElementById('save_point_count');
    counter.textContent = savePointCount;
    counter.classList.add('save-point-flash');
    setTimeout(function() { counter.classList.remove('save-point-flash'); }, 300);
  })
  .catch(function(err) { console.error("Save point error:", err); });
});

function saveFigures() {
  const stamp = generateTimestamp();
  return saveFullTimeSeries(stamp).then(function() {
    // Small gap between downloads so the browser doesn't block the second one
    return new Promise(function(resolve) { setTimeout(resolve, 300); });
  }).then(function() {
    return saveScreenshot(stamp);
  });
}

// Clear time series button
document.getElementById('clear_ts_btn').addEventListener('click', function() {
  for (var i = 0; i < plotData.length; i++) {
    plotData[i] = [];
  }
  legendRowCache = null;  // force legend rebuild
  animScatters.forEach(function(sc) { sc.clear(); });
});

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
