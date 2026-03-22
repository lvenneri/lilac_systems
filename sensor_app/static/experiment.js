"use strict";

// Experiment config fetched from /config endpoint
let experimentConfig = null;
let pidControls = {};       // loop_name -> { statusEls, spInput, modeRadios, outSlider, ... }
let outputSliders = {};     // channel_name -> { type, slider/seg, ... }
let interlocksDefs = [];    // interlock definitions from config
let interlocksBuilt = false;
let interlocksWereTripped = false;  // track previous state for beep edge-detection

// Interlock alarm beep using Web Audio API
// Browsers require a user gesture before AudioContext can produce sound.
// We eagerly create and resume it on the first click/keydown.
let _alarmAudioCtx = null;
function _ensureAudioCtx() {
  if (!_alarmAudioCtx) _alarmAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_alarmAudioCtx.state === 'suspended') _alarmAudioCtx.resume();
  return _alarmAudioCtx;
}
document.addEventListener('click', _ensureAudioCtx, { once: true });
document.addEventListener('keydown', _ensureAudioCtx, { once: true });
let _alarmInterval = null;
let _alarmMuted = false;
let _alarmActive = false;  // true while interlocks are tripped (even if muted)

function _startInterlockAlarm() {
  _alarmActive = true;
  if (_alarmInterval || _alarmMuted) return;
  _ensureAudioCtx();

  function beep() {
    if (_alarmMuted) return;
    const ctx = _ensureAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 560;
    osc.type = "sine";
    gain.gain.value = 0.15;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.stop(ctx.currentTime + 0.25);
  }

  beep();
  _alarmInterval = setInterval(beep, 800);
}

function _stopInterlockAlarm() {
  _alarmActive = false;
  _alarmMuted = false;
  _updateMuteButtonIcon();
  if (_alarmInterval) {
    clearInterval(_alarmInterval);
    _alarmInterval = null;
  }
}

const _svgSpeakerOn = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
const _svgSpeakerOff = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';

function _updateMuteButtonIcon() {
  const btn = document.getElementById('mute_alarm_toggle');
  if (btn) btn.innerHTML = _alarmMuted ? _svgSpeakerOff : _svgSpeakerOn;
}

// Wire up mute button
(function _wireMuteBtn() {
  const btn = document.getElementById('mute_alarm_toggle');
  if (!btn) { document.addEventListener('DOMContentLoaded', _wireMuteBtn); return; }
  btn.addEventListener('click', function() {
    _alarmMuted = !_alarmMuted;
    _updateMuteButtonIcon();
    if (_alarmMuted) {
      if (_alarmInterval) { clearInterval(_alarmInterval); _alarmInterval = null; }
    } else if (_alarmActive) {
      _startInterlockAlarm();
    }
  });
})();

// Pleasant chime for step hold start / end
function _playChime(type) {
  if (_alarmMuted) return;
  const ctx = _ensureAudioCtx();
  const now = ctx.currentTime;

  if (type === "hold_start") {
    // Two-note ascending chime (C5 → E5)
    [523.25, 659.25].forEach(function(freq, i) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      var t0 = now + i * 0.12;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.12, t0 + 0.04);
      gain.gain.setValueAtTime(0.12, t0 + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
      osc.start(t0);
      osc.stop(t0 + 0.35);
    });
  } else if (type === "hold_end") {
    // Three-note ascending ta-da (C5 → E5 → G5)
    [523.25, 659.25, 783.99].forEach(function(freq, i) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      var t0 = now + i * 0.1;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.12, t0 + 0.04);
      gain.gain.setValueAtTime(0.12, t0 + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
      osc.start(t0);
      osc.stop(t0 + 0.4);
    });
  }
}

let _prevStepSettled = null;
let _prevStepIndex = null;
let _prevStepRunning = null;

// ---------------------------------------------------------------------------
// Fetch config once on page load
// ---------------------------------------------------------------------------

function loadExperimentConfig() {
  fetch('/config')
    .then(r => r.json())
    .then(cfg => {
      experimentConfig = cfg;
      interlocksDefs = cfg.interlocks || [];
      buildStepSeriesControls(cfg);
      buildPIDPanels(cfg.control_loops || {});
      buildOutputChannelControls(cfg);
      initSettingsFromConfig(cfg);
      buildInterlockList();
      buildDriverStatusPanel(cfg.instruments || {});
    })
    .catch(err => console.warn("No experiment config:", err));
}

// ---------------------------------------------------------------------------
// PID control panels
// ---------------------------------------------------------------------------

