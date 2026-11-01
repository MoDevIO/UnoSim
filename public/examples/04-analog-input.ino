/*
 * Analogen Eingang lesen
 *
 * Lernziel:
 * Mit analogRead() eine Spannung als Zahl von 0 bis 1023 erfassen.
 *
 * Beobachtung:
 * Der Monitor zeigt alle 250 ms den Wert. Stelle A0 im Simulator ein.
 */

void setup() {
  Serial.begin(115200);
}

void loop() {
  Serial.print("A0: ");
  Serial.println(analogRead(A0));
  delay(250);
}
