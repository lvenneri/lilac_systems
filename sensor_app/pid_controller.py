"""Minimal positional PID controller with anti-windup."""


class PIDController:
    def __init__(self, kp, ki, kd, setpoint, out_min, out_max, sample_time):
        self.kp = kp
        self.ki = ki
        self.kd = kd
        self.setpoint = setpoint
        self.out_min = out_min
        self.out_max = out_max
        self.sample_time = sample_time
        self._integral = 0.0
        self._prev_error = 0.0
        self._first = True

    def compute(self, pv):
        """Compute PID output. Returns (output, error)."""
        error = self.setpoint - pv

        # Proportional
        p_term = self.kp * error

        # Integral
        self._integral += error * self.sample_time
        i_term = self.ki * self._integral

        # Derivative (skip on first call)
        if self._first:
            d_term = 0.0
            self._first = False
        else:
            d_term = self.kd * (error - self._prev_error) / self.sample_time

        output = p_term + i_term + d_term

        # Clamp output
        output = max(self.out_min, min(self.out_max, output))

        # Anti-windup: if saturated, undo last integral accumulation
        if output == self.out_min or output == self.out_max:
            self._integral -= error * self.sample_time

        self._prev_error = error
        return output, error

    def reset(self):
        self._integral = 0.0
        self._prev_error = 0.0
        self._first = True
