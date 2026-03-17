"""Driver for Rigol DHO5000-series oscilloscopes over USB-TMC or LAN (PyVISA).

Tested with: DHO5058 (8-channel, 500 MHz)

Communication uses standard SCPI over PyVISA (USB-TMC, LXI/VXI-11, or raw socket).

Instrument config fields:
    Address / Device : VISA resource string, e.g.
                       "USB0::0x1AB1::0x0518::DS5A000000000::INSTR"
                       "TCPIP::192.168.1.100::INSTR"
    Timeout (s)      : VISA timeout (default 5)

Channel ID format (used in the Excel config "Channel ID" column):
    {measurement}{channel_number}

    Channel numbers: 1–8

    Voltage measurements:
        VPP1 … VPP8       – Peak-to-peak voltage
        VMAX1 … VMAX8     – Maximum voltage
        VMIN1 … VMIN8     – Minimum voltage
        VAVG1 … VAVG8     – Average voltage
        VRMS1 … VRMS8     – RMS voltage
        VAMP1 … VAMP8     – Amplitude (VTOP - VBASE)
        VTOP1 … VTOP8     – Top voltage (flat top)
        VBASE1 … VBASE8   – Base voltage (flat bottom)

    Timing measurements:
        FREQ1 … FREQ8     – Frequency (Hz)
        PER1 … PER8       – Period (s)
        RISE1 … RISE8     – Rise time (s)
        FALL1 … FALL8     – Fall time (s)
        PWID1 … PWID8     – Positive pulse width (s)
        NWID1 … NWID8     – Negative pulse width (s)

    Duty cycle:
        PDUT1 … PDUT8     – Positive duty cycle (%)
        NDUT1 … NDUT8     – Negative duty cycle (%)

    Other:
        OVER1 … OVER8     – Overshoot (%)
        PRES1 … PRES8     – Preshoot (%)
"""

import logging
import math
import re
import time

import pyvisa

from driver_base import DriverBase

log = logging.getLogger(__name__)

# ── Channel ID parsing ──────────────────────────────────────────────────

# Map short names used in channel_id -> Rigol SCPI :MEASure item keywords
_MEAS_MAP = {
    "VPP":   "VPP",
    "VMAX":  "VMAX",
    "VMIN":  "VMIN",
    "VAVG":  "VAVG",
    "VRMS":  "VRMS",
    "VAMP":  "VAMP",
    "VTOP":  "VTOP",
    "VBASE": "VBASE",
    "FREQ":  "FREQuency",
    "PER":   "PERiod",
    "RISE":  "RTIMe",
    "FALL":  "FTIMe",
    "PWID":  "PWIDth",
    "NWID":  "NWIDth",
    "PDUT":  "PDUTy",
    "NDUT":  "NDUTy",
    "OVER":  "OVERshoot",
    "PRES":  "PREShoot",
}

_CH_RE = re.compile(
    r"^(" + "|".join(sorted(_MEAS_MAP.keys(), key=len, reverse=True)) + r")(\d)$",
    re.IGNORECASE,
)


def _parse_channel_id(channel_id):
    """Return (scpi_item, channel_number) or raise ValueError."""
    cid = channel_id.strip()
    m = _CH_RE.match(cid)
    if not m:
        raise ValueError(
            f"Cannot parse channel_id '{channel_id}'. "
            f"Expected format: <MEAS><1-8> where MEAS is one of "
            f"{sorted(_MEAS_MAP.keys())}. Example: VRMS1, FREQ4"
        )
    meas_key = m.group(1).upper()
    ch_num = int(m.group(2))
    if ch_num < 1 or ch_num > 8:
        raise ValueError(
            f"Channel number {ch_num} out of range in '{channel_id}'. "
            "DHO5058 has channels 1–8."
        )
    scpi_item = _MEAS_MAP[meas_key]
    return scpi_item, ch_num


