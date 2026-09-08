// Emit a changing value that is easy to inspect in the Serial Plotter.
int value = 0;
int direction = 1;

void setup() {
  Serial.begin(115200);
}

void loop() {
  Serial.print("value:");
  Serial.println(value);
  value += direction * 10;
  if (value >= 100 || value <= 0) direction = -direction;
  delay(100);
}
