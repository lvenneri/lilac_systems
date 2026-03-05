"""Experiment engine: sampling loop, PID control, interlocks, data buffering."""

import collections
import csv
import json
import os
import threading
import time

from pid_controller import PIDController
from driver_base import create_driver


class ExperimentEngine:
    def __init__(self, config):
        self.config = config
        self.drivers = {}           # instrument_name -> DriverBase
        self.pid_controllers = {}   # loop_name -> PIDController
        self.loop_configs = {}      # loop_name -> mutable config dict
        self.interlocks = []
        self.tripped_interlocks = set()

        # Shared data state
        self.latest_readings = {}
        self.latest_pid_status = {}
        buf_size = int(config.get("settings", {}).get("Data Buffer Size", 10000))
        self.sample_buffer = collections.deque(maxlen=buf_size)

        # Locks (same 3-lock pattern as original app.py)
        self.data_lock = threading.Lock()
        self.buffer_lock = threading.Lock()
        self.command_lock = threading.Lock()

        # Control settings from frontend (file_name, append, etc.)
        settings = config.get("settings", {})
        self.control_settings = {
            "file_name": str(settings.get("CSV Log File", "junk.csv")),
            "sample_frequency_hz": float(settings.get("Sample Frequency (Hz)", 10)),
            "log_subsample": int(settings.get("Log Subsample", 10)),
            "append": False,
        }

        # CSV state
        self.file_initialized = False
        self.csv_fieldnames = None

        # Step series state
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

        self._running = False

    def initialize(self):
        """Create drivers and PID controllers from config."""
        for name, inst_cfg in self.config.get("instruments", {}).items():
            if inst_cfg.get("enabled", True):
                drv = create_driver(inst_cfg)
                drv.connect()
                self.drivers[name] = drv

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

        # Apply first step setpoints since we start in auto mode
        if self.step_series and self.step_mode == "auto":
            self._apply_step_setpoints(self.step_series[0])

    # ------------------------------------------------------------------
    # Channel I/O
    # ------------------------------------------------------------------

    def _read_all_channels(self):
        """Read all enabled input channels, apply slope/offset scaling."""
        readings = {}
        channels = self.config.get("channels", {})
        for ch_name, ch_cfg in channels.items():
            if not ch_cfg.get("enabled", True):
                continue
            if ch_cfg["direction"] != "input":
                continue
            driver = self.drivers.get(ch_cfg["instrument"])
            if driver is None:
                continue
            raw = driver.read_channel(ch_cfg["channel_id"])
            slope = ch_cfg.get("slope", 1)
            offset = ch_cfg.get("offset", 0)
            readings[ch_name] = raw * slope + offset
        return readings

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
            if pv is None:
                continue

            pid.setpoint = float(cfg["setpoint"])

            if mode == "auto":
                output, error = pid.compute(pv)
                self._write_channel(cfg["output_channel"], output)
            else:
                # Manual mode: read last written output, compute error only
                output = self._read_output_value(cfg["output_channel"])
                error = pid.setpoint - pv

            pid_status[loop_name] = {
                "setpoint": pid.setpoint,
                "pv": pv,
                "output": output,
                "error": error,
                "mode": mode,
                "sp_units": cfg.get("sp_units", ""),
                "pv_channel": cfg["pv_channel"],
                "output_channel": cfg["output_channel"],
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

    def _check_interlocks(self, readings):
        for il in self.interlocks:
            ch_value = readings.get(il["channel"])
            if ch_value is None:
                continue
            threshold = float(il["threshold"])
            condition = il["condition"]

            tripped = False
            if condition == ">" and ch_value > threshold:
                tripped = True
            elif condition == "<" and ch_value < threshold:
                tripped = True
            elif condition == ">=" and ch_value >= threshold:
                tripped = True
            elif condition == "<=" and ch_value <= threshold:
                tripped = True

            if tripped and il["name"] not in self.tripped_interlocks:
                self.tripped_interlocks.add(il["name"])
                self._execute_interlock_action(il)
                print(f"INTERLOCK TRIPPED: {il['name']} ({il['channel']} {condition} {threshold})")
            elif not tripped and il["name"] in self.tripped_interlocks:
                self.tripped_interlocks.discard(il["name"])
                print(f"INTERLOCK CLEARED: {il['name']}")

    def _execute_interlock_action(self, il):
        action = il["action"]
        target = il.get("target", "")
        value = il.get("action_value")

        if action == "set_output" and target:
            self._write_channel(target, float(value) if value is not None else 0)
        elif action == "disable_loop" and target in self.loop_configs:
            self.loop_configs[target]["mode"] = "manual"
            if target in self.pid_controllers:
                self.pid_controllers[target].reset()
        elif action == "alarm":
            pass  # logged to console above

    # ------------------------------------------------------------------
    # CSV logging
    # ------------------------------------------------------------------

    def _log_to_csv(self, flat_sensors, ctrl):
        filename = ctrl.get("file_name", "junk.csv")
        append = ctrl.get("append", False)

        now = time.time()
        local = time.localtime(now)
        ms = int((now % 1) * 1000)
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S", local) + f".{ms:03d}"

        row = {"timestamp": timestamp}
        row.update(flat_sensors)

        if self.csv_fieldnames is None:
            self.csv_fieldnames = list(row.keys())

        need_init = not self.file_initialized
        if need_init:
            self.file_initialized = True

        mode = 'a'
        header_needed = False
        if need_init:
            mode = 'a' if append else 'w'
            header_needed = True

        file_exists = os.path.isfile(filename)
        try:
            with open(filename, mode, newline='') as csvfile:
                writer = csv.DictWriter(csvfile, fieldnames=self.csv_fieldnames, extrasaction='ignore')
                if header_needed or not file_exists:
                    writer.writeheader()
                writer.writerow(row)
                csvfile.flush()
        except Exception as e:
            print(f"CSV write error: {e}")

    def _save_config(self, ctrl):
        csv_filename = ctrl.get("file_name", "junk.csv")
        config_filename = os.path.splitext(csv_filename)[0] + "_config.json"
        try:
            with open(config_filename, 'w') as f:
                json.dump(ctrl, f, indent=2)
        except Exception:
            pass

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

            # 2. Check interlocks (before PID, so interlocks can override)
            self._check_interlocks(readings)

            # 3. Run PID loops
            pid_status = self._run_pid_loops(readings)

            # 3.5. Step series — always update settled state; advance only when running
            if self.step_mode == "auto" and len(self.step_series) > 0:
                self.step_settled = self._check_step_settled(readings)
                if self.step_running and self.step_settled:
                    if self._step_last_tick is not None:
                        dt = now - self._step_last_tick
                        self.step_hold_elapsed += dt
                    self._step_last_tick = now
                    if self.step_hold_elapsed >= self.step_hold_total:
                        next_idx = self.step_current + 1
                        if next_idx < len(self.step_series):
                            self._go_to_step(next_idx)
                        else:
                            self.step_running = False
                else:
                    self._step_last_tick = None

            # 4. Build flat sensor dict (channels + PID virtual channels)
            flat_sensors = dict(readings)
            # Also include output channel values
            for ch_name, ch_cfg in self.config.get("channels", {}).items():
                if ch_cfg["direction"] == "output" and ch_cfg.get("enabled", True):
                    flat_sensors[ch_name] = self._read_output_value(ch_name)

            for loop_name, status in pid_status.items():
                flat_sensors[f"pid.{loop_name}.setpoint"] = status["setpoint"]
                flat_sensors[f"pid.{loop_name}.pv"] = status["pv"]
                flat_sensors[f"pid.{loop_name}.output"] = status["output"]
                flat_sensors[f"pid.{loop_name}.error"] = status["error"]

            # 5. Store latest + buffer
            with self.data_lock:
                self.latest_readings = flat_sensors
                self.latest_pid_status = pid_status

            with self.buffer_lock:
                self.sample_buffer.append({
                    "timestamp": now,
                    "sensors": flat_sensors,
                })

            # 6. CSV logging
            with self.command_lock:
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
        for d in self.drivers.values():
            d.close()

    # ------------------------------------------------------------------
    # API methods (called by Flask routes)
    # ------------------------------------------------------------------

    def get_data_since(self, since):
        """Return samples since timestamp, plus latest readings, PID status, controls."""
        with self.buffer_lock:
            samples = []
            for s in reversed(self.sample_buffer):
                if s["timestamp"] <= since:
                    break
                samples.append(s)
            samples.reverse()

        with self.data_lock:
            readings = dict(self.latest_readings)
            pid_status = dict(self.latest_pid_status)

        with self.command_lock:
            ctrl = dict(self.control_settings)

        step_status = {}
        if len(self.step_series) > 0:
            step_status = {
                "current_step": self.step_current,
                "total_steps": len(self.step_series),
                "mode": self.step_mode,
                "running": self.step_running,
                "settled": self.step_settled,
                "settled_cols": dict(self.step_settled_cols),
                "hold_elapsed": round(self.step_hold_elapsed, 1),
                "hold_total": self.step_hold_total,
            }

        return {
            "samples": samples,
            "sensors": readings,
            "pid_status": pid_status,
            "controls": ctrl,
            "tripped_interlocks": list(self.tripped_interlocks),
            "step_series": step_status,
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
    # Step Series control
    # ------------------------------------------------------------------

    def step_series_set_mode(self, mode):
        """Set step series mode to 'auto' or 'manual'."""
        old_mode = self.step_mode
        self.step_mode = mode
        if mode == "manual":
            self.step_running = False
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
        """
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
            if tol is None:
                continue  # no tolerance → always settled, not tracked
            tol = float(tol)
            header = col["header"]
            sp_info = step["setpoints"].get(header)
            if sp_info is None:
                continue
            target = sp_info["value"]
            if col["type"] == "pid_setpoint":
                pv = readings.get(col["pv_channel"])
                cols[header] = pv is not None and abs(pv - target) <= tol
            elif col["type"] == "output_channel":
                actual = self._read_output_value(col["channel_name"])
                cols[header] = abs(actual - target) <= tol
        self.step_settled_cols = cols
        return all(cols.values()) if cols else True
