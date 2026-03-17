# Sensor App

A config-driven experiment control and monitoring dashboard built with Flask and Canvas 2D. Supports real-time plotting, PID control loops, safety interlocks, and CSV data logging. Designed to run on a Raspberry Pi.

## Quick Start

```bash
source ../venv/bin/activate
python app.py                              # uses example_config.xlsx, opens browser
python app.py my_experiment.xlsx           # uses a custom config
python app.py --port 8080                  # serve on a different port
python app.py --no-browser                 # don't auto-open the browser
python app.py --validate-only my.xlsx      # check config without starting
```

The dashboard opens automatically at `http://localhost:5001`. On a headless Pi, use `--no-browser`.

The app ships with `example_config.xlsx` which runs a simulated experiment: random sensors, a thermal reactor model, a PID loop controlling heater output to reach a temperature setpoint, and an over-temperature interlock.

## Architecture

```
app.py                  Flask routes + startup (loads config, validates, starts engine)
config_loader.py        Parses Excel config into Python dicts
validate_config.py      Config validation (cross-references, driver types, ranges)
experiment_engine.py    Main loop: sampling, PID, interlocks, CSV logging
pid_controller.py       PID controller with anti-windup
driver_base.py          Abstract instrument driver + SimulatedDriver + registry
thermal_model.py        Simulated thermal process (used by SimulatedDriver)

static/
  dashboard.js          Plotting, polling, instruments table, controls
  experiment.js         PID panel builder + interlock status display
  dashboard.css         All themed styles (CSS variables for dark mode)
  base.js               Shared widgets (Slider, SegmentedControl, makeControlPanel)
  base_extra.css        Shared component styles

templates/
  index.html            Page layout (panels are populated dynamically by JS)

example_config.xlsx     Working demo config (simulated sensors + PID)
```

## Excel Config Format

Each experiment is defined by a single `.xlsx` file with these sheets. In every sheet, **Row 1** is a free-text description row (ignored by the parser), **Row 2** contains the column headers, and **Row 3+** contains data.

### Instruments
One row per physical device (or simulated source).

