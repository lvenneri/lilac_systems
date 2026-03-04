# CO2 Monitor System

This directory contains the CO2 and air quality monitoring system that reads real sensor data from an Arduino device.

## Components

### arduino_log.py
Command-line script that reads sensor data from Arduino via serial port and logs it to CSV.

**Features:**
- Reads JSON data from Arduino (via /dev/ttyACM0)
- Logs temperature, humidity, pressure, eCO2, TVOC data
- Outputs to `arduino_json_data.csv`

**Usage:**
```bash
python arduino_log.py
```

### arduino_log_web.py
Web application with live charts for air quality monitoring.

**Features:**
- Reads data from Arduino in background thread
- Averages data over 60-second windows
- Serves live Chart.js visualizations
- Logs averaged data to `averaged_data.csv`
- Displays: Temperature, Humidity, Pressure, CO2, TVOC, and AQI

**Usage:**
```bash
python arduino_log_web.py
```
Then open browser to `http://localhost:5000`

**Run in background:**
```bash
nohup sudo python3 arduino_log_web.py >/dev/null 2>&1 &
```

**Stop background process:**
```bash
pkill -f "python3 arduino_log_web.py"
```

## Hardware Requirements

- Arduino board connected via USB (/dev/ttyACM0)
- Air quality sensors (based on sketch_feb22a_airquality.ino)
- Sensors: LM35 (temperature), BME280 or similar (humidity/pressure), CCS811 (CO2/TVOC)

## Configuration

Edit the following constants in the Python files:
- `SERIAL_PORT`: Default is '/dev/ttyACM0'
- `BAUD_RATE`: Default is 115200
- `AVERAGE_WINDOW_SECONDS`: Default is 60 seconds (arduino_log_web.py)

## Data Files

- `arduino_json_data.csv` - Raw readings from arduino_log.py
- `averaged_data.csv` - Averaged readings from arduino_log_web.py
