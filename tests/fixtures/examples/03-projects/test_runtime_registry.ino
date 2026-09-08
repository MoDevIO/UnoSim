// Test Runtime I/O Registry
// This tests loop-based pin initialization

void setup() {
  Serial.begin(115200);
  
  // Loop-based pin initialization (should be captured by runtime registry)
  for (byte i = 0; i < 6; i++) {
    pinMode(i, INPUT);
  }
  
  // Explicit pins
  pinMode(13, OUTPUT);
  pinMode(A0, INPUT);
  
  Serial.println("Pins configured");
}

void loop() {
  // Read loop-initialized pins
  for (byte i = 0; i < 6; i++) {
    digitalRead(i);
  }
  
  // Use explicit pins
  digitalWrite(13, HIGH);
  analogRead(A0);
  
  delay(1000);
}
