#include <Wire.h>
#include "DFRobot_RGBLCD1602.h"
#include <Servo.h>

// NEW LIBRARIES FOR ENS160 and BME280
#include "SparkFun_ENS160.h"
#include "SparkFunBME280.h"

// Instantiate the LCD with RGB address 0x60 and dimensions 16x2
DFRobot_RGBLCD1602 lcd(0x60, 16, 2);

// Instantiate the servo object
Servo myServo;

// Create sensor objects
SparkFun_ENS160 myENS;
BME280 myBME280;

// Thresholds / Settings
#define TEMP_THRESHOLD    25.0   // LM35 Temperature alarm if > 25°C
#define CO2_THRESHOLD     1000.0 // eCO2 alarm if > 1000 ppm
#define LIGHT_THRESHOLD   5.0    // Light sensor voltage alarm if > 5V

// Pin definitions
const int LED_PIN     = 6;  // External RED LED
const int SPEAKER_PIN = 8;  // Speaker
const int MOTION_PIN  = 5;  // IR motion sensor
const int SERVO_PIN   = 9;  // Servo

// Which analog pins?
//  A0 -> LM35
//  A2 -> Light sensor

// Servo positions (adjust as needed)
const int SERVO_ALARM_UP   = 90; 
const int SERVO_ALARM_DOWN = 0;  

// Global variable to record the last time motion was detected
unsigned long lastMotionTime = 0;

// Optional "breath" function for a backlight effect at startup
void breath(unsigned char color) {
  for (int i = 0; i < 255; i++) {
    lcd.setPWM(color, i);
    delay(5);
  }
  delay(500);
  for (int i = 254; i >= 0; i--) {
    lcd.setPWM(color, i);
    delay(5);
  }
  delay(500);
}

// --- NEW: Boot chirp function ---
// Plays a short ascending chirp
void elegantBootChirp() {
  // Example: 3 short ascending notes
  tone(SPEAKER_PIN, 500, 150); // 500 Hz for 150ms
  delay(150);
  tone(SPEAKER_PIN, 700, 150); // 700 Hz for 150ms
  delay(150);
  tone(SPEAKER_PIN, 900, 150); // 900 Hz for 150ms
  delay(200);
  tone(SPEAKER_PIN, 900, 150); // 900 Hz for 150ms
  delay(200);
  noTone(SPEAKER_PIN);
}

void setup() {
  Serial.begin(115200);
  Wire.begin();
  
  // --------------------
  //   Initialize LCD
  // --------------------
  lcd.init();
  lcd.clear();
  lcd.setCursor(4, 0);
  lcd.print("Booting...");
  lcd.setCursor(1, 1);
  delay(1000);
  // breath((lcd.REG_ONLY)); // optional fancy effect

  // --- Play the boot chirp here ---
  elegantBootChirp();

  // --------------------
  //   Pin Modes
  // --------------------
  pinMode(LED_PIN, OUTPUT);
  pinMode(SPEAKER_PIN, OUTPUT);
  pinMode(MOTION_PIN, INPUT);

  // Default LCD backlight color
  lcd.setRGB(255, 186, 51);

  // --------------------
  //   Servo Setup
  // --------------------
  myServo.attach(SERVO_PIN);
  myServo.write(SERVO_ALARM_DOWN);

  // --------------------
  //   BME280 Setup
  // --------------------
  if (!myBME280.beginI2C()) {
    Serial.println("BME280 not detected. Check wiring!");
    while (1) ; // Stop here
  }
  Serial.println("BME280 initialization complete.");

  // --------------------
  //   ENS160 Setup
  // --------------------
  if (!myENS.begin()) {
    Serial.println("ENS160 not detected. Check wiring!");
    while (1) ; // Stop here
  }
  Serial.println("ENS160 initialization complete.");

  // Optional: reset ENS160 to default
  myENS.setOperatingMode(SFE_ENS160_RESET);
  delay(100);

  // Initial compensation
  float initialTemp = readLM35C();            // from LM35
  float initialHum  = myBME280.readFloatHumidity();
  myENS.setTempCompensationCelsius(initialTemp);
  myENS.setRHCompensationFloat(initialHum);

  // Put ENS160 into STANDARD operating mode
  myENS.setOperatingMode(SFE_ENS160_STANDARD);
  delay(500);

  // Check status flags of ENS160
  int ensStatus = myENS.getFlags();
  Serial.print("ENS160 Status Flag (0=OK,1=Warm-up,2=Initial Start-up): ");
  Serial.println(ensStatus);

  lcd.clear();
  lcd.setCursor(0,0);
  lcd.print("Setup Complete");
  delay(1000);
}

// --------------------------
//  Helper to read LM35 (A0)
// --------------------------
float readLM35C() {
  int   tempRaw     = analogRead(A0);
  float voltageTemp = tempRaw * (5.0 / 1023.0);
  // LM35: 10 mV/°C => 0.01 V/°C => 1°C = 0.01 V
  return voltageTemp * 100.0;
}

