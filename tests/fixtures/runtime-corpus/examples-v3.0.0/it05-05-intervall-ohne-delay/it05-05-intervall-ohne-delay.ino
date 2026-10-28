/*
 * IT05.5 – Alle 500 ms etwas tun, ohne delay()
 *
 * Lernziel:
 * Mit millis() und if eine Aktion in festen Zeitabständen ausführen, ohne
 * das Programm mit delay() anzuhalten.
 *
 * Bezug zu den Unterlagen:
 * IT05, Folie „Einfache Verzweigung - Beispiel“ (alle 500 ms eine Ausgabe
 * ohne delay); IT03 „Zeit in Millisekunden abfragen mit millis“.
 *
 * Beobachtung:
 * Alle 500 ms erscheint eine Zeile. Zwischen zwei Ausgaben wird loop() sehr
 * oft durchlaufen – das Programm wartet nicht. Wie oft, hängt von der
 * Geschwindigkeit des Systems ab.
 */

const unsigned long INTERVALL = 500;   // ms
unsigned long letzteAusgabe = 0;
unsigned long durchlaeufe = 0;

void setup() {
  Serial.begin(115200);
}

void loop() {
  durchlaeufe = durchlaeufe + 1;
  unsigned long jetzt = millis();

  if (jetzt - letzteAusgabe >= INTERVALL) {
    letzteAusgabe = jetzt;
    Serial.print("Zeit: ");
    Serial.print(jetzt);
    Serial.print(" ms, Durchlaeufe: ");
    Serial.println(durchlaeufe);
  }
}

/*
 * Experimente:
 * 1. Ändere INTERVALL auf 2000.
 * 2. Ersetze die Verzweigung durch die Ausgabe und delay(500);. Vergleiche
 *    die Zahl der Durchläufe.
 * 3. Lasse zusätzlich die LED an Pin 13 im selben Takt umschalten.
 *
 * Lernfragen:
 * 1. Warum wird jetzt - letzteAusgabe berechnet und nicht nur jetzt geprüft?
 * 2. Warum muss letzteAusgabe nach jeder Ausgabe neu gesetzt werden?
 * 3. Welchen Vorteil hat diese Lösung gegenüber delay()?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen eine zeitgesteuerte Aktion ohne delay() umsetzen können."
  - "Sie sollen erklären können, warum das Programm dabei weiterläuft."
afterFocus: free
focus:
  - id: zeitvergleich
    title: "Der Zeitvergleich"
    objective: "Die Bedingung mit `millis` erklären."
    questions:
      - kind: concept
        text: "Warum prüft die Bedingung `jetzt - letzteAusgabe >= INTERVALL`?"
      - kind: concept
        text: "Warum muss `letzteAusgabe` nach jeder Ausgabe auf `jetzt` gesetzt werden?"
  - id: vorteil
    title: "Vorteil gegenüber delay"
    objective: "Den Unterschied zu einer festen Pause beschreiben und die Lösung erweitern."
    questions:
      - kind: prediction
        text: "Wie verändert sich die Zahl in `durchlaeufe` zwischen zwei Ausgaben, wenn das Programm stattdessen nach jeder Ausgabe 500 ms anhält?"
      - kind: transfer
        text: "Wie würdest du zusätzlich eine LED im selben Takt umschalten, ohne das Programm anzuhalten?"
@end-unosim-tutor */
