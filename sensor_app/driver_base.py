"""Abstract instrument driver base + simulated driver + driver registry."""

import abc
import math
import random
import time

from thermal_model import ThermalModel


class DriverBase(abc.ABC):
    """Abstract driver. One instance per instrument in the config."""

    def __init__(self, instrument_config):
        self.config = instrument_config

    @abc.abstractmethod
    def connect(self):
        pass

    @abc.abstractmethod
    def read_channel(self, channel_id):
        """Read a single channel value (raw, before slope/offset)."""
        pass

    @abc.abstractmethod
    def write_channel(self, channel_id, value):
        """Write a value to an output channel (raw, after inverse scaling)."""
        pass

    @abc.abstractmethod
    def close(self):
        pass


class SimulatedDriver(DriverBase):
    """Generates all the current demo sensors plus a thermal reactor model."""

    def __init__(self, instrument_config):
        super().__init__(instrument_config)
        self.thermal = ThermalModel(initial_temp=25.0, ambient=25.0)
        self._heater_pct = 0.0
        self._last_time = None
        self._outputs = {}  # channel_id -> value

    def connect(self):
        self._last_time = time.time()

    def _get_cpu_temperature(self):
        try:
            with open("/sys/class/thermal/thermal_zone0/temp", "r") as f:
                return float(f.read().strip()) / 1000.0
        except Exception:
            return random.uniform(40, 80)

    def read_channel(self, channel_id):
        now = time.time()
        dt = now - self._last_time if self._last_time else 0.1
        self._last_time = now

        if channel_id == "ai0":     # reactor_temp
            return self.thermal.step(self._heater_pct, dt)
        elif channel_id == "ai1":   # cpu_temp
            return self._get_cpu_temperature()
        elif channel_id == "ai2":   # ambient_temp
            return random.uniform(20, 30)
        elif channel_id == "ai3":   # humidity
            return random.uniform(30, 70)
        elif channel_id == "ai4":   # pressure
            return random.uniform(950, 1050)
        elif channel_id == "ai5":   # rotation.x
            return random.uniform(0, 2 * math.pi)
        elif channel_id == "ai6":   # rotation.y
            return random.uniform(0, 2 * math.pi)
        elif channel_id == "ai7":   # rotation.z
            return random.uniform(0, 2 * math.pi)
        elif channel_id == "ai8":   # dial1
            return random.uniform(0, 100)
        elif channel_id == "ai9":   # dial2
            return random.uniform(0, 100)
        elif channel_id == "ai10":  # temperature
            return random.uniform(20, 30)
        else:
            return 0.0

    def write_channel(self, channel_id, value):
        self._outputs[channel_id] = value
        if channel_id == "ao0":     # heater_output
            self._heater_pct = max(0.0, min(100.0, value))
        # ao1 (dummy_output_slider) and ao2 (dummy_output_selector) just store

    def close(self):
        pass