void loop() 
{
  // --------------------------------------------------------------------
  // Read Light Sensor (analog pin A2)
  // --------------------------------------------------------------------
  int   lightRaw     = analogRead(A2);
  float voltageLight = lightRaw * (5.0 / 1023.0);

  // --------------------------------------------------------------------
  // Read LM35 for Temperature
  // --------------------------------------------------------------------
  float temperatureC = readLM35C();

  // --------------------------------------------------------------------
  // Use BME280 for Humidity AND Pressure
  // --------------------------------------------------------------------
  float humidity     = myBME280.readFloatHumidity();
  float pressurePa   = myBME280.readFloatPressure(); // in Pascals
  float pressurehPa  = pressurePa / 100.0;           // in hPa (millibars)

  // --------------------------------------------------------------------
  // Update ENS160 compensation
  // --------------------------------------------------------------------
  myENS.setTempCompensationCelsius(temperatureC); // from LM35
  myENS.setRHCompensationFloat(humidity);         // from BME280

  // --------------------------------------------------------------------
  // Read ENS160 data
  // --------------------------------------------------------------------
  float eCO2 = myENS.getECO2();   // eCO2 in ppm
  float tvoc = myENS.getTVOC();   // Total Volatile Organic Compounds in ppb
  uint8_t aqi = myENS.getAQI();   // 1-5

  // --------------------------------------------------------------------
  // Check Motion Sensor
  // --------------------------------------------------------------------
  if (digitalRead(MOTION_PIN) == HIGH) {
    lastMotionTime = millis();
  }

  // --------------------------------------------------------------------
  // Print All Data to Serial as JSON
  // --------------------------------------------------------------------
  Serial.print("{");
  Serial.print("\"LM35_Temp\":");
  Serial.print(temperatureC, 2);
  Serial.print(",\"LM35_Unit\":\"C\",");

  Serial.print("\"Humidity\":");
  Serial.print(humidity, 2);
  Serial.print(",\"Humidity_Unit\":\"%\",");

  Serial.print("\"Pressure\":");
  Serial.print(pressurehPa, 2);
  Serial.print(",\"Pressure_Unit\":\"hPa\",");

  Serial.print("\"eCO2\":");
  Serial.print(eCO2);
  Serial.print(",\"eCO2_Unit\":\"ppm\",");

  Serial.print("\"TVOC\":");
  Serial.print(tvoc);
  Serial.print(",\"TVOC_Unit\":\"ppb\",");

  // --------------------------------------------------------------------
  // ADDITION: Air Quality Index (AQI) and Light Sensor Voltage
  // --------------------------------------------------------------------
  Serial.print("\"AQI\":");
  Serial.print(aqi);
  Serial.print(",\"AQI_Scale\":\"1-5\",");

  Serial.print("\"Light\":");
  Serial.print(voltageLight, 2);
  Serial.print(",\"Light_Unit\":\"V\"");

  Serial.println("}");

  // --------------------------------------------------------------------
  //  Update the LCD (Normal Mode)
  // --------------------------------------------------------------------
  lcd.clear();

  // First row: LM35 Temp & eCO2
  lcd.setCursor(0, 0);
  lcd.print("T:");
  lcd.print(temperatureC, 1);
  lcd.print("C eC:");
  lcd.print(eCO2, 0);

  // Second row: Humidity & Pressure 
  lcd.setCursor(0, 1);
  lcd.print("H:");
  lcd.print(humidity, 0);
  lcd.print("% P:");
  lcd.print(pressurehPa, 0);

  // --------------------------------------------------------------------
  //  Check Alarm Conditions
  //  (using LM35 temperature, eCO2 from ENS160, light sensor)
  // --------------------------------------------------------------------
  if ((temperatureC > TEMP_THRESHOLD) || 
      (eCO2         > CO2_THRESHOLD) ||
      (voltageLight > LIGHT_THRESHOLD))
  {
    // Set LCD backlight solid red
    lcd.setRGB(255, 51, 51);
    // Move servo to "up" position
    myServo.write(SERVO_ALARM_UP);

    // Keep alarming until conditions clear
    while ((temperatureC > TEMP_THRESHOLD) || 
           (eCO2         > CO2_THRESHOLD) ||
           (voltageLight > LIGHT_THRESHOLD))
    {
      // Blink LED and sound speaker
      digitalWrite(LED_PIN, HIGH);
      tone(SPEAKER_PIN, 1000); 
      delay(250);
      digitalWrite(LED_PIN, LOW);
      noTone(SPEAKER_PIN);
      delay(250);

      // Update sensor readings inside alarm loop
      lightRaw     = analogRead(A2);
      voltageLight = lightRaw * (5.0 / 1023.0);
      temperatureC = readLM35C();
      humidity     = myBME280.readFloatHumidity();
      pressurePa   = myBME280.readFloatPressure();
      pressurehPa  = pressurePa / 100.0;

      // Re-update ENS160
      myENS.setTempCompensationCelsius(temperatureC);
      myENS.setRHCompensationFloat(humidity);

      eCO2 = myENS.getECO2();
      tvoc = myENS.getTVOC();
      aqi  = myENS.getAQI();

      // Check motion sensor
      if (digitalRead(MOTION_PIN) == HIGH) {
        lastMotionTime = millis();
      }

      // Update LCD in alarm
      lcd.clear();
      lcd.setCursor(0, 0);
      lcd.print("ALARM!");
      lcd.setCursor(0, 1);
      lcd.print("T:");
      lcd.print(temperatureC, 1);
      lcd.print("C eC:");
      lcd.print(eCO2, 0);
    }

    // Once alarm condition clears:
    lcd.setRGB(255, 186, 51);   // back to normal color
    myServo.write(SERVO_ALARM_DOWN);
  }

  // --------------------------------------------------------------------
  //  Wait 1s before next reading
  // --------------------------------------------------------------------
  delay(1000);
}