function buildPIDPanels(loops) {
  const container = document.getElementById("pid_loops_container");
  if (!container) return;

  for (const [loopName, cfg] of Object.entries(loops)) {
    const panel = document.createElement("div");
    panel.className = "pid-loop-panel";
    panel.id = "pid_loop_" + loopName;

    // Header row: title + mode toggle
    const header = document.createElement("div");
    header.className = "pid-loop-header";

    const title = document.createElement("div");
    title.className = "pid-loop-title";
    title.textContent = loopName.replace(/_/g, " ");
    if (cfg.output_channel) {
      const outLabel = document.createElement("span");
      outLabel.className = "pid-output-channel-label";
      outLabel.textContent = cfg.output_channel.replace(/_/g, " ");
      title.appendChild(outLabel);
    }
    header.appendChild(title);

    const statusEls = { pv_channel: cfg.pv_channel };

    const btnGroup = document.createElement("div");
    btnGroup.className = "btn-group btn-group-sm";
    btnGroup.setAttribute("role", "group");

    const modes = ["auto", "manual"];
    const modeDisplayLabels = ["Auto", "Manual"];
    const modeRadios = {};

    modes.forEach((mode, i) => {
      const radioId = "pid_mode_" + loopName + "_" + mode;
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.className = "btn-check";
      radio.name = "pid_mode_" + loopName;
      radio.id = radioId;
      radio.value = mode;
      radio.autocomplete = "off";
      if (mode === cfg.mode) radio.checked = true;
      radio.addEventListener("change", function() {
        const manual = (this.value === "manual");
        outGroup.style.pointerEvents = manual ? "" : "none";
        outGroup.style.opacity = manual ? "" : "0.4";
        fetch('/pid/mode', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ loop: loopName, mode: this.value })
        });
      });
      const lbl = document.createElement("label");
      lbl.className = "btn btn-outline-secondary";
      lbl.setAttribute("for", radioId);
      lbl.textContent = modeDisplayLabels[i];
      btnGroup.appendChild(radio);
      btnGroup.appendChild(lbl);
      modeRadios[mode] = radio;
    });

    // Auto-tune button (same style as mode toggle)
    const tuneBtnGroup = document.createElement("div");
    tuneBtnGroup.className = "btn-group btn-group-sm";
    tuneBtnGroup.setAttribute("role", "group");
    const tuneBtn = document.createElement("button");
    tuneBtn.className = "btn btn-outline-secondary btn-sm";
    tuneBtn.textContent = "Tune";
    tuneBtnGroup.appendChild(tuneBtn);
    tuneBtn.addEventListener("click", function() {
      if (tuneBtn.classList.contains("tuning")) {
        fetch('/pid/autotune', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ loop: loopName, action: "cancel" })
        });
        tuneBtn.classList.remove("tuning");
        tuneBtn.textContent = "Tune";
      } else {
        fetch('/pid/autotune', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ loop: loopName, action: "start" })
        });
        tuneBtn.classList.add("tuning");
        tuneBtn.textContent = "Cancel";
      }
    });

    // Layout: title on left, mode toggle + tune on right
    header.appendChild(title);
    const rightGroup = document.createElement("div");
    rightGroup.style.display = "flex";
    rightGroup.style.alignItems = "center";
    rightGroup.style.gap = "6px";
    rightGroup.appendChild(btnGroup);
    rightGroup.appendChild(tuneBtnGroup);
    header.appendChild(rightGroup);
    panel.appendChild(header);

    // Setpoint input (text_group group)
    const spGroup = document.createElement("div");
    spGroup.className = "text_group group";

    const spLabel = document.createElement("label");
    spLabel.className = "slider_text";
    spLabel.textContent = "Setpoint" + (cfg.sp_units ? " (" + cfg.sp_units + ")" : "");
    spGroup.appendChild(spLabel);

    const spIndicator = document.createElement("span");
    spIndicator.className = "control-indicator";
    spGroup.appendChild(spIndicator);

    const spInput = document.createElement("input");
    spInput.type = "text";
    spInput.className = "text_input";
    spInput.value = cfg.setpoint;
    spInput.addEventListener("change", function() {
      const val = parseFloat(this.value);
      if (!isNaN(val)) {
        fetch('/pid/setpoint', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ loop: loopName, setpoint: val })
        });
      }
    });
    spGroup.appendChild(spInput);

    // PV and Err readouts to the right of setpoint input
    const pvErrLine = document.createElement("span");
    pvErrLine.className = "pid-status-line";

    for (const [field, label] of [["pv", "PV"], ["error", "Err"]]) {
      const lbl = document.createElement("span");
      lbl.className = "pid-status-label";
      lbl.textContent = label;

      const val = document.createElement("span");
      val.className = "pid-status-value";
      val.id = "pid_" + loopName + "_" + field;
      val.textContent = "--";

      pvErrLine.appendChild(lbl);
      pvErrLine.appendChild(val);
      statusEls[field] = val;
    }

    if (cfg.sp_units) {
      const unitsSpan = document.createElement("span");
      unitsSpan.className = "pid-status-units";
      unitsSpan.textContent = cfg.sp_units;
      pvErrLine.appendChild(unitsSpan);
    }

    spGroup.appendChild(pvErrLine);

    // Settled dot — last in row so it sits at the far right
    const settledDot = document.createElement("span");
    settledDot.className = "step-settled-dot";
    settledDot.style.display = "none";
    spGroup.appendChild(settledDot);

    panel.appendChild(spGroup);

    // Manual output slider (slider_group group)
    const outGroup = document.createElement("div");
    outGroup.className = "slider_group group";

    const outLabel = document.createElement("label");
    outLabel.className = "slider_text";
    outLabel.textContent = "Output (%)";
    outGroup.appendChild(outLabel);

    const outIndicator = document.createElement("span");
    outIndicator.className = "control-indicator";
    outGroup.appendChild(outIndicator);

    const outValueSpan = document.createElement("span");
    outValueSpan.className = "indicator_value";
    outValueSpan.textContent = "--";
    outGroup.appendChild(outValueSpan);

    const outSliderWrap = document.createElement("div");
    outSliderWrap.className = "slider_wrapper";
    outGroup.appendChild(outSliderWrap);

    panel.appendChild(outGroup);

    const outMin = cfg.out_min || 0;
    const outMax = cfg.out_max || 100;
    let outSliderSending = false;

    const outSlider = new Slider(outSliderWrap, function(p) {
      const value = outMin + p * (outMax - outMin);
      outValueSpan.textContent = value.toFixed(1);
      if (!outSliderSending) return;
      fetch('/pid/manual_output', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ loop: loopName, output: value })
      });
    }, "", 0, false);
    outSliderSending = true;

    // Disable slider in auto mode
    if (cfg.mode !== "manual") {
      outGroup.style.pointerEvents = "none";
      outGroup.style.opacity = "0.4";
    }

    container.appendChild(panel);

    // Gains + autotune status line
    const gainsLine = document.createElement("div");
    gainsLine.className = "pid-gains-line";
    gainsLine.style.fontSize = "0.75em";
    gainsLine.style.opacity = "0.6";
    gainsLine.style.padding = "2px 8px";
    panel.appendChild(gainsLine);

    pidControls[loopName] = {
      statusEls, spInput, spIndicator, modeRadios,
      outSlider, outValueSpan, outIndicator, outMin, outMax, outGroup,
      settledDot, tuneBtn, gainsLine
    };
  }
}

