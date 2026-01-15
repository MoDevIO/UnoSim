// Test: Multiple pinMode calls with different modes
void setup() {
  Serial.begin(9600);
  
  // Pin 5: Different modes (conflict)
  pinMode(5, OUTPUT);
  pinMode(5, INPUT);
  
  // Pin 3: Same mode multiple times
  pinMode(3, INPUT);
  pinMode(3, INPUT);
  pinMode(3, INPUT);
  
  // Pin 7: Single call
  pinMode(7, OUTPUT);
  
  Serial.println("Setup complete");
}

void loop() {
  delay(1000);
  Serial.println("Running...");
}
