"""Validate an experiment config Excel file.

Checks all cross-references between sheets, verifies driver types exist,
and catches common mistakes before the app runs.

Usage:
    python validate_config.py                     # validates example_config.xlsx
    python validate_config.py my_config.xlsx      # validates a specific file
    python validate_config.py --strict my.xlsx    # treat warnings as errors
"""

import argparse
import os
import re
import sys

from config_loader import load_config
from driver_base import DRIVER_REGISTRY


# ── Channel ID format validators (one per driver type) ────────────────
# Each returns (ok, error_msg).  These run at config-parse time so they
# only check *format* — no hardware access.

_NI_CDAQ_CH_RE = re.compile(
    r"^Mod(\d+)/(ai|tc|rtd|ao|ai_poly|ai_custom)(\d+)$", re.IGNORECASE
)

_ALICAT_VALID = {"P", "T", "VOL_FLOW", "MASS_FLOW", "SETPOINT", "GAS"}

_YOKOGAWA_SIGMA_RE = re.compile(r"^SIGMA_(\w+)$", re.IGNORECASE)
_YOKOGAWA_ELEM_RE = re.compile(r"^(\w+?)(\d)$", re.IGNORECASE)
_YOKOGAWA_ELEM_FUNCS = {
    "U", "I", "P", "S", "Q", "LAMBDA", "PHI",
    "FU", "FI", "UPP", "IPP", "UPPK", "IPPK",
}
_YOKOGAWA_SIGMA_FUNCS = {"P", "S", "Q", "LAMBDA"}

# Build Rigol pattern from the same measurement keys the driver uses
_RIGOL_MEAS_KEYS = {
    "VPP", "VMAX", "VMIN", "VAVG", "VRMS", "VAMP", "VTOP", "VBASE",
    "FREQ", "PER", "RISE", "FALL", "PWID", "NWID",
    "PDUT", "NDUT", "OVER", "PRES",
}
_RIGOL_CH_RE = re.compile(
    r"^(" + "|".join(sorted(_RIGOL_MEAS_KEYS, key=len, reverse=True)) + r")(\d)$",
    re.IGNORECASE,
)


def _validate_channel_id_ni_cdaq(channel_id, direction):
    m = _NI_CDAQ_CH_RE.match(channel_id.strip())
    if not m:
        return False, (
            f"invalid format '{channel_id}'. Expected Mod<slot>/<ai|tc|rtd|ao|ai_poly|ai_custom><index> "
            "(e.g. Mod1/ai0, Mod2/tc3, Mod3/rtd0, Mod4/ao1)"
        )
    slot = int(m.group(1))
    kind = m.group(2).lower()
    index = int(m.group(3))
    if slot < 1 or slot > 8:
        return False, f"slot {slot} in '{channel_id}' is out of range (expected 1-8)"
    if index > 31:
        return False, f"index {index} in '{channel_id}' is out of range (expected 0-31)"
    if direction == "output" and kind != "ao":
        return False, f"output channel '{channel_id}' uses kind '{kind}' — only 'ao' is valid for outputs"
    if direction == "input" and kind == "ao":
        return False, f"input channel '{channel_id}' uses kind 'ao' — 'ao' is only valid for outputs"
    return True, ""


def _validate_channel_id_alicat(channel_id, direction):
    key = channel_id.strip().upper()
    if key not in _ALICAT_VALID:
        return False, f"'{channel_id}' not valid. Must be one of {sorted(_ALICAT_VALID)}"
    if direction == "output" and key != "SETPOINT":
        return False, f"only SETPOINT is writable on Alicat, got '{channel_id}'"
    return True, ""


def _validate_channel_id_yokogawa(channel_id, direction):
    cid = channel_id.strip()
    m = _YOKOGAWA_SIGMA_RE.match(cid)
    if m:
        func = m.group(1).upper()
        if func not in _YOKOGAWA_SIGMA_FUNCS:
            return False, f"invalid sigma function '{func}'. Valid: {sorted(_YOKOGAWA_SIGMA_FUNCS)}"
        return True, ""
    m = _YOKOGAWA_ELEM_RE.match(cid)
    if m:
        func = m.group(1).upper()
        elem = m.group(2)
        if elem not in ("1", "2", "3"):
            return False, f"element must be 1, 2, or 3, got '{elem}'"
        if func not in _YOKOGAWA_ELEM_FUNCS:
            return False, f"unknown function '{func}'. Valid: {sorted(_YOKOGAWA_ELEM_FUNCS)}"
        return True, ""
    return False, (
        f"cannot parse '{channel_id}'. Expected <FUNC><1|2|3> (e.g. U1, P3) "
        "or SIGMA_<FUNC> (e.g. SIGMA_P)"
    )


