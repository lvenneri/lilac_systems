"""Experiment engine: sampling loop, PID control, interlocks, data buffering."""

import collections
import csv
import json
import logging
import math
import os
import threading
import time

log = logging.getLogger(__name__)

from pid_controller import PIDController
from pid_autotune import StepResponseTuner
from driver_base import create_driver


class ExperimentEngine:
    def __init__(self, config):
        self.config = config
        self.drivers = {}           # instrument_name -> DriverBase
        self.pid_controllers = {}   # loop_name -> PIDController
        self.loop_configs = {}      # loop_name -> mutable config dict
        self.interlocks = []
        self.tripped_interlocks = set()
        self.latched_interlocks = set()  # latched interlocks stay tripped until manual reset

        # Shared data state
        self.latest_readings = {}
        self.latest_pid_status = {}
        buf_size = int(config.get("settings", {}).get("Data Buffer Size", 10000))
        self.sample_buffer = collections.deque(maxlen=buf_size)

        # Single lock protects all shared state (data, buffer, commands)
        self._lock = threading.Lock()

        # Control settings from frontend (file_name, append, etc.)
        settings = config.get("settings", {})
        self.control_settings = {
            "note": "",
            "file_name": str(settings.get("CSV Log File", "junk.csv")),
            "sample_frequency_hz": float(settings.get("Sample Frequency (Hz)", 10)),
            "log_subsample": int(settings.get("Log Subsample", 10)),
            "append": False,
        }

        # Points CSV state
        self.pts_fieldnames = None
        self._pts_first_write = True  # overwrite on first save each session

        # CSV state — persistent file handle
        self.file_initialized = False
        self.csv_fieldnames = None
        self._csv_file = None       # persistent file object
        self._csv_writer = None     # persistent DictWriter
        self._csv_filename = None   # tracks current filename for reopen

        # Pre-computed channel lists (populated in initialize())
        self._input_channels = []   # [(ch_name, driver, channel_id, slope, offset, inst_name)]
        self._output_channels = []  # [(ch_name, ch_cfg)]

        # Per-instrument poll rate limiting
        self._instrument_poll_rates = {}   # instrument_name -> min interval (seconds)
        self._last_instrument_read = {}    # instrument_name -> last read timestamp
        self._cached_readings = {}         # ch_name -> last known scaled value

        # Instrument health tracking for reconnection
        self._instrument_status = {}       # inst_name -> {status, consecutive_failures, last_error, ...}
        self._RECONNECT_THRESHOLD = 10     # consecutive all-NaN cycles before reconnect attempt
        self._RECONNECT_COOLDOWN = 30.0    # seconds between reconnect attempts

        # Step series state
        self.step_tests = config.get("step_tests", {})
        self.step_test_names = config.get("step_test_names", [])
        self.step_active_test = self.step_test_names[0] if self.step_test_names else ""
        self.step_series = config.get("step_series", [])
        self.step_columns = config.get("step_columns", [])
        self.step_current = 0
        self.step_mode = "auto"         # "auto" or "manual"
        self.step_running = False       # play/pause state (only meaningful in auto mode)
        self.step_settled = False       # True once all PVs within tolerance of setpoints
        self.step_settled_cols = {}     # {column_header: bool} per-column settled state
        self.step_hold_elapsed = 0.0
        self.step_hold_total = self.step_series[0]["hold_time"] if self.step_series else 0.0
        self._step_last_tick = None  # wall-clock time of last hold tick
        self.saved_points = []  # [{x, y, label}, ...] for scatter overlay

        self._running = False
        self._autotuners = {}  # loop_name -> RelayAutoTuner (active tuning sessions)

        # Thread-safe snapshots (written under _lock by sampling thread,
        # read under _lock by Flask thread in get_data_since)
        self._tripped_snapshot = set()
        self._latched_snapshot = set()
        self._step_snapshot = {
            "current_step": 0, "mode": "auto", "running": False,
            "settled": False, "settled_cols": {},
            "hold_elapsed": 0.0, "hold_total": 0.0,
            "active_test": self.step_active_test,
        }
        self._instrument_status_snapshot = {}

    # Backward-compat aliases so external code (app.py) using the old lock names still works
    @property
    def command_lock(self):
        return self._lock

    @property
    def data_lock(self):
        return self._lock

    @property
    def buffer_lock(self):
        return self._lock

    def initialize(self):
        """Create drivers and PID controllers from config."""
        for name, inst_cfg in self.config.get("instruments", {}).items():
            if inst_cfg.get("enabled", True):
                drv = create_driver(inst_cfg)
                initial_status = "ok"
                initial_error = ""
                try:
                    drv.connect()
                except Exception as exc:
                    log.error("Instrument '%s' failed to connect: %s", name, exc)
                    initial_status = "disconnected"
                    initial_error = str(exc)
                self.drivers[name] = drv
                # Store poll rate for per-instrument rate limiting
                poll_rate = inst_cfg.get("poll_rate", 0)
                if isinstance(poll_rate, (int, float)) and poll_rate > 0:
                    self._instrument_poll_rates[name] = poll_rate
                self._last_instrument_read[name] = 0.0  # force first read
                self._instrument_status[name] = {
                    "status": initial_status,
                    "type": inst_cfg.get("type", "simulated"),
                    "consecutive_failures": 0,
                    "last_error": initial_error,
                    "last_reconnect_attempt": 0.0,
                    "reconnect_count": 0,
                }

        for loop_name, loop_cfg in self.config.get("control_loops", {}).items():
            if loop_cfg.get("enabled", True):
                self.loop_configs[loop_name] = dict(loop_cfg)
                self.pid_controllers[loop_name] = PIDController(
                    kp=float(loop_cfg["kp"]),
                    ki=float(loop_cfg["ki"]),
                    kd=float(loop_cfg["kd"]),
                    setpoint=float(loop_cfg["setpoint"]),
                    out_min=float(loop_cfg["out_min"]),
                    out_max=float(loop_cfg["out_max"]),
                    sample_time=float(loop_cfg["sample_time"]),
                )

        self.interlocks = [
            il for il in self.config.get("interlocks", [])
            if il.get("enabled", True)
        ]

        # Validate channel IDs against connected hardware
        for ch_name, ch_cfg in self.config.get("channels", {}).items():
            if not ch_cfg.get("enabled", True):
                continue
            inst_name = ch_cfg.get("instrument", "")
            driver = self.drivers.get(inst_name)
            if driver and hasattr(driver, "validate_channel_id"):
                ok, msg = driver.validate_channel_id(ch_cfg["channel_id"])
                if not ok:
                    log.error("Channel '%s': %s", ch_name, msg)

        # Pre-compute channel lists for fast iteration in hot loop
        # Group channels by instrument for batch read support
        self._channels_by_instrument = {}  # instrument_name -> [(ch_name, channel_id, slope, offset)]
        for ch_name, ch_cfg in self.config.get("channels", {}).items():
            if not ch_cfg.get("enabled", True):
                continue
            if ch_cfg["direction"] == "input":
                inst_name = ch_cfg["instrument"]
                driver = self.drivers.get(inst_name)
                if driver is not None:
                    self._input_channels.append((
                        ch_name, driver, ch_cfg["channel_id"],
                        ch_cfg.get("slope", 1), ch_cfg.get("offset", 0),
                        inst_name,
                    ))
                    self._channels_by_instrument.setdefault(inst_name, []).append(
                        (ch_name, ch_cfg["channel_id"], ch_cfg.get("slope", 1), ch_cfg.get("offset", 0))
                    )
            elif ch_cfg["direction"] == "output":
                self._output_channels.append((ch_name, ch_cfg))

        # Apply first step setpoints since we start in auto mode
        if self.step_series and self.step_mode == "auto":
            self._apply_step_setpoints(self.step_series[0])

    # ------------------------------------------------------------------
    # Derived / computed quantities
    # ------------------------------------------------------------------

    def _compute_derived(self, flat_sensors):
        """Compute derived quantities from measured data.

        Add your custom calculations here. Each new key you add to
        flat_sensors will automatically appear in the live dashboard,
        CSV logs, and data buffer — no other changes needed.

        ``flat_sensors`` already contains all scaled input-channel
        readings, output-channel readbacks, and PID virtual channels
        (pid.<loop>.setpoint / pv / output / error).

        Examples
        --------
        # Power from voltage and current channels
        V = flat_sensors.get("Voltage")
        I = flat_sensors.get("Current")
        if V is not None and I is not None:
            flat_sensors["Power (W)"] = V * I
            flat_sensors["Resistance (Ohm)"] = V / I if I != 0 else float("nan")

        # Efficiency from two power measurements
        p_in = flat_sensors.get("Input Power")
        p_out = flat_sensors.get("Output Power")
        if p_in and p_out and p_in != 0:
            flat_sensors["Efficiency (%)"] = (p_out / p_in) * 100

        # Dew point estimate from temperature and humidity
        T = flat_sensors.get("Temperature")
        RH = flat_sensors.get("Humidity")
        if T is not None and RH is not None and RH > 0:
            a, b = 17.27, 237.7
            gamma = (a * T) / (b + T) + math.log(RH / 100.0)
            flat_sensors["Dew Point (C)"] = (b * gamma) / (a - gamma)
        """
        pass

    # ------------------------------------------------------------------
    # Channel I/O
    # ------------------------------------------------------------------

    def _read_all_channels(self):
        """Read all enabled input channels, apply slope/offset scaling.

        Respects per-instrument poll rates: if an instrument's poll_rate
        interval hasn't elapsed, returns cached values for its channels.
        Uses batch reads (read_channels) when the driver supports it.
        Tracks per-instrument health and attempts reconnection after
        consecutive failures.
        """
        now = time.time()
        readings = {}

        # Attempt reconnection for disconnected instruments before reading
        self._attempt_reconnections(now)

        # Determine which instruments are due for a read
        instruments_to_read = set()
        disconnected_instruments = set()
        for inst_name in self._channels_by_instrument:
            status = self._instrument_status.get(inst_name, {})
            if status.get("status") in ("disconnected", "reconnecting"):
                disconnected_instruments.add(inst_name)
                continue  # skip until reconnected
            min_interval = self._instrument_poll_rates.get(inst_name, 0)
            elapsed = now - self._last_instrument_read.get(inst_name, 0)
            if elapsed >= min_interval:
                instruments_to_read.add(inst_name)

        # Track which channels produced NaN per instrument this cycle
        inst_nan_counts = {}   # inst_name -> number of NaN readings
        inst_total_counts = {} # inst_name -> total channels read

        # Batch read for instruments that support it
        batch_read_done = set()  # instrument names handled by batch read
        for inst_name in instruments_to_read:
            driver = self.drivers.get(inst_name)
            if driver is None:
                continue
            ch_list = self._channels_by_instrument[inst_name]
            if hasattr(driver, "read_channels") and len(ch_list) > 1:
                channel_ids = [cid for _, cid, _, _ in ch_list]
                try:
                    raw_values = driver.read_channels(channel_ids)
                    nan_count = 0
                    for (ch_name, cid, slope, offset), raw in zip(ch_list, raw_values):
                        if math.isnan(raw):
                            nan_count += 1
                        val = raw * slope + offset
                        readings[ch_name] = val
                        self._cached_readings[ch_name] = val
                    self._last_instrument_read[inst_name] = now
                    batch_read_done.add(inst_name)
                    inst_nan_counts[inst_name] = nan_count
                    inst_total_counts[inst_name] = len(ch_list)
                except Exception:
                    log.warning("Batch read failed for %s, falling back to per-channel", inst_name, exc_info=True)

        # Per-channel reads for remaining instruments
        for ch_name, driver, channel_id, slope, offset, inst_name in self._input_channels:
            if ch_name in readings:
                continue  # already handled by batch read
            if inst_name in disconnected_instruments:
                # Disconnected — report NaN so plots/interlocks see the gap
                readings[ch_name] = float('nan')
                continue
            if inst_name not in instruments_to_read:
                # Not due yet — use cached value
                readings[ch_name] = self._cached_readings.get(ch_name, 0.0)
                continue
            try:
                raw = driver.read_channel(channel_id)
            except Exception:
                log.warning("read_channel failed for %s/%s", inst_name, channel_id, exc_info=True)
                raw = float('nan')
            if math.isnan(raw):
                inst_nan_counts[inst_name] = inst_nan_counts.get(inst_name, 0) + 1
            inst_total_counts[inst_name] = inst_total_counts.get(inst_name, 0) + 1
            val = raw * slope + offset
            readings[ch_name] = val
            self._cached_readings[ch_name] = val

        # Update last-read timestamps for instruments read via per-channel
        for inst_name in instruments_to_read - batch_read_done:
            self._last_instrument_read[inst_name] = now

        # Update instrument health based on NaN counts
        for inst_name in instruments_to_read:
            status = self._instrument_status.get(inst_name)
            if status is None:
                continue
            total = inst_total_counts.get(inst_name, 0)
            nans = inst_nan_counts.get(inst_name, 0)
            if total == 0:
                continue
            if nans == total:
                # All channels returned NaN — likely disconnected
                status["consecutive_failures"] += 1
                if status["consecutive_failures"] >= self._RECONNECT_THRESHOLD:
                    if status["status"] != "disconnected":
                        log.warning(
                            "Instrument '%s': %d consecutive all-NaN cycles, marking disconnected",
                            inst_name, status["consecutive_failures"],
                        )
                    status["status"] = "disconnected"
                    status["last_error"] = f"All {total} channels returned NaN"
                elif status["consecutive_failures"] >= 1:
                    status["status"] = "degraded"
            elif nans > 0:
                # Some channels NaN — degraded but not fully down
                status["status"] = "degraded"
                status["consecutive_failures"] = 0
            else:
                # All channels good
                if status["status"] in ("degraded", "reconnecting"):
                    log.info("Instrument '%s': recovered, all channels reading normally", inst_name)
                status["status"] = "ok"
                status["consecutive_failures"] = 0
                status["last_error"] = ""

        return readings

    def _attempt_reconnections(self, now):
        """Try to reconnect disconnected instruments (with cooldown)."""
        for inst_name, status in self._instrument_status.items():
            if status["status"] != "disconnected":
                continue
            elapsed = now - status["last_reconnect_attempt"]
            if elapsed < self._RECONNECT_COOLDOWN:
                continue
            status["last_reconnect_attempt"] = now
            status["status"] = "reconnecting"
            status["reconnect_count"] += 1
            driver = self.drivers.get(inst_name)
            if driver is None:
                continue
            log.info("Attempting reconnect for '%s' (attempt #%d)...", inst_name, status["reconnect_count"])
            try:
                driver.close()
                driver.connect()
                status["status"] = "ok"
                status["consecutive_failures"] = 0
                status["last_error"] = ""
                log.info("Reconnected '%s' successfully", inst_name)
            except Exception as exc:
                status["status"] = "disconnected"
                status["last_error"] = str(exc)
                log.warning("Reconnect failed for '%s': %s", inst_name, exc)

    def _write_channel(self, channel_name, value):
        """Write a value to an output channel (inverse scaling applied)."""
        channels = self.config.get("channels", {})
        ch_cfg = channels.get(channel_name)
        if ch_cfg is None or ch_cfg["direction"] != "output":
            return
        slope = ch_cfg.get("slope", 1)
        offset = ch_cfg.get("offset", 0)
        raw = (value - offset) / slope if slope != 0 else value
        driver = self.drivers.get(ch_cfg["instrument"])
        if driver:
            driver.write_channel(ch_cfg["channel_id"], raw)

    # ------------------------------------------------------------------
    # PID
    # ------------------------------------------------------------------

    def _run_pid_loops(self, readings):
        """Execute all enabled PID loops. Returns pid_status dict."""
        pid_status = {}
        for loop_name, pid in self.pid_controllers.items():
            cfg = self.loop_configs[loop_name]
            mode = cfg.get("mode", "manual")
            pv = readings.get(cfg["pv_channel"])
            if pv is None or (isinstance(pv, float) and math.isnan(pv)):
                continue

            pid.setpoint = float(cfg["setpoint"])

            # Check for active auto-tuner
            tuner = self._autotuners.get(loop_name)
            if tuner and not tuner.done:
                output = tuner.update(pv)
                self._write_channel(cfg["output_channel"], output)
                error = pid.setpoint - pv
                mode = "autotune"
                if tuner.done:
                    self._finish_autotune(loop_name, tuner)
            elif mode == "auto":
                output, error = pid.compute(pv)
                self._write_channel(cfg["output_channel"], output)
            else:
                # Manual mode: read last written output, compute error only
                output = self._read_output_value(cfg["output_channel"])
                error = pid.setpoint - pv

            # Auto-tune progress
            at_info = None
            at = self._autotuners.get(loop_name)
            if at and not at.done:
                at_info = {
                    "oscillations": at.oscillation_count,
                    "needed": at.oscillations_needed,
                }

            pid_status[loop_name] = {
                "setpoint": pid.setpoint,
                "pv": pv,
                "output": output,
                "error": error,
                "mode": mode,
                "sp_units": cfg.get("sp_units", ""),
                "pv_channel": cfg["pv_channel"],
                "output_channel": cfg["output_channel"],
                "kp": pid.kp,
                "ki": pid.ki,
                "kd": pid.kd,
                "autotune": at_info,
            }
        return pid_status

    def _read_output_value(self, channel_name):
        """Read back the current value of an output channel from the driver."""
        channels = self.config.get("channels", {})
        ch_cfg = channels.get(channel_name)
        if ch_cfg is None:
            return 0.0
        driver = self.drivers.get(ch_cfg["instrument"])
        if driver and hasattr(driver, '_outputs'):
            raw = driver._outputs.get(ch_cfg["channel_id"], 0.0)
            return raw * ch_cfg.get("slope", 1) + ch_cfg.get("offset", 0)
        return 0.0

    # ------------------------------------------------------------------
    # Interlocks
    # ------------------------------------------------------------------

    def _eval_condition(self, il, readings):
        """Evaluate a single interlock condition against current readings.

        Returns False for None or NaN values (indeterminate — cannot evaluate).
        NaN arises when a device is disconnected; comparisons with NaN are
        always False in Python, which would silently bypass the interlock.
        """
        ch_value = readings.get(il["channel"])
        if ch_value is None or (isinstance(ch_value, float) and math.isnan(ch_value)):
            return False
        threshold = float(il["threshold"])
        condition = il["condition"]
        if condition == ">" and ch_value > threshold:
            return True
        if condition == "<" and ch_value < threshold:
            return True
        if condition == ">=" and ch_value >= threshold:
            return True
        if condition == "<=" and ch_value <= threshold:
            return True
        return False

    def _check_interlocks(self, readings):
        # Group interlocks: all conditions in a group must be true to trip.
        # Ungrouped interlocks (group == "") are evaluated independently.
        groups = {}
        ungrouped = []
        for il in self.interlocks:
            g = il.get("group", "")
            if g:
                groups.setdefault(g, []).append(il)
            else:
                ungrouped.append(il)

        # Evaluate ungrouped interlocks individually
        for il in ungrouped:
            self._process_interlock(il, self._eval_condition(il, readings))

        # Evaluate grouped interlocks (AND logic)
        for group_name, members in groups.items():
            all_met = all(self._eval_condition(il, readings) for il in members)
            for il in members:
                self._process_interlock(il, all_met, group=group_name)

    def _process_interlock(self, il, condition_met, group=None):
        """Handle trip/clear logic for a single interlock, including latching and recovery."""
        name = il["name"]
        is_latched = il.get("latch", False)
        was_tripped = name in self.tripped_interlocks
        group_label = f" (group {group})" if group else ""

        if condition_met and not was_tripped:
            # Newly tripped
            self.tripped_interlocks.add(name)
            if is_latched:
                self.latched_interlocks.add(name)
            self._execute_interlock_actions(il)
            print(f"INTERLOCK TRIPPED{group_label}: {name} ({il['channel']} {il['condition']} {il['threshold']})")
        elif condition_met and was_tripped:
            # Still tripped — re-execute actions to enforce outputs
            # (e.g. keep heater off even if user tries to override)
            self._execute_interlock_actions(il)
        elif not condition_met and was_tripped:
            # Condition cleared — but latched interlocks stay tripped
            if name in self.latched_interlocks:
                # Keep enforcing safe-state actions until operator resets
                self._execute_interlock_actions(il)
            else:
                self.tripped_interlocks.discard(name)
                self._execute_interlock_recovery(il)
                print(f"INTERLOCK CLEARED{group_label}: {name}")

    def _execute_interlock_actions(self, il):
        """Execute all actions for a tripped interlock (compound action support)."""
        actions = il.get("actions", [])
        if not actions:
            # Fallback to legacy single-action fields
            actions = [{"action": il.get("action", "alarm"),
                        "target": il.get("target", ""),
                        "value": il.get("action_value")}]
        for act in actions:
            self._do_interlock_action(act["action"], act.get("target", ""), act.get("value"))

    def _execute_interlock_recovery(self, il):
        """Execute recovery actions when an interlock clears."""
        recovery = il.get("recovery", [])
        for act in recovery:
            self._do_interlock_action(act["action"], act.get("target", ""), act.get("value"))
            print(f"  RECOVERY: {act['action']} -> {act.get('target', '')} = {act.get('value', '')}")

    def _do_interlock_action(self, action, target, value):
        """Execute a single interlock action (shared by trip and recovery)."""
        if action == "set_output" and target:
            self._write_channel(target, float(value) if value is not None else 0)
        elif action == "disable_loop" and target in self.loop_configs:
            self.loop_configs[target]["mode"] = "manual"
            if target in self.pid_controllers:
                self.pid_controllers[target].reset()
        elif action == "enable_loop" and target in self.loop_configs:
            self.loop_configs[target]["mode"] = "auto"
        elif action == "alarm":
            pass  # logged to console above

    def reset_interlock(self, name):
        """Manually reset a latched interlock.

        If the trip condition is still active, the interlock will
        re-trip on the next engine cycle.  Recovery actions are only
        executed if the condition has actually cleared.
        """
        with self._lock:
            is_latched = name in self.latched_interlocks
            is_tripped = name in self.tripped_interlocks
            readings = dict(self.latest_readings)

        if is_latched:
            # Find the interlock definition
            il = None
            for _il in self.interlocks:
                if _il["name"] == name:
                    il = _il
                    break

            # Check whether the condition is still active
            condition_still_met = False
            if il:
                condition_still_met = self._eval_condition(il, readings)

            if condition_still_met:
                print(f"INTERLOCK RESET REJECTED: {name} (condition still active)")
                return {
                    "status": "error",
                    "message": f"Cannot reset '{name}' — condition is still active "
                               f"({il['channel']} {il['condition']} {il['threshold']})"
                }

            with self._lock:
                self.latched_interlocks.discard(name)
                self.tripped_interlocks.discard(name)
            if il:
                self._execute_interlock_recovery(il)
            print(f"INTERLOCK RESET (manual): {name}")
            return {"status": "ok", "message": f"Interlock '{name}' reset"}
        elif is_tripped:
            return {"status": "error", "message": f"Interlock '{name}' is not latched — it will clear automatically"}
        else:
            return {"status": "error", "message": f"Interlock '{name}' is not tripped"}

    # ------------------------------------------------------------------
    # CSV logging
    # ------------------------------------------------------------------

    def _open_csv(self, filename, append):
        """Open (or reopen) the CSV file and write the header if needed."""
        self._close_csv()
        self._csv_filename = filename
        file_exists = os.path.isfile(filename)
        mode = 'a' if append else 'w'
        self._csv_file = open(filename, mode, newline='')
        self._csv_writer = csv.DictWriter(
            self._csv_file, fieldnames=self.csv_fieldnames, extrasaction='ignore')
        if not append or not file_exists:
            self._csv_writer.writeheader()
            self._csv_file.flush()

    def _close_csv(self):
        """Close the persistent CSV file handle if open."""
        if self._csv_file is not None:
            try:
                self._csv_file.flush()
                self._csv_file.close()
            except Exception:
                pass
            self._csv_file = None
            self._csv_writer = None
            self._csv_filename = None

    def _get_step_info(self):
        """Return current step name and settled state for CSV columns."""
        if self.step_series and self.step_current < len(self.step_series):
            step = self.step_series[self.step_current]
            return step.get("name", ""), self.step_settled
        return "", False

    def _log_to_csv(self, flat_sensors, ctrl):
        filename = ctrl.get("file_name", "junk.csv")
        append = ctrl.get("append", False)

        now = time.time()
        local = time.localtime(now)
        ms = int((now % 1) * 1000)
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S", local) + f".{ms:03d}"

        step_name, settled = self._get_step_info()
        row = {"timestamp": timestamp, "Step Name": step_name, "Hold Stable": settled}
        row.update(flat_sensors)

        if self.csv_fieldnames is None:
            self.csv_fieldnames = list(row.keys())

        try:
            # (Re)open if needed: first write, filename changed, or file was closed
            if (self._csv_writer is None or
                    not self.file_initialized or
                    self._csv_filename != filename):
                self._open_csv(filename, append)
                self.file_initialized = True

            self._csv_writer.writerow(row)
            self._csv_file.flush()
        except Exception as e:
            print(f"CSV write error: {e}")
            self._close_csv()  # force reopen on next cycle

    def _save_config(self, ctrl):
        csv_filename = ctrl.get("file_name", "junk.csv")
        config_filename = os.path.splitext(csv_filename)[0] + "_config.json"
        try:
            with open(config_filename, 'w') as f:
                json.dump(ctrl, f, indent=2)
        except Exception:
            pass

    def save_point(self, label=None, readings=None):
        """Save the latest readings as a single row to a pts.csv file."""
        with self.command_lock:
            ctrl = dict(self.control_settings)
        if readings is not None:
            flat_sensors = dict(readings)
        else:
            with self.data_lock:
                flat_sensors = dict(self.latest_readings)

        csv_filename = ctrl.get("file_name", "junk.csv")
        pts_filename = os.path.splitext(csv_filename)[0] + "_pts.csv"

        now = time.time()
        local = time.localtime(now)
        ms = int((now % 1) * 1000)
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S", local) + f".{ms:03d}"

        # Determine label for scatter overlay
        if label is None:
            label = ctrl.get("note", "") or str(len(self.saved_points) + 1)

        step_name, settled = self._get_step_info()
        row = {"timestamp": timestamp, "note": ctrl.get("note", ""),
               "Step Name": step_name, "Hold Stable": settled}
        row.update(flat_sensors)

        if self.pts_fieldnames is None:
            self.pts_fieldnames = list(row.keys())

        mode = 'w' if self._pts_first_write else 'a'
        try:
            with open(pts_filename, mode, newline='') as csvfile:
                writer = csv.DictWriter(csvfile, fieldnames=self.pts_fieldnames,
                                        extrasaction='ignore')
                if self._pts_first_write:
                    writer.writeheader()
                writer.writerow(row)
                csvfile.flush()
            self._pts_first_write = False
        except Exception as e:
            print(f"Points CSV write error: {e}")

        # Record for scatter overlay (epoch timestamp lets frontend look up plotData)
        self.saved_points.append({"timestamp": now, "sensors": dict(flat_sensors), "label": label})

        return pts_filename

    # ------------------------------------------------------------------
    # Main loop
    # ------------------------------------------------------------------

    def run(self):
        """Main sampling loop (runs in background thread)."""
        self._running = True
        sample_count = 0

        settings = self.config.get("settings", {})
        freq = float(settings.get("Sample Frequency (Hz)", 10))
        log_subsample_default = int(settings.get("Log Subsample", 10))
        next_time = time.time()

        while self._running:
            sample_count += 1
            now = time.time()

            # 1. Read all input channels
            readings = self._read_all_channels()

            # 2. Run PID loops
            pid_status = self._run_pid_loops(readings)

            # 3. Build flat sensor dict (channels + PID virtual channels)
            flat_sensors = dict(readings)
            # Also include output channel values (pre-computed list)
            for ch_name, ch_cfg in self._output_channels:
                flat_sensors[ch_name] = self._read_output_value(ch_name)

            for loop_name, status in pid_status.items():
                flat_sensors[f"pid.{loop_name}.setpoint"] = status["setpoint"]
                flat_sensors[f"pid.{loop_name}.pv"] = status["pv"]
                flat_sensors[f"pid.{loop_name}.output"] = status["output"]
                flat_sensors[f"pid.{loop_name}.error"] = status["error"]

            # 3.1. Compute derived quantities from all available data
            self._compute_derived(flat_sensors)

            # 4. Check interlocks (after PID so we can monitor output
            #    channels and PID virtual channels like pid.X.output).
            #    Interlock actions take effect on the next cycle.
            self._check_interlocks(flat_sensors)

            # 4.5. Step series — always update settled state; advance only when running
            if self.step_mode == "auto" and len(self.step_series) > 0:
                self.step_settled = self._check_step_settled(flat_sensors)
                if self.step_running and self.step_settled:
                    if self._step_last_tick is not None:
                        dt = now - self._step_last_tick
                        self.step_hold_elapsed += dt
                    self._step_last_tick = now
                    if self.step_hold_elapsed >= self.step_hold_total:
                        step = self.step_series[self.step_current]
                        step_label = step.get("name") or str(step.get("step_num", self.step_current + 1))
                        self.save_point(label=step_label, readings=flat_sensors)
                        next_idx = self.step_current + 1
                        if next_idx < len(self.step_series):
                            self._go_to_step(next_idx)
                        else:
                            self.step_running = False
                else:
                    self._step_last_tick = None

            # 5. Store latest + buffer + read control settings (single lock)
            with self._lock:
                self.latest_readings = flat_sensors
                self.latest_pid_status = pid_status
                self.sample_buffer.append({
                    "timestamp": now,
                    "sensors": flat_sensors,
                })
                # Snapshot interlock and step state for thread-safe reads
                self._tripped_snapshot = set(self.tripped_interlocks)
                self._latched_snapshot = set(self.latched_interlocks)
                self._step_snapshot = {
                    "current_step": self.step_current,
                    "mode": self.step_mode,
                    "running": self.step_running,
                    "settled": self.step_settled,
                    "settled_cols": dict(self.step_settled_cols),
                    "hold_elapsed": round(self.step_hold_elapsed, 1),
                    "hold_total": self.step_hold_total,
                    "active_test": self.step_active_test,
                }
                self._instrument_status_snapshot = {
                    name: dict(s) for name, s in self._instrument_status.items()
                }
                ctrl = dict(self.control_settings)

            subsample = log_subsample_default
            try:
                subsample = max(1, int(ctrl.get("log_subsample", log_subsample_default)))
            except (ValueError, TypeError):
                pass

            if sample_count % subsample == 0:
                self._log_to_csv(flat_sensors, ctrl)

            # 7. Deadline-based sleep
            ctrl_freq = freq
            try:
                ctrl_freq = float(ctrl.get("sample_frequency_hz", freq))
            except (ValueError, TypeError):
                pass
            next_time += 1.0 / max(ctrl_freq, 1)
            sleep_dur = next_time - time.time()
            if sleep_dur > 0:
                time.sleep(sleep_dur)
            else:
                next_time = time.time()

    def stop(self):
        self._running = False
        self._close_csv()
        for d in self.drivers.values():
            d.close()

    # ------------------------------------------------------------------
    # API methods (called by Flask routes)
    # ------------------------------------------------------------------

    def get_data_since(self, since):
        """Return samples since timestamp, plus latest readings, PID status, controls."""
        with self._lock:
            samples = []
            for s in reversed(self.sample_buffer):
                if s["timestamp"] <= since:
                    break
                samples.append(s)
            samples.reverse()
            readings = dict(self.latest_readings)
            pid_status = dict(self.latest_pid_status)
            ctrl = dict(self.control_settings)
            tripped = list(self._tripped_snapshot)
            latched = list(self._latched_snapshot)
            step_snap = dict(self._step_snapshot)
            inst_status = dict(self._instrument_status_snapshot)
            saved = list(self.saved_points)

        step_status = {}
        if len(self.step_series) > 0:
            idx = step_snap["current_step"]
            current_step = self.step_series[idx] if idx < len(self.step_series) else {}
            step_status = {
                "current_step": idx,
                "total_steps": len(self.step_series),
                "step_name": current_step.get("name", ""),
                "active_test": step_snap.get("active_test", ""),
                "mode": step_snap["mode"],
                "running": step_snap["running"],
                "settled": step_snap["settled"],
                "settled_cols": step_snap["settled_cols"],
                "hold_elapsed": step_snap["hold_elapsed"],
                "hold_total": step_snap["hold_total"],
            }

        return {
            "samples": samples,
            "sensors": readings,
            "pid_status": pid_status,
            "controls": ctrl,
            "tripped_interlocks": tripped,
            "latched_interlocks": latched,
            "step_series": step_status,
            "instrument_status": inst_status,
            "saved_points": saved,
        }

    def update_settings(self, data):
        """Process control updates from frontend."""
        with self.command_lock:
            old_filename = self.control_settings.get("file_name")
            for key, value in data.items():
                if key == "append":
                    self.control_settings[key] = value if isinstance(value, bool) else str(value).lower() == "true"
                else:
                    self.control_settings[key] = value
            # Reset CSV if filename changed
            if data.get("file_name") and data["file_name"] != old_filename:
                self.file_initialized = False
            ctrl_copy = dict(self.control_settings)

        self._save_config(ctrl_copy)
        return ctrl_copy

    def set_pid_setpoint(self, loop_name, setpoint):
        if loop_name in self.loop_configs:
            self.loop_configs[loop_name]["setpoint"] = setpoint
            if loop_name in self.pid_controllers:
                self.pid_controllers[loop_name].setpoint = setpoint

    def set_pid_mode(self, loop_name, mode):
        if loop_name in self.loop_configs:
            self.loop_configs[loop_name]["mode"] = mode
            if mode == "manual" and loop_name in self.pid_controllers:
                self.pid_controllers[loop_name].reset()

    def set_manual_output(self, loop_name, output):
        if loop_name in self.loop_configs:
            cfg = self.loop_configs[loop_name]
            if cfg.get("mode") == "manual":
                output = max(float(cfg["out_min"]), min(float(cfg["out_max"]), output))
                self._write_channel(cfg["output_channel"], output)

    def set_output(self, channel_name, value):
        """Directly write a value to an output channel (for non-PID controls)."""
        channels = self.config.get("channels", {})
        ch_cfg = channels.get(channel_name)
        if ch_cfg is None or ch_cfg["direction"] != "output":
            return
        ch_min = float(ch_cfg.get("min", 0))
        ch_max = float(ch_cfg.get("max", 100))
        clamped = max(ch_min, min(ch_max, float(value)))
        self._write_channel(channel_name, clamped)

    # ------------------------------------------------------------------
    # PID Auto-tune
    # ------------------------------------------------------------------

    def start_autotune(self, loop_name):
        """Start doublet step-response auto-tune for all enabled PID loops."""
        if loop_name not in self.pid_controllers:
            return {"error": f"unknown loop: {loop_name}"}
        started = []
        for ln, pid in self.pid_controllers.items():
            cfg = self.loop_configs[ln]
            if not cfg.get("enabled", True):
                continue
            out_min = float(cfg["out_min"])
            out_max = float(cfg["out_max"])
            setpoint = float(cfg["setpoint"])
            reverse = float(cfg.get("kp", 1)) < 0
            baseline_output = self._read_output_value(cfg["output_channel"])
            tuner = StepResponseTuner(
                setpoint=setpoint,
                baseline_output=baseline_output,
                out_min=out_min,
                out_max=out_max,
                reverse=reverse,
            )
            self._autotuners[ln] = tuner
            cfg["mode"] = "auto"
            pid.reset()
            started.append(ln)
            print(f"  {ln}: SP={setpoint}, baseline={baseline_output:.1f}, "
                  f"range=[{out_min},{out_max}], reverse={reverse}")
        print(f"\n{'='*60}")
        print(f"AUTO-TUNE STARTED: {', '.join(started)}")
        print(f"  Method: doublet step response + SIMC tuning")
        print(f"{'='*60}\n", flush=True)
        return {"status": "started"}

    def _finish_autotune(self, loop_name, tuner):
        """Apply auto-tuned gains and clean up."""
        result = tuner.result
        if result is None:
            print(f"\nAUTO-TUNE FAILED: {loop_name} — no measurable response\n", flush=True)
            del self._autotuners[loop_name]
            return

        kp, ki, kd = result["kp"], result["ki"], result["kd"]

        # Negate gains for reverse-acting loops
        cfg = self.loop_configs[loop_name]
        old_kp = float(cfg.get("kp", 1))
        if old_kp < 0:
            kp, ki, kd = -kp, -ki, -kd

        t_sample = result.get("sample_time", float(cfg.get("sample_time", 0.1)))

        pid = self.pid_controllers[loop_name]
        pid.kp = kp
        pid.ki = ki
        pid.kd = kd
        pid.sample_time = t_sample
        pid.reset()
        cfg["kp"] = kp
        cfg["ki"] = ki
        cfg["kd"] = kd
        cfg["sample_time"] = t_sample

        print(f"\n{'='*60}")
        print(f"AUTO-TUNE COMPLETE: {loop_name}")
        print(f"  Process gain (K): {result['K']:.4f}")
        print(f"  Time constant (τ): {result['tau']:.2f} s")
        print(f"  Dead time (θ): {result['theta']:.2f} s")
        print(f"  Kp = {kp:.4f}")
        print(f"  Ki = {ki:.4f}")
        print(f"  Kd = {kd:.4f}")
        print(f"  Sample time = {t_sample:.3f} s")
        print(f"{'='*60}\n", flush=True)

        del self._autotuners[loop_name]

    def cancel_autotune(self, loop_name):
        """Cancel an active auto-tune session."""
        if loop_name in self._autotuners:
            del self._autotuners[loop_name]
            print(f"AUTO-TUNE CANCELLED: {loop_name}", flush=True)
            # Return to manual mode
            self.set_pid_mode(loop_name, "manual")
            return {"status": "cancelled"}
        return {"error": "no active autotune"}

    def get_autotune_status(self, loop_name):
        """Return auto-tune progress for the given loop."""
        tuner = self._autotuners.get(loop_name)
        if tuner is None:
            return {"active": False}
        return {
            "active": not tuner.done,
            "oscillations": tuner.oscillation_count,
            "needed": tuner.oscillations_needed,
        }

    # ------------------------------------------------------------------
    # Step Series control
    # ------------------------------------------------------------------

    def step_series_select_test(self, test_name):
        """Switch to a different test sequence by name."""
        if test_name not in self.step_tests:
            return
        with self._lock:
            self.step_active_test = test_name
            self.step_series = self.step_tests[test_name]
            self.step_current = 0
            self.step_hold_elapsed = 0.0
            self._step_last_tick = None
            self.step_settled = False
            self.step_settled_cols = {}
            self.step_running = False
            self.step_hold_total = self.step_series[0]["hold_time"] if self.step_series else 0.0
        if self.step_series and self.step_mode == "auto":
            self._apply_step_setpoints(self.step_series[0])

    def step_series_set_mode(self, mode):
        """Set step series mode to 'auto' or 'manual'."""
        with self._lock:
            old_mode = self.step_mode
            self.step_mode = mode
            if mode == "manual":
                self.step_running = False
        if mode == "manual":
            # Restore PID loops that step series forced to auto back to manual
            if old_mode == "auto":
                for col in self.step_columns:
                    if col["type"] == "pid_setpoint":
                        for loop_name, loop_cfg in self.loop_configs.items():
                            if loop_cfg["pv_channel"] == col["pv_channel"]:
                                self.set_pid_mode(loop_name, "manual")
                                break
        elif mode == "auto" and self.step_series:
            self._apply_step_setpoints(self.step_series[self.step_current])

    def step_series_play_pause(self, running=None):
        """Set play/pause state for step series auto-advance.

        If *running* is given, set explicitly (idempotent).
        Otherwise toggle (legacy).
        """
        with self._lock:
            if self.step_mode != "auto":
                return
            if running is not None:
                self.step_running = bool(running)
            else:
                self.step_running = not self.step_running

    def step_series_next(self):
        """Advance to next step."""
        next_idx = self.step_current + 1
        if next_idx < len(self.step_series):
            self._go_to_step(next_idx)

    def step_series_prev(self):
        """Go to previous step."""
        prev_idx = self.step_current - 1
        if prev_idx >= 0:
            self._go_to_step(prev_idx)

    def step_series_go_to_step(self, step_index):
        """Jump to a specific step."""
        if 0 <= step_index < len(self.step_series):
            self._go_to_step(step_index)

    def _go_to_step(self, idx):
        """Internal: jump to step index and apply setpoints."""
        with self._lock:
            self.step_current = idx
            self.step_hold_elapsed = 0.0
            self._step_last_tick = None
            self.step_settled = False
            self.step_settled_cols = {}
            step = self.step_series[idx]
            self.step_hold_total = step["hold_time"]
        self._apply_step_setpoints(step)

    def _apply_step_setpoints(self, step):
        """Apply all setpoints from a step definition.

        For PID setpoint columns, also forces the PID loop into auto mode
        so the controller actively drives toward the setpoint.
        PID loops whose SP column is blank/NA for this step are switched
        to manual so direct output control can take over.
        """
        # Collect which PID pv_channels are actively set in this step
        active_pv_channels = set()
        for sp_info in step["setpoints"].values():
            if sp_info["type"] == "pid_setpoint":
                active_pv_channels.add(sp_info["pv_channel"])

        for col_header, sp_info in step["setpoints"].items():
            if sp_info["type"] == "pid_setpoint":
                pv_channel = sp_info["pv_channel"]
                for loop_name, loop_cfg in self.loop_configs.items():
                    if loop_cfg["pv_channel"] == pv_channel:
                        self.set_pid_setpoint(loop_name, sp_info["value"])
                        if self.step_mode == "auto":
                            self.set_pid_mode(loop_name, "auto")
                        break
            elif sp_info["type"] == "output_channel":
                self.set_output(sp_info["channel_name"], sp_info["value"])
            # "watch" type: no actuation — user controls this manually

        # Switch PID loops with no SP value in this step to manual
        if self.step_mode == "auto":
            for col in self.step_columns:
                if col["type"] != "pid_setpoint":
                    continue
                if col["pv_channel"] not in active_pv_channels:
                    for loop_name, loop_cfg in self.loop_configs.items():
                        if loop_cfg["pv_channel"] == col["pv_channel"]:
                            self.set_pid_mode(loop_name, "manual")
                            break

    def _check_step_settled(self, readings):
        """Check per-column and overall settled state.

        Updates self.step_settled_cols ({header: bool}) and returns
        the overall settled bool.  Columns without a tolerance are
        considered always settled (not tracked in step_settled_cols).
        """
        cols = {}
        if self.step_current >= len(self.step_series):
            self.step_settled_cols = cols
            return True
        step = self.step_series[self.step_current]
        for col in self.step_columns:
            tol = col.get("tolerance")
            header = col["header"]
            sp_info = step["setpoints"].get(header)
            if sp_info is None:
                continue
            target = sp_info["value"]
            if col["type"] == "pid_setpoint":
                if tol is None:
                    continue  # no tolerance → always settled, not tracked
                tol = float(tol)
                pv = readings.get(col["pv_channel"])
                cols[header] = (pv is not None
                                and not (isinstance(pv, float) and math.isnan(pv))
                                and abs(pv - target) <= tol)
            elif col["type"] == "watch":
                if tol is None:
                    continue
                tol = float(tol)
                pv = readings.get(col["channel_name"])
                cols[header] = (pv is not None
                                and not (isinstance(pv, float) and math.isnan(pv))
                                and abs(pv - target) <= tol)
            elif col["type"] == "output_channel":
                # No tolerance → exact match (appropriate for selectors)
                tol = float(tol) if tol is not None else 0.0
                actual = self._read_output_value(col["channel_name"])
                cols[header] = abs(actual - target) <= tol
        self.step_settled_cols = cols
        return all(cols.values()) if cols else True
