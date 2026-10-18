/*
 * IT01.1 – Eine Variable deklarieren, initialisieren und zuweisen
 *
 * Lernziel:
 * Deklaration, Initialisierung und Zuweisung unterscheiden und erklären,
 * was bei einer neuen Zuweisung mit dem alten Wert geschieht.
 *
 * Bezug zu den Unterlagen:
 * IT01 Daten, Folien „Variable deklarieren“ und „Datentypen für ganze Zahlen“
 * (Deklaration + Initialisierung = Definition).
 *
 * Beobachtung:
 * Der serielle Monitor zeigt „Teile: 3“, dann „Teile: 5“ und „Fehler: 0“.
 * Serial wird hier nur benutzt, um die Werte sichtbar zu machen.
 */

int anzahlTeile;        // Deklaration: Es gibt jetzt eine Variable vom Typ int
int anzahlFehler = 0;   // Definition: Deklaration und Initialisierung in einem Schritt

void setup() {
  Serial.begin(115200);

  anzahlTeile = 3;      // Zuweisung
  Serial.print("Teile: ");
  Serial.println(anzahlTeile);

  anzahlTeile = 5;      // Die neue Zuweisung überschreibt den alten Wert
  Serial.print("Teile: ");
  Serial.println(anzahlTeile);

  Serial.print("Fehler: ");
  Serial.println(anzahlFehler);
}

void loop() {
}

/*
 * Experimente:
 * 1. Weise anzahlFehler in setup() den Wert 2 zu und gib ihn erneut aus.
 * 2. Deklariere drei weitere Variablen in einer Zeile: int x, y, z;
 * 3. Schreibe in einer der Ausgaben AnzahlTeile mit großem A und lies die
 *    Fehlermeldung des Compilers.
 *
 * Lernfragen:
 * 1. Welche Zeile ist nur eine Deklaration und welche eine Definition?
 * 2. Was geschieht mit dem alten Wert, wenn anzahlTeile = 5 ausgeführt wird?
 * 3. Warum erkennt der Compiler AnzahlTeile nicht als dieselbe Variable?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen Deklaration, Initialisierung und Zuweisung einer Variablen unterscheiden können."
  - "Sie sollen erklären können, dass eine Zuweisung den alten Wert überschreibt."
afterFocus: free
focus:
  - id: begriffe
    title: "Deklaration, Definition, Zuweisung"
    objective: "Die drei Begriffe an den Zeilen des Sketches zeigen und unterscheiden."
    questions:
      - kind: recall
        text: "Welche Zeile ist nur eine Deklaration, und welche Zeile ist eine Definition?"
      - kind: concept
        text: "Worin unterscheidet sich die Zeile mit `anzahlFehler` von der Zeile, in der `anzahlTeile` deklariert wird?"
  - id: ueberschreiben
    title: "Einen Wert überschreiben"
    objective: "Vorhersagen, welchen Wert eine Variable nach mehreren Zuweisungen besitzt."
    questions:
      - kind: prediction
        text: "Was geschieht mit dem alten Wert von `anzahlTeile`, wenn `anzahlTeile = 5` ausgeführt wird?"
      - kind: application
        text: "Wie viele Werte kann `anzahlTeile` zu einem Zeitpunkt gleichzeitig speichern?"
  - id: namen
    title: "Variablennamen"
    objective: "Die Regeln für Variablennamen anwenden."
    questions:
      - kind: concept
        text: "Warum meldet der Compiler einen Fehler, wenn `anzahlTeile` an einer Stelle mit großem A geschrieben wird?"
      - kind: transfer
        text: "Welche weitere Variable würdest du für ein Zählprogramm definieren, und mit welchem Startwert?"
@end-unosim-tutor */
