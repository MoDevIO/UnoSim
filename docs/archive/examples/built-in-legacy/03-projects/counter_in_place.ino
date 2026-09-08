int zaehler = 0;

void setup() {
  Serial.begin(115200);
  Serial.println("Zähler gestartet:\n");
}

void loop() {
  // \r setzt den Cursor an den Anfang der Zeile
  Serial.print("\rAktueller Wert: ");
  Serial.print(zaehler);
  Serial.print("      "); 
  zaehler++;
  delay(1000);
}