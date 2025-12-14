// Stopwatch Timer
// Simple stopwatch that counts milliseconds and displays elapsed time

unsigned long startTime = 0;
unsigned long elapsedTime = 0;
boolean isRunning = false;

void setup() {
  Serial.begin(115200);
  Serial.println("Stopwatch Timer");
  Serial.println("==============");
  Serial.println("Starting in 2 seconds...");
  delay(2000);
  
  startTime = millis();
  isRunning = true;
  Serial.println("Timer started!");
}

void loop() {
  if (isRunning) {
    elapsedTime = millis() - startTime;
    
    // Calculate minutes, seconds, and milliseconds
    unsigned long minutes = elapsedTime / 60000;
    unsigned long seconds = (elapsedTime % 60000) / 1000;
    unsigned long ms = elapsedTime % 1000;
    
    // Print formatted time
    Serial.print("Time: ");
    Serial.print(minutes);
    Serial.print(":");
    
    // Pad seconds with leading zero if needed
    if (seconds < 10) Serial.print("0");
    Serial.print(seconds);
    Serial.print(".");
    
    // Pad milliseconds with leading zeros if needed
    if (ms < 100) Serial.print("0");
    if (ms < 10) Serial.print("0");
    Serial.println(ms);
    
    delay(100); // Update every 100ms
    
    // Stop after 60 seconds for demo
    if (elapsedTime > 60000) {
      isRunning = false;
      Serial.println("60 seconds reached - Timer stopped!");
    }
  }
}
