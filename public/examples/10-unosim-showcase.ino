// A compact tour of UnoSim: GPIO, analog input, PWM, serial, and timing.
const int buttonPin = 2;
const int pwmPin = 9;
const int ledPin = LED_BUILTIN;
unsigned long lastReport = 0;

void setup() {
  Serial.begin(115200);
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(pwmPin, OUTPUT);
  pinMode(ledPin, OUTPUT);
  Serial.println("UnoSim showcase ready");
}

void loop() {
  int sensor = analogRead(A0);
  int brightness = map(sensor, 0, 1023, 0, 255);
  bool pressed = digitalRead(buttonPin) == LOW;
  if (pressed) brightness = 255 - brightness;
  analogWrite(pwmPin, brightness);
  digitalWrite(ledPin, pressed ? HIGH : LOW);

  if (millis() - lastReport >= 500) {
    lastReport = millis();
    Serial.print("A0=");
    Serial.print(sensor);
    Serial.print(" PWM=");
    Serial.print(brightness);
    Serial.print(" button=");
    Serial.println(pressed ? "pressed" : "released");
  }
}
