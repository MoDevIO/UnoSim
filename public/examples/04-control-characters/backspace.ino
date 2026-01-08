void setup() {
  Serial.begin(115200);
  
  Serial.print("Counting: 1");
  delay(1000);
  Serial.print("\b2"); 
  delay(1000);
  Serial.print("\b3"); 
  delay(3000);
  Serial.print("\b4");
}


void loop() {
  Serial.println(".");
  delay(3000);
}