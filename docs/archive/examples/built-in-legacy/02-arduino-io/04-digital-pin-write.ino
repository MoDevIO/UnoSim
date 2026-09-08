// Digital Pin Write
// Learn: How to write HIGH or LOW to a digital pin to control devices

const int ledPin = 13;  // Digital pin for LED output

void setup() {
  Serial.begin(115200);
  pinMode(ledPin, OUTPUT);
  Serial.println("Digital Pin Write Example");
  Serial.println("========================");
}

void loop() {
  // Set pin to HIGH
  digitalWrite(ledPin, HIGH);
  Serial.println("LED ON");
  delay(1000);
  
  // Set pin to LOW
  digitalWrite(ledPin, LOW);
  Serial.println("LED OFF");
  delay(1000);
}
