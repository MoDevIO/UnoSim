void setup() {
  Serial.begin(115200);
  pinMode(A0, INPUT);
  Serial.println("A0 gestartet");
}

void loop() {
  digitalRead(A0);  
  delay(80);
}