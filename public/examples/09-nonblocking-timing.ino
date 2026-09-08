// Blink and report time without blocking the loop with delay().
const int ledPin = LED_BUILTIN;
unsigned long lastChange = 0;
bool ledState = LOW;

void setup() {
  Serial.begin(115200);
  pinMode(ledPin, OUTPUT);
}

void loop() {
  unsigned long now = millis();
  if (now - lastChange >= 500) {
    lastChange = now;
    ledState = !ledState;
    digitalWrite(ledPin, ledState);
    Serial.println(ledState ? "tick" : "tock");
  }
}