| Column | Description |
|--------|-------------|
| Instrument Name | Unique ID referenced by Channels sheet |
| Type | Driver type (see [Available Drivers](#available-drivers)) |
| Address / Device | Hardware address (e.g. `GPIB0::5::INSTR`, `COM3`) |
| Query Command | Command string to read the instrument |
| Poll Rate (s) | Minimum interval between reads for this instrument. The engine skips instruments that aren't due yet and returns cached values. Set to `1` for slow GPIB instruments, `0.1` for fast DAQ cards. Default `0.1`. |
| Timeout (s) | Communication timeout |
| Enabled | `Yes` / `No` |
| Notes | Free-text documentation (ignored by engine) |

### Channels
One row per I/O signal. Links to an instrument.

| Column | Description |
|--------|-------------|
| Instrument | Must match an Instrument Name |
| Channel ID | Hardware channel (e.g. `ai0`, `ch1`) |
| Channel Name | Unique key used everywhere else (e.g. `reactor_temp`) |
| Direction | `input` (sensor) or `output` (actuator) |
| Signal Type | Informational label (`voltage`, `current`, `temperature`, `string`, etc.). Not used by the engine — purely for documentation. |
| Units | Display units (e.g. `degC`, `%`, `hPa`) |
| Slope / Offset | Linear calibration: `value = raw * slope + offset` |
| Min / Max Value | Expected range (used for axis scaling) |
| Control Options | Comma-separated list of discrete states for segmented selector controls (e.g. `Off,Low,High`). Leave blank for slider controls. Output channels only. |
| Enabled | `Yes` / `No` |
| Notes | Free-text documentation (ignored by engine) |

### Control Loops
One row per PID loop.

| Column | Description |
|--------|-------------|
| Loop Name | Unique ID |
| Process Variable | Channel Name of the input to control |
| Setpoint | Initial target value |
| SP Units | Units for the setpoint |
| Output Channel | Channel Name of the output to drive |
| Out Min / Out Max | Output clamp range |
| Kp, Ki, Kd | PID tuning gains |
| Sample Time (s) | PID update interval |
| Mode | `auto` (PID active) or `manual` (operator sets output) |
| Enabled | `Yes` / `No` |
| Notes | Free-text documentation (ignored by engine) |

**PID virtual channels:** Each enabled loop automatically creates four plottable channels in the data buffer and CSV: `pid.<loop_name>.setpoint`, `pid.<loop_name>.pv`, `pid.<loop_name>.output`, `pid.<loop_name>.error`. These can be used in derived calculations and are visible in the instruments table.

### Interlocks
Safety conditions evaluated every sample cycle, server-side.

| Column | Description |
|--------|-------------|
| Interlock Name | Unique ID |
| Channel | Channel Name to monitor |
| Condition | `>`, `<`, `>=`, `<=` |
| Threshold | Trip value |
| Action | `set_output`, `disable_loop`, `enable_loop`, or `alarm` (semicolon-separated for compound actions) |
| Target | Channel or Loop Name the action applies to (semicolon-separated to match compound actions) |
| Action Value | Value to write for `set_output` (semicolon-separated to match compound actions) |
| Recovery Action | Action(s) to execute when the interlock clears (same format as Action) |
| Recovery Target | Target(s) for recovery actions |
| Recovery Value | Value(s) for recovery actions |
| Latch | `Yes` / `No` — latched interlocks stay tripped until manually reset from the dashboard |
| Group | Optional group name — all interlocks in a group must trip simultaneously (AND logic) |
| Enabled | `Yes` / `No` |
| Notes | Free-text documentation (ignored by engine) |

**Actions:**

| Action | Description |
|--------|-------------|
| `set_output` | Force an output channel to a specific value. **Target:** output channel name. **Action Value:** the value to write. |
| `disable_loop` | Switch a PID loop to manual mode and reset the controller. **Target:** loop name. **Action Value:** leave blank. |
| `enable_loop` | Switch a PID loop back to auto mode (useful as a recovery action). **Target:** loop name. **Action Value:** leave blank. |
| `alarm` | Log to console only (no actuation). **Target:** leave blank. **Action Value:** leave blank. |

**Compound actions:** Use semicolons to trigger multiple actions from a single interlock. The Action, Target, and Action Value columns are split by `;` and matched positionally:

```
Action:       disable_loop; set_output
Target:       temp_control; heater_output
Action Value: ;             0
```

This disables the `temp_control` PID loop AND forces `heater_output` to 0 in a single trip.

**Recovery actions:** When an interlock clears (condition no longer met), recovery actions run automatically. For latched interlocks, recovery runs when the operator clicks Reset. Use the same semicolon format as compound actions:

```
Recovery Action: enable_loop
Recovery Target: temp_control
Recovery Value:
```

**Latching:** A latched interlock stays in the tripped state even after the monitored channel returns to a safe range. The dashboard shows a "LATCHED" indicator and a Reset button. Recovery actions execute on reset.

**Groups:** Interlocks sharing a Group name use AND logic — all conditions in the group must be true before any of them trip. When the group condition clears, all members clear together.

### Logging
Which channels to log to CSV and display on the dashboard.

| Column | Description |
|--------|-------------|
| Channel | Channel Name |
| Log to CSV | `Yes` / `No` |
| Display on UI | `Yes` / `No` |
| Display Format | Number format (e.g. `0.0`, `0.00e+0`) |
| Decimal Places | Rounding precision |
| Alarm Low / High | UI alarm thresholds (separate from interlocks) |
| Notes | Free-text documentation (ignored by engine) |

### Settings
Key-value pairs for global configuration.

| Setting | Example | Description |
|---------|---------|-------------|
| Sample Frequency (Hz) | `10` | Engine polling rate |
| Log Subsample | `10` | Log every Nth sample to CSV |
| Data Buffer Size | `10000` | Ring buffer size for plotting |
| CSV Log File | `data_{timestamp}.csv` | Output file path |
| Scatter X Channel | `ambient_temp` | Channel for scatter plot X axis (omit both X and Y to hide scatter panel) |
| Scatter Y Channel | `cpu_temp` | Channel for scatter plot Y axis |
| Scatter X Channel 2 | `pressure` | Additional scatter plot pair (supports 2–9) |
| Scatter Y Channel 2 | `humidity` | Additional scatter plot pair |
| Poll Interval (ms) | `100` | Dashboard refresh rate |
| Max Plot Points | `10000` | Max data points retained for plotting |

### Step Series

The Step Series sheet defines an automated sequence of setpoint steps. The engine advances through them, waiting for settling and hold time at each step.

**Reserved columns:**

| Column | Description |
|--------|-------------|
| Step # | Step index (integer) |
| Name | Optional label (used in save points) |
| Hold Time (s) | Time to hold after all columns settle |

**Tolerance row:** If the first data row has `Tolerance` in the Step # column, its values define per-column settling tolerances.

All other columns are step variable columns. The column header determines the type:

| Header format | Type | Behaviour |
|---------------|------|-----------|
| `SP: channel_name (units)` | PID setpoint | Sets the PID setpoint and switches the loop to auto mode. Units in parentheses are optional display hints. |
| `Watch: channel_name (units)` | Watch (observe-only) | Displays target value; checks settling via tolerance; does **not** actuate anything. For variables controlled manually (e.g. a heat gun). |
| `channel_name (units)` | Direct output | Writes the value directly to the output channel. Units in parentheses are stripped to match the channel name. |

**Blank cells and NA:** If a cell is blank or contains `NA` / `N/A`, that column is skipped for that step. This enables mixed-mode steps:

```
Step #  SP: pump_flow (LPM)  SP: pump_head (PSId)  pump_speed (RPM)  pump_valve (%)  Hold Time (s)
1       15                   5                                                        5
2       30                   10                                                       5
3       NA                   NA                    1800              50               5
4       NA                   NA                    3600              100              5
```

- **Steps 1–2:** PID loops control pump_speed and pump_valve to hit the flow/head setpoints.
- **Steps 3–4:** PID loops switch to manual; pump_speed and pump_valve are set directly.

**Over-specification:** The validator will flag any step that both sets a PID setpoint (SP column) and directly writes to the same PID loop's output channel — these would fight each other.

## Derived / Computed Channels

You can compute new quantities from measured data by editing `_compute_derived()` in `experiment_engine.py`. This method runs every sample cycle after all channels and PID loops have been read, and any keys you add to `flat_sensors` automatically appear in the live dashboard, CSV logs, and data buffer.

```python
def _compute_derived(self, flat_sensors):
    # Power from voltage and current
    V = flat_sensors.get("Voltage")
    I = flat_sensors.get("Current")
    if V is not None and I is not None:
        flat_sensors["Power (W)"] = V * I
        flat_sensors["Resistance (Ohm)"] = V / I if I != 0 else float("nan")

    # Efficiency from two power measurements
    p_in = flat_sensors.get("Input Power")
    p_out = flat_sensors.get("Output Power")
    if p_in and p_out and p_in != 0:
        flat_sensors["Efficiency (%)"] = (p_out / p_in) * 100
```

The method has access to all scaled input channels, output channel readbacks, and PID virtual channels (`pid.<loop>.setpoint`, `.pv`, `.output`, `.error`). Use `flat_sensors.get()` to safely handle missing channels.

### NI cDAQ Special Channel Types

For voltage inputs on an NI cDAQ that need conversion beyond simple slope/offset, two additional channel kinds are available in the Channel ID field:

| Channel ID format | Description |
|-------------------|-------------|
| `Mod{slot}/ai_poly{n}` | Polynomial conversion. Provide `"coefficients": [c0, c1, c2, ...]` in the instrument's `channel_options`. Computes `c0 + c1*V + c2*V² + ...` |
| `Mod{slot}/ai_custom{n}` | Hardcoded conversion. Edit `_custom_sensor_convert()` in `driver_ni_cdaq.py` with your sensor-specific formula |

**Batch reads:** The cDAQ driver automatically groups channels by module and type into multi-channel DAQmx tasks. Instead of N individual reads (each with USB round-trip overhead), all channels on the same module are read in a single call. This significantly reduces aggregate throughput load when a module has many channels. Falls back to per-channel reads if the batch task fails.

## PID Auto-Tuning

The dashboard includes a built-in auto-tuner for PID loops, accessible via the **Tune** button on each PID panel.

**Method:** Doublet step-response with SIMC (Skogestad IMC) tuning rules.

**How it works:**

1. The tuner stabilizes the process at the current output (baseline)
2. Applies a +15% output step and waits for the process to settle
3. Returns to baseline and records the response
4. Fits a First-Order Plus Dead Time (FOPDT) model: process gain *K*, time constant *τ*, dead time *θ*
5. Computes Kp, Ki, Kd using SIMC rules (Skogestad 2003)
6. Automatically detects reverse-acting processes (negative Kp)

**Dashboard display during tuning:**
- Oscillation progress counter (0–3 phases)
- Live estimated gains (Kp, Ki, Kd)
- Process parameters: K, τ, θ

Click **Tune** again to cancel and return to manual mode.

## Save Points

Save points capture a snapshot of all current sensor readings as a single CSV row.

- **Manual:** Click the **Save Point** button in the header. The current note field is included as a label.
- **Automatic:** During step series auto-advance, a save point is recorded at the end of each step's hold time, labeled with the step name.
- **Output file:** Saved to `{csv_name}_pts.csv` alongside the main CSV log.
- **Scatter overlay:** Save points appear as labeled markers on the animated scatter plot.
- **Counter:** The header shows how many points have been saved this session.

## CSV Logging

The engine logs sensor data to a CSV file with configurable filename and append/overwrite mode.

- **Subsample rate:** Only every Nth sample is written (configured by `Log Subsample` in Settings). At 10 Hz with subsample 10, the CSV gets one row per second.
- **Timestamp column:** ISO format with milliseconds.
- **Step metadata columns:** `Step Name` (current step label) and `Hold Stable` (whether the step has settled) are included when a step series is active.
- **Config snapshot:** On first write, the current control settings are saved as `{csv_name}_config.json` alongside the CSV.
- **Dynamic fieldnames:** All channels discovered on first sample are included as columns.

## Audio Alerts

The dashboard uses the Web Audio API for audible feedback (requires a user gesture to enable):

- **Interlock alarm:** 560 Hz sine wave beep every 1.3 seconds while any interlock is tripped. A mute button (speaker icon) appears to silence without clearing.
- **Step series chimes:** An ascending two-note chime plays when a step begins its hold timer (all columns settled). A three-note "ta-da" plays when a step completes and advances.

## Available Drivers

Built-in driver types for the Instruments sheet `Type` column:

| Type | Description | Import |
|------|-------------|--------|
| `simulated` | Demo driver with random sensors, thermal reactor model, simulated dials/selectors | Built-in |
| `sim_pump` | Simulated centrifugal pump with affinity laws, H-Q curve, and throttle valve | Built-in |
| `ni_cdaq` | NI cDAQ-9177 chassis (9201/9202/9214/9216/9264 modules) via NI-DAQmx | Requires `nidaqmx` |
| `yokogawa_wt` | Yokogawa WT333E power analyzer via GPIB/VISA | Requires `pyvisa` |
| `alicat` | Alicat mass flow/pressure controllers via USB serial | Requires `pyserial` |
| `rigol_dho` | Rigol DHO-series oscilloscope | Requires `pyvisa` |

Hardware drivers are imported conditionally — if the required library is not installed, the driver is silently unavailable and the validator will warn if you reference it. The engine falls back to `simulated` for unknown types.

## Setting Up a New Experiment

### 1. Create the config Excel

Copy `example_config.xlsx` and edit the sheets to match your hardware. The key relationships:

```
Instruments  --1:N-->  Channels  --referenced by-->  Control Loops
                                                     Interlocks
                                                     Logging
```

### 2. Validate the config

```bash
python validate_config.py my_experiment.xlsx
```

Checks all cross-references (channels reference valid instruments, control loops reference valid channels, interlocks reference valid targets, etc.), verifies driver types exist, and catches range errors. The app also runs this automatically at startup and refuses to start if there are errors.

### 3. Write a driver (if using real hardware)

Create a class that extends `DriverBase` in `driver_base.py`:

```python
class MyDriver(DriverBase):
    def connect(self):
        # Open connection to hardware
        pass

    def read_channel(self, channel_id):
        # Read raw value from channel_id (e.g. "ai0")
        # Return a number (before slope/offset scaling)
        pass

    def write_channel(self, channel_id, value):
        # Write raw value to channel_id
        pass

    def close(self):
        # Clean up connection
        pass
```

Register it in `DRIVER_REGISTRY`:

```python
DRIVER_REGISTRY = {
    "simulated": SimulatedDriver,
    "my_hardware": MyDriver,
}
```

Then set `Type` to `my_hardware` in the Instruments sheet.

### 4. Run

```bash
source ../venv/bin/activate
python app.py my_experiment.xlsx
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Dashboard UI |
| GET | `/data_since/<timestamp>` | Poll for new samples, sensor values, PID status, interlocks, step series, save points |
| GET | `/config` | Experiment config (frontend uses this to build all dynamic panels) |
| GET | `/log_data` | Retrieve CSV log as JSON |
| POST | `/update` | Update control settings (file_name, sample_freq, log_subsample, note, etc.) |
| POST | `/pid/setpoint` | `{"loop": "temp_control", "setpoint": 200}` |
| POST | `/pid/mode` | `{"loop": "temp_control", "mode": "manual"}` |
| POST | `/pid/manual_output` | `{"loop": "temp_control", "output": 50}` |
| POST | `/pid/autotune` | `{"loop": "temp_control", "action": "start"}` — also `"cancel"`, `"status"` |
| POST | `/output/set` | `{"channel": "heater_output", "value": 50}` — direct output write |
| POST | `/interlock/reset` | `{"name": "over_temp"}` — manually reset a latched interlock |
| POST | `/step_series/mode` | `{"mode": "auto"}` or `{"mode": "manual"}` |
| POST | `/step_series/play_pause` | `{"running": true}` — play/pause auto-advance |
| POST | `/step_series/next` | Advance to next step |
| POST | `/step_series/prev` | Go to previous step |
| POST | `/step_series/goto` | `{"step": 3}` — jump to a specific step |
| POST | `/save_point` | `{"label": "baseline"}` — save current readings snapshot |
| POST | `/stop` | Stop engine, finalize CSV, shut down server |

## Dashboard Features

**Plotting:**
- Multi-series time-series with per-unit Y-axis subplots and sigmoidal fade
- Animated scatter plot with smooth interpolation, trail history, and save-point overlay markers
- Switchable 1-minute / 30-minute scatter window
- 5 color palettes (amber, blue, gray, scifi, tactical) with light/dark variants

**PID controls:**
- Per-loop panel: live PV, setpoint, output %, error
- Auto / Manual mode toggle
- Setpoint text input with sync indicator dot (green = server matches, red = pending)
- Manual output slider (enabled only in manual mode)
- Tune button for auto-tuning with live progress display
- Output channel label on each panel

**Step series:**
- Auto / Manual mode toggle
- Transport controls: Restart, Previous, Play/Pause, Next
- Hold timer progress bar with elapsed / total seconds
- Per-column settling indicator dots (green = within tolerance)
- Watch-channel rows with target value display
- Audio chimes on hold start and step advance

**Interlocks:**
- Live status per interlock: OK / WARNING / LATCHED
- Grouped interlocks shown with AND-logic label
- Reset button for latched interlocks
- Alarm beep with mute toggle
- Panel and body-wide visual alarm on trip

**Output controls:**
- Slider controls for continuous output channels
- Segmented selector buttons for discrete-state channels (from Control Options)
- Sync indicator dots

**General:**
- Instruments table with per-channel plot-enable checkboxes
- Server-synced clock display
- Save Point button with counter
- Save Figure (exports time-series canvas as PNG)
- Stop button (finalizes CSV, shuts down server)
- Dark mode toggle
- Adjustable font size
- Draggable, collapsible panels
- CSV filename, sample frequency, log subsample, and note controls

## Dependencies

- Python 3.11+
- Flask
- openpyxl (for Excel config parsing)

Install:
```bash
pip install flask openpyxl
```
