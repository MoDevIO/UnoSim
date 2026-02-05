int f=30;
int t=1000/f;

void setup() {
  // Initialize digital pin 13 as an output
  pinMode(13, OUTPUT);
}

void loop() {
  // Turn the LED on
  digitalWrite(13, HIGH);
  delay(t/2); // Wait for 1 second
  
  // Turn the LED off
  digitalWrite(13, LOW);
  delay(t/2); // Wait for 1 second
}
