/*
 * IT01.3 – Einen Datentyp begründet auswählen
 *
 * Lernziel:
 * Für einen bekannten Wertebereich einen passenden Datentyp auswählen und
 * die Auswahl über die Anzahl der Bitmuster begründen.
 *
 * Bezug zu den Unterlagen:
 * IT01 Daten, Folie „Argumentation für die Auswahl von Datentypen“
 * (Wert zwischen 0 und 1023).
 *
 * Beobachtung:
 * Derselbe Wert 1023 wird einmal als unsigned int und einmal als byte
 * gespeichert. Der byte-Wert ist 255 – der Wert passt nicht hinein.
 */

// Anforderung: Ein Sensorwert liegt immer zwischen 0 und 1023.
unsigned int sensorwertPassend = 1023;

void setup() {
  Serial.begin(115200);

  byte sensorwertZuKlein = sensorwertPassend;

  Serial.print("Als unsigned int gespeichert: ");
  Serial.println(sensorwertPassend);
  Serial.print("Als byte gespeichert:         ");
  Serial.println(sensorwertZuKlein);
}

void loop() {
}

/*
 * Experimente:
 * 1. Setze sensorwertPassend auf 255 und vergleiche beide Ausgaben.
 * 2. Setze sensorwertPassend auf 300. Welcher byte-Wert erscheint?
 * 3. Begründe schriftlich nach dem Schema der Folie, welchen Datentyp du für
 *    einen Füllstand von 0,4 m bis 6,0 m wählen würdest.
 *
 * Lernfragen:
 * 1. Wie viele verschiedene Bitmuster besitzt ein 8-Bit-Datentyp, wie viele
 *    ein 16-Bit-Datentyp?
 * 2. Warum ist byte für den Bereich 0 bis 1023 nicht geeignet?
 * 3. Warum darf hier das Schlüsselwort unsigned verwendet werden?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen einen Datentyp für einen gegebenen Wertebereich auswählen und begründen können."
  - "Sie sollen die Anzahl der Bitmuster eines Datentyps aus seiner Bitbreite bestimmen können."
afterFocus: free
focus:
  - id: bitmuster
    title: "Bitmuster und Wertebereich"
    objective: "Aus der Bitbreite die Anzahl der Bitmuster und den größten Wert bestimmen."
    questions:
      - kind: recall
        text: "Wie viele verschiedene Bitmuster kann ein 8-Bit-Datentyp wie `byte` darstellen?"
      - kind: concept
        text: "Warum ist `byte` für Werte bis 1023 zu klein?"
  - id: argumentation
    title: "Den Datentyp begründen"
    objective: "Die Wahl von `unsigned int` nach dem Schema der Folie begründen."
    questions:
      - kind: concept
        text: "Warum darf `sensorwertPassend` mit `unsigned` deklariert werden?"
      - kind: prediction
        text: "Welcher Wert erscheint für `sensorwertZuKlein`, wenn `sensorwertPassend` den Wert 300 hat?"
      - kind: transfer
        text: "Welchen Datentyp würdest du für einen Füllstand von 0,4 m bis 6,0 m wählen, und wie begründest du das?"
@end-unosim-tutor */
