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


# --- Driver registry ---

DRIVER_REGISTRY = {
    "simulated": SimulatedDriver,
}


def create_driver(instrument_config):
    driver_type = instrument_config.get("type", "simulated")
    cls = DRIVER_REGISTRY.get(driver_type, SimulatedDriver)
    return cls(instrument_config)
