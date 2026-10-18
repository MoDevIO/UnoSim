/*
 * IT06.1 – Eine kopfgesteuerte Schleife
 *
 * Lernziel:
 * Mit while einen Block wiederholen, solange eine Bedingung wahr ist, auch
 * wenn die Anzahl der Durchläufe vorher nicht bekannt ist.
 *
 * Bezug zu den Unterlagen:
 * IT06, Folien „Kopfgesteuerte Schleife“ und „Kopfgesteuerte Schleife - while“.
 *
 * Beobachtung:
 * Der Wert wird verdoppelt, solange er kleiner als 1000 ist:
 * 1, 2, 4, ..., 512. Danach erscheinen „Schritte: 10“ und „Endwert: 1024“.
 */

const unsigned int GRENZE = 1000;

void setup() {
  Serial.begin(115200);

  unsigned int wert = 1;
  byte schritte = 0;

  while (wert < GRENZE) {
    Serial.println(wert);
    wert = wert * 2;
    schritte++;
  }

  Serial.print("Schritte: ");
  Serial.println(schritte);
  Serial.print("Endwert: ");
  Serial.println(wert);
}

void loop() {
}

/*
 * Experimente:
 * 1. Setze den Startwert von wert auf 3.
 * 2. Setze den Startwert von wert auf 2000. Wie oft läuft die Schleife?
 * 3. Entferne die Zeile wert = wert * 2;. Was geschieht? (Simulation danach stoppen.)
 *
 * Lernfragen:
 * 1. Wann wird die Bedingung einer while-Schleife geprüft?
 * 2. Warum muss wert im Schleifenblock verändert werden?
 * 3. Warum ist der Endwert größer als GRENZE?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen eine kopfgesteuerte Schleife mit while formulieren und ihren Ablauf beschreiben können."
afterFocus: free
focus:
  - id: pruefung
    title: "Prüfung am Kopf"
    objective: "Erklären, wann die Bedingung geprüft wird, und die Zahl der Durchläufe vorhersagen."
    questions:
      - kind: concept
        text: "Wann wird die Bedingung `wert < GRENZE` geprüft?"
      - kind: prediction
        text: "Wie oft läuft die Schleife, wenn `wert` mit 2000 startet?"
  - id: abbruch
    title: "Abbruch der Schleife"
    objective: "Begründen, warum sich die Bedingung im Block ändern muss."
    questions:
      - kind: concept
        text: "Warum muss `wert` im Schleifenblock verändert werden?"
      - kind: concept
        text: "Warum ist der ausgegebene Endwert größer als `GRENZE`?"
      - kind: transfer
        text: "Wie würdest du mit einer `while`-Schleife zählen, wie viele Halbierungen von 1000 bis unter 1 nötig sind?"
@end-unosim-tutor */
