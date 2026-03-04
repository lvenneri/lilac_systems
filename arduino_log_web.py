#/home/nitwit/lilac_box/venv/bin/python python3

import os
import csv
import serial
import json
import threading
import time
from datetime import datetime
from flask import Flask, jsonify, render_template_string

# ---------------------------------
#  Configuration
# ---------------------------------
SERIAL_PORT = '/dev/ttyACM0'   # Adjust for your Arduino
BAUD_RATE   = 115200
AVERAGE_WINDOW_SECONDS = 60    
SLEEP_BETWEEN_READS = 0.1      # Slight delay to avoid busy-loop
CSV_FILENAME = "averaged_data.csv"

data_buffer = []               # Stores *averages* in memory (for the web endpoint)

app = Flask(__name__)

# ----------------------------------------------------------------------
#  1) Serve the HTML page
# ----------------------------------------------------------------------
@app.route('/')
def index():
    """
    Returns an HTML page with multiple Chart.js charts,
    each fetching data from /data every few seconds.
    """
    html_page = """
<!DOCTYPE html>
<html>
<head>
    <title>Arduino Live Data</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <!-- Chart.js date-fns adapter for time-based x-axis: -->
    <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>
</head>
<body>
    <h1>Air Quality Data</h1>

    <!-- One canvas per chart; set them bigger for clarity -->
    <canvas id="tempChart"    width="600" height="200"></canvas>
    <canvas id="humidityChart" width="600" height="200"></canvas>
    <canvas id="pressureChart" width="600" height="200"></canvas>
    <canvas id="co2Chart"     width="600" height="200"></canvas>
    <canvas id="tvocChart"    width="600" height="200"></canvas>
    <canvas id="aqiChart"     width="600" height="200"></canvas>

    <script>
    // We store data for each sensor in arrays:
    let tempData     = [];
    let humidityData = [];
    let pressureData = [];
    let co2Data      = [];
    let tvocData     = [];
    let aqiData      = [];

    // We use an array of timestamps as "labels" for Chart.js,
    // in time-based mode these labels will be timestamps.
    let timeLabels   = [];

    // Common chart options with time-based x-axis
    const commonOptions = {
      responsive: false,
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'minute',   // Adjust as needed
          },
          title: { display: true, text: 'Time' }
        },
        y: {
          title: { display: true, text: 'Value' }
        }
      }
    };

    // 1) Temperature Chart
    const tempChart = new Chart(
      document.getElementById('tempChart').getContext('2d'),
      {
        type: 'line',
        data: {
          labels: timeLabels,
          datasets: [{
            label: 'Temperature (C)',
            data: tempData,
            borderColor: 'red',
            fill: false,
          }]
        },
        options: commonOptions
      }
    );

    // 2) Humidity Chart
    const humidityChart = new Chart(
      document.getElementById('humidityChart').getContext('2d'),
      {
        type: 'line',
        data: {
          labels: timeLabels,
          datasets: [{
            label: 'Humidity (%)',
            data: humidityData,
            borderColor: 'blue',
            fill: false,
          }]
        },
        options: commonOptions
      }
    );

    // 3) Pressure Chart
    const pressureChart = new Chart(
      document.getElementById('pressureChart').getContext('2d'),
      {
        type: 'line',
        data: {
          labels: timeLabels,
          datasets: [{
            label: 'Pressure (hPa)',
            data: pressureData,
            borderColor: 'green',
            fill: false,
          }]
        },
        options: commonOptions
      }
    );

    // 4) eCO2 Chart
    const co2Chart = new Chart(
      document.getElementById('co2Chart').getContext('2d'),
      {
        type: 'line',
        data: {
          labels: timeLabels,
          datasets: [{
            label: 'eCO2 (ppm)',
            data: co2Data,
            borderColor: 'purple',
            fill: false,
          }]
        },
        options: commonOptions
      }
    );

    // 5) TVOC Chart
    const tvocChart = new Chart(
      document.getElementById('tvocChart').getContext('2d'),
      {
        type: 'line',
        data: {
          labels: timeLabels,
          datasets: [{
            label: 'TVOC (ppb)',
            data: tvocData,
            borderColor: 'orange',
            fill: false,
          }]
        },
        options: commonOptions
      }
    );

    // 6) AQI Chart
    const aqiChart = new Chart(
      document.getElementById('aqiChart').getContext('2d'),
      {
        type: 'line',
        data: {
          labels: timeLabels,
          datasets: [{
            label: 'AQI (1-5)',
            data: aqiData,
            borderColor: 'brown',
            fill: false,
          }]
        },
        options: commonOptions
      }
    );

    // Function to fetch new data from /data
    async function fetchData() {
      try {
        const response = await fetch('/data');
        const jsonData = await response.json();
        
        // Clear existing arrays
        timeLabels.length   = 0;
        tempData.length     = 0;
        humidityData.length = 0;
        pressureData.length = 0;
        co2Data.length      = 0;
        tvocData.length     = 0;
        aqiData.length      = 0;
        
        // Populate arrays
        jsonData.forEach((item) => {
          // item.timestamp is an ISO string e.g. "2025-02-22 10:12:05"
          // For Chart.js time axis, we can push as a string or Date object:
          timeLabels.push(item.timestamp); 
          tempData.push(item.LM35_Temp);
          humidityData.push(item.Humidity);
          pressureData.push(item.Pressure);
          co2Data.push(item.eCO2);
          tvocData.push(item.TVOC);
          aqiData.push(item.AQI);
        });

        // Update all charts
        tempChart.update();
        humidityChart.update();
        pressureChart.update();
        co2Chart.update();
        tvocChart.update();
        aqiChart.update();

      } catch (error) {
        console.error("Error fetching data:", error);
      }
    }

    // Fetch data initially, then every 5 seconds
    fetchData();
    setInterval(fetchData, 5000);
    </script>
</body>
</html>
    """
    return render_template_string(html_page)