def _validate_channel_id_rigol(channel_id, direction):
    cid = channel_id.strip()
    m = _RIGOL_CH_RE.match(cid)
    if not m:
        return False, (
            f"invalid format '{channel_id}'. Expected <MEAS><1-8> "
            f"(e.g. VRMS1, FREQ4). Valid measurements: {sorted(_RIGOL_MEAS_KEYS)}"
        )
    ch_num = int(m.group(2))
    if ch_num < 1 or ch_num > 8:
        return False, f"channel number must be 1-8, got {ch_num}"
    return True, ""


_JULABO_VALID_CHANNELS = {
    "BATH_TEMP", "EXT_TEMP", "SETPOINT", "POWER", "SAFETY_TEMP",
    "HI_CUTOFF", "LEVEL", "PUMP", "START_STOP", "RAMP_RATE",
}
_JULABO_WRITABLE = {"SETPOINT", "PUMP", "START_STOP", "RAMP_RATE"}


def _validate_channel_id_julabo(channel_id, direction):
    key = channel_id.strip().upper()
    if key not in _JULABO_VALID_CHANNELS:
        return False, (
            f"unknown channel '{channel_id}'. "
            f"Valid: {sorted(_JULABO_VALID_CHANNELS)}"
        )
    if direction == "output" and key not in _JULABO_WRITABLE:
        return False, f"channel '{key}' is read-only"
    return True, ""


_CHANNEL_ID_VALIDATORS = {
    "ni_cdaq": _validate_channel_id_ni_cdaq,
    "alicat": _validate_channel_id_alicat,
    "yokogawa_wt": _validate_channel_id_yokogawa,
    "rigol_dho": _validate_channel_id_rigol,
    "julabo": _validate_channel_id_julabo,
}


