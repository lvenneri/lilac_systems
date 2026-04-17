"""Driver for Julabo MAGIO MX circulators / refrigerated circulators
over USB serial (RS232) or Ethernet TCP.

Tested with:
    MAGIO MX series (bridge-mounted, heating, refrigerated circulators)

Communication uses Julabo's ASCII command protocol (IN/OUT commands).
Serial default: 4800 baud, 7 data bits, even parity, 1 stop bit.

Instrument config fields:
    Address / Device : Serial port (e.g. "/dev/ttyUSB0", "COM3") or
                       TCP address (e.g. "192.168.1.100:49200")
    Query Command    : "serial" (default) or "tcp"
    Timeout (s)      : Communication timeout (default 2)
    Poll Rate (s)    : Minimum time between hardware polls
    Notes            : Baud rate override (default 4800)

Channel ID format (used in the Excel config "Channel ID" column):
    BATH_TEMP    - Internal bath temperature (read-only)
    EXT_TEMP     - External Pt100 temperature (read-only)
    SETPOINT     - Setpoint temperature (read/write)
    POWER        - Current heating/cooling power % (read-only)
    SAFETY_TEMP  - Safety sensor temperature (read-only)
    HI_CUTOFF    - High temperature cut-off setting (read-only)
    LEVEL        - Bath fluid filling level % (read-only)
    PUMP         - Pump capacity % (read/write)
    START_STOP   - 0=standby, 1=running (read/write, requires remote mode)
    RAMP_RATE    - Software ramp rate in K/min (write-only, 0=instant)

RAMP_RATE notes:
    The Julabo hardware programmer supports gradient ramps, but only via the
    touchscreen menu.  This driver implements a software ramp: when RAMP_RATE
    is set > 0, writing to SETPOINT will step the hardware setpoint gradually
    at that rate.  Set RAMP_RATE to 0 to jump to the target instantly.
"""

import logging
import math
import socket
import threading
import time

import serial

from driver_base import DriverBase

log = logging.getLogger(__name__)

# Valid readable channels and their IN commands
_READ_COMMANDS = {
    "BATH_TEMP":   "in_pv_00",
    "EXT_TEMP":    "in_pv_02",
    "SETPOINT":    "in_sp_00",
    "POWER":       "in_pv_01",
    "SAFETY_TEMP": "in_pv_03",
    "HI_CUTOFF":   "in_pv_04",
    "LEVEL":       "in_pv_16",
    "PUMP":        "in_sp_27",
    "START_STOP":  "in_mode_05",
}

# Writable channels and their OUT commands (value appended after space)
_WRITE_COMMANDS = {
    "SETPOINT":   "out_sp_00",
    "PUMP":       "out_sp_27",
    "START_STOP": "out_mode_05",
}

_VALID_CHANNELS = set(_READ_COMMANDS) | {"RAMP_RATE"}