# ----------------------------------------------------------------------
#  2) Route that returns the data as JSON
# ----------------------------------------------------------------------
@app.route('/data')
def get_data():
    """
    Return the data_buffer as JSON.
    Each item in data_buffer is a dict with fields:
      {
        "timestamp":  "YYYY-MM-DD HH:MM:SS",
        "LM35_Temp":  ...,
        "Humidity":   ...,
        "Pressure":   ...,
        "eCO2":       ...,
        "TVOC":       ...,
        "AQI":        ...
      }
    """
    return jsonify(data_buffer)

# ----------------------------------------------------------------------
#  3) CSV-writing helper
# ----------------------------------------------------------------------
def write_to_csv(data_dict, filename=CSV_FILENAME):
    """
    Appends a single row to CSV, creating the file with a header if it doesn't exist yet.
    """
    file_exists = os.path.isfile(filename)
    with open(filename, mode='a', newline='') as f:
        writer = csv.writer(f)

        # If the file did not exist before, write header
        if not file_exists:
            writer.writerow(["timestamp", "LM35_Temp", "Humidity", "Pressure", "eCO2", "TVOC", "AQI"])

        # Prepare a row matching the header
        row = [
            data_dict.get("timestamp", ""),
            data_dict.get("LM35_Temp", ""),
            data_dict.get("Humidity", ""),
            data_dict.get("Pressure", ""),
            data_dict.get("eCO2", ""),
            data_dict.get("TVOC", ""),
            data_dict.get("AQI", ""),
        ]
        writer.writerow(row)

# ----------------------------------------------------------------------
#  4) Background thread: read from serial, store averaged data
# ----------------------------------------------------------------------
def read_serial_data():
    """
    Continuously reads lines from Arduino as they arrive, accumulates
    them in a rolling buffer for AVERAGE_WINDOW_SECONDS, then computes 
    the average of everything in that window.
    Each average is appended to:
      - data_buffer (in-memory, for the web endpoint)
      - CSV file on disk (for permanent logging)
    """
    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
        print(f"Opened serial port: {SERIAL_PORT}")
    except Exception as e:
        print("Error opening serial port:", e)
        return

    rolling_buffer = []
    window_start_time = None

    while True:
        try:
            # Read a line if available:
            line = ser.readline().decode('utf-8').strip()
            if not line:
                time.sleep(SLEEP_BETWEEN_READS)
                continue

            # Parse JSON from Arduino
            sample = json.loads(line)

            # If first sample of a new window, record the start time
            if window_start_time is None:
                window_start_time = time.time()

            # Accumulate into rolling buffer
            rolling_buffer.append(sample)

            # Check elapsed time
            elapsed = time.time() - window_start_time
            if elapsed >= AVERAGE_WINDOW_SECONDS:
                # Compute average of this window
                avg_data = compute_average(rolling_buffer)
                # Add a timestamp (use the end of the window as the time stamp)
                avg_data["timestamp"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

                # 1) Append to in-memory buffer (for the live web endpoint)
                data_buffer.append(avg_data)
                
                # 2) Also write out to CSV
                write_to_csv(avg_data, CSV_FILENAME)

                print("Add point:", avg_data)

                # Clear rolling buffer, start a new window
                rolling_buffer.clear()
                window_start_time = None

        except Exception as e:
            print("Serial read error:", e)

        # Small sleep to avoid busy-looping:
        time.sleep(SLEEP_BETWEEN_READS)


def compute_average(samples):
    """
    Given a list of dicts, compute the average for each numeric key.
    Returns a single dict with the same keys, but averaged values.
    """
    if not samples:
        return {}

    sums = {}
    counts = {}
    for item in samples:
        for key, value in item.items():
            if isinstance(value, (int, float)):
                sums[key] = sums.get(key, 0.0) + value
                counts[key] = counts.get(key, 0) + 1

    avg_data = {}
    for key in sums.keys():
        avg_data[key] = sums[key] / counts[key]

    return avg_data

# ----------------------------------------------------------------------
#  5) Main entry point
# ----------------------------------------------------------------------
if __name__ == '__main__':
    # Start reading from serial in a background thread
    t = threading.Thread(target=read_serial_data, daemon=True)
    t.start()
    
    # Start the Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)

    # nohup sudo python3 arduino_log_web.py >/dev/null 2>&1 &
    # pkill -f "python3 arduino_log_web.py"
    