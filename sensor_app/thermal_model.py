"""Simple first-order lumped thermal model for simulated reactor process."""

import random


class ThermalModel:
    """
    dT/dt = heater_gain * (power/100) - loss * (T - T_ambient)

    With default parameters, 100% heater reaches ~325 degC from 25 degC
    ambient with a ~20s rise time constant.
    """

    def __init__(self, initial_temp=25.0, ambient=25.0):
        self.temp = initial_temp
        self.ambient = ambient
        self.heater_gain = 15.0   # degC/s at 100% power
        self.loss_coeff = 0.05    # 1/s  (Newton cooling)

    def step(self, heater_pct, dt):
        """Advance model by dt seconds. heater_pct in 0-100. Returns new temp."""
        power = max(0.0, min(100.0, heater_pct)) / 100.0
        dT = (power * self.heater_gain - self.loss_coeff * (self.temp - self.ambient)) * dt
        self.temp += dT
        self.temp += random.gauss(0, 0.05)
        return self.temp
