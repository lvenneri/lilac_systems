"""Driver for Yokogawa WT333E power analyzer over GPIB (via PyVISA).

Tested with: WT333E-C1-D-EX1 (3-element, GP-IB, D/A output, EX1 option)

Channel ID format (used in the Excel config "Channel ID" column):
    {function}{element}

    Elements: 1, 2, 3 (input elements), SIGMA (sum across elements)

    Per-element functions:
        U1, U2, U3        – RMS voltage (V)
        I1, I2, I3        – RMS current (A)
        P1, P2, P3        – Active power (W)
        S1, S2, S3        – Apparent power (VA)
        Q1, Q2, Q3        – Reactive power (var)
        LAMBDA1, LAMBDA2  – Power factor
        FU1, FU2, FU3     – Voltage frequency (Hz)
        FI1, FI2, FI3     – Current frequency (Hz)
        PHI1, PHI2, PHI3  – Phase angle (deg)
        UPP1, UPP2, UPP3  – Voltage peak-to-peak (V)
        IPP1, IPP2, IPP3  – Current peak-to-peak (A)

    Sigma functions:
        SIGMA_P            – Total active power (W)
        SIGMA_S            – Total apparent power (VA)
        SIGMA_Q            – Total reactive power (var)
        SIGMA_LAMBDA       – Total power factor

Instrument config fields:
    Address / Device : VISA resource string, e.g. "GPIB0::1::INSTR"
    Timeout (s)      : VISA timeout (default 5)
"""

import logging
import math
import re
import time

import pyvisa

from driver_base import DriverBase

log = logging.getLogger(__name__)

# ── Channel ID parsing ──────────────────────────────────────────────────

# "U1" → function="U", element="1"
# "SIGMA_P" → function="P", element="SIGMA"
_CH_SIGMA_RE = re.compile(r"^SIGMA_(\w+)$", re.IGNORECASE)
_CH_ELEM_RE = re.compile(r"^(\w+?)(\d)$", re.IGNORECASE)

# Functions the WT333E supports per element (used for validation)
_ELEMENT_FUNCTIONS = {
    "U", "I", "P", "S", "Q", "LAMBDA", "PHI",
    "FU", "FI", "UPP", "IPP", "UPPK", "IPPK",
}
_SIGMA_FUNCTIONS = {"P", "S", "Q", "LAMBDA"}


def _parse_channel_id(channel_id):
    """Return (function, element) strings for a WT333E numeric item.

    Returns e.g. ("U", "1") or ("P", "SIGMA").
    """
    cid = channel_id.strip()

    m = _CH_SIGMA_RE.match(cid)
    if m:
        func = m.group(1).upper()
        if func not in _SIGMA_FUNCTIONS:
            raise ValueError(
                f"Invalid sigma function '{func}' in '{channel_id}'. "
                f"Valid: {sorted(_SIGMA_FUNCTIONS)}"
            )
        return func, "SIGMA"

    m = _CH_ELEM_RE.match(cid)
    if m:
        func = m.group(1).upper()
        elem = m.group(2)
        if elem not in ("1", "2", "3"):
            raise ValueError(
                f"Invalid element '{elem}' in '{channel_id}'. Use 1, 2, or 3."
            )
        if func not in _ELEMENT_FUNCTIONS:
            raise ValueError(
                f"Unknown function '{func}' in '{channel_id}'. "
                f"Valid: {sorted(_ELEMENT_FUNCTIONS)}"
            )
        return func, elem

    raise ValueError(
        f"Cannot parse channel_id '{channel_id}'. "
        "Expected format: <FUNC><1|2|3> (e.g. U1, P3) "
        "or SIGMA_<FUNC> (e.g. SIGMA_P)."
    )


