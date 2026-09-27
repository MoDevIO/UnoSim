// Fade an LED with PWM and expose the output on the board view.
const int ledPin = 9;

void setup() {
  pinMode(ledPin, OUTPUT);
}

void loop() {
  for (int brightness = 0; brightness <= 255; brightness += 5) {
    analogWrite(ledPin, brightness);
    delay(20);
  }
  for (int brightness = 255; brightness >= 0; brightness -= 5) {
    analogWrite(ledPin, brightness);
    delay(20);
  }
}
