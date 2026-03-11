from flask import Flask, render_template, jsonify, request
import argparse, csv, os, sys, threading, webbrowser

from config_loader import load_config
from validate_config import validate
from experiment_engine import ExperimentEngine

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Load and validate experiment config
# ---------------------------------------------------------------------------
parser = argparse.ArgumentParser(description="Sensor App")
parser.add_argument("config", nargs="?",
                    default=os.path.join(os.path.dirname(__file__), 'example_config.xlsx'),
                    help="Path to experiment config .xlsx (default: example_config.xlsx)")
parser.add_argument("--port", type=int, default=5001,
                    help="Port to serve on (default: 5001)")
parser.add_argument("--no-browser", action="store_true",
                    help="Don't auto-open the dashboard in a browser")
parser.add_argument("--validate-only", action="store_true",
                    help="Validate the config and exit without starting the server")
args = parser.parse_args()
CONFIG_PATH = args.config
config = load_config(CONFIG_PATH)

errors, warnings = validate(config)
for w in warnings:
    print(f"  WARNING: {w}")
if errors:
    for e in errors:
        print(f"  ERROR:   {e}")
    print(f"\nConfig validation failed ({len(errors)} error(s)). Fix the config and try again.")
    sys.exit(1)
if args.validate_only:
    n = len(warnings)
    print(f"Config OK" + (f" ({n} warning(s))" if n else ""))
    sys.exit(0)

# Resolve CSV output directory relative to the config file
CONFIG_DIR = os.path.dirname(os.path.abspath(CONFIG_PATH))
os.chdir(CONFIG_DIR)

# Build SENSOR_UNITS from config channels (served to frontend via Jinja)
SENSOR_UNITS = {}
for ch_name, ch_cfg in config.get("channels", {}).items():
    if ch_cfg.get("enabled", True):
        SENSOR_UNITS[ch_name] = ch_cfg.get("units", "")

# Add PID virtual channel units
for loop_name, loop_cfg in config.get("control_loops", {}).items():
    sp_units = loop_cfg.get("sp_units", "")
    SENSOR_UNITS[f"pid.{loop_name}.setpoint"] = sp_units
    SENSOR_UNITS[f"pid.{loop_name}.pv"] = sp_units
    SENSOR_UNITS[f"pid.{loop_name}.output"] = "%"
    SENSOR_UNITS[f"pid.{loop_name}.error"] = sp_units

# Dashboard settings from config (passed to template)
_settings = config.get("settings", {})
SCATTER_X = str(_settings.get("Scatter X Channel", "")).strip()
SCATTER_Y = str(_settings.get("Scatter Y Channel", "")).strip()

# ---------------------------------------------------------------------------
# Create and start experiment engine
# ---------------------------------------------------------------------------
engine = ExperimentEngine(config)
engine.initialize()

sampler_thread = threading.Thread(target=engine.run, daemon=True)
sampler_thread.start()

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    return render_template('index.html', sensor_units=SENSOR_UNITS,
                           scatter_x=SCATTER_X, scatter_y=SCATTER_Y)


@app.route('/data_since/<path:since>')
def data_since(since):
    """Return buffered samples since a given timestamp."""
    try:
        since = float(since)
    except (ValueError, TypeError):
        return jsonify({"error": "invalid timestamp"}), 400
    return jsonify(engine.get_data_since(since))


@app.route('/update', methods=['POST'])
def update():
    data = request.get_json()
    ctrl_copy = engine.update_settings(data)
    return jsonify({"status": "success", "received": data, "controls": ctrl_copy})


@app.route('/log_data')
def log_data_endpoint():
    with engine.command_lock:
        filename = engine.control_settings.get("file_name", "junk.csv")
    if not os.path.exists(filename):
        return jsonify([])
    rows = []
    with open(filename, 'r') as csvfile:
        reader = csv.DictReader(csvfile)
        for row in reader:
            rows.append(row)
    return jsonify(rows)