def validate(config):
    """Validate a parsed config dict.

    Returns (errors, warnings) where each is a list of strings.
    Errors are hard failures; warnings are suspicious but non-fatal.
    """
    errors = []
    warnings = []

    instruments = config.get("instruments", {})
    channels = config.get("channels", {})
    control_loops = config.get("control_loops", {})
    interlocks = config.get("interlocks", [])
    logging_cfg = config.get("logging", {})
    settings = config.get("settings", {})
    step_series = config.get("step_series", [])
    step_columns = config.get("step_columns", [])

    # Helper: enabled channels by direction
    enabled_channels = {n: c for n, c in channels.items() if c.get("enabled", True)}
    input_channels = {n: c for n, c in enabled_channels.items() if c["direction"] == "input"}
    output_channels = {n: c for n, c in enabled_channels.items() if c["direction"] == "output"}
    enabled_instruments = {n: i for n, i in instruments.items() if i.get("enabled", True)}
    enabled_loops = {n: l for n, l in control_loops.items() if l.get("enabled", True)}

    # ── Instruments ──────────────────────────────────────────────────
    for name, inst in instruments.items():
        if not inst.get("enabled", True):
            continue
        driver_type = inst.get("type", "simulated")
        if driver_type not in DRIVER_REGISTRY:
            warnings.append(
                f"Instruments > {name}: type '{driver_type}' not in DRIVER_REGISTRY "
                f"(available: {', '.join(DRIVER_REGISTRY.keys())}); will fall back to simulated"
            )
        poll = inst.get("poll_rate", 0.1)
        if not isinstance(poll, (int, float)) or poll <= 0:
            errors.append(f"Instruments > {name}: Poll Rate must be > 0, got {poll}")
        timeout = inst.get("timeout", 5)
        if not isinstance(timeout, (int, float)) or timeout <= 0:
            errors.append(f"Instruments > {name}: Timeout must be > 0, got {timeout}")

    # ── Channels ─────────────────────────────────────────────────────
    for name, ch in channels.items():
        if not ch.get("enabled", True):
            continue
        # Instrument reference
        inst_name = ch.get("instrument", "")
        if inst_name and inst_name not in instruments:
            errors.append(f"Channels > {name}: Instrument '{inst_name}' does not exist")
        elif inst_name and inst_name not in enabled_instruments:
            warnings.append(f"Channels > {name}: Instrument '{inst_name}' is disabled")
        # Direction
        direction = ch.get("direction", "")
        if direction not in ("input", "output"):
            errors.append(f"Channels > {name}: Direction must be 'input' or 'output', got '{direction}'")
        # Range
        ch_min = ch.get("min", 0)
        ch_max = ch.get("max", 100)
        if isinstance(ch_min, (int, float)) and isinstance(ch_max, (int, float)):
            if ch_min >= ch_max:
                errors.append(f"Channels > {name}: Min ({ch_min}) must be < Max ({ch_max})")
        # Slope
        slope = ch.get("slope", 1)
        if slope == 0 and direction == "output":
            warnings.append(f"Channels > {name}: Slope is 0 — will cause division by zero on output scaling")
        # Channel ID format validation (driver-specific)
        channel_id = ch.get("channel_id", "")
        if not channel_id and inst_name and inst_name in instruments:
            driver_type = instruments[inst_name].get("type", "simulated")
            if driver_type != "simulated":
                warnings.append(f"Channels > {name}: no Channel ID for non-simulated driver '{driver_type}'")
        if channel_id and inst_name and inst_name in instruments:
            driver_type = instruments[inst_name].get("type", "simulated")
            validator = _CHANNEL_ID_VALIDATORS.get(driver_type)
            if validator:
                ok, msg = validator(channel_id, direction)
                if not ok:
                    errors.append(f"Channels > {name}: Channel ID {msg}")

    # ── Control Loops ────────────────────────────────────────────────
    for name, loop in control_loops.items():
        if not loop.get("enabled", True):
            continue
        # Process Variable
        pv = loop.get("pv_channel", "")
        if pv not in channels:
            errors.append(f"Control Loops > {name}: Process Variable '{pv}' does not exist in Channels")
        elif pv not in enabled_channels:
            errors.append(f"Control Loops > {name}: Process Variable '{pv}' is disabled")
        elif channels[pv]["direction"] != "input":
            errors.append(f"Control Loops > {name}: Process Variable '{pv}' must be an input channel")
        # Output Channel
        out = loop.get("output_channel", "")
        if out not in channels:
            errors.append(f"Control Loops > {name}: Output Channel '{out}' does not exist in Channels")
        elif out not in enabled_channels:
            errors.append(f"Control Loops > {name}: Output Channel '{out}' is disabled")
        elif channels[out]["direction"] != "output":
            errors.append(f"Control Loops > {name}: Output Channel '{out}' must be an output channel")
        # Self-reference
        if pv and pv == out:
            errors.append(f"Control Loops > {name}: Process Variable and Output Channel are the same ('{pv}')")
        # Range
        out_min = loop.get("out_min", 0)
        out_max = loop.get("out_max", 100)
        if isinstance(out_min, (int, float)) and isinstance(out_max, (int, float)):
            if out_min >= out_max:
                errors.append(f"Control Loops > {name}: Out Min ({out_min}) must be < Out Max ({out_max})")
        # Sample Time
        st = loop.get("sample_time", 0.1)
        if not isinstance(st, (int, float)) or st <= 0:
            errors.append(f"Control Loops > {name}: Sample Time must be > 0, got {st}")
        # Mode
        mode = loop.get("mode", "manual")
        if mode not in ("manual", "auto"):
            errors.append(f"Control Loops > {name}: Mode must be 'manual' or 'auto', got '{mode}'")

    # ── Interlocks ───────────────────────────────────────────────────
    interlock_names = set()
    valid_conditions = {">", "<", ">=", "<="}
    valid_actions = {"alarm", "set_output", "disable_loop", "enable_loop"}

    def _validate_action_entry(name, act_dict, label):
        """Validate a single action dict (used for both trip actions and recovery)."""
        action = act_dict.get("action", "")
        target = act_dict.get("target", "")
        if action not in valid_actions:
            errors.append(f"Interlocks > {name}: {label} action must be one of {valid_actions}, got '{action}'")
        if action == "set_output":
            if not target:
                errors.append(f"Interlocks > {name}: {label} 'set_output' requires a Target channel")
            elif target not in output_channels:
                errors.append(
                    f"Interlocks > {name}: {label} Target '{target}' must be an enabled output channel "
                    f"(for action 'set_output')"
                )
        elif action in ("disable_loop", "enable_loop"):
            if not target:
                errors.append(f"Interlocks > {name}: {label} '{action}' requires a Target loop name")
            elif target not in enabled_loops:
                errors.append(
                    f"Interlocks > {name}: {label} Target '{target}' must be an enabled control loop "
                    f"(for action '{action}')"
                )

    for il in interlocks:
        if not il.get("enabled", True):
            continue
        name = il.get("name", "")
        if name in interlock_names:
            errors.append(f"Interlocks > {name}: duplicate interlock name")
        interlock_names.add(name)
        # Channel
        ch = il.get("channel", "")
        if ch not in channels:
            errors.append(f"Interlocks > {name}: Channel '{ch}' does not exist in Channels")
        elif ch not in enabled_channels:
            errors.append(f"Interlocks > {name}: Channel '{ch}' is disabled — interlock will never trigger")
        # Condition
        cond = il.get("condition", "")
        if cond not in valid_conditions:
            errors.append(f"Interlocks > {name}: Condition must be one of {valid_conditions}, got '{cond}'")
        # Validate compound actions
        actions = il.get("actions", [])
        if actions:
            for i, act in enumerate(actions):
                _validate_action_entry(name, act, f"Action[{i}]")
        else:
            # Fallback: validate legacy single-action fields
            _validate_action_entry(name, {
                "action": il.get("action", ""),
                "target": il.get("target", ""),
                "value": il.get("action_value"),
            }, "Action")
        # Validate recovery actions
        recovery = il.get("recovery", [])
        for i, act in enumerate(recovery):
            _validate_action_entry(name, act, f"Recovery[{i}]")

    # ── Logging ──────────────────────────────────────────────────────
    for ch_name, log_cfg in logging_cfg.items():
        if ch_name not in channels:
            warnings.append(f"Logging > {ch_name}: Channel does not exist in Channels sheet")
        low = log_cfg.get("alarm_low")
        high = log_cfg.get("alarm_high")
        if low is not None and high is not None:
            if isinstance(low, (int, float)) and isinstance(high, (int, float)) and low >= high:
                errors.append(f"Logging > {ch_name}: Alarm Low ({low}) must be < Alarm High ({high})")

    # ── Step Series ──────────────────────────────────────────────────
    # Build PV-to-loop map for SP column validation
    pv_to_loop = {}
    for loop_name, loop_cfg in enabled_loops.items():
        pv_to_loop[loop_cfg["pv_channel"]] = loop_name

    # Map PID output channels for over-specification checks
    pid_output_to_loop = {}
    for loop_name, loop_cfg in enabled_loops.items():
        pid_output_to_loop[loop_cfg["output_channel"]] = loop_name

    for col in step_columns:
        header = col.get("header", "")
        if col["type"] == "pid_setpoint":
            pv_ch = col.get("pv_channel", "")
            if pv_ch not in input_channels:
                errors.append(
                    f"Step Series > column '{header}': PV channel '{pv_ch}' "
                    f"does not exist as an enabled input channel"
                )
            elif pv_ch not in pv_to_loop:
                errors.append(
                    f"Step Series > column '{header}': PV channel '{pv_ch}' "
                    f"is not the Process Variable of any enabled control loop"
                )
        elif col["type"] == "output_channel":
            ch_name = col.get("channel_name", "")
            if ch_name not in output_channels:
                errors.append(
                    f"Step Series > column '{header}': output channel '{ch_name}' "
                    f"does not exist as an enabled output channel"
                )
        elif col["type"] == "watch":
            ch_name = col.get("channel_name", "")
            if ch_name not in enabled_channels:
                errors.append(
                    f"Step Series > column '{header}': watch channel '{ch_name}' "
                    f"does not exist as an enabled channel"
                )
            if col.get("tolerance") is None:
                warnings.append(
                    f"Step Series > column '{header}': Watch column has no tolerance — "
                    f"settling will not be tracked for this column"
                )
        tol = col.get("tolerance")
        if tol is not None and (not isinstance(tol, (int, float)) or tol <= 0):
            errors.append(f"Step Series > column '{header}': Tolerance must be > 0, got {tol}")

    # Per-step checks (validate all tests, not just the active one)
    step_tests = config.get("step_tests", {})
    all_steps = []
    for test_name, test_steps in step_tests.items():
        for step in test_steps:
            all_steps.append((test_name, step))
    if not all_steps:
        all_steps = [("", step) for step in step_series]

    for test_name, step in all_steps:
        step_num = step.get("step_num", "?")
        prefix = f"Step Series > Test '{test_name}' > Step {step_num}" if test_name else f"Step Series > Step {step_num}"
        hold = step.get("hold_time", 0)
        if not isinstance(hold, (int, float)) or hold < 0:
            errors.append(f"{prefix}: Hold Time must be >= 0, got {hold}")

        # Check for over-specification: a step that has both an SP column
        # (which drives a PID loop's output) and a direct output column
        # targeting the same physical output channel.
        sp_info = step.get("setpoints", {})
        active_pid_outputs = set()
        for col_header, info in sp_info.items():
            if info["type"] == "pid_setpoint":
                pv_ch = info["pv_channel"]
                loop_name = pv_to_loop.get(pv_ch)
                if loop_name:
                    active_pid_outputs.add(enabled_loops[loop_name]["output_channel"])
        for col_header, info in sp_info.items():
            if info["type"] == "output_channel":
                ch_name = info["channel_name"]
                if ch_name in active_pid_outputs:
                    loop_name = pid_output_to_loop.get(ch_name, "?")
                    errors.append(
                        f"{prefix}: output channel '{ch_name}' is set directly "
                        f"AND driven by PID loop '{loop_name}' via SP column in the same step — "
                        f"use blank/NA in one column to avoid conflict"
                    )

    # ── Settings ─────────────────────────────────────────────────────
    freq = settings.get("Sample Frequency (Hz)")
    if freq is not None:
        if not isinstance(freq, (int, float)) or freq <= 0:
            errors.append(f"Settings > Sample Frequency (Hz): must be > 0, got {freq}")

    log_sub = settings.get("Log Subsample")
    if log_sub is not None:
        if not isinstance(log_sub, (int, float)) or log_sub < 1:
            errors.append(f"Settings > Log Subsample: must be >= 1, got {log_sub}")

    buf = settings.get("Data Buffer Size")
    if buf is not None:
        if not isinstance(buf, (int, float)) or buf <= 0:
            errors.append(f"Settings > Data Buffer Size: must be > 0, got {buf}")

    for key in ("Scatter X Channel", "Scatter Y Channel"):
        val = settings.get(key)
        if val and str(val).strip():
            if str(val).strip() not in channels:
                errors.append(f"Settings > {key}: channel '{val}' does not exist in Channels")

    # Scatter plots require both X and Y; warn if only one is set
    for n in ["", " 2", " 3", " 4", " 5", " 6", " 7", " 8", " 9"]:
        sx = str(settings.get(f"Scatter X Channel{n}", "")).strip()
        sy = str(settings.get(f"Scatter Y Channel{n}", "")).strip()
        if bool(sx) != bool(sy):
            which = f"Scatter X Channel{n}" if sx else f"Scatter Y Channel{n}"
            missing = f"Scatter Y Channel{n}" if sx else f"Scatter X Channel{n}"
            warnings.append(f"Settings > {which} is set but {missing} is empty — scatter plot{n} will not be created")

    return errors, warnings


def main():
    parser = argparse.ArgumentParser(description="Validate experiment config")
    parser.add_argument("config", nargs="?",
                        default=os.path.join(os.path.dirname(__file__), "example_config.xlsx"),
                        help="Path to config .xlsx (default: example_config.xlsx)")
    parser.add_argument("--strict", action="store_true",
                        help="Treat warnings as errors")
    args = parser.parse_args()

    print(f"Validating: {args.config}")
    config = load_config(args.config)
    errors, warnings = validate(config)

    for w in warnings:
        print(f"  WARNING: {w}")
    for e in errors:
        print(f"  ERROR:   {e}")

    if args.strict and warnings:
        errors.extend(warnings)

    if errors:
        print(f"\nFailed: {len(errors)} error(s), {len(warnings)} warning(s)")
        sys.exit(1)
    elif warnings:
        print(f"\nPassed with {len(warnings)} warning(s)")
    else:
        print("\nPassed: no errors or warnings")


if __name__ == "__main__":
    main()