class SimPump(DriverBase):
    """Simulated centrifugal pump with throttle valve.

    Write channels:
        "speed" — commanded pump RPM (0-3600)
        "valve" — valve position 0-100% (0 = closed, 100 = fully open)

    Read channels:
        "flow"  — flow rate (LPM)
        "head"  — pump differential pressure (PSId)
        "power" — shaft power (W)
        "speed" — actual RPM (ramped)
        "valve" — actual valve position (ramped)

    Model: parabolic pump H-Q curve (affinity-law scaled) intersected
    with a quadratic system/valve curve.  Valve Cv controls the system
    resistance — closing the valve raises the system curve, reducing flow
    and increasing head toward shutoff.
    """

    # Rated operating point (at full speed, valve fully open)
    RATED_RPM = 3600.0
    RATED_FLOW = 60.0     # LPM at rated RPM, valve 100%
    RATED_HEAD = 30.0     # PSId shutoff head at rated RPM
    EFFICIENCY_BEP = 0.65

    def __init__(self, instrument_config):
        super().__init__(instrument_config)
        self._rpm = 0.0               # commanded speed
        self._current_rpm = 0.0       # actual speed (ramps)
        self._valve_cmd = 100.0       # commanded valve %
        self._current_valve = 100.0   # actual valve % (ramps)
        self._last_time = None
        self._rng = random.Random()
        self._outputs = {}            # for _read_output_value compatibility
        # Cache last computed values so multiple read_channel calls
        # in the same sample cycle return consistent data
        self._cache = (0.0, 0.0, 0.0)
        self._cache_time = 0.0

    def connect(self):
        self._last_time = time.time()

    def _step(self):
        """Advance the simulation and return (flow, head, power)."""
        now = time.time()
        dt = now - self._last_time if self._last_time else 0.1
        self._last_time = now

        # Return cached values if called multiple times in the same ms
        if abs(now - self._cache_time) < 0.001:
            return self._cache

        # Ramp actual RPM toward commanded (motor inertia, ~1s tau)
        a_rpm = 1.0 - math.exp(-dt / 1.0)
        self._current_rpm += (self._rpm - self._current_rpm) * a_rpm

        # Ramp actual valve toward commanded (actuator, ~0.5s tau)
        a_vlv = 1.0 - math.exp(-dt / 0.5)
        self._current_valve += (self._valve_cmd - self._current_valve) * a_vlv

        rpm = max(0.0, self._current_rpm)
        valve_pct = max(0.0, min(100.0, self._current_valve))

        if rpm < 1.0:
            self._cache = (0.0, 0.0, 0.0)
            self._cache_time = now
            return self._cache

        # Affinity-law ratio
        n = rpm / self.RATED_RPM

        # Pump curve (parabolic): H_pump(Q) = shutoff_head * (1 - (Q/Qmax)^2)
        shutoff_head = self.RATED_HEAD * n * n
        max_flow = self.RATED_FLOW * n

        # System/valve curve: H_sys(Q) = k * Q^2
        # k depends on valve position.  At 100% open, system head = ~10% of
        # shutoff at rated flow.  At 0% (closed), k → very large (no flow).
        # Cv scales roughly with valve_pct^2 (equal-percentage characteristic).
        valve_frac = (valve_pct / 100.0) ** 2
        valve_frac = max(valve_frac, 0.001)  # never fully zero
        # k such that at valve=100%, H_sys(Qmax) = 0.1 * shutoff_head_rated
        k_open = 0.1 * self.RATED_HEAD / (self.RATED_FLOW ** 2) if self.RATED_FLOW > 0 else 1.0
        k = k_open / valve_frac

        # Intersection of pump curve and system curve:
        # shutoff_head * (1 - (Q/Qmax)^2) = k * Q^2
        # shutoff_head = Q^2 * (shutoff_head/Qmax^2 + k)
        # Q^2 = shutoff_head / (shutoff_head/Qmax^2 + k)
        if max_flow > 0 and shutoff_head > 0:
            denom = shutoff_head / (max_flow * max_flow) + k
            q_sq = shutoff_head / denom
            flow = math.sqrt(max(0.0, q_sq))
        else:
            flow = 0.0

        head = k * flow * flow

        # Power from hydraulic power / efficiency
        eff = self.EFFICIENCY_BEP * min(1.0, (n / 0.3) ** 2) if n > 0 else 0.01
        eff = max(eff, 0.01)
        # P_hyd = head [psi] * 6894.76 [Pa/psi] * flow [LPM] / 60000 [m3/s per LPM]
        p_hyd = head * 6894.76 * (flow / 60000.0)
        power = p_hyd / eff

        # Sensor noise
        noise = self._rng.gauss
        flow += noise(0, flow * 0.005 + 0.01)
        head += noise(0, head * 0.003 + 0.01)
        power += noise(0, power * 0.005 + 0.1)

        result = (max(0.0, flow), max(0.0, head), max(0.0, power))
        self._cache = result
        self._cache_time = now
        return result

    def read_channel(self, channel_id):
        flow, head, power = self._step()
        if channel_id == "flow":
            return flow
        elif channel_id == "head":
            return head
        elif channel_id == "power":
            return power
        elif channel_id == "speed":
            return self._current_rpm
        elif channel_id == "valve":
            return self._current_valve
        return 0.0

    def write_channel(self, channel_id, value):
        self._outputs[channel_id] = float(value)
        if channel_id == "speed":
            self._rpm = max(0.0, min(3600.0, float(value)))
        elif channel_id == "valve":
            self._valve_cmd = max(0.0, min(100.0, float(value)))

    def close(self):
        self._rpm = 0.0
        self._current_rpm = 0.0


# --- Driver registry ---

DRIVER_REGISTRY = {
    "simulated": SimulatedDriver,
    "sim_pump": SimPump,
}

try:
    from driver_ni_cdaq import NiCdaqDriver
    DRIVER_REGISTRY["ni_cdaq"] = NiCdaqDriver
except ImportError:
    pass

try:
    from driver_yokogawa_wt import YokogawaWtDriver
    DRIVER_REGISTRY["yokogawa_wt"] = YokogawaWtDriver
except ImportError:
    pass

try:
    from driver_alicat import AlicatDriver
    DRIVER_REGISTRY["alicat"] = AlicatDriver
except ImportError:
    pass

try:
    from driver_rigol_dho import RigolDhoDriver
    DRIVER_REGISTRY["rigol_dho"] = RigolDhoDriver
except ImportError:
    pass


def create_driver(instrument_config):
    driver_type = instrument_config.get("type", "simulated")
    cls = DRIVER_REGISTRY.get(driver_type, SimulatedDriver)
    return cls(instrument_config)
