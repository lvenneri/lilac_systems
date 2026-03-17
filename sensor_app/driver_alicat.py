"""Driver for Alicat mass flow meters / controllers / pressure controllers
over USB serial.

Tested with:
    K-H100B-SDS-S0A-KT-2D   (mass flow controller, USB)
    PCD-1000PSIA-D-PCA40/10P (dual-valve pressure controller, USB)

Alicat instruments appear as a virtual COM port when connected via USB.
Communication uses Alicat's ASCII serial protocol.

Instrument config fields:
    Address / Device : Serial port, e.g. "COM3" or "/dev/tty.usbserial-…"
    Query Command    : Unit ID character (default "A")
    Timeout (s)      : Serial timeout (default 2)
    Poll Rate (s)    : Minimum time between hardware polls

Channel ID format (used in the Excel config "Channel ID" column):
    P          – Absolute pressure
    T          – Gas temperature
    VOL_FLOW   – Volumetric flow rate
    MASS_FLOW  – Mass flow rate
    SETPOINT   – Setpoint (read back current SP; writable on controllers)
    GAS        – Gas index number (read-only)

For controllers, write to the SETPOINT channel to change the setpoint.
"""

import logging
import math
import time

import serial

from driver_base import DriverBase

log = logging.getLogger(__name__)

# Field positions in an Alicat polling response.
# Controller response: "A +014.60 +024.97 +000.00 +000.00 000.00 Air"
# Meter response:      "A +014.60 +024.97 +000.00 +000.00 Air"
# Index:                0  1        2       3        4      5     6  (controller)
#                       0  1        2       3        4      5        (meter)
_FIELD_NAMES_CONTROLLER = ["unit_id", "P", "T", "VOL_FLOW", "MASS_FLOW", "SETPOINT", "GAS"]
_FIELD_NAMES_METER = ["unit_id", "P", "T", "VOL_FLOW", "MASS_FLOW", "GAS"]

_VALID_CHANNELS = {"P", "T", "VOL_FLOW", "MASS_FLOW", "SETPOINT", "GAS"}

# Gas table index lookup (common gases) for interpreting GAS field
_GAS_TABLE = {
    "Air": 0, "Ar": 1, "CH4": 2, "CO": 3, "CO2": 4,
    "C2H6": 5, "H2": 6, "He": 7, "N2": 8, "N2O": 9,
    "Ne": 10, "O2": 11, "C3H8": 12, "SF6": 13, "C4H10": 14,
    "C2H2": 15, "C2H4": 16, "Kr": 17, "Xe": 18, "CF4": 19,
}


