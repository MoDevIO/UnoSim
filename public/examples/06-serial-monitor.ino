/*
 * Serial Monitor
 *
 * Lernziel:
 * Text und Zahlen seriell ausgeben.
 *
 * Beobachtung:
 * Nach der Begrüßung erscheint jede Sekunde der Wert von millis().
 */

void setup() {
  Serial.begin(115200);
  Serial.println("UnoSim serial monitor demo");
}

void loop() {
  Serial.print("millis = ");
  Serial.println(millis());
  delay(1000);
}
