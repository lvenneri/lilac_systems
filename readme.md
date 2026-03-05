# Lilac Systems

A config-driven experiment control and monitoring dashboard built with Flask. Supports real-time plotting, PID control loops, safety interlocks, and CSV data logging. Designed to run on a Raspberry Pi.

## Setup

Requires Python 3.11+.

```bash
git clone <repo-url>
cd lilac_systems
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
source venv/bin/activate
cd sensor_app
python app.py                              # uses example_config.xlsx, opens browser
python app.py my_experiment.xlsx           # uses a custom config
python app.py --port 8080                  # serve on a different port
python app.py --no-browser                 # don't auto-open the browser
python app.py --validate-only my.xlsx      # check config without starting the server
```

The dashboard opens automatically in your browser. On a headless Pi, use `--no-browser` and navigate to `http://<pi-ip>:5001`.

CSV data files are written next to the config file, not the working directory.

## Configuring an Experiment

Everything is defined in a single `.xlsx` file with these sheets:

| Sheet | Purpose |
|-------|---------|
| **Instruments** | Each physical device (or simulated source) — type, address, poll rate |
| **Channels** | I/O signals linked to instruments — name, direction, units, calibration (slope/offset), range |
| **Control Loops** | PID loops — process variable, setpoint, output channel, gains (Kp/Ki/Kd), auto/manual mode |
| **Interlocks** | Safety rules — channel, condition/threshold, action (set output, disable loop, alarm) |
| **Logging** | Which channels to log to CSV and display on the dashboard, with alarm thresholds |
| **Settings** | Global options — sample rate, log subsample, buffer size, CSV filename, scatter plot channels, poll interval |

Start by copying `example_config.xlsx` and editing to match your setup. The key relationships:

```
Instruments  ──1:N──▶  Channels  ──referenced by──▶  Control Loops
                                                      Interlocks
                                                      Logging
```

### Adding a Custom Hardware Driver

1. Create a class extending `DriverBase` in `sensor_app/driver_base.py`:

```python
class MyDriver(DriverBase):
    def connect(self):        ...  # open connection
    def read_channel(self, channel_id):   ...  # return raw value
    def write_channel(self, channel_id, value): ...  # write raw value
    def close(self):          ...  # clean up
```

2. Register it in `DRIVER_REGISTRY`:

```python
DRIVER_REGISTRY = {
    "simulated": SimulatedDriver,
    "my_hardware": MyDriver,
}
```

3. Set `Type` to `my_hardware` in the Instruments sheet of your config.

See [sensor_app/README.md](sensor_app/README.md) for full column-by-column details, API endpoints, and dashboard features.

## Network Access

### Get Raspberry Pi IP Address
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

### Copy Files from Pi to Another Machine
```bash
scp -r nitwit@192.168.0.23:/home/nitwit/lilac_systems /Users/nitwit/Dropbox/LilacBox
```