// ---------------------------------------------------------------------------
// Indicator dot helper
// ---------------------------------------------------------------------------

function setIndicatorDot(el, match) {
  if (!el) return;
  el.innerHTML = '<span class="indicator-dot ' + (match ? "match" : "mismatch") + '"></span>';
}

// ---------------------------------------------------------------------------
// PID status update (called every poll from dashboard.js)
// ---------------------------------------------------------------------------

function updatePIDStatus(pidStatus) {
  if (!pidStatus) return;
  for (const [loopName, status] of Object.entries(pidStatus)) {
    const ctrl = pidControls[loopName];
    if (!ctrl) continue;

    // Update numeric displays (pv, setpoint, error)
    for (const field of ["pv", "setpoint", "error"]) {
      const el = ctrl.statusEls[field];
      if (el && status[field] != null) {
        el.textContent = parseFloat(status[field]).toFixed(1);
      }
    }

    // Sync mode radio from server (setting .checked doesn't fire change event)
    if (ctrl.modeRadios && ctrl.modeRadios[status.mode]) {
      ctrl.modeRadios[status.mode].checked = true;
    }

    // Sync setpoint input (only if not focused) + indicator dot
    if (document.activeElement !== ctrl.spInput) {
      ctrl.spInput.value = parseFloat(status.setpoint).toFixed(1);
    }
    const spLocal = parseFloat(ctrl.spInput.value);
    const spServer = parseFloat(status.setpoint);
    setIndicatorDot(ctrl.spIndicator, Math.abs(spLocal - spServer) < 0.05);

    // Sync output slider + enable/disable + indicator dot
    if (ctrl.outSlider && status.output != null) {
      const manual = (status.mode === "manual");
      ctrl.outGroup.style.pointerEvents = manual ? "" : "none";
      ctrl.outGroup.style.opacity = manual ? "" : "0.4";
      ctrl.outValueSpan.textContent = parseFloat(status.output).toFixed(1);
      const range = ctrl.outMax - ctrl.outMin;
      if (range > 0) {
        ctrl.outSlider.set_value((status.output - ctrl.outMin) / range);
      }
      setIndicatorDot(ctrl.outIndicator, true);
    }

    // Auto-tune status + gains display
    if (ctrl.gainsLine) {
      const at = status.autotune;
      if (at) {
        ctrl.gainsLine.textContent = `Tuning: ${at.oscillations}/${at.needed} oscillations`;
        ctrl.gainsLine.style.opacity = "1";
        ctrl.gainsLine.style.color = "#f0ad4e";
        if (!ctrl.tuneBtn.classList.contains("tuning")) {
          ctrl.tuneBtn.classList.add("tuning");
          ctrl.tuneBtn.textContent = "Cancel";
        }
      } else {
        const kp = status.kp != null ? status.kp.toFixed(4) : "--";
        const ki = status.ki != null ? status.ki.toFixed(4) : "--";
        const kd = status.kd != null ? status.kd.toFixed(4) : "--";
        ctrl.gainsLine.textContent = `Kp=${kp}  Ki=${ki}  Kd=${kd}`;
        ctrl.gainsLine.style.opacity = "0.6";
        ctrl.gainsLine.style.color = "";
        if (ctrl.tuneBtn.classList.contains("tuning")) {
          ctrl.tuneBtn.classList.remove("tuning");
          ctrl.tuneBtn.textContent = "Tune";
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Output channel controls (non-PID outputs in Controls panel)
// ---------------------------------------------------------------------------

function buildOutputChannelControls(cfg) {
  const controlsDiv = document.getElementById("output_controls_container");
  if (!controlsDiv) return;

  // Collect output channels that are driven by a PID loop
  const pidOutputs = new Set();
  for (const loop of Object.values(cfg.control_loops || {})) {
    pidOutputs.add(loop.output_channel);
  }

  const channels = cfg.output_channels || {};
  if (Object.keys(channels).length === 0) return;

  const outputGroup = document.createElement("div");
  outputGroup.className = "output-controls-panel";
  controlsDiv.appendChild(outputGroup);

  for (const [chName, chCfg] of Object.entries(channels)) {
    if (pidOutputs.has(chName)) continue;

    const chMin = chCfg.min || 0;
    const chMax = chCfg.max || 100;
    const units = chCfg.units || "";
    const options = chCfg.control_options || null;

    if (options && options.length > 1) {
      // Selector control — uses seg_group wrapper (same as makeControlPanel segments)
      const row = document.createElement("div");
      row.className = "output-control-row";

      const wrapper = document.createElement("div");
      wrapper.className = "seg_group group";

      const label = document.createElement("label");
      label.className = "slider_text";
      label.textContent = chName.replace(/_/g, " ");
      wrapper.appendChild(label);

      const indicator = document.createElement("span");
      indicator.className = "control-indicator";
      wrapper.appendChild(indicator);

      row.appendChild(wrapper);

      const settledDotSel = document.createElement("span");
      settledDotSel.className = "step-settled-dot";
      settledDotSel.style.display = "none";
      row.appendChild(settledDotSel);

      outputGroup.appendChild(row);

      const entry = { type: "selector", seg: null, indicator, options, min: chMin, max: chMax, lastInteraction: 0, syncing: false, settledDot: settledDotSel };
      let segSending = false;

      const seg = new SegmentedControl(wrapper, function(selectedIndex) {
        if (!segSending || entry.syncing) return;
        entry.lastInteraction = Date.now();
        fetch('/output/set', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ channel: chName, value: selectedIndex })
        });
      }, options, 0);
      segSending = true;
      entry.seg = seg;

      outputSliders[chName] = entry;
    } else {
      // Slider control — uses slider_group wrapper (same as makeControlPanel sliders)
      const row = document.createElement("div");
      row.className = "output-control-row";

      const wrapper = document.createElement("div");
      wrapper.className = "slider_group group";

      const label = document.createElement("label");
      label.className = "slider_text";
      label.textContent = chName.replace(/_/g, " ") + (units ? " (" + units + ")" : "");
      wrapper.appendChild(label);

      const indicator = document.createElement("span");
      indicator.className = "control-indicator";
      wrapper.appendChild(indicator);

      const valueSpan = document.createElement("span");
      valueSpan.className = "indicator_value";
      wrapper.appendChild(valueSpan);

      const sliderContainer = document.createElement("div");
      sliderContainer.className = "slider_wrapper";
      wrapper.appendChild(sliderContainer);

      row.appendChild(wrapper);

      const settledDotSlider = document.createElement("span");
      settledDotSlider.className = "step-settled-dot";
      settledDotSlider.style.display = "none";
      row.appendChild(settledDotSlider);

      outputGroup.appendChild(row);

      let sliderSending = false;
      const slider = new Slider(sliderContainer, function(p) {
        const value = chMin + p * (chMax - chMin);
        valueSpan.textContent = value.toFixed(1);
        if (!sliderSending) return;
        fetch('/output/set', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ channel: chName, value: value })
        });
      }, "", 0, false);
      sliderSending = true;

      outputSliders[chName] = { type: "slider", slider, indicator, valueSpan, min: chMin, max: chMax, settledDot: settledDotSlider };
    }
  }
}

