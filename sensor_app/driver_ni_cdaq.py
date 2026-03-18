"""Driver for NI cDAQ-9177 chassis with mixed I/O modules.

Supported cards:
    NI 9201  – 8-ch  ±10 V analog voltage input
    NI 9202  – 16-ch ±10 V analog voltage input
    NI 9214  – 16-ch thermocouple input
    NI 9216  – 8-ch  RTD input
    NI 9264  – 16-ch ±10 V analog voltage output

Channel ID format (used in the Excel config "Channel ID" column):
    Mod{slot}/ai{n}         – voltage input  (NI 9201, NI 9202)
    Mod{slot}/tc{n}         – thermocouple   (NI 9214)
    Mod{slot}/rtd{n}        – RTD            (NI 9216)
    Mod{slot}/ao{n}         – voltage output (NI 9264)
    Mod{slot}/ai_poly{n}    – voltage input with polynomial conversion
                              Coefficients via channel_options:
                              "coefficients": [c0, c1, c2, ...]
                              result = c0 + c1*V + c2*V^2 + ...
    Mod{slot}/ai_custom{n}  – voltage input with hardcoded custom conversion
                              (edit _custom_sensor_convert() for your sensor)

Instrument config "Address / Device" should be the NI-DAQmx device name
for the chassis, e.g. "cDAQ1".

All analog input tasks use hardware-timed (finite) sampling for
compatibility with both on-demand and delta-sigma modules.  The
``sample_rate`` (default 1000 Hz) and ``samps_per_chan`` (default 2)
can be overridden globally via instrument_config or per-channel via
channel_options.
"""

import math
import re
import logging

import nidaqmx
from nidaqmx.constants import (
    AcquisitionType,
    RTDType,
    ResistanceConfiguration,
    ExcitationSource,
    ThermocoupleType,
    TemperatureUnits,
)

from driver_base import DriverBase

log = logging.getLogger(__name__)

# Regex: "Mod3/ai0" -> groups (module="3", kind="ai", index="0")
_CH_RE = re.compile(r"^Mod(\d+)/(ai|tc|rtd|ao|ai_poly|ai_custom)(\d+)$", re.IGNORECASE)

# Hardware-timed sampling defaults
_DEFAULT_SAMPLE_RATE = 10      # Hz – safe for delta-sigma cards (e.g. NI 9214)
_DEFAULT_SAMPS_PER_CHAN = 2    # minimum finite buffer

# Defaults – can be overridden per-channel via instrument_config["channel_options"]
_TC_TYPE_DEFAULT = ThermocoupleType.K
_RTD_TYPE_DEFAULT = RTDType.PT_3750
_RTD_RESISTANCE_DEFAULT = 100.0  # ohms (Pt100)
_RTD_WIRE_DEFAULT = ResistanceConfiguration.THREE_WIRE

# Map string names to nidaqmx enums for config overrides
_TC_TYPE_MAP = {
    "B": ThermocoupleType.B,
    "E": ThermocoupleType.E,
    "J": ThermocoupleType.J,
    "K": ThermocoupleType.K,
    "N": ThermocoupleType.N,
    "R": ThermocoupleType.R,
    "S": ThermocoupleType.S,
    "T": ThermocoupleType.T,
}

_RTD_TYPE_MAP = {
    "PT_3750": RTDType.PT_3750,
    "PT_3851": RTDType.PT_3851,
    "PT_3911": RTDType.PT_3911,
    "PT_3916": RTDType.PT_3916,
    "PT_3920": RTDType.PT_3920,
    "PT_3928": RTDType.PT_3928,
}

_RTD_WIRE_MAP = {
    "2": ResistanceConfiguration.TWO_WIRE,
    "3": ResistanceConfiguration.THREE_WIRE,
    "4": ResistanceConfiguration.FOUR_WIRE,
}


def _eval_polynomial(voltage, coefficients):
    """Evaluate polynomial: coefficients = [c0, c1, c2, ...] -> c0 + c1*V + c2*V^2 + ..."""
    result = 0.0
    for i, c in enumerate(coefficients):
        result += c * (voltage ** i)
    return result


def _custom_sensor_convert(voltage):
    """Example hardcoded voltage-to-engineering-unit conversion.

    Replace this function body with your sensor-specific conversion.
    This example converts a 0–10 V signal to 0–1000 PSI (linear).
    """
    psi = voltage * 100.0  # 0 V -> 0 PSI, 10 V -> 1000 PSI
    return psi


