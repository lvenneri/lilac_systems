from flask import Flask, render_template, jsonify, request
import random, math, csv, os, time

app = Flask(__name__)

# Global control settings (the last values sent by the client).
# You can extend this with additional keys dynamically.
control_settings = {}

# Global flag to track if the CSV file has been initialized.
file_initialized = False

def get_cpu_temperature():
    """Attempt to read the CPU temperature from the system; otherwise, simulate it."""
    try:
        with open("/sys/class/thermal/thermal_zone0/temp", "r") as f:
            temp_str = f.read().strip()
            return float(temp_str) / 1000.0
    except Exception:
        return random.uniform(40, 80)

def flatten_dict(d, parent_key='', sep='_'):
    """
    Recursively flatten a dictionary.
    For example, {'rotation': {'x': 1, 'y': 2}} becomes {'rotation_x': 1, 'rotation_y': 2}.
    """
    items = {}
    for k, v in d.items():
        new_key = f"{parent_key}{sep}{k}" if parent_key else k
        if isinstance(v, dict):
            items.update(flatten_dict(v, new_key, sep=sep))
        else:
            items[new_key] = v
    return items

def read_one_sample():
    """Simulate a sensor reading including extra environmental data."""
    sensor = {
        "rotation": {
            "x": random.uniform(0, 2 * math.pi),
            "y": random.uniform(0, 2 * math.pi),
            "z": random.uniform(0, 2 * math.pi)
        },
        "dial1": random.uniform(0, 100),
        "dial2": random.uniform(0, 100),
        "status": "OK",
        "temperature": random.uniform(20, 30)
    }
    sensor["cpu_temp"] = get_cpu_temperature()             # Raspberry Pi CPU temperature
    sensor["ambient_temp"] = random.uniform(20, 30)          # Simulated ambient temperature
    sensor["humidity"] = random.uniform(30, 70)              # Simulated humidity (in %)
    sensor["pressure"] = random.uniform(950, 1050)           # Simulated pressure (in hPa)
    return sensor

def log_data(sensor, controls):
    """Flatten the sensor data, merge with controls, and log the result to a CSV file."""
    global file_initialized
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
    
    # Flatten sensor dictionary (e.g., rotation becomes rotation_x, etc.)
    flattened_sensor = flatten_dict(sensor)
    row = {"timestamp": timestamp}
    row.update(flattened_sensor)
    row.update(controls)  # Merge in all controls

    # Determine CSV fieldnames from the row keys (order not guaranteed)
    fieldnames = list(row.keys())

    # Choose file open mode: if not initialized, use write mode (or append if desired)
    mode = 'a'
    header_needed = False
    if not file_initialized:
        mode = 'a' if controls.get("append", False) else 'w'
        header_needed = True
        file_initialized = True

    filename = controls.get("file_name", "junk.csv")
    file_exists = os.path.isfile(filename)
    with open(filename, mode, newline='') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        if header_needed or not file_exists:
            writer.writeheader()
        writer.writerow(row)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/data')
def data():
    sensor = read_one_sample()
    log_data(sensor, control_settings)
    return jsonify({
        "sensors": sensor,
        "controls": control_settings
    })

@app.route('/update', methods=['POST'])
def update():
    global file_initialized, control_settings
    data = request.get_json()
    # Dynamically update control_settings for every key in the received command.
    for key, value in data.items():
        if key == "file_name":
            if value != control_settings.get("file_name"):
                control_settings[key] = value
                file_initialized = False  # reset so header will be re-written for a new file
            else:
                control_settings[key] = value
        elif key == "append":
            if isinstance(value, bool):
                control_settings[key] = value
            else:
                control_settings[key] = (value.lower() == "true")
        else:
            control_settings[key] = value
    return jsonify({"status": "success", "received": data, "controls": control_settings})

@app.route('/log_data')
def log_data_endpoint():
    filename = control_settings.get("file_name", "junk.csv")
    if not os.path.exists(filename):
        return jsonify([])
    rows = []
    with open(filename, 'r') as csvfile:
        reader = csv.DictReader(csvfile)
        for row in reader:
            rows.append(row)
    return jsonify(rows)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)