// ---------------------------------------------------------------------------
// Initialize system settings from config
// ---------------------------------------------------------------------------

function initSettingsFromConfig(cfg) {
  const settings = cfg.settings || {};
  const mapping = {
    "CSV Log File": "file_name",
    "Sample Frequency (Hz)": "sample_frequency_hz",
    "Log Subsample": "log_subsample",
  };
  for (const [settingKey, controlKey] of Object.entries(mapping)) {
    if (settings[settingKey] != null) {
      const el = document.getElementById("controls_" + controlKey);
      if (el) {
        el.value = settings[settingKey];
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Sync output sliders from server sensor data (called every poll)
// ---------------------------------------------------------------------------

function updateOutputSliders(sensors) {
  if (!sensors) return;
  for (const [chName, ctrl] of Object.entries(outputSliders)) {
    const value = sensors[chName];
    if (value == null) continue;

    if (ctrl.type === "selector") {
      // Skip sync briefly after user interaction to avoid reverting
      if (Date.now() - (ctrl.lastInteraction || 0) < 1500) {
        setIndicatorDot(ctrl.indicator, false);
        continue;
      }
      const idx = Math.round(parseFloat(value));
      if (ctrl.seg && typeof ctrl.seg.set_selection === "function") {
        ctrl.syncing = true;
        ctrl.seg.set_selection(idx);
        ctrl.syncing = false;
      }
      setIndicatorDot(ctrl.indicator, true);
    } else {
      const localVal = parseFloat(ctrl.valueSpan.textContent);
      const serverVal = parseFloat(value);
      ctrl.valueSpan.textContent = serverVal.toFixed(1);
      const range = ctrl.max - ctrl.min;
      if (range > 0) {
        ctrl.slider.set_value((value - ctrl.min) / range);
      }
      setIndicatorDot(ctrl.indicator, Math.abs(localVal - serverVal) < 0.05 || isNaN(localVal));
    }
  }
}

// ---------------------------------------------------------------------------
// Interlocks
// ---------------------------------------------------------------------------

function buildInterlockList() {
  const container = document.getElementById("interlocks_container");
  if (!container || interlocksDefs.length === 0) {
    if (container) container.innerHTML = '<div class="interlock-clear">No interlocks configured</div>';
    return;
  }

  // Build static list of interlock names with status placeholders.
  // Group interlocks with matching group names visually.
  container.innerHTML = "";
  const groups = {};
  const ungrouped = [];
  interlocksDefs.forEach(il => {
    const g = il.group || "";
    if (g) {
      if (!groups[g]) groups[g] = [];
      groups[g].push(il);
    } else {
      ungrouped.push(il);
    }
  });

  function addRow(il, parent) {
    const row = document.createElement("div");
    row.className = "interlock-row";
    row.id = "interlock_" + il.name;

    const name = document.createElement("span");
    name.className = "interlock-name";
    let label = il.name.replace(/_/g, " ");
    if (il.latch) label += " [latch]";
    name.textContent = label;

    const cond = document.createElement("span");
    cond.className = "interlock-condition";
    cond.id = "interlock_cond_" + il.name;
    cond.textContent = il.channel + " " + il.condition + " " + il.threshold;

    const status = document.createElement("span");
    status.className = "interlock-status interlock-clear";
    status.textContent = "OK";
    status.id = "interlock_status_" + il.name;

    // Reset button for latched interlocks (hidden until latched)
    if (il.latch) {
      const resetBtn = document.createElement("button");
      resetBtn.className = "interlock-reset-btn hidden";
      resetBtn.id = "interlock_reset_" + il.name;
      resetBtn.textContent = "Reset";
      resetBtn.addEventListener("click", () => {
        fetch("/interlock/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: il.name }),
        }).then(r => r.json()).then(data => {
          if (data.status === "error") {
            const el = document.getElementById("interlock_status_" + il.name);
            if (el) {
              el.innerHTML = '\u26A0 <span class="interlock-warning-box">ACTIVE</span>';
            }
          }
        }).catch(() => {});
      });
      row.appendChild(name);
      row.appendChild(cond);
      row.appendChild(status);
      row.appendChild(resetBtn);
    } else {
      row.appendChild(name);
      row.appendChild(cond);
      row.appendChild(status);
    }
    parent.appendChild(row);
  }

  // Render grouped interlocks with a label
  Object.keys(groups).forEach(g => {
    const wrapper = document.createElement("div");
    wrapper.className = "interlock-group";
    const label = document.createElement("div");
    label.className = "interlock-group-label";
    label.textContent = g.replace(/_/g, " ") + " (all must be true)";
    wrapper.appendChild(label);
    groups[g].forEach(il => addRow(il, wrapper));
    container.appendChild(wrapper);
  });

  // Render ungrouped interlocks
  ungrouped.forEach(il => addRow(il, container));
  interlocksBuilt = true;
}

function updateInterlockStatus(trippedList, sensors, latchedList) {
  if (!interlocksBuilt) return;
  const trippedSet = new Set(trippedList || []);
  const latchedSet = new Set(latchedList || []);
  let anyTripped = false;

  interlocksDefs.forEach(il => {
    const el = document.getElementById("interlock_status_" + il.name);
    const condEl = document.getElementById("interlock_cond_" + il.name);
    const row = document.getElementById("interlock_" + il.name);
    const resetBtn = document.getElementById("interlock_reset_" + il.name);
    if (!el) return;

    // Update condition text with actual sensor value
    if (condEl && sensors) {
      const val = sensors[il.channel];
      const valStr = (val != null) ? parseFloat(val).toFixed(1) : "?";
      condEl.textContent = valStr + " " + il.condition + " " + il.threshold;
    }

    const isLatched = latchedSet.has(il.name);

    if (trippedSet.has(il.name)) {
      if (isLatched) {
        el.innerHTML = '\u26A0 <span class="interlock-warning-box">LATCHED</span>';
      } else {
        el.innerHTML = '\u26A0 <span class="interlock-warning-box">WARNING</span>';
      }
      el.className = "interlock-status interlock-tripped";
      if (row) row.classList.add("tripped");
      if (resetBtn) resetBtn.classList.toggle("hidden", !isLatched);
      anyTripped = true;
    } else {
      el.textContent = "OK";
      el.className = "interlock-status interlock-clear";
      if (row) row.classList.remove("tripped");
      if (resetBtn) resetBtn.classList.add("hidden");
    }
  });

  const panel = document.querySelector('[data-panel-id="interlocks"]');
  if (panel) panel.classList.toggle("interlock-alarm", anyTripped);
  document.body.classList.toggle("interlock-alarm", anyTripped);

  // Beep alarm: start on rising edge, stop when cleared
  if (anyTripped && !interlocksWereTripped) {
    _startInterlockAlarm();
  } else if (!anyTripped && interlocksWereTripped) {
    _stopInterlockAlarm();
  }
  interlocksWereTripped = anyTripped;
}

// ---------------------------------------------------------------------------
// Step Series controls
// ---------------------------------------------------------------------------

let stepSeriesUI = null;
let stepSeriesLastAction = 0;  // timestamp of last user click — suppress poll sync briefly

function buildStepSeriesControls(cfg) {
  const steps = cfg.step_series || [];
  const columns = cfg.step_columns || [];
  if (steps.length === 0) return;

  const container = document.getElementById("step_series_container");
  if (!container) return;

  // === Header: Step indicator + Auto/Manual toggle ===
  const header = document.createElement("div");
  header.className = "step-series-header";

  const stepIndicator = document.createElement("span");
  stepIndicator.className = "step-series-indicator";
  stepIndicator.id = "step_indicator";
  stepIndicator.textContent = "Step 1 / " + steps.length;
  header.appendChild(stepIndicator);

  const btnGroup = document.createElement("div");
  btnGroup.className = "btn-group btn-group-sm";
  btnGroup.setAttribute("role", "group");
  header.appendChild(btnGroup);

  const modeRadios = {};
  ["auto", "manual"].forEach(function(mode, i) {
    const radioId = "step_series_mode_" + mode;
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.className = "btn-check";
    radio.name = "step_series_mode";
    radio.id = radioId;
    radio.value = mode;
    radio.autocomplete = "off";
    if (mode === "auto") radio.checked = true;
    radio.addEventListener("change", function() {
      stepSeriesLastAction = Date.now();
      fetch('/step_series/mode', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ mode: this.value })
      });
    });
    const lbl = document.createElement("label");
    lbl.className = "btn btn-outline-secondary";
    lbl.setAttribute("for", radioId);
    lbl.textContent = ["Auto", "Manual"][i];
    btnGroup.appendChild(radio);
    btnGroup.appendChild(lbl);
    modeRadios[mode] = radio;
  });

  container.appendChild(header);

  // === Transport controls: Prev | Play/Pause | Next ===
  const svgRestart = '<svg width="14" height="14" viewBox="0 0 14 14"><rect x="0.5" y="2" width="2" height="10" fill="currentColor"/><polygon points="8,2 3,7 8,12" fill="currentColor"/><polygon points="13,2 8,7 13,12" fill="currentColor"/></svg>';
  const svgPrev = '<svg width="14" height="14" viewBox="0 0 14 14"><rect x="1" y="2" width="2.5" height="10" fill="currentColor"/><polygon points="13,2 5,7 13,12" fill="currentColor"/></svg>';
  const svgPlay = '<svg width="14" height="14" viewBox="0 0 14 14"><polygon points="3,1 13,7 3,13" fill="currentColor"/></svg>';
  const svgPause = '<svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="1.5" width="3.5" height="11" rx="0.5" fill="currentColor"/><rect x="8.5" y="1.5" width="3.5" height="11" rx="0.5" fill="currentColor"/></svg>';
  const svgNext = '<svg width="14" height="14" viewBox="0 0 14 14"><polygon points="1,2 9,7 1,12" fill="currentColor"/><rect x="10.5" y="2" width="2.5" height="10" fill="currentColor"/></svg>';

  const transport = document.createElement("div");
  transport.className = "step-series-transport btn-group btn-group-sm";
  transport.setAttribute("role", "group");

  const restartBtn = document.createElement("button");
  restartBtn.className = "btn btn-outline-secondary step-transport-btn";
  restartBtn.innerHTML = svgRestart;
  restartBtn.title = "Restart sequence";
  restartBtn.addEventListener("click", function() {
    stepSeriesLastAction = Date.now();
    fetch('/step_series/goto', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ step: 0 })
    });
  });

  const prevBtn = document.createElement("button");
  prevBtn.className = "btn btn-outline-secondary step-transport-btn";
  prevBtn.innerHTML = svgPrev;
  prevBtn.title = "Previous step";
  prevBtn.addEventListener("click", function() {
    stepSeriesLastAction = Date.now();
    fetch('/step_series/prev', { method: 'POST' });
  });

  const playPauseBtn = document.createElement("button");
  playPauseBtn.className = "btn btn-outline-secondary step-transport-btn step-play-pause";
  playPauseBtn.id = "step_play_pause";
  playPauseBtn.innerHTML = svgPlay;
  playPauseBtn.title = "Play / Pause";
  playPauseBtn.addEventListener("click", function() {
    stepSeriesLastAction = Date.now();
    // Send explicit desired state (idempotent — no toggle race)
    const wantRunning = !this.classList.contains("playing");
    this.innerHTML = wantRunning ? svgPause : svgPlay;
    this.classList.toggle("playing", wantRunning);
    fetch('/step_series/play_pause', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ running: wantRunning })
    });
  });

  const nextBtn = document.createElement("button");
  nextBtn.className = "btn btn-outline-secondary step-transport-btn";
  nextBtn.innerHTML = svgNext;
  nextBtn.title = "Next step";
  nextBtn.addEventListener("click", function() {
    stepSeriesLastAction = Date.now();
    fetch('/step_series/next', { method: 'POST' });
  });

  transport.appendChild(restartBtn);
  transport.appendChild(prevBtn);
  transport.appendChild(playPauseBtn);
  transport.appendChild(nextBtn);
  container.appendChild(transport);

  // === Hold timer progress ===
  const timerRow = document.createElement("div");
  timerRow.className = "step-series-timer";

  const timerLabel = document.createElement("span");
  timerLabel.className = "step-series-timer-label";
  timerLabel.textContent = "Hold:";
  timerRow.appendChild(timerLabel);

  const timerBar = document.createElement("div");
  timerBar.className = "step-series-progress-track";
  const timerFill = document.createElement("div");
  timerFill.className = "step-series-progress-fill";
  timerFill.id = "step_timer_fill";
  timerBar.appendChild(timerFill);
  timerRow.appendChild(timerBar);

  const timerText = document.createElement("span");
  timerText.className = "step-series-timer-text";
  timerText.id = "step_timer_text";
  timerText.textContent = "0.0 / 0.0 s";
  timerRow.appendChild(timerText);

  container.appendChild(timerRow);

  // === Watch-only channel rows (no actuation, just target + settled dot) ===
  const watchRows = {};
  columns.forEach(function(col) {
    if (col.type !== "watch") return;
    const row = document.createElement("div");
    row.className = "output-control-row watch-channel-row";

    const label = document.createElement("label");
    label.className = "slider_text";
    label.textContent = col.channel_name.replace(/_/g, " ");
    row.appendChild(label);

    const targetSpan = document.createElement("span");
    targetSpan.className = "pid-status-value watch-target-value";
    row.appendChild(targetSpan);

    const dot = document.createElement("span");
    dot.className = "step-settled-dot";
    dot.style.display = "none";
    row.appendChild(dot);

    container.appendChild(row);
    watchRows[col.header] = { row: row, targetSpan: targetSpan, settledDot: dot, col: col };
  });

  // Store references for polling updates
  stepSeriesUI = {
    indicator: stepIndicator,
    modeRadios: modeRadios,
    playPauseBtn: playPauseBtn,
    timerLabel: timerLabel,
    timerFill: timerFill,
    timerText: timerText,
    steps: steps,
    columns: columns,
    watchRows: watchRows,
  };
}

