/*
 * Serial Plotter
 *
 * Lernziel:
 * Einen Wert so ausgeben, dass der Plotter eine Kurve zeichnet.
 *
 * Beobachtung:
 * Im Plotter pendelt die Kurve value zwischen 0 und 100.
 */

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
