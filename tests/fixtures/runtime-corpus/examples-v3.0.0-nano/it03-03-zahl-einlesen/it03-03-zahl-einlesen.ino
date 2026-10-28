/*
 * IT03.3 – Eine Zahl am Stück einlesen
 *
 * Lernziel:
 * Mit Serial.parseInt() eine mehrstellige Zahl einlesen und weiterverarbeiten.
 *
 * Bezug zu den Unterlagen:
 * IT03, Folie „Zahlen am Stück einlesen mit Serial.parseInt()“ und
 * Transferaufgabe „Pause Beginn / Pause Ende“.
 *
 * Beobachtung:
 * Sende 21. Es erscheint „Zahl: 21, doppelt: 42“.
 * Ohne Eingabe liefert parseInt() den Wert 0 – deshalb wird 0 ignoriert.
 */

void setup() {
  Serial.begin(115200);
  Serial.println("Bitte eine Zahl eingeben:");
}

void loop() {
  int zahl = Serial.parseInt();

  if (zahl != 0) {
    Serial.print("Zahl: ");
    Serial.print(zahl);
    Serial.print(", doppelt: ");
    Serial.println(zahl * 2);
  }
}

/*
 * Experimente:
 * 1. Sende eine negative Zahl und den Text abc12.
 * 2. Sende 0. Warum erscheint keine Ausgabe?
 * 3. Erweitere das Programm wie in der Transferaufgabe: Die eingegebene Zahl
 *    ist eine Pausenzeit in ms. Gib „Pause Beginn“ aus, warte mit delay()
 *    und gib danach „Pause Ende“ aus.
 *
 * Lernfragen:
 * 1. Warum ist parseInt() für mehrstellige Zahlen bequemer als read()?
 * 2. Was macht parseInt() mit Zeichen, die keine Ziffern sind?
 * 3. Welche Einschränkung entsteht durch die Bedingung zahl != 0?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen eine Zahl mit parseInt() einlesen und weiterverarbeiten können."
afterFocus: free
focus:
  - id: zahl-einlesen
    title: "Zahl einlesen"
    objective: "Die Arbeitsweise von `parseInt` beschreiben."
    questions:
      - kind: concept
        text: "Warum ist `Serial.parseInt` für mehrstellige Zahlen bequemer als das Lesen einzelner Zeichen?"
      - kind: prediction
        text: "Welche Zahl erhält `zahl`, wenn der Text abc12 gesendet wird?"
  - id: sonderfall-null
    title: "Der Sonderfall 0"
    objective: "Die Bedingung `zahl != 0` begründen und ihre Einschränkung erkennen."
    questions:
      - kind: concept
        text: "Warum prüft das Programm `zahl != 0`, bevor es etwas ausgibt?"
      - kind: transfer
        text: "Wie würdest du das Programm verwenden, um eine eingegebene Pausenzeit abzuwarten?"
@end-unosim-tutor */