function updateStepSeriesStatus(status) {
  if (!stepSeriesUI || !status || Object.keys(status).length === 0) return;

  const ui = stepSeriesUI;
  const cooldown = (Date.now() - stepSeriesLastAction) < 1500;

  // Update step indicator
  var stepLabel = "Step " + (status.current_step + 1) + " / " + status.total_steps;
  if (status.step_name) stepLabel += "  —  " + status.step_name;
  ui.indicator.textContent = stepLabel;

  // Update per-control settled indicator dots + dimming
  var settledCols = status.settled_cols || {};
  const autoMode = (status.mode === "auto");

  // PID loops
  for (const loopName in pidControls) {
    const ctrl = pidControls[loopName];
    const col = ui.columns.find(function(c) { return c.pv_channel === ctrl.statusEls.pv_channel; });
    const inSeries = !!col;
    // Show/hide settled dot (green = within tolerance, red = not yet)
    if (ctrl.settledDot) {
      if (autoMode && inSeries) {
        var ok = (col.header in settledCols) ? (settledCols[col.header] === true) : true;
        ctrl.settledDot.style.display = "";
        ctrl.settledDot.innerHTML = '<span class="indicator-dot ' + (ok ? "settled" : "unsettled") + '"></span>';
      } else {
        ctrl.settledDot.style.display = "none";
      }
    }
    // Dim setpoint input only when auto mode is actively running
    const lockSp = autoMode && inSeries && status.running;
    ctrl.spInput.disabled = lockSp;
    ctrl.spInput.style.opacity = lockSp ? "0.5" : "";
  }

  // Output channels
  for (const chName in outputSliders) {
    const ctrl = outputSliders[chName];
    const col = ui.columns.find(function(c) { return c.channel_name === chName; });
    const inSeries = !!col;
    // Show/hide settled dot (green = within tolerance, red = not yet)
    if (ctrl.settledDot) {
      if (autoMode && inSeries) {
        var ok2 = (col.header in settledCols) ? (settledCols[col.header] === true) : true;
        ctrl.settledDot.style.display = "";
        ctrl.settledDot.innerHTML = '<span class="indicator-dot ' + (ok2 ? "settled" : "unsettled") + '"></span>';
      } else {
        ctrl.settledDot.style.display = "none";
      }
    }
    // Dim in auto mode
    if (inSeries) {
      if (ctrl.type === "slider" && ctrl.slider) {
        const wrapper = ctrl.slider.container ? ctrl.slider.container.parentElement : null;
        if (wrapper) {
          wrapper.style.pointerEvents = autoMode ? "none" : "";
          wrapper.style.opacity = autoMode ? "0.5" : "";
        }
      } else if (ctrl.type === "selector" && ctrl.seg) {
        const wrapper = ctrl.seg.container ? ctrl.seg.container.parentElement : null;
        if (wrapper) {
          wrapper.style.pointerEvents = autoMode ? "none" : "";
          wrapper.style.opacity = autoMode ? "0.5" : "";
        }
      }
    }
  }

  // Watch-only channels
  const watchRows = ui.watchRows || {};
  const currentStep = (ui.steps && status.current_step < ui.steps.length) ? ui.steps[status.current_step] : null;
  for (const header in watchRows) {
    const w = watchRows[header];
    if (autoMode && currentStep) {
      const sp = currentStep.setpoints[header];
      w.targetSpan.textContent = sp ? sp.value : "—";
      w.row.style.display = "";
      if (w.settledDot) {
        var okW = (header in settledCols) ? (settledCols[header] === true) : true;
        w.settledDot.style.display = "";
        w.settledDot.innerHTML = '<span class="indicator-dot ' + (okW ? "settled" : "unsettled") + '"></span>';
      }
    } else {
      w.row.style.display = "none";
    }
  }

  if (!cooldown) {
    // Sync mode toggle from server (setting .checked doesn't fire change event)
    if (ui.modeRadios && ui.modeRadios[status.mode]) {
      ui.modeRadios[status.mode].checked = true;
    }

    // Update play/pause button only when state actually changes
    // (replacing innerHTML every poll kills in-flight click events)
    const isPlaying = ui.playPauseBtn.classList.contains("playing");
    if (status.running !== isPlaying) {
      const svgPlayIcon = '<svg width="14" height="14" viewBox="0 0 14 14"><polygon points="3,1 13,7 3,13" fill="currentColor"/></svg>';
      const svgPauseIcon = '<svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="1.5" width="3.5" height="11" rx="0.5" fill="currentColor"/><rect x="8.5" y="1.5" width="3.5" height="11" rx="0.5" fill="currentColor"/></svg>';
      ui.playPauseBtn.innerHTML = status.running ? svgPauseIcon : svgPlayIcon;
      ui.playPauseBtn.classList.toggle("playing", status.running);
    }
  }

  // Chime on hold transitions
  const settled = status.settled;
  if (status.running) {
    if (settled && _prevStepSettled === false) {
      _playChime("hold_start");
    }
    if (_prevStepIndex !== null && status.current_step !== _prevStepIndex) {
      _playChime("hold_end");
    }
  }
  // Last step finished: was running, now stopped, on final step
  if (_prevStepRunning === true && !status.running &&
      status.current_step === status.total_steps - 1) {
    _playChime("hold_end");
  }
  _prevStepSettled = settled;
  _prevStepIndex = status.current_step;
  _prevStepRunning = status.running;

  // Update timer — show settling state
  const elapsed = status.hold_elapsed || 0;
  const total = status.hold_total || 0;
  if (status.running && !settled) {
    ui.timerLabel.textContent = "Settling...";
    ui.timerText.textContent = "0.0 / " + total.toFixed(1) + " s";
    ui.timerFill.style.width = "0%";
    ui.timerFill.classList.add("settling");
  } else {
    ui.timerLabel.textContent = "Hold:";
    ui.timerText.textContent = elapsed.toFixed(1) + " / " + total.toFixed(1) + " s";
    const pct = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0;
    ui.timerFill.style.width = pct + "%";
    ui.timerFill.classList.remove("settling");
  }

}

