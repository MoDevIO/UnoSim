/*
 * IT08.5 – Struktur und Funktionen in eine Headerdatei auslagern
 *
 * Lernziel:
 * Datentyp und Funktionen in eine eigene Datei auslagern und mit #include
 * in das Hauptprogramm einbinden.
 *
 * Bezug zu den Unterlagen:
 * IT08, Folien „Funktionen in eine eigene Datei auslagern“ und
 * „Beispiel 4: struct als Funktionsparameter“ (funktionen.h).
 *
 * Beobachtung:
 * Das Programm verhält sich genau wie IT08.3. Hauptprogramm und Funktionen
 * stehen jetzt aber in zwei Dateien: diesem Sketch und messung.h.
 */

#include "messung.h"

const byte ANZAHL_MESSSTELLEN = 3;
const byte MESSSTELLEN[ANZAHL_MESSSTELLEN] = {A0, A1, A2};
struct Messung messungen[ANZAHL_MESSSTELLEN];

void setup() {
  Serial.begin(115200);
}

void loop() {
  for (byte i = 0; i < ANZAHL_MESSSTELLEN; i++) {
    messwertEinlesen(&messungen[i], MESSSTELLEN[i]);
  }
  for (byte i = 0; i < ANZAHL_MESSSTELLEN; i++) {
    messwertAusgeben(&messungen[i]);
  }
  Serial.println();
  delay(1000);
}

/*
 * Experimente:
 * 1. Öffne messung.h und ergänze in messwertAusgeben() die Einheit mV.
 * 2. Kommentiere die Zeile mit #include aus und lies die Fehlermeldungen.
 * 3. Ergänze in messung.h eine Funktion messwertGueltig(), die prüft, ob der
 *    Messwert größer als 0 V ist, und verwende sie hier.
 *
 * Lernfragen:
 * 1. Welche Aufgabe hat die Zeile mit #include?
 * 2. In welcher Datei ist messwertEinlesen() implementiert?
 * 3. Welchen Vorteil bietet die Trennung bei größeren Programmen?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen Datentypen und Funktionen in eine Headerdatei auslagern und einbinden können."
afterFocus: free
focus:
  - id: include
    title: "Einbinden mit #include"
    objective: "Die Aufgabe von `#include` erklären und die Folge ohne die Zeile vorhersagen."
    questions:
      - kind: concept
        text: "Welche Aufgabe hat die Zeile mit `#include`?"
      - kind: prediction
        text: "Welche Fehlermeldungen erwartest du, wenn die Zeile mit `#include` auskommentiert wird?"
  - id: organisation
    title: "Programme organisieren"
    objective: "Den Nutzen der Trennung in mehrere Dateien begründen."
    questions:
      - kind: recall
        text: "In welcher Datei sind `messwertEinlesen` und `messwertAusgeben` implementiert?"
      - kind: concept
        text: "Welchen Vorteil bietet die Trennung in Hauptprogramm und Headerdatei bei größeren Programmen?"
@end-unosim-tutor */
