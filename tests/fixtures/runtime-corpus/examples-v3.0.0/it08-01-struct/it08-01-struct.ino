/*
 * IT08.1 – Unterschiedliche Daten in einer Struktur zusammenfassen
 *
 * Lernziel:
 * Mit struct einen eigenen Datentyp aus Zeitstempel, Messstelle und
 * Messwert definieren und mit dem Punktoperator auf die Felder zugreifen.
 *
 * Bezug zu den Unterlagen:
 * IT08, Folien „Bedarf“, „struct – Deklaration der Struktur“ und
 * „struct – Deklaration einer Variablen der Struktur“.
 *
 * Beobachtung:
 * Jede Sekunde erscheint ein Datensatz aus Zeit, Messstelle und Spannung an A0.
 */

const byte PIN_SENSOR = A0;

struct Messung {
  unsigned long zeit;
  byte messstelle;
  float messwert;
};

void setup() {
  Serial.begin(115200);
}

void loop() {
  struct Messung messung;
  messung.zeit = millis();
  messung.messstelle = 1;
  messung.messwert = analogRead(PIN_SENSOR) / 1024.0 * 5.0;

  Serial.print("Zeit: ");
  Serial.print(messung.zeit);
  Serial.print(" ms\tStelle: ");
  Serial.print(messung.messstelle);
  Serial.print("\tWert: ");
  Serial.print(messung.messwert, 2);
  Serial.println(" V");

  delay(1000);
}

/*
 * Experimente:
 * 1. Ergänze das Feld bool gueltig und setze es auf true, wenn der Messwert
 *    größer als 0 V ist.
 * 2. Lege eine zweite Variable struct Messung messung2 für A1 an.
 * 3. Versuche, messung als Ganzes mit Serial.println(messung); auszugeben,
 *    und lies die Fehlermeldung.
 *
 * Lernfragen:
 * 1. Welche Datentypen fasst Messung zusammen?
 * 2. Ist Messung ein Datentyp oder bereits eine Variable?
 * 3. Welche Aufgabe hat der Punktoperator?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen eine Struktur definieren und auf ihre Felder zugreifen können."
  - "Sie sollen zwischen dem Strukturtyp und einer Variablen dieses Typs unterscheiden können."
afterFocus: free
focus:
  - id: typ-und-variable
    title: "Strukturtyp und Variable"
    objective: "Zwischen Strukturtyp und Variable unterscheiden und die enthaltenen Datentypen benennen."
    questions:
      - kind: concept
        text: "Ist `Messung` ein Datentyp oder bereits eine Variable?"
      - kind: recall
        text: "Welche Datentypen fasst `Messung` zusammen?"
  - id: punktoperator
    title: "Zugriff auf Felder"
    objective: "Den Punktoperator erklären und die Wahl der Felddatentypen begründen."
    questions:
      - kind: concept
        text: "Welche Aufgabe hat der Punkt in `messung.messwert`?"
      - kind: application
        text: "Warum ist für das Feld `zeit` der Typ `unsigned long` passend?"
      - kind: transfer
        text: "Welches Feld würdest du ergänzen, um zu speichern, ob ein Messwert gültig ist?"
@end-unosim-tutor */
