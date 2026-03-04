# Lilac Box - Raspberry Pi Monitoring System

This project contains two separate systems:

1. **CO2 Monitor** - Real air quality monitoring with Arduino sensors
2. **Sensor App** - Generic simulated sensor dashboard

## Project Structure

```
lilac_box/
├── co2_monitor/          # Real CO2/air quality monitoring system
│   ├── arduino_log.py           # CLI sensor data logger
│   ├── arduino_log_web.py       # Web UI with live charts
│   ├── sketch_feb22a_airquality.ino  # Arduino firmware
│   └── README.md
│
├── sensor_app/           # Generic sensor simulation app
│   ├── app.py                   # Flask app with simulated data
│   ├── templates/               # HTML templates
│   ├── static/                  # Static assets
│   └── README.md
│
└── venv/                 # Python virtual environment
```

## Setup

### Activate Virtual Environment
```bash
source venv/bin/activate
```

### Install Packages
```bash
pip install flask flask-socketio pyserial eventlet
```

## Running the Applications

### CO2 Monitor (Port 5000)
```bash
cd co2_monitor
python3 arduino_log_web.py
```
Access at: http://192.168.0.23:5000

### Sensor App (Port 5001)
```bash
cd sensor_app
sudo python app.py
```
Access at: http://192.168.0.23:5001

## Auto-Start on Boot

The CO2 monitor runs automatically on boot via crontab.

**Update crontab to reflect new directory structure:**
```bash
crontab -e
```
Change to:
```
@reboot cd /home/nitwit/lilac_box/co2_monitor && nohup /usr/bin/python3 arduino_log_web.py >/dev/null 2>&1 &
```

## Network Access

### Get Raspberry Pi IP Address
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```
Example output: `inet 192.168.0.23  netmask 255.255.255.0`

### Ensure SSH is Active
```bash
sudo systemctl status ssh
```

### Copy Files from Pi to Another Machine
From your other machine:
```bash
scp -r nitwit@192.168.0.23:/home/nitwit/lilac_box /Users/nitwit/Dropbox/LilacBox
```

## See Component READMEs

- [CO2 Monitor Documentation](co2_monitor/README.md)
- [Sensor App Documentation](sensor_app/README.md)
