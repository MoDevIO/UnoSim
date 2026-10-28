/*
 * IT01.5 – Globale und lokale Variablen
 *
 * Lernziel:
 * Den Gültigkeitsbereich globaler und lokaler Variablen unterscheiden.
 *
 * Bezug zu den Unterlagen:
 * IT01 Daten, Folie „Globale Variablen / Lokale Variablen“.
 *
 * Beobachtung:
 * setup() setzt den globalen Zähler auf 10. Danach erhöht loop() ihn jede
 * Sekunde um 1: 11, 12, 13, ...
 * delay(1000) wartet eine Sekunde (Vorgriff auf IT03).
 */

int zaehlerGlobal = 0;        // global: überall im Programm verwendbar

void setup() {
  Serial.begin(115200);

  int startwert = 10;         // lokal: nur in setup() verwendbar
  zaehlerGlobal = startwert;
  Serial.print("setup: zaehlerGlobal = ");
  Serial.println(zaehlerGlobal);
}

void loop() {
  int schritt = 1;            // lokal: wird bei jedem Durchlauf von loop() neu angelegt
  zaehlerGlobal = zaehlerGlobal + schritt;
  Serial.print("loop:  zaehlerGlobal = ");
  Serial.println(zaehlerGlobal);
  delay(1000);
}

/*
 * Experimente:
 * 1. Gib in loop() zusätzlich startwert aus und lies die Fehlermeldung.
 * 2. Ergänze in loop() eine lokale Variable int zaehlerLokal = 0;, erhöhe sie
 *    ebenfalls um schritt und gib sie aus. Vergleiche mit zaehlerGlobal.
 * 3. Setze schritt auf 5.
 *
 * Lernfragen:
 * 1. Wo darf zaehlerGlobal verwendet werden, wo startwert?
 * 2. Warum behält zaehlerGlobal seinen Wert zwischen zwei Durchläufen von loop()?
 * 3. Warum bleibt zaehlerLokal im zweiten Experiment immer bei 1?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen den Gültigkeitsbereich globaler und lokaler Variablen unterscheiden können."
afterFocus: free
focus:
  - id: gueltigkeit
    title: "Gültigkeitsbereich"
    objective: "Bestimmen, in welchen Funktionen eine Variable verwendet werden darf."
    questions:
      - kind: concept
        text: "Warum kann `startwert` in `loop` nicht verwendet werden?"
      - kind: recall
        text: "In welchen Funktionen darf `zaehlerGlobal` verwendet werden?"
  - id: lebensdauer
    title: "Werte über Durchläufe hinweg"
    objective: "Erklären, welche Variable ihren Wert zwischen zwei Durchläufen von `loop` behält."
    questions:
      - kind: prediction
        text: "Welche Werte von `zaehlerGlobal` erscheinen in den ersten drei Durchläufen von `loop`?"
      - kind: concept
        text: "Warum beginnt `schritt` bei jedem Durchlauf von `loop` wieder mit demselben Wert?"
      - kind: transfer
        text: "Wo würdest du eine Variable deklarieren, die zählen soll, wie oft `loop` durchlaufen wurde?"
@end-unosim-tutor */
