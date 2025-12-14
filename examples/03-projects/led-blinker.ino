// LED Blinker - Classic Arduino "Hello World"
// Blinks an LED on and off

void setup() {
  // Initialize digital pin 13 as an output
  pinMode(13, OUTPUT);
}

void loop() {
  // Turn the LED on
  digitalWrite(13, HIGH);
  delay(1000); // Wait for 1 second
  
  // Turn the LED off
  digitalWrite(13, LOW);
  delay(1000); // Wait for 1 second
}
