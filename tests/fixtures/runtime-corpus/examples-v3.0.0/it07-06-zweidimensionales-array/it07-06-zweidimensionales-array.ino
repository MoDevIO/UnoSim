/*
 * IT07.6 – Ein Tastenfeld als zweidimensionales Array
 *
 * Lernziel:
 * Werte in Zeilen und Spalten speichern und mit zwei Indizes auslesen.
 *
 * Bezug zu den Unterlagen:
 * IT07, Folien „2-dimensionales Array“ und Transferaufgabe „Tastenfeld“
 * (nicht verwendete Felder enthalten -1).
 *
 * Beobachtung:
 * Das Tastenfeld erscheint in 4 Zeilen. Nicht belegte Felder sind leer.
 * Darunter steht die Taste in Zeile 3, Spalte 1: 0.
 */

const byte ZEILEN = 4;
const byte SPALTEN = 3;

int tastenfeld[ZEILEN][SPALTEN] = {
  { 9, 8, 7 },
  { 6, 5, 4 },
  { 3, 2, 1 },
  { -1, 0, -1 }
};

void setup() {
  Serial.begin(115200);

  for (byte zeile = 0; zeile < ZEILEN; zeile++) {
    for (byte spalte = 0; spalte < SPALTEN; spalte++) {
      if (tastenfeld[zeile][spalte] == -1) {
        Serial.print(" ");
      } else {
        Serial.print(tastenfeld[zeile][spalte]);
      }
      Serial.print("\t");
    }
    Serial.println();
  }

  Serial.print("Zeile 3, Spalte 1: ");
  Serial.println(tastenfeld[3][1]);
}

void loop() {
}

/*
 * Experimente:
 * 1. Gib die Taste 5 über ihre beiden Indizes aus.
 * 2. Gib das Feld spaltenweise aus: Vertausche dazu die beiden Schleifen.
 * 3. Transfer der Folie: Speichere zusätzlich zu jeder Taste die Anzahl der
 *    Betätigungen (drei Indizes).
 *
 * Lernfragen:
 * 1. Welche zwei Indizes werden für ein Element benötigt?
 * 2. Welche Schleife läuft über die Spalten?
 * 3. Wozu dient der Wert -1 in der letzten Zeile?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen ein zweidimensionales Array anlegen und mit zwei Indizes auslesen können."
afterFocus: free
focus:
  - id: zwei-indizes
    title: "Zwei Indizes"
    objective: "Die zwei Indizes eines Elements erklären und ein Element bestimmen."
    questions:
      - kind: concept
        text: "Wofür steht der erste und wofür der zweite Index von `tastenfeld`?"
      - kind: application
        text: "Mit welchen Indizes erreichst du in `tastenfeld` die Taste 5?"
  - id: ausgabe
    title: "Ausgabe mit zwei Schleifen"
    objective: "Die Aufgabe der Schleifen und des Sonderwerts erklären."
    questions:
      - kind: concept
        text: "Welche der beiden Schleifen läuft über die Spalten?"
      - kind: concept
        text: "Wozu dient der Wert -1 in `tastenfeld`, und wie behandelt die Ausgabe ihn?"
      - kind: transfer
        text: "Wie würdest du zu jeder Taste zusätzlich die Anzahl ihrer Betätigungen speichern?"
@end-unosim-tutor */
