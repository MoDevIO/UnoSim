// Digital Pin Read
// Learn: How to read the state of a digital pin (HIGH or LOW)

const int buttonPin = 2;  // Digital pin for button input

void setup() {
  Serial.begin(115200);
  pinMode(buttonPin, INPUT);
  Serial.println("Digital Pin Read Example");
  Serial.println("=======================");
}

void loop() {
  // Read the digital pin
  int buttonState = digitalRead(buttonPin);
  
  // Print the state
  Serial.print("Button Pin State: ");
  if (buttonState == HIGH) {
    Serial.println("HIGH (not pressed)");
  } else {
    Serial.println("LOW (pressed)");
  }
  
  delay(100);
}
