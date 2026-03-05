# Lilac Box

A config-driven experiment control and monitoring dashboard built with Flask. Supports real-time plotting, PID control loops, safety interlocks, and CSV data logging. Designed to run on a Raspberry Pi.

## Setup

Requires Python 3.11+.

```bash
git clone <repo-url>
cd lilac_box
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
source venv/bin/activate
cd sensor_app
python app.py
```

Open `http://<pi-ip>:5001` in a browser.

## Documentation

See [sensor_app/README.md](sensor_app/README.md) for full details on architecture, config format, API endpoints, and adding hardware drivers.

## Network Access

### Get Raspberry Pi IP Address
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

### Copy Files from Pi to Another Machine
```bash
scp -r nitwit@192.168.0.23:/home/nitwit/lilac_box /Users/nitwit/Dropbox/LilacBox
```