// ---------------------------------------------------------------------------
// Driver Status panel
// ---------------------------------------------------------------------------

let driverStatusDefs = {};  // instrument_name -> {type, address}
let driverStatusBuilt = false;

var _driverIdMap = {};  // original name -> unique safe DOM id
function _driverDomId(name) {
  if (_driverIdMap[name]) return _driverIdMap[name];
  let base = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  let safe = base;
  let n = 2;
  const used = new Set(Object.values(_driverIdMap));
  while (used.has(safe)) { safe = base + "_" + n; n++; }
  _driverIdMap[name] = safe;
  return safe;
}

function buildDriverStatusPanel(instruments) {
  const container = document.getElementById("driver_status_container");
  if (!container) return;
  driverStatusDefs = instruments;
  const names = Object.keys(instruments);
  if (names.length === 0) {
    container.innerHTML = '<div class="driver-status-empty">No instruments configured</div>';
    return;
  }
  container.innerHTML = "";
  names.forEach(name => {
    const inst = instruments[name];
    const safeId = _driverDomId(name);
    const row = document.createElement("div");
    row.className = "driver-status-row";
    row.id = "driver_status_" + safeId;

    const nameEl = document.createElement("span");
    nameEl.className = "driver-status-name";
    nameEl.textContent = name;

    const typeEl = document.createElement("span");
    typeEl.className = "driver-status-type";
    typeEl.textContent = inst.type;

    const indicator = document.createElement("span");
    indicator.className = "driver-status-indicator driver-status-ok";
    indicator.id = "driver_indicator_" + safeId;
    indicator.textContent = "OK";

    const detail = document.createElement("span");
    detail.className = "driver-status-detail";
    detail.id = "driver_detail_" + safeId;
    detail.textContent = "";

    row.appendChild(nameEl);
    row.appendChild(typeEl);
    row.appendChild(indicator);
    row.appendChild(detail);
    container.appendChild(row);
  });
  driverStatusBuilt = true;
}