class YokogawaWtDriver(DriverBase):
    """Driver for Yokogawa WT300E-series power analyzers over GPIB/VISA."""

    def __init__(self, instrument_config):
        super().__init__(instrument_config)
        self._address = instrument_config.get("address", "GPIB0::1::INSTR").strip()
        self._timeout_s = float(instrument_config.get("timeout", 5))
        self._outputs = {}     # for readback compatibility
        self._rm = None        # pyvisa ResourceManager
        self._inst = None      # pyvisa instrument handle

        # Bulk-read cache: all numeric items from the last :NUMeric query
        self._cache = {}       # channel_id (upper) -> float
        self._cache_time = 0.0
        self._cache_max_age = float(instrument_config.get("poll_rate", 0.1))

        # Items we've been asked to read – built up lazily
        self._items = []       # [(channel_id, function, element), ...]
        self._items_set = set()
        self._items_dirty = True  # True = need to re-send :NUMeric config

    # ── VISA helpers ─────────────────────────────────────────────────────

    def _write(self, cmd):
        log.debug("GPIB TX: %s", cmd)
        self._inst.write(cmd)

    def _query(self, cmd):
        log.debug("GPIB TX: %s", cmd)
        resp = self._inst.query(cmd).strip()
        log.debug("GPIB RX: %s", resp[:200])
        return resp

    def _configure_numeric_items(self):
        """Push the current item list to the instrument's :NUMeric setup."""
        n = len(self._items)
        if n == 0:
            return
        self._write(f":NUMeric:NORMal:NUMBer {n}")
        for idx, (cid, func, elem) in enumerate(self._items, start=1):
            self._write(f":NUMeric:NORMal:ITEM{idx} {func},{elem}")
        self._items_dirty = False
        log.info("Configured %d numeric items on WT333E", n)

    def _ensure_item_registered(self, channel_id):
        """Register a channel_id for bulk reading if not already known."""
        key = channel_id.strip().upper()
        if key in self._items_set:
            return
        func, elem = _parse_channel_id(channel_id)
        self._items.append((key, func, elem))
        self._items_set.add(key)
        self._items_dirty = True

    def _bulk_read(self):
        """Query all configured numeric items at once and update cache."""
        if self._items_dirty:
            self._configure_numeric_items()

        if not self._items:
            return

        resp = self._query(":NUMeric:NORMal:VALue?")
        values = resp.split(",")

        for i, (cid, func, elem) in enumerate(self._items):
            if i < len(values):
                try:
                    val = float(values[i])
                except (ValueError, IndexError):
                    val = float("nan")
                    log.warning(
                        "Could not parse value for %s: '%s'",
                        cid, values[i] if i < len(values) else "(missing)",
                    )
            else:
                val = float("nan")
                log.warning("No value returned for item %d (%s)", i + 1, cid)
            self._cache[cid] = val

        self._cache_time = time.monotonic()

    # ── DriverBase interface ─────────────────────────────────────────────

    def connect(self):
        """Open GPIB connection and identify the instrument."""
        try:
            self._rm = pyvisa.ResourceManager()
        except Exception as exc:
            raise ConnectionError(
                f"PyVISA ResourceManager failed: {exc}. "
                "Is NI-VISA or pyvisa-py backend installed?"
            ) from exc

        # Log all visible VISA resources for troubleshooting
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
                "Check GPIB address, cable, and that the instrument is powered on."
            ) from exc

        self._inst.timeout = int(self._timeout_s * 1000)  # pyvisa uses ms

        # Identify
        try:
            idn = self._query("*IDN?")
            log.info("Connected to: %s", idn)
        except Exception as exc:
            raise ConnectionError(
                f"Instrument at '{self._address}' did not respond to *IDN?: {exc}. "
                "Check GPIB address matches front-panel setting."
            ) from exc

        if "WT" not in idn.upper():
            log.warning(
                "IDN response '%s' does not look like a Yokogawa WT instrument. "
                "Proceeding anyway.", idn,
            )

        # Configure for ASCII numeric output, clear errors
        self._write("*RST")
        self._write(":NUMeric:FORMat ASCii")
        self._write("*CLS")
        # Set to normal measurement mode (continuous)
        self._write(":INPut:MODE RMS")
        log.info(
            "Yokogawa WT driver ready on '%s' (timeout=%gs)",
            self._address, self._timeout_s,
        )

    def read_channel(self, channel_id):
        """Read a measurement from the WT333E.

        On the first call for a new channel_id, it is automatically added
        to the numeric item list.  All items are queried in a single bulk
        read and cached for the current scan cycle.
        """
        key = channel_id.strip().upper()
        self._ensure_item_registered(channel_id)

        # Use cache if fresh enough
        age = time.monotonic() - self._cache_time
        if age > self._cache_max_age or key not in self._cache:
            try:
                self._bulk_read()
            except pyvisa.errors.VisaIOError as exc:
                log.warning(
                    "VISA I/O error during bulk read (addr=%s): %s",
                    self._address, exc,
                )
                return float("nan")
            except Exception:
                log.warning("Bulk read failed", exc_info=True)
                return float("nan")

        value = self._cache.get(key, float("nan"))
        if not math.isfinite(value):
            log.warning("Non-finite reading on %s: %s", channel_id, value)
        return value

    def write_channel(self, channel_id, value):
        """Not applicable for a power analyzer — log and ignore."""
        log.debug("write_channel(%s, %s) ignored (read-only instrument)", channel_id, value)
        self._outputs[channel_id] = value

    def close(self):
        """Return to local control and close the VISA session."""
        if self._inst:
            try:
                self._write(":COMMunicate:REMote OFF")
            except Exception:
                pass
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
        log.info("Yokogawa WT driver closed.")