@app.route('/config')
def get_config():
    """Serve experiment config to frontend for dynamic UI building."""
    frontend_config = {
        "control_loops": {},
        "output_channels": {},
        "interlocks": [],
        "settings": config.get("settings", {}),
    }
    for loop_name, loop_cfg in config.get("control_loops", {}).items():
        if loop_cfg.get("enabled", True):
            # Include live state from engine
            live = engine.loop_configs.get(loop_name, loop_cfg)
            frontend_config["control_loops"][loop_name] = {
                "pv_channel": loop_cfg["pv_channel"],
                "setpoint": live.get("setpoint", loop_cfg["setpoint"]),
                "sp_units": loop_cfg.get("sp_units", ""),
                "output_channel": loop_cfg["output_channel"],
                "out_min": loop_cfg["out_min"],
                "out_max": loop_cfg["out_max"],
                "mode": live.get("mode", loop_cfg.get("mode", "auto")),
                "kp": loop_cfg["kp"],
                "ki": loop_cfg["ki"],
                "kd": loop_cfg["kd"],
            }
    for ch_name, ch_cfg in config.get("channels", {}).items():
        if ch_cfg.get("enabled", True) and ch_cfg["direction"] == "output":
            out_info = {
                "units": ch_cfg.get("units", ""),
                "min": ch_cfg.get("min", 0),
                "max": ch_cfg.get("max", 100),
            }
            if ch_cfg.get("control_options"):
                out_info["control_options"] = [
                    s.strip() for s in ch_cfg["control_options"].split(",")
                ]
            frontend_config["output_channels"][ch_name] = out_info
    for il in config.get("interlocks", []):
        if il.get("enabled", True):
            frontend_config["interlocks"].append({
                "name": il["name"],
                "channel": il["channel"],
                "condition": il["condition"],
                "threshold": il["threshold"],
            })
    frontend_config["step_series"] = config.get("step_series", [])
    frontend_config["step_columns"] = config.get("step_columns", [])
    return jsonify(frontend_config)


@app.route('/pid/setpoint', methods=['POST'])
def set_pid_setpoint():
    data = request.get_json()
    engine.set_pid_setpoint(data["loop"], float(data["setpoint"]))
    return jsonify({"status": "ok"})


@app.route('/pid/mode', methods=['POST'])
def set_pid_mode():
    data = request.get_json()
    engine.set_pid_mode(data["loop"], data["mode"])
    return jsonify({"status": "ok"})


@app.route('/pid/manual_output', methods=['POST'])
def set_manual_output():
    data = request.get_json()
    engine.set_manual_output(data["loop"], float(data["output"]))
    return jsonify({"status": "ok"})


@app.route('/output/set', methods=['POST'])
def set_output():
    data = request.get_json()
    engine.set_output(data["channel"], float(data["value"]))
    return jsonify({"status": "ok"})


@app.route('/step_series/mode', methods=['POST'])
def step_series_mode():
    data = request.get_json()
    engine.step_series_set_mode(data["mode"])
    return jsonify({"status": "ok"})


@app.route('/step_series/play_pause', methods=['POST'])
def step_series_play_pause():
    data = request.get_json(silent=True)
    if data and "running" in data:
        engine.step_series_play_pause(running=data["running"])
    else:
        engine.step_series_play_pause()
    return jsonify({"status": "ok"})


@app.route('/step_series/next', methods=['POST'])
def step_series_next():
    engine.step_series_next()
    return jsonify({"status": "ok"})


@app.route('/step_series/prev', methods=['POST'])
def step_series_prev():
    engine.step_series_prev()
    return jsonify({"status": "ok"})


@app.route('/step_series/goto', methods=['POST'])
def step_series_goto():
    data = request.get_json()
    engine.step_series_go_to_step(int(data["step"]))
    return jsonify({"status": "ok"})


@app.route('/save_point', methods=['POST'])
def save_point():
    filename = engine.save_point()
    return jsonify({"status": "ok", "file": filename})


@app.route('/stop', methods=['POST'])
def stop_server():
    """Stop the experiment engine and shut down the server."""
    engine.stop()
    def shutdown():
        print("\nExperiment stopped.", flush=True)
        os._exit(0)
    threading.Timer(0.5, shutdown).start()
    return jsonify({"status": "stopped"})


if __name__ == '__main__':
    port = args.port
    if not args.no_browser:
        # Open after a short delay so the server has time to start
        threading.Timer(1.5, webbrowser.open, args=[f"http://localhost:{port}"]).start()
    app.run(host='0.0.0.0', port=port, debug=True, use_reloader=False)