function updateDriverStatus(statusMap) {
  if (!driverStatusBuilt || !statusMap) return;
  Object.keys(driverStatusDefs).forEach(name => {
    const s = statusMap[name];
    const safeId = _driverDomId(name);
    const indicator = document.getElementById("driver_indicator_" + safeId);
    const detail = document.getElementById("driver_detail_" + safeId);
    const row = document.getElementById("driver_status_" + safeId);
    if (!indicator) return;

    const status = s ? s.status : "ok";
    // Update indicator text and class
    indicator.className = "driver-status-indicator";
    if (status === "ok") {
      indicator.textContent = "OK";
      indicator.classList.add("driver-status-ok");
      if (row) row.classList.remove("driver-row-warn", "driver-row-error");
    } else if (status === "degraded") {
      indicator.textContent = "DEGRADED";
      indicator.classList.add("driver-status-degraded");
      if (row) { row.classList.add("driver-row-warn"); row.classList.remove("driver-row-error"); }
    } else if (status === "reconnecting") {
      indicator.textContent = "RECONNECTING";
      indicator.classList.add("driver-status-reconnecting");
      if (row) { row.classList.add("driver-row-warn"); row.classList.remove("driver-row-error"); }
    } else if (status === "disconnected") {
      indicator.textContent = "DISCONNECTED";
      indicator.classList.add("driver-status-disconnected");
      if (row) { row.classList.remove("driver-row-warn"); row.classList.add("driver-row-error"); }
    }

    // Detail text
    if (detail) {
      if (s && s.last_error) {
        detail.textContent = s.last_error;
        detail.title = s.last_error;
      } else if (s && s.reconnect_count > 0 && status === "ok") {
        detail.textContent = "reconnected (#" + s.reconnect_count + ")";
        detail.title = "";
      } else {
        detail.textContent = "";
        detail.title = "";
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------
loadExperimentConfig();
