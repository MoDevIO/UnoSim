/*
 * IT02.4 – Die Grenze eines Datentyps sichtbar machen
 *
 * Lernziel:
 * Beobachten und erklären, was beim Überschreiten des Wertebereichs eines
 * Datentyps geschieht.
 *
 * Bezug zu den Unterlagen:
 * IT02 Datenmanipulation, Abschnitt „Wertebereiche mit Programmen sichtbar
 * machen“ (Grenzen eines Datentyps anzeigen).
 *
 * Beobachtung:
 * Der Zähler läuft 250, 251, ..., 255 und springt dann auf 0, 1, 2, ...
 * delay(300) wartet 300 ms zwischen zwei Ausgaben (Vorgriff auf IT03).
 */

byte zaehler = 250;

void setup() {
  Serial.begin(115200);
}

void loop() {
  Serial.println(zaehler);
  zaehler = zaehler + 1;
  delay(300);
}

/*
 * Experimente:
 * 1. Starte zaehler bei 5 und verringere ihn mit zaehler = zaehler - 1;.
 *    Was folgt auf 0?
 * 2. Gib zusätzlich zaehler mit Serial.println(zaehler, BIN); aus und
 *    beobachte die Bitmuster beim Sprung von 255 auf 0.
 * 3. Erhöhe zaehler in jedem Schritt um 10.
 *
 * Lernfragen:
 * 1. Warum folgt auf 255 der Wert 0?
 * 2. Welches Bitmuster hat 255 und welches entsteht, wenn 1 addiert wird?
 * 3. Welche Folgen kann ein solcher Überlauf in einem Steuerungsprogramm haben?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen erklären können, was beim Überschreiten eines Wertebereichs geschieht."
  - "Sie sollen daraus ableiten, warum der Datentyp zum Wertebereich passen muss."
afterFocus: free
focus:
  - id: ueberlauf
    title: "Überlauf"
    objective: "Den Sprung von 255 auf 0 mit dem Bitmuster des Datentyps erklären."
    questions:
      - kind: concept
        text: "Warum folgt bei `zaehler` auf 255 der Wert 0?"
      - kind: prediction
        text: "Welcher Wert folgt auf 0, wenn `zaehler` in jedem Durchlauf um eins verringert wird?"
  - id: folgen
    title: "Folgen für Programme"
    objective: "Die Bedeutung eines Überlaufs für ein reales Programm einschätzen."
    questions:
      - kind: application
        text: "Was könnte passieren, wenn `zaehler` in einer Anlage die Anzahl produzierter Teile zählt?"
      - kind: transfer
        text: "Welchen Datentyp würdest du für `zaehler` wählen, wenn bis zu 1000 Teile gezählt werden sollen?"
@end-unosim-tutor */
