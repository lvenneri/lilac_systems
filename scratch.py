import RPi.GPIO as GPIO
import time
import numpy as np
SENSOR_PIN = 4

GPIO.setmode(GPIO.BCM)
GPIO.setup(SENSOR_PIN, GPIO.IN)

def read_sensor():
    # read sensor data here
    # generate random number
    return np.random.rand()

while True:
    data = read_sensor()
    print("Sensor data:", data)
    time.sleep(1)



    # https://digilent.com/reference/software/daq-hats/start