def _parse_channel_id(channel_id):
    """Return (module_num, kind, index) or raise ValueError."""
    m = _CH_RE.match(channel_id)
    if not m:
        raise ValueError(
            f"Invalid channel_id '{channel_id}'. "
            "Expected format: Mod<slot>/<ai|tc|rtd|ao|ai_poly|ai_custom><index>"
        )
    return int(m.group(1)), m.group(2).lower(), int(m.group(3))


class NiCdaqDriver(DriverBase):
    """Driver for an NI cDAQ-9177 chassis using the nidaqmx Python API."""

    def __init__(self, instrument_config):
        super().__init__(instrument_config)
        raw = instrument_config.get("address", "cDAQ1").strip()
        # Strip accidental "ModN" suffix — we only want the chassis name
        self._device = re.sub(r"Mod\d+$", "", raw)
        self._available_channels = set()  # populated by connect()
        self._tasks = {}       # channel_id -> nidaqmx.Task
        self._task_kind = {}   # channel_id -> "read" | "write"
        self._outputs = {}     # channel_id -> last written value (for readback)
        # Optional per-channel overrides from config
        self._channel_opts = instrument_config.get("channel_options", {})
        # Global timing defaults (can be overridden per-channel in channel_options)
        self._sample_rate = instrument_config.get("sample_rate", _DEFAULT_SAMPLE_RATE)
        self._samps_per_chan = instrument_config.get("samps_per_chan", _DEFAULT_SAMPS_PER_CHAN)

    # -- helpers ----------------------------------------------------------

    def _phys_name(self, channel_id):
        """Best-effort physical channel name for log messages."""
        try:
            m, k, i = _parse_channel_id(channel_id)
            return self._physical_channel(m, k, i)
        except ValueError:
            return channel_id

    def _physical_channel(self, module, kind, index):
        """Build the NI-DAQmx physical channel string.

        TC and RTD channels still use 'ai' on the hardware; the task
        configuration determines how the signal is interpreted.
        """
        hw_kind = "ao" if kind == "ao" else "ai"  # ai_poly, ai_custom also map to "ai"
        return f"{self._device}Mod{module}/{hw_kind}{index}"

    def _configure_hw_timing(self, task, channel_id=None):
        """Configure finite hardware-timed sampling on an AI task.

        Uses per-channel overrides from channel_options if available,
        otherwise falls back to the driver-level defaults.
        """
        opts = self._channel_opts.get(channel_id, {}) if channel_id else {}
        rate = opts.get("sample_rate", self._sample_rate)
        samps = opts.get("samps_per_chan", self._samps_per_chan)
        task.timing.cfg_samp_clk_timing(
            rate=rate,
            sample_mode=AcquisitionType.FINITE,
            samps_per_chan=samps,
        )

    def _read_hw_timed(self, task, num_channels=1):
        """Read from a finite-acquisition task, return the last sample(s).

        For a single-channel task, returns a single float.
        For a multi-channel task, returns a list of floats (one per channel).
        After reading, stops the task so it can be re-armed on the next call.
        """
        samps = task.timing.samp_quant_samp_per_chan
        data = task.read(number_of_samples_per_channel=samps)
        task.stop()  # re-arm for next finite acquisition

        if num_channels == 1:
            # Single channel: data is a list of floats [sample0, sample1, ...]
            if isinstance(data, list):
                return data[-1]
            return data
        else:
            # Multi-channel: data is list-of-lists [[ch0_s0, ch0_s1], [ch1_s0, ch1_s1], ...]
            return [ch_data[-1] if isinstance(ch_data, list) else ch_data for ch_data in data]

    def _get_or_create_task(self, channel_id):
        """Return an existing task or create a new one for *channel_id*."""
        if channel_id in self._tasks:
            return self._tasks[channel_id]

        module, kind, index = _parse_channel_id(channel_id)
        phys = self._physical_channel(module, kind, index)
        opts = self._channel_opts.get(channel_id, {})
        task = nidaqmx.Task()  # auto-generated name avoids collisions on reconnect

        try:
            if kind in ("ai", "ai_poly", "ai_custom"):
                task.ai_channels.add_ai_voltage_chan(
                    phys,
                    min_val=opts.get("min_val", -10.0),
                    max_val=opts.get("max_val", 10.0),
                )
            elif kind == "tc":
                tc_type = _TC_TYPE_MAP.get(
                    str(opts.get("tc_type", "K")).upper(), _TC_TYPE_DEFAULT
                )
                task.ai_channels.add_ai_thrmcpl_chan(
                    phys,
                    thermocouple_type=tc_type,
                    units=TemperatureUnits.DEG_C,
                )
            elif kind == "rtd":
                wire = _RTD_WIRE_MAP.get(
                    str(opts.get("rtd_wires", "3")), _RTD_WIRE_DEFAULT
                )
                task.ai_channels.add_ai_rtd_chan(
                    phys,
                    rtd_type=_RTD_TYPE_MAP.get(
                        str(opts.get("rtd_type", "PT_3750")).upper(), _RTD_TYPE_DEFAULT
                    ),
                    resistance_config=wire,
                    current_excit_source=ExcitationSource.INTERNAL,
                    current_excit_val=opts.get("excitation_current", 0.001),
                    r_0=opts.get("r0", _RTD_RESISTANCE_DEFAULT),
                    units=TemperatureUnits.DEG_C,
                )
            elif kind == "ao":
                task.ao_channels.add_ao_voltage_chan(
                    phys,
                    min_val=opts.get("min_val", -10.0),
                    max_val=opts.get("max_val", 10.0),
                )
            else:
                task.close()
                raise ValueError(f"Unknown channel kind '{kind}'")

            # Configure hardware-timed sampling for all AI tasks
            if kind != "ao":
                self._configure_hw_timing(task, channel_id)

        except nidaqmx.DaqError as exc:
            task.close()
            raise ConnectionError(
                f"Failed to create task for {channel_id} "
                f"(physical channel '{phys}'). "
                f"Is the correct card in slot {module}? "
                f"NI-DAQmx error: {exc}"
            ) from exc
        except Exception:
            task.close()
            raise

        self._tasks[channel_id] = task
        self._task_kind[channel_id] = "write" if kind == "ao" else "read"
        return task

    # -- DriverBase interface ---------------------------------------------

    def connect(self):
        """Verify the chassis is reachable and log what NI-DAQmx sees."""
        try:
            system = nidaqmx.system.System.local()
        except Exception as exc:
            raise ConnectionError(
                f"NI-DAQmx runtime not available: {exc}. "
                "Is the NI-DAQmx driver installed on this machine?"
            ) from exc

        all_devices = list(system.devices)
        if not all_devices:
            raise ConnectionError(
                "NI-DAQmx runtime loaded but no devices found. "
                "Check USB cable, power, and NI MAX."
            )

        # Log everything NI-DAQmx can see for troubleshooting
        log.info("--- NI-DAQmx device scan ---")
        for d in all_devices:
            try:
                ai = [c.name for c in d.ai_physical_channels]
                ao = [c.name for c in d.ao_physical_channels]
                log.info(
                    "  %s: %s  serial=%s  AI=%s  AO=%s",
                    d.name, d.product_type, d.dev_serial_num, ai, ao,
                )
            except Exception:
                log.info("  %s: (could not query details)", d.name)

        # Match our configured device prefix against discovered names
        matched = [d for d in all_devices if d.name.startswith(self._device)]
        if not matched:
            device_names = [d.name for d in all_devices]
            raise ConnectionError(
                f"NI-DAQmx device '{self._device}' not found. "
                f"Available devices: {device_names}. "
                "Check the 'Address / Device' field in the Instruments sheet "
                "matches what NI MAX shows (e.g. 'cDAQ1')."
            )

        # Report matched modules
        for d in matched:
            try:
                log.info(
                    "Matched module %s: %s (serial %s)",
                    d.name, d.product_type, d.dev_serial_num,
                )
            except Exception:
                log.info("Matched module %s", d.name)

        # Build set of available physical channels for validation
        self._available_channels = set()
        for d in matched:
            try:
                for c in d.ai_physical_channels:
                    self._available_channels.add(c.name)
                for c in d.ao_physical_channels:
                    self._available_channels.add(c.name)
            except Exception:
                pass

        log.info(
            "Connected to NI cDAQ chassis '%s' — %d module(s) found, "
            "%d physical channels available",
            self._device, len(matched), len(self._available_channels),
        )

    def validate_channel_id(self, channel_id):
        """Validate a channel ID. Returns (ok, error_message).

        Checks format against _CH_RE, then checks the physical channel
        exists in the hardware (if enumerate has run).
        """
        m = _CH_RE.match(channel_id)
        if not m:
            return False, (
                f"Invalid NI cDAQ channel ID '{channel_id}'. "
                "Expected format: Mod<slot>/<ai|tc|rtd|ao|ai_poly|ai_custom><index> "
                "(e.g. Mod1/ai0, Mod2/tc3, Mod3/rtd0, Mod4/ao1)"
            )
        module, kind, index = int(m.group(1)), m.group(2).lower(), int(m.group(3))
        # Check against discovered hardware channels (if available)
        if self._available_channels:
            phys = self._physical_channel(module, kind, index)
            if phys not in self._available_channels:
                return False, (
                    f"Channel '{channel_id}' maps to physical channel '{phys}' "
                    f"which was not found on the hardware. "
                    f"Available: {sorted(self._available_channels)}"
                )
        return True, ""

    def read_channels(self, channel_ids):
        """Batch-read multiple input channels in a single call.

        Groups channels by module and kind, creates (or reuses) a
        multi-channel task per group, and reads all channels in one
        DAQmx call.  Falls back to per-channel reads on error.

        Returns a list of floats in the same order as *channel_ids*.
        """
        # Group by (module, kind) for efficient multi-channel tasks
        groups = {}  # (module, kind) -> [(list_index, channel_id, index)]
        for i, cid in enumerate(channel_ids):
            try:
                module, kind, index = _parse_channel_id(cid)
                if kind == "ao":
                    continue  # output channels aren't batch-readable
                groups.setdefault((module, kind), []).append((i, cid, index))
            except ValueError:
                pass

        results = [float("nan")] * len(channel_ids)

        for (module, kind), members in groups.items():
            # Build a composite task key for caching.
            # Use ordered IDs (not sorted) — the task returns values in
            # the order channels were added, so the key must match that order.
            ordered_ids = tuple(m[1] for m in members)
            task_key = ("_batch", module, kind, ordered_ids)

            if task_key not in self._tasks:
                # Clean up any individual per-channel tasks for these
                # channels (left over from a previous fallback) so
                # NI-DAQmx doesn't reject the new batch task.
                for _, cid, _ in members:
                    if cid in self._tasks:
                        try:
                            self._tasks[cid].stop()
                            self._tasks[cid].close()
                        except Exception:
                            pass
                        del self._tasks[cid]
                        self._task_kind.pop(cid, None)

                task = nidaqmx.Task()
                try:
                    for _, cid, idx in members:
                        phys = self._physical_channel(module, kind, idx)
                        opts = self._channel_opts.get(cid, {})
                        if kind in ("ai", "ai_poly", "ai_custom"):
                            task.ai_channels.add_ai_voltage_chan(
                                phys,
                                min_val=opts.get("min_val", -10.0),
                                max_val=opts.get("max_val", 10.0),
                            )
                        elif kind == "tc":
                            tc_type = _TC_TYPE_MAP.get(
                                str(opts.get("tc_type", "K")).upper(), _TC_TYPE_DEFAULT
                            )
                            task.ai_channels.add_ai_thrmcpl_chan(
                                phys,
                                thermocouple_type=tc_type,
                                units=TemperatureUnits.DEG_C,
                            )
                        elif kind == "rtd":
                            wire = _RTD_WIRE_MAP.get(
                                str(opts.get("rtd_wires", "3")), _RTD_WIRE_DEFAULT
                            )
                            task.ai_channels.add_ai_rtd_chan(
                                phys,
                                rtd_type=_RTD_TYPE_MAP.get(
                                    str(opts.get("rtd_type", "PT_3750")).upper(),
                                    _RTD_TYPE_DEFAULT,
                                ),
                                resistance_config=wire,
                                current_excit_source=ExcitationSource.INTERNAL,
                                current_excit_val=opts.get("excitation_current", 0.001),
                                r_0=opts.get("r0", _RTD_RESISTANCE_DEFAULT),
                                units=TemperatureUnits.DEG_C,
                            )
                    # Hardware-timed sampling for the batch task.
                    # Use the first channel's opts for rate, or the global default.
                    first_cid = members[0][1]
                    self._configure_hw_timing(task, first_cid)

                except Exception as exc:
                    task.close()
                    log.warning("Batch task creation failed for Mod%d/%s: %s", module, kind, exc)
                    # Fall back to per-channel reads (use read_channel which
                    # creates its own individual tasks — safe here since the
                    # batch task was never cached)
                    for list_idx, cid, _ in members:
                        results[list_idx] = self.read_channel(cid)
                    continue
                self._tasks[task_key] = task

            # Read all channels in a single call
            try:
                task = self._tasks[task_key]
                values = self._read_hw_timed(task, num_channels=len(members))
                # Single-channel batch returns a scalar via _read_hw_timed
                if not isinstance(values, list):
                    values = [values]
                for (list_idx, cid, _), raw in zip(members, values):
                    if not math.isfinite(raw):
                        log.warning("Non-finite batch reading on %s: %s", cid, raw)
                        results[list_idx] = float("nan")
                        continue
                    # Post-read conversions
                    _, k, _ = _parse_channel_id(cid)
                    if k == "ai_poly":
                        opts = self._channel_opts.get(cid, {})
                        coeffs = opts.get("coefficients", [0, 1])
                        raw = _eval_polynomial(raw, coeffs)
                    elif k == "ai_custom":
                        raw = _custom_sensor_convert(raw)
                    results[list_idx] = raw
            except nidaqmx.DaqError as exc:
                log.warning("Batch read failed for Mod%d/%s: %s", module, kind, exc)
                # Invalidate cached batch task
                try:
                    self._tasks[task_key].stop()
                    self._tasks[task_key].close()
                except Exception:
                    pass
                del self._tasks[task_key]
                # Fall back to per-channel reads — these create individual
                # tasks in self._tasks keyed by channel_id (no collision
                # with batch keys which are tuples).
                for list_idx, cid, _ in members:
                    results[list_idx] = self.read_channel(cid)

        return results

    def read_channel(self, channel_id):
        """Read a single sample from *channel_id* and return a float.

        For ai_poly channels, applies a polynomial conversion using
        coefficients from channel_options (e.g. "coefficients": [c0, c1, c2]).
        For ai_custom channels, applies the hardcoded _custom_sensor_convert().

        Returns NaN on hardware error (open TC/RTD, cable fault, etc.)
        so the sampling loop stays alive.
        """
        try:
            task = self._get_or_create_task(channel_id)
            value = self._read_hw_timed(task, num_channels=1)
        except nidaqmx.DaqError as exc:
            log.warning(
                "DAQ read error on %s (phys=%s): %s",
                channel_id, self._phys_name(channel_id), exc,
            )
            return float("nan")
        except Exception:
            log.warning("Read failed for %s", channel_id, exc_info=True)
            return float("nan")
        if not math.isfinite(value):
            log.warning("Non-finite reading on %s: %s", channel_id, value)
            return float("nan")

        # Post-read conversions for special channel kinds
        _, kind, _ = _parse_channel_id(channel_id)
        if kind == "ai_poly":
            opts = self._channel_opts.get(channel_id, {})
            coeffs = opts.get("coefficients", [0, 1])  # default = passthrough
            value = _eval_polynomial(value, coeffs)
        elif kind == "ai_custom":
            value = _custom_sensor_convert(value)

        return value

    def write_channel(self, channel_id, value):
        """Write a single sample to *channel_id*."""
        try:
            task = self._get_or_create_task(channel_id)
            task.write(float(value))
            self._outputs[channel_id] = value
        except nidaqmx.DaqError as exc:
            log.warning(
                "DAQ write error on %s (phys=%s): %s",
                channel_id, self._phys_name(channel_id), exc,
            )
        except Exception:
            log.warning("Write failed for %s", channel_id, exc_info=True)

    def close(self):
        """Stop and close all nidaqmx tasks."""
        for cid, task in self._tasks.items():
            try:
                task.stop()
                task.close()
            except Exception:
                log.warning("Error closing task for %s", cid, exc_info=True)
        self._tasks.clear()
        self._task_kind.clear()
        self._outputs.clear()
        log.info("NI cDAQ driver closed.")
