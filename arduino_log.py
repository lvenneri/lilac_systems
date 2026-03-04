import serial
import json
import csv
from datetime import datetime

SERIAL_PORT = '/dev/ttyACM0'  # Adjust to your device (e.g., /dev/ttyUSB0)
BAUD_RATE   = 115200          # Must match Arduino's Serial.begin
CSV_FILENAME = 'arduino_json_data.csv'

def main():
    # Open serial port
    ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
    
    # Open a CSV file for writing
    with open(CSV_FILENAME, 'w', newline='') as csvfile:
        csv_writer = csv.writer(csvfile)
        
        # Optional: Write a header row
        header = ["Timestamp", "LM35_Temp", "LM35_Unit", "Humidity", "Humidity_Unit",
                  "Pressure", "Pressure_Unit", "eCO2", "eCO2_Unit", "TVOC", "TVOC_Unit"]
        csv_writer.writerow(header)
        
        print(f"Reading from {SERIAL_PORT} and writing to {CSV_FILENAME}. Press Ctrl+C to stop.")
        
        while True:
            try:
                line = ser.readline().decode('utf-8').strip()
                if not line:
                    continue
                
                # Parse the JSON line from Arduino
                data = json.loads(line)  # This gives us a dict
                
                # Extract fields safely
                # (Use dict.get(...) to avoid errors if a field is missing)
                LM35_Temp  = data.get("LM35_Temp", None)
                LM35_Unit  = data.get("LM35_Unit", "")
                Humidity   = data.get("Humidity", None)
                Humid_Unit = data.get("Humidity_Unit", "")
                Pressure   = data.get("Pressure", None)
                Press_Unit = data.get("Pressure_Unit", "")
                eCO2       = data.get("eCO2", None)
                eCO2_Unit  = data.get("eCO2_Unit", "")
                TVOC       = data.get("TVOC", None)
                TVOC_Unit  = data.get("TVOC_Unit", "")
                
                # Build a row with a timestamp (from Pi) plus the data
                now_str = datetime.now().isoformat()
                row = [
                    now_str,
                    LM35_Temp,  LM35_Unit,
                    Humidity,   Humid_Unit,
                    Pressure,   Press_Unit,
                    eCO2,       eCO2_Unit,
                    TVOC,       TVOC_Unit
                ]
                
                csv_writer.writerow(row)
                print("Logged:", row)
            
            except KeyboardInterrupt:
                print("\nExiting...")
                break
            except json.JSONDecodeError:
                # If a line isn't valid JSON, skip it or handle error
                print("Invalid JSON line:", line)
            except Exception as e:
                print("Error:", e)

    ser.close()

if __name__ == '__main__':
    main()