class JulaboDriver(DriverBase):
    """Driver for Julabo MAGIO MX circulators via RS232/USB or Ethernet."""

    def __init__(self, instrument_config):
        super().__init__(instrument_config)
        self._address = instrument_config.get("address", "").strip()
        self._mode = (instrument_config.get("query_command", "")
                      .strip().lower() or "serial")
        self._timeout_s = float(instrument_config.get("timeout", 2))
        self._baud = int(instrument_config.get("notes", "") or 4800)

        # Communication handle
        self._ser = None    # serial.Serial (serial mode)
        self._sock = None   # socket (tcp mode)
        self._lock = threading.Lock()

        # Cache: channel -> (float_value, monotonic_timestamp)
        self._cache = {}
        self._cache_max_age = float(instrument_config.get("poll_rate", 0.5))

        # Software ramp state
        self._ramp_rate = 0.0       # K/min, 0 = instant
        self._ramp_target = None    # target setpoint (None = no ramp active)
        self._ramp_current = None   # last setpoint sent to hardware
        self._ramp_last_time = None
        self._ramp_thread = None
        self._ramp_stop = threading.Event()

        self._outputs = {}

    # -- Low-level communication -----------------------------------------------

    def _send_recv(self, cmd, expect_response=True):
        """Send a command and return the response string.

        Protocol: send command + CR, receive response + CR + LF.
        OUT commands may not return a response on some firmware versions,
        so *expect_response=False* suppresses the timeout error.
        """
        with self._lock:
            if self._mode == "tcp":
                return self._tcp_send_recv(cmd, expect_response)
            else:
                return self._serial_send_recv(cmd, expect_response)

    def _serial_send_recv(self, cmd, expect_response=True):
        log.debug("Julabo TX: %r", cmd)
        self._ser.reset_input_buffer()
        self._ser.write((cmd + "\r").encode("ascii"))
        raw = self._ser.readline()
        line = raw.decode("ascii", errors="replace").strip()
        log.debug("Julabo RX: %r", line)
        if not line and expect_response:
            raise TimeoutError(f"No response from Julabo on {self._address}")
        return line

    def _tcp_send_recv(self, cmd, expect_response=True):
        log.debug("Julabo TX (TCP): %r", cmd)
        self._sock.sendall((cmd + "\r").encode("ascii"))
        buf = b""
        deadline = time.monotonic() + self._timeout_s
        while time.monotonic() < deadline:
            try:
                chunk = self._sock.recv(256)
            except socket.timeout:
                break
            if not chunk:
                break
            buf += chunk
            if b"\r\n" in buf or b"\n" in buf:
                break
        line = buf.decode("ascii", errors="replace").strip()
        log.debug("Julabo RX (TCP): %r", line)
        if not line and expect_response:
            raise TimeoutError(
                f"No response from Julabo at {self._address}")
        return line

    def _query(self, in_cmd):
        """Send an IN command and parse the numeric response."""
        resp = self._send_recv(in_cmd)
        try:
            return float(resp)
        except ValueError:
            log.warning("Cannot parse Julabo response for %s: %r",
                        in_cmd, resp)
            return float("nan")

    def _command(self, out_cmd, value):
        """Send an OUT command with a parameter value.

        OUT commands may or may not echo a response depending on firmware.
        We attempt to read one but don't fail if nothing comes back.
        """
        cmd = f"{out_cmd} {value}"
        resp = self._send_recv(cmd, expect_response=False)
        log.debug("Julabo command %s -> %r", cmd, resp)
        return resp

    # -- Software ramp ---------------------------------------------------------

    def _ramp_worker(self):
        """Background thread that steps the hardware setpoint toward target."""
        log.info("Julabo ramp thread started (rate=%.2f K/min, target=%.2f)",
                 self._ramp_rate, self._ramp_target)
        while not self._ramp_stop.is_set():
            now = time.monotonic()
            rate = self._ramp_rate  # K/min
            target = self._ramp_target
            current = self._ramp_current

            if target is None or current is None or rate <= 0:
                break

            dt_min = (now - self._ramp_last_time) / 60.0
            self._ramp_last_time = now

            diff = target - current
            max_step = rate * dt_min

            if abs(diff) <= max_step:
                # Reached target
                new_sp = target
            else:
                new_sp = current + math.copysign(max_step, diff)

            try:
                self._command(_WRITE_COMMANDS["SETPOINT"], f"{new_sp:.2f}")
                self._ramp_current = new_sp
                log.debug("Ramp step: %.2f -> %.2f (target %.2f)",
                          current, new_sp, target)
            except Exception:
                log.warning("Ramp setpoint write failed", exc_info=True)

            if abs(new_sp - target) < 0.005:
                log.info("Ramp complete: setpoint = %.2f", target)
                self._ramp_target = None
                break

            # Step interval: aim for ~0.5 K steps or 1 second, whichever is shorter
            step_interval = max(0.5, 0.5 / (rate / 60.0 + 0.001))
            step_interval = min(step_interval, 2.0)
            self._ramp_stop.wait(step_interval)

        log.debug("Julabo ramp thread exiting")

    def _start_ramp(self, target):
        """Begin ramping to a new setpoint."""
        self._stop_ramp()

        # Read current hardware setpoint as ramp starting point
        if self._ramp_current is None:
            try:
                self._ramp_current = self._query("in_sp_00")
            except Exception:
                self._ramp_current = target  # fallback: jump

        self._ramp_target = target
        self._ramp_last_time = time.monotonic()
        self._ramp_stop.clear()
        self._ramp_thread = threading.Thread(
            target=self._ramp_worker, daemon=True,
            name="julabo-ramp")
        self._ramp_thread.start()

    def _stop_ramp(self):
        """Stop any active ramp."""
        if self._ramp_thread and self._ramp_thread.is_alive():
            self._ramp_stop.set()
            self._ramp_thread.join(timeout=3)
        self._ramp_target = None

    # -- DriverBase interface ---------------------------------------------------

    def connect(self):
        if self._mode == "tcp":
            self._connect_tcp()
        else:
            self._connect_serial()

        # Verify communication — IN commands work regardless of remote mode
        try:
            temp = self._query("in_pv_00")
            sp = self._query("in_sp_00")
        except TimeoutError as exc:
            raise ConnectionError(
                f"Julabo not responding on {self._address}. "
                "Check: (1) correct port/address, "
                f"(2) baud rate matches (trying {self._baud}), "
                "(3) cable is connected."
            ) from exc

        # Check operating status via the 'status' command
        try:
            status_str = self._send_recv("status")
            log.info("Julabo status: %s", status_str)
            # Status "02 REMOTE STOP" or "03 REMOTE START" means remote is on.
            # "00 MANUAL STOP" / "01 MANUAL START" means writes won't work.
            if status_str.startswith("00") or status_str.startswith("01"):
                log.warning(
                    "Julabo is in MANUAL mode (%s). "
                    "OUT commands (setpoint, start/stop) will NOT work. "
                    "Enable remote control on the unit: Main menu > "
                    "Connect unit > Remote control > select USB/Serial/Ethernet.",
                    status_str,
                )
        except Exception:
            log.debug("Could not read Julabo status", exc_info=True)

        log.info("Julabo connected: bath=%.2f C, setpoint=%.2f C", temp, sp)

    def _connect_serial(self):
        if not self._address:
            import serial.tools.list_ports
            ports = [(p.device, p.description) for p
                     in serial.tools.list_ports.comports()]
            raise ConnectionError(
                "No serial port configured. "
                f"Available ports: {ports}")

        log.info("Opening Julabo serial: %s (baud=%d, 7E1)",
                 self._address, self._baud)
        try:
            self._ser = serial.Serial(
                port=self._address,
                baudrate=self._baud,
                bytesize=serial.SEVENBITS,
                parity=serial.PARITY_EVEN,
                stopbits=serial.STOPBITS_ONE,
                timeout=self._timeout_s,
                write_timeout=self._timeout_s,
                rtscts=True,           # hardware handshake
            )
        except serial.SerialException as exc:
            raise ConnectionError(
                f"Cannot open serial port '{self._address}': {exc}"
            ) from exc

        time.sleep(0.2)
        self._ser.reset_input_buffer()

    def _connect_tcp(self):
        parts = self._address.rsplit(":", 1)
        host = parts[0]
        port = int(parts[1]) if len(parts) > 1 else 49200
        log.info("Connecting to Julabo via TCP: %s:%d", host, port)
        try:
            self._sock = socket.create_connection(
                (host, port), timeout=self._timeout_s)
            self._sock.settimeout(self._timeout_s)
        except OSError as exc:
            raise ConnectionError(
                f"Cannot connect to Julabo at {host}:{port}: {exc}"
            ) from exc

    def read_channel(self, channel_id):
        key = channel_id.strip().upper()

        if key == "RAMP_RATE":
            return self._ramp_rate

        if key not in _READ_COMMANDS:
            log.warning("Unknown Julabo channel '%s'. Valid: %s",
                        channel_id, sorted(_VALID_CHANNELS))
            return float("nan")

        # Use per-channel cache if fresh enough
        now = time.monotonic()
        cached = self._cache.get(key)
        if cached is not None:
            val, ts = cached
            if (now - ts) <= self._cache_max_age:
                return val

        # Query this single channel from hardware
        cmd = _READ_COMMANDS[key]
        try:
            val = self._query(cmd)
            self._cache[key] = (val, now)
            return val
        except TimeoutError:
            log.warning("Julabo poll timeout reading %s on %s",
                        key, self._address)
        except Exception:
            log.warning("Julabo poll failed reading %s", key, exc_info=True)

        # Return stale cache or NaN
        if cached is not None:
            return cached[0]
        return float("nan")

    def write_channel(self, channel_id, value):
        key = channel_id.strip().upper()
        self._outputs[channel_id] = value

        if key == "RAMP_RATE":
            self._ramp_rate = max(0.0, float(value))
            log.info("Julabo ramp rate set to %.2f K/min", self._ramp_rate)
            return

        if key == "SETPOINT":
            fval = float(value)
            if self._ramp_rate > 0:
                # Use software ramp
                self._start_ramp(fval)
                log.info("Julabo ramping to %.2f at %.2f K/min",
                         fval, self._ramp_rate)
                return
            else:
                # Instant setpoint change
                self._stop_ramp()
                try:
                    self._command("out_sp_00", f"{fval:.2f}")
                    self._ramp_current = fval
                    log.info("Julabo setpoint -> %.2f", fval)
                except Exception:
                    log.warning("Julabo setpoint write failed", exc_info=True)
                return

        if key == "START_STOP":
            ival = int(float(value))
            if ival not in (0, 1):
                log.warning("START_STOP must be 0 or 1, got %s", value)
                return
            try:
                self._command("out_mode_05", str(ival))
                log.info("Julabo %s", "started" if ival else "stopped")
            except Exception:
                log.warning("Julabo start/stop write failed", exc_info=True)
            return

        if key == "PUMP":
            ival = max(40, min(100, int(float(value))))
            try:
                self._command("out_sp_27", str(ival))
                log.info("Julabo pump -> %d%%", ival)
            except Exception:
                log.warning("Julabo pump write failed", exc_info=True)
            return

        if key not in _WRITE_COMMANDS:
            log.debug("write_channel(%s) ignored - not writable", channel_id)

    def close(self):
        self._stop_ramp()
        if self._ser and self._ser.is_open:
            try:
                self._ser.close()
            except Exception:
                log.warning("Error closing Julabo serial port", exc_info=True)
        self._ser = None
        if self._sock:
            try:
                self._sock.close()
            except Exception:
                pass
        self._sock = None
        self._cache.clear()
        log.info("Julabo driver closed.")


if __name__ == "__main__":
    import sys
    import traceback
    from datetime import datetime

    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    addr = sys.argv[1] if len(sys.argv) > 1 else "/dev/ttyUSB0"
    mode = sys.argv[2] if len(sys.argv) > 2 else "serial"
    config = {
        "address": addr,
        "query_command": mode,
        "timeout": 2,
        "poll_rate": 0.5,
    }

    channels = ["BATH_TEMP", "EXT_TEMP", "SETPOINT", "POWER",
                "SAFETY_TEMP", "LEVEL", "PUMP", "START_STOP"]

    print(f"Julabo test - address: {addr}, mode: {mode}")
    print(f"Channels: {channels}")

    drv = JulaboDriver(config)
    try:
        drv.connect()
        for i in range(10):
            values = {ch: drv.read_channel(ch) for ch in channels}
            print(f"[{datetime.now():%H:%M:%S.%f}] #{i+1:02d}  {values}")
            time.sleep(2)
    except KeyboardInterrupt:
        print("\nStopped.")
    except Exception:
        traceback.print_exc()
    finally:
        drv.close()
