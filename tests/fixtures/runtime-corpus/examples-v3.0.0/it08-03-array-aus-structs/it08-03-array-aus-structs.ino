/*
 * IT08.3 – Mehrere Messstellen in einem Array aus Strukturen
 *
 * Lernziel:
 * Ein Array verwenden, dessen Elemente Strukturen sind, und die Elemente
 * über Funktionen füllen und ausgeben.
 *
 * Bezug zu den Unterlagen:
 * IT08, Folien „Beispiel 3: Array of struct, struct als Funktionsparameter“,
 * „Einschub: Spaghetticode“ und „Beispiel 4: struct als Funktionsparameter“.
 *
 * Beobachtung:
 * Jede Sekunde erscheinen drei Datensätze für A0, A1 und A2.
 * Die Messstelle ist die Pinnummer: A0 hat beim Uno die Nummer 14.
 */

struct Messung {
  unsigned long zeit;
  byte messstelle;
  float messwert;
};

const byte ANZAHL_MESSSTELLEN = 3;
const byte MESSSTELLEN[ANZAHL_MESSSTELLEN] = {A0, A1, A2};
struct Messung messungen[ANZAHL_MESSSTELLEN];

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
 * 1. Stelle im Simulator für A0, A1 und A2 unterschiedliche Werte ein.
 * 2. Ergänze die Messstelle A3.
 * 3. Gib nur den Messwert des zweiten Datensatzes aus: messungen[1].messwert.
 *
 * Lernfragen:
 * 1. Welchen Datentyp besitzt ein einzelnes Element von messungen?
 * 2. Was bedeutet &messungen[i] beim Aufruf?
 * 3. Warum ist es besser, die Daten als Parameter zu übergeben, statt in den
 *    Funktionen direkt das globale Array zu verwenden?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen ein Array aus Strukturen anlegen und über Funktionen verarbeiten können."
  - "Sie sollen begründen können, warum Daten als Parameter übergeben werden."
afterFocus: free
focus:
  - id: elemente
    title: "Elemente des Arrays"
    objective: "Den Typ eines Elements bestimmen und den Zugriff auf ein Feld erklären."
    questions:
      - kind: recall
        text: "Welchen Datentyp besitzt ein einzelnes Element von `messungen`?"
      - kind: concept
        text: "Was wird beim Aufruf mit `&messungen[i]` an die Funktion übergeben?"
  - id: parameter-statt-global
    title: "Parameter statt globaler Zugriff"
    objective: "Den Vorteil der Übergabe als Parameter begründen."
    questions:
      - kind: concept
        text: "Warum greifen `messwertEinlesen` und `messwertAusgeben` nicht direkt auf `messungen` zu?"
      - kind: transfer
        text: "Was musst du ändern, um eine vierte Messstelle zu ergänzen?"
@end-unosim-tutor */
