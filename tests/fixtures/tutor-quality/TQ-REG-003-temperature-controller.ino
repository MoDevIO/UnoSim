// TQ-REG-003: a temperature controller in the shape of the sketch the unclear Tutor question was
// observed on (if / else if / else, an early return, serial output). Reconstructed, not the original.
const int sensorPin = A0;
const int heaterRelay = 8;
const int fanRelay = 9;
const float TEMP_MIN = 19.0;
const float TEMP_MAX = 24.0;

void setup() {
  pinMode(heaterRelay, OUTPUT);
  pinMode(fanRelay, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  int raw = analogRead(sensorPin);
  if (raw == 0) {
    Serial.println("Sensorfehler");
    return;
  }
  float temperature = raw * 0.488 - 50.0;
  if (temperature < TEMP_MIN) {
    digitalWrite(heaterRelay, HIGH);
    digitalWrite(fanRelay, LOW);
    Serial.println("Heizen");
  } else if (temperature > TEMP_MAX) {
    digitalWrite(heaterRelay, LOW);
    digitalWrite(fanRelay, HIGH);
    Serial.println("Lueften");
  } else {
    digitalWrite(heaterRelay, LOW);
    digitalWrite(fanRelay, LOW);
    Serial.println("Halten");
  }
  delay(1000);
}