class AlicatDriver(DriverBase):
    """Driver for Alicat flow meters and controllers via USB serial."""

    def __init__(self, instrument_config):
        super().__init__(instrument_config)
        self._port = instrument_config.get("address", "").strip()
        self._unit_id = instrument_config.get("query_command", "A").strip() or "A"
        self._timeout_s = float(instrument_config.get("timeout", 2))
        self._baud = int(instrument_config.get("notes", "") or 19200)
        self._outputs = {}     # for readback compatibility
        self._ser = None       # serial.Serial handle
        self._is_controller = None  # True/False, detected on first poll

        # Cache: parsed fields from last poll
        self._cache = {}       # channel_id (upper) -> float
        self._cache_time = 0.0
        self._cache_max_age = float(instrument_config.get("poll_rate", 0.1))

    # ── Serial helpers ───────────────────────────────────────────────────

    def _send(self, cmd):
        """Send a command string (CR-terminated) to the Alicat."""
        log.debug("Alicat TX: %r", cmd)
        self._ser.reset_input_buffer()
        self._ser.write((cmd + "\r").encode("ascii"))

    def _readline(self):
        """Read one CR-terminated response line."""
        raw = self._ser.readline()
        line = raw.decode("ascii", errors="replace").strip()
        log.debug("Alicat RX: %r", line)
        if not line:
            raise TimeoutError(
                f"No response from Alicat unit '{self._unit_id}' "
                f"on {self._port}"
            )
        return line

    def _poll(self):
        """Send a poll command and parse the response into the cache."""
        self._send(self._unit_id)
        line = self._readline()

        fields = line.split()
        if not fields:
            log.warning("Empty Alicat response")
            return

        # Detect controller vs meter on first poll
        if self._is_controller is None:
            # Controllers have 7 fields, meters have 6
            if len(fields) >= 7:
                self._is_controller = True
                log.info("Alicat unit '%s': detected as CONTROLLER", self._unit_id)
            else:
                self._is_controller = False
                log.info("Alicat unit '%s': detected as METER", self._unit_id)

        field_names = _FIELD_NAMES_CONTROLLER if self._is_controller else _FIELD_NAMES_METER
        expected = len(field_names)

        if len(fields) < expected:
            log.warning(
                "Alicat response has %d fields, expected %d: %r",
                len(fields), expected, line,
            )

        for i, name in enumerate(field_names):
            if i >= len(fields) or name == "unit_id":
                continue
            raw = fields[i]
            if name == "GAS":
                # Convert gas name to index number
                self._cache["GAS"] = float(_GAS_TABLE.get(raw, -1))
            else:
                try:
                    self._cache[name] = float(raw)
                except ValueError:
                    log.warning("Cannot parse Alicat field %s: %r", name, raw)
                    self._cache[name] = float("nan")

        self._cache_time = time.monotonic()

    # ── DriverBase interface ─────────────────────────────────────────────

    def connect(self):
        """Open the USB serial connection and verify communication."""
        if not self._port:
            # Try to help find the port
            import serial.tools.list_ports
            ports = list(serial.tools.list_ports.comports())
            port_info = [(p.device, p.description, p.manufacturer) for p in ports]
            raise ConnectionError(
                "No serial port configured in 'Address / Device'. "
                f"Available ports: {port_info}"
            )

        log.info("Opening serial port %s (baud=%d, unit=%s)",
                 self._port, self._baud, self._unit_id)

        # List all ports for troubleshooting
        try:
            import serial.tools.list_ports
            ports = list(serial.tools.list_ports.comports())
            for p in ports:
                log.info("  Port: %s  desc=%s  mfg=%s  vid:pid=%s:%s",
                         p.device, p.description, p.manufacturer,
                         hex(p.vid) if p.vid else "?",
                         hex(p.pid) if p.pid else "?")
        except Exception:
            pass

        try:
            self._ser = serial.Serial(
                port=self._port,
                baudrate=self._baud,
                bytesize=serial.EIGHTBITS,
                parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_ONE,
                timeout=self._timeout_s,
                write_timeout=self._timeout_s,
            )
        except serial.SerialException as exc:
            raise ConnectionError(
                f"Cannot open serial port '{self._port}': {exc}. "
                "Check the port name, USB cable, and that no other "
                "application has the port open."
            ) from exc

        # Flush any startup garbage
        time.sleep(0.1)
        self._ser.reset_input_buffer()

        # Test communication with a poll
        try:
            self._poll()
        except TimeoutError as exc:
            raise ConnectionError(
                f"Alicat unit '{self._unit_id}' not responding on "
                f"{self._port} at {self._baud} baud. "
                "Check: (1) unit ID matches front-panel setting, "
                "(2) baud rate matches (default 19200), "
                "(3) USB cable is connected."
            ) from exc
        except Exception as exc:
            raise ConnectionError(
                f"Unexpected error polling Alicat on {self._port}: {exc}"
            ) from exc

        log.info(
            "Alicat unit '%s' connected on %s — %s, "
            "P=%.2f T=%.2f",
            self._unit_id, self._port,
            "controller" if self._is_controller else "meter",
            self._cache.get("P", 0), self._cache.get("T", 0),
        )

    def read_channel(self, channel_id):
        """Read a measurement from the Alicat."""
        key = channel_id.strip().upper()
        if key not in _VALID_CHANNELS:
            log.warning(
                "Unknown Alicat channel '%s'. Valid: %s",
                channel_id, sorted(_VALID_CHANNELS),
            )
            return float("nan")

        if key == "SETPOINT" and not self._is_controller:
            log.warning("SETPOINT read on a meter (unit '%s') — not available",
                        self._unit_id)
            return float("nan")

        # Use cache if fresh
        age = time.monotonic() - self._cache_time
        if age > self._cache_max_age or key not in self._cache:
            try:
                self._poll()
            except TimeoutError:
                log.warning("Alicat poll timeout on %s (unit %s)",
                            self._port, self._unit_id)
                return float("nan")
            except Exception:
                log.warning("Alicat poll failed", exc_info=True)
                return float("nan")

        value = self._cache.get(key, float("nan"))
        if not math.isfinite(value):
            log.warning("Non-finite reading on Alicat %s/%s: %s",
                        self._unit_id, channel_id, value)
        return value

    def write_channel(self, channel_id, value):
        """Write a setpoint to the Alicat controller."""
        key = channel_id.strip().upper()

        if key != "SETPOINT":
            log.debug("write_channel(%s) ignored — only SETPOINT is writable",
                      channel_id)
            self._outputs[channel_id] = value
            return

        if not self._is_controller:
            log.warning("Cannot write setpoint — unit '%s' is a meter, not a controller",
                        self._unit_id)
            return

        try:
            cmd = f"{self._unit_id}S{float(value):.4f}"
            self._send(cmd)
            resp = self._readline()
            self._outputs[channel_id] = value
            log.debug("Setpoint set to %.4f, response: %s", value, resp)
        except TimeoutError:
            log.warning("Alicat setpoint write timeout on %s", self._port)
        except Exception:
            log.warning("Alicat setpoint write failed", exc_info=True)

    def close(self):
        """Close the serial connection."""
        if self._ser and self._ser.is_open:
            try:
                self._ser.close()
            except Exception:
                log.warning("Error closing serial port", exc_info=True)
        self._ser = None
        self._cache.clear()
        log.info("Alicat driver closed (unit '%s').", self._unit_id)
