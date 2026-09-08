// Millis Timer
// Learn: How to use millis() to measure time without blocking with delay()

unsigned long lastTime = 0;
unsigned long interval = 2000;  // 2 seconds

void setup() {
  Serial.begin(115200);
  Serial.println("Millis Timer Example");
  Serial.println("===================");
  lastTime = millis();
}

void loop() {
  // Get current time
  unsigned long currentTime = millis();
  
  // Check if interval has passed
  if (currentTime - lastTime >= interval) {
    Serial.print("Timer triggered! Time: ");
    Serial.print(currentTime);
    Serial.println(" ms");
    
    lastTime = currentTime;  // Reset timer
  }
  
  // Other code can run here without being blocked
  // This doesn't block execution like delay() does
}