class RigolDhoDriver(DriverBase):
    """Driver for Rigol DHO5000-series oscilloscopes via PyVISA."""

    def __init__(self, instrument_config):
        super().__init__(instrument_config)
        self._address = instrument_config.get("address", "").strip()
        self._timeout_s = float(instrument_config.get("timeout", 5))
        self._outputs = {}     # for readback compatibility
        self._rm = None
        self._inst = None

        # Per-measurement cache to avoid redundant SCPI queries in one scan
        self._cache = {}       # channel_id (upper) -> float
        self._cache_time = 0.0
        self._cache_max_age = float(instrument_config.get("poll_rate", 0.1))

        # Track which measurements have been enabled on the scope
        self._enabled_meas = set()  # (scpi_item, ch_num)

    # ── VISA helpers ─────────────────────────────────────────────────────

    def _write(self, cmd):
        log.debug("RIGOL TX: %s", cmd)
        self._inst.write(cmd)

    def _query(self, cmd):
        log.debug("RIGOL TX: %s", cmd)
        resp = self._inst.query(cmd).strip()
        log.debug("RIGOL RX: %s", resp[:200])
        return resp

    def _enable_measurement(self, scpi_item, ch_num):
        """Enable a measurement on the scope if not already active."""
        key = (scpi_item, ch_num)
        if key in self._enabled_meas:
            return
        try:
            self._write(f":MEASure:ITEM {scpi_item},CHANnel{ch_num}")
            self._enabled_meas.add(key)
            log.info("Enabled measurement %s on CH%d", scpi_item, ch_num)
        except Exception:
            log.warning("Failed to enable %s on CH%d", scpi_item, ch_num,
                        exc_info=True)

    # ── DriverBase interface ─────────────────────────────────────────────

    def connect(self):
        """Open VISA connection and identify the oscilloscope."""
        if not self._address:
            try:
                rm = pyvisa.ResourceManager()
                resources = rm.list_resources()
                rm.close()
            except Exception:
                resources = ()
            raise ConnectionError(
                "No VISA address configured in 'Address / Device'. "
                f"Available resources: {list(resources)}"
            )

        try:
            self._rm = pyvisa.ResourceManager()
        except Exception as exc:
            raise ConnectionError(
                f"PyVISA ResourceManager failed: {exc}. "
                "Is NI-VISA or pyvisa-py backend installed?"
            ) from exc

        # Log all VISA resources for troubleshooting
        try:
            resources = self._rm.list_resources()
            log.info("VISA resources found: %s", resources)
        except Exception:
            log.info("Could not enumerate VISA resources")
            resources = ()

        if self._address not in resources and resources:
            log.warning(
                "Configured address '%s' not in resource list %s",
                self._address, resources,
            )

        try:
            self._inst = self._rm.open_resource(self._address)
        except Exception as exc:
            raise ConnectionError(
                f"Could not open '{self._address}': {exc}. "
                "Check the connection (USB cable / network) and that "
                "the scope is powered on."
            ) from exc

        self._inst.timeout = int(self._timeout_s * 1000)

        # Identify
        try:
            idn = self._query("*IDN?")
            log.info("Connected to: %s", idn)
        except Exception as exc:
            raise ConnectionError(
                f"Instrument at '{self._address}' did not respond to *IDN?: {exc}"
            ) from exc

        if "RIGOL" not in idn.upper():
            log.warning(
                "IDN response '%s' does not look like a Rigol instrument. "
                "Proceeding anyway.", idn,
            )

        self._write("*CLS")
        log.info(
            "Rigol DHO driver ready on '%s' (timeout=%gs)",
            self._address, self._timeout_s,
        )

    def read_channel(self, channel_id):
        """Read a measurement from the oscilloscope."""
        key = channel_id.strip().upper()

        try:
            scpi_item, ch_num = _parse_channel_id(channel_id)
        except ValueError as exc:
            log.warning("Bad channel_id: %s", exc)
            return float("nan")

        self._enable_measurement(scpi_item, ch_num)

        # Use cache if fresh
        age = time.monotonic() - self._cache_time
        if age <= self._cache_max_age and key in self._cache:
            return self._cache[key]

        # Query the specific measurement
        try:
            resp = self._query(
                f":MEASure:ITEM? {scpi_item},CHANnel{ch_num}"
            )
            # Rigol returns "9.9E37" for invalid / no-signal measurements
            value = float(resp)
            if value >= 9.8e37:
                value = float("nan")
                log.debug("No signal for %s on CH%d", scpi_item, ch_num)
        except pyvisa.errors.VisaIOError as exc:
            log.warning(
                "VISA I/O error reading %s CH%d (addr=%s): %s",
                scpi_item, ch_num, self._address, exc,
            )
            return float("nan")
        except (ValueError, TypeError):
            log.warning(
                "Cannot parse response for %s CH%d: %r",
                scpi_item, ch_num, resp,
            )
            value = float("nan")
        except Exception:
            log.warning("Read failed for %s", channel_id, exc_info=True)
            return float("nan")

        self._cache[key] = value
        self._cache_time = time.monotonic()

        if not math.isfinite(value):
            log.warning("Non-finite reading on %s: %s", channel_id, value)
        return value

    def write_channel(self, channel_id, value):
        """Not applicable for an oscilloscope — log and ignore."""
        log.debug("write_channel(%s, %s) ignored (read-only instrument)",
                  channel_id, value)
        self._outputs[channel_id] = value

    def close(self):
        """Close the VISA session."""
        if self._inst:
            try:
                self._inst.close()
            except Exception:
                log.warning("Error closing VISA session", exc_info=True)
            self._inst = None
        if self._rm:
            try:
                self._rm.close()
            except Exception:
                pass
            self._rm = None
        self._cache.clear()
        self._enabled_meas.clear()
        log.info("Rigol DHO driver closed.")
