// messung.h – Datentyp und Funktionen für Messungen (IT08.5)
#pragma once

struct Messung {
  unsigned long zeit;
  byte messstelle;
  float messwert;
};

void messwertEinlesen(struct Messung *messung, byte pin) {
  messung->zeit = millis();
  messung->messstelle = pin;
  messung->messwert = analogRead(pin) / 1024.0 * 5.0;
}

void messwertAusgeben(struct Messung *messung) {
  Serial.print("Stelle ");
  Serial.print(messung->messstelle);
  Serial.print(": ");
  Serial.print(messung->messwert, 2);
  Serial.print(" V (");
  Serial.print(messung->zeit);
  Serial.println(" ms)");
}
