# Sensor App

A config-driven experiment control and monitoring dashboard built with Flask and Canvas 2D. Supports real-time plotting, PID control loops, safety interlocks, and CSV data logging. Designed to run on a Raspberry Pi.

## Quick Start

```bash
source ../venv/bin/activate
python app.py                     # uses example_config.xlsx
python app.py my_experiment.xlsx  # uses a custom config
```

Open `http://<pi-ip>:5001` in a browser.

The app ships with `example_config.xlsx` which runs a simulated experiment: random sensors, a thermal reactor model, a PID loop controlling heater output to reach a temperature setpoint, and an over-temperature interlock.

## Architecture

```
app.py                  Flask routes + startup (loads config, starts engine)
config_loader.py        Parses Excel config into Python dicts
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

Each experiment is defined by a single `.xlsx` file with these sheets:

### Instruments
One row per physical device (or simulated source).

| Column | Description |
|--------|-------------|
| Instrument Name | Unique ID referenced by Channels sheet |
| Type | Driver type: `simulated`, `daqmx`, `gpib`, `serial` |
| Address / Device | Hardware address (e.g. `GPIB0::5::INSTR`, `COM3`) |
| Query Command | Command string to read the instrument |
| Poll Rate (s) | How often to read (drives the engine sample rate) |
| Timeout (s) | Communication timeout |
| Enabled | `Yes` / `No` |

### Channels
One row per I/O signal. Links to an instrument.

| Column | Description |
|--------|-------------|
| Instrument | Must match an Instrument Name |
| Channel ID | Hardware channel (e.g. `ai0`, `ch1`) |
| Channel Name | Unique key used everywhere else (e.g. `reactor_temp`) |
| Direction | `input` (sensor) or `output` (actuator) |
| Signal Type | `voltage`, `string`, etc. |
| Units | Display units (e.g. `degC`, `%`, `hPa`) |
| Slope / Offset | Linear calibration: `value = raw * slope + offset` |
| Min / Max Value | Expected range (used for axis scaling) |
| Enabled | `Yes` / `No` |

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

### Interlocks
Safety conditions evaluated every sample cycle, server-side.

| Column | Description |
|--------|-------------|
| Interlock Name | Unique ID |
| Channel | Channel Name to monitor |
| Condition | `>`, `<`, `>=`, `<=` |
| Threshold | Trip value |
| Action | `set_output` (force a channel), `disable_loop` (switch PID to manual), `alarm` (log only) |
| Target | Channel or Loop Name the action applies to |
| Action Value | Value to write (for `set_output`) |
| Enabled | `Yes` / `No` |

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

### Settings
Key-value pairs for global configuration.

| Setting | Example | Description |
|---------|---------|-------------|
| Sample Frequency (Hz) | `10` | Engine polling rate |
| Log Subsample | `10` | Log every Nth sample to CSV |
| Data Buffer Size | `10000` | Ring buffer size for plotting |
| CSV Log File | `data_{timestamp}.csv` | Output file path |

## Setting Up a New Experiment

### 1. Create the config Excel

Copy `example_config.xlsx` and edit the sheets to match your hardware. The key relationships:

```
Instruments  --1:N-->  Channels  --referenced by-->  Control Loops
                                                     Interlocks
                                                     Logging
```

### 2. Write a driver (if using real hardware)

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

### 3. Run

```bash
source ../venv/bin/activate
python app.py my_experiment.xlsx
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Dashboard UI |
| GET | `/data_since/<timestamp>` | Poll for new samples, sensor values, PID status, interlocks |
| GET | `/config` | Experiment config (used by frontend to build PID panels) |
| POST | `/update` | Update control settings (file_name, sample_freq, sliders, etc.) |
| POST | `/pid/setpoint` | `{"loop": "temp_control", "setpoint": 200}` |
| POST | `/pid/mode` | `{"loop": "temp_control", "mode": "manual"}` |
| POST | `/pid/manual_output` | `{"loop": "temp_control", "output": 50}` |
| GET | `/log_data` | Retrieve CSV log as JSON |

## Dashboard Features

- Real-time scatter plot (CPU vs Ambient temperature)
- Multi-series time series with per-unit sub-plots and sigmoidal fade
- PID control panel: live PV/SP/Output/Error, mode toggle, setpoint input
- Interlock status display (OK / TRIPPED)
- Instruments table with plot-enable checkboxes
- Sliders, segmented selectors, text inputs for control settings
- Dark mode toggle
- Draggable, collapsible panels
- CSV data logging with configurable filename and append/overwrite

## Dependencies

- Python 3.11+
- Flask
- openpyxl (for Excel config parsing)

Install:
```bash
pip install flask openpyxl
```
