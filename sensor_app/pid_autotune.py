"""Doublet step-response PID auto-tuner with SIMC tuning.

Applies a step-up then step-down (doublet) and averages the two
responses for robust FOPDT identification.  Uses the two-point method
(28% and 63% crossings) for τ and θ, then SIMC (Skogestad, 2003)
tuning rules for PID gains.
"""

import math
import time


class StepResponseTuner:
    """Auto-tunes a PID loop using a doublet step-response test.

    Phases:
      1. SETTLE_1  — hold baseline output, wait for PV to stabilize.
      2. STEP_UP   — apply +step, record response until settled.
      3. SETTLE_2  — hold stepped output, wait for PV to re-stabilize.
      4. STEP_DOWN — remove step (back to baseline), record response.
      5. DONE      — average both responses, fit FOPDT, compute SIMC gains.
    """

    PHASES = ("settle_1", "step_up", "settle_2", "step_down", "done")

    def __init__(self, setpoint, baseline_output, out_min=0.0, out_max=100.0,
                 reverse=False):
        self.setpoint = setpoint
        self.out_min = out_min
        self.out_max = out_max
        self.reverse = reverse

        self.done = False
        self.result = None
        self.oscillation_count = 0       # UI progress (0-3)
        self.oscillations_needed = 3

        # Step size: 15% of output range
        self._step_size = (out_max - out_min) * 0.15
        self._baseline_output = max(out_min, min(out_max, baseline_output))
        self._step_output = None
        self._step_dir = 1

        # Phase management
        self._phase = "settle_1"
        self._settle_count = 0
        self._settle_history = []
        self._baseline_pv = None
        self._stepped_pv = None

        # Step response data: list of (elapsed_seconds, pv)
        self._up_data = []
        self._down_data = []
        self._step_start_time = None
        self._sample_count = 0

        # Timing
        self._min_settle = 15
        self._max_settle = 50
        self._min_step = 30
        self._max_step = 200
        self._max_step_time = 120.0  # seconds

    def update(self, pv):
        """Feed a new PV sample. Returns the output to apply."""
        self._sample_count += 1

        if self._phase == "settle_1":
            return self._do_settle(pv, phase_num=1)
        elif self._phase == "step_up":
            return self._do_step(pv, self._up_data, next_phase="settle_2")
        elif self._phase == "settle_2":
            return self._do_settle(pv, phase_num=2)
        elif self._phase == "step_down":
            return self._do_step(pv, self._down_data, next_phase="done")
        else:
            return self._baseline_output

    # ------------------------------------------------------------------
    # Settle phase
    # ------------------------------------------------------------------
    def _do_settle(self, pv, phase_num):
        self._settle_count += 1
        self._settle_history.append(pv)
        if len(self._settle_history) > 10:
            self._settle_history.pop(0)

        if self._settle_count >= self._min_settle:
            pv_range = max(self._settle_history) - min(self._settle_history)
            threshold = max(0.3, abs(self.setpoint) * 0.015)
            stable = pv_range < threshold
            forced = self._settle_count >= self._max_settle

            if stable or forced:
                avg_pv = sum(self._settle_history) / len(self._settle_history)

                if phase_num == 1:
                    self._baseline_pv = avg_pv
                    # Pick step direction
                    error = self.setpoint - avg_pv
                    if self.reverse:
                        self._step_dir = -1 if error > 0 else 1
                    else:
                        self._step_dir = 1 if error > 0 else -1
                    self._step_output = self._clamp(
                        self._baseline_output + self._step_dir * self._step_size)
                    # Make sure step actually changes output
                    if abs(self._step_output - self._baseline_output) < 1e-6:
                        self._step_output = self._clamp(
                            self._baseline_output - self._step_dir * self._step_size)
                    self._phase = "step_up"
                    self.oscillation_count = 1
                    print(f"  [autotune] settled: PV={avg_pv:.2f}, "
                          f"output {self._baseline_output:.1f} → {self._step_output:.1f}",
                          flush=True)
                else:
                    self._stepped_pv = avg_pv
                    self._phase = "step_down"
                    self.oscillation_count = 2
                    print(f"  [autotune] step-up done ({len(self._up_data)} samples). "
                          f"PV settled at {avg_pv:.2f}. Stepping back down.",
                          flush=True)

                self._step_start_time = time.time()
                self._settle_count = 0
                self._settle_history.clear()
                return self._step_output if phase_num == 1 else self._baseline_output

        if self._settle_count % 10 == 0:
            out = self._step_output if phase_num == 2 else self._baseline_output
            print(f"  [autotune] settle_{phase_num}: PV={pv:.2f}, "
                  f"out={out if out else self._baseline_output:.1f}, "
                  f"sample {self._settle_count}", flush=True)

        return self._step_output if phase_num == 2 and self._step_output else self._baseline_output

    # ------------------------------------------------------------------
    # Step response phase
    # ------------------------------------------------------------------
    def _do_step(self, pv, data_list, next_phase):
        now = time.time()
        dt = now - self._step_start_time
        data_list.append((dt, pv))
        n = len(data_list)

        if n % 15 == 0:
            print(f"  [autotune] {self._phase}: PV={pv:.2f}, t={dt:.1f}s, "
                  f"n={n}", flush=True)

        if n < self._min_step:
            return self._step_output if self._phase == "step_up" else self._baseline_output

        # Check for settled
        recent = [p for _, p in data_list[-10:]]
        pv_range = max(recent) - min(recent)
        threshold = max(0.3, abs(self.setpoint) * 0.015)
        settled = pv_range < threshold
        timed_out = dt > self._max_step_time

        if settled or timed_out or n >= self._max_step:
            if next_phase == "done":
                self._compute_result()
                self.done = True
                self.oscillation_count = 3
                return self._baseline_output
            else:
                # Transition to settle_2
                self._phase = next_phase
                self._settle_count = 0
                self._settle_history.clear()
                return self._step_output  # hold stepped output during settle_2

        return self._step_output if self._phase == "step_up" else self._baseline_output

    # ------------------------------------------------------------------
    # FOPDT identification and SIMC tuning
    # ------------------------------------------------------------------
    def _compute_result(self):
        step_delta = self._step_output - self._baseline_output
        if abs(step_delta) < 1e-10 or not self._up_data:
            self.result = None
            return

        # Identify from step-up response
        up_id = self._identify_response(self._up_data, self._baseline_pv, step_delta)

        # Identify from step-down response (if available)
        down_id = None
        if self._down_data and self._stepped_pv is not None:
            down_id = self._identify_response(
                self._down_data, self._stepped_pv, -step_delta)

        if up_id is None and down_id is None:
            print("  [autotune] FAILED: could not identify process", flush=True)
            self.result = None
            return

        # Average the two identifications
        if up_id and down_id:
            K = (abs(up_id["K"]) + abs(down_id["K"])) / 2.0
            tau = (up_id["tau"] + down_id["tau"]) / 2.0
            theta = (up_id["theta"] + down_id["theta"]) / 2.0
            print(f"  [autotune] Averaged UP and DOWN responses", flush=True)
        elif up_id:
            K = abs(up_id["K"])
            tau = up_id["tau"]
            theta = up_id["theta"]
        else:
            K = abs(down_id["K"])
            tau = down_id["tau"]
            theta = down_id["theta"]

        if K < 1e-10 or tau < 0.01:
            print("  [autotune] FAILED: degenerate process parameters", flush=True)
            self.result = None
            return

        # SIMC tuning rules (Skogestad, 2003), detuned for slow approach
        # τc = 2τ — closed-loop is 2x slower than open-loop
        tau_c = max(2.0 * tau, theta)

        kp = tau / (K * (tau_c + theta))
        ti = min(tau, 4.0 * (tau_c + theta))  # integral time
        ki = kp / ti if ti > 0.01 else 0.0
        kd = 0.0  # no derivative — prevents output spikes on SP changes

        # Sample time: τ/10, clamped
        t_sample = max(0.1, min(tau / 10.0, 5.0))

        self.result = {
            "K": K,
            "tau": tau,
            "theta": theta,
            "tau_c": tau_c,
            "kp": kp,
            "ki": ki,
            "kd": kd,
            "sample_time": t_sample,
        }

        print(f"\n  [autotune] FOPDT identification:")
        print(f"    Process gain |K| = {K:.4f}")
        print(f"    Time constant  τ = {tau:.2f} s")
        print(f"    Dead time      θ = {theta:.2f} s")
        print(f"    Closed-loop   τc = {tau_c:.2f} s")
        print(f"  SIMC tuning:")
        print(f"    Kp = {kp:.4f},  Ki = {ki:.4f},  Kd = {kd:.4f}")
        print(f"    Sample time = {t_sample:.2f} s", flush=True)

    def _identify_response(self, data, pv_start, step_delta):
        """Identify FOPDT parameters from a single step response.

        Uses the two-point method: find times to 28.3% and 63.2% of
        final change, then:
            τ = 1.5 * (t63 - t28)
            θ = t63 - τ
        """
        if len(data) < 5:
            return None

        # Final PV: average of last 10 samples
        tail = [p for _, p in data[-10:]]
        pv_final = sum(tail) / len(tail)
        pv_delta = pv_final - pv_start

        if abs(pv_delta) < 1e-10:
            return None

        K = pv_delta / step_delta

        # Normalize response: 0 = start, 1 = final
        rising = pv_delta > 0

        def find_crossing(frac):
            target = pv_start + frac * pv_delta
            for i, (dt, pv) in enumerate(data):
                if rising and pv >= target:
                    # Interpolate between this and previous sample
                    if i > 0:
                        dt0, pv0 = data[i - 1]
                        if abs(pv - pv0) > 1e-10:
                            f = (target - pv0) / (pv - pv0)
                            return dt0 + f * (dt - dt0)
                    return dt
                elif not rising and pv <= target:
                    if i > 0:
                        dt0, pv0 = data[i - 1]
                        if abs(pv - pv0) > 1e-10:
                            f = (target - pv0) / (pv - pv0)
                            return dt0 + f * (dt - dt0)
                    return dt
            return None

        t28 = find_crossing(0.283)
        t63 = find_crossing(0.632)

        if t28 is None or t63 is None or t63 <= t28:
            # Fallback: use 63% point directly
            t63 = find_crossing(0.632)
            if t63 is None:
                t63 = data[-1][0] * 0.5
            tau = t63
            theta = 0.0
        else:
            tau = 1.5 * (t63 - t28)
            theta = max(0.0, t63 - tau)

        # Sanity: τ must be positive
        tau = max(0.05, tau)

        return {"K": K, "tau": tau, "theta": theta}

    def _clamp(self, v):
        return max(self.out_min, min(self.out_max, v))
