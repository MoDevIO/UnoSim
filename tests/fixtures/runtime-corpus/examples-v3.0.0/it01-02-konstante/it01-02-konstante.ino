/*
 * IT01.2 – Einen unveränderlichen Wert festlegen
 *
 * Lernziel:
 * Werte, die sich nie ändern sollen, mit const als Konstante definieren und
 * die vordefinierten Arduino-Konstanten kennenlernen.
 *
 * Bezug zu den Unterlagen:
 * IT01 Daten, Folien „Konstanten“ und „Festlegungen“ (Konstanten werden
 * immer großgeschrieben).
 *
 * Beobachtung:
 * Der serielle Monitor zeigt die eigene Konstante, einen Umrechnungsfaktor
 * und die Zahlenwerte der vordefinierten Konstanten HIGH und LOW.
 */

const byte MAXIMALE_ANZAHL = 10;
const float ZOLL_IN_CM = 2.54;

void setup() {
  Serial.begin(115200);

  Serial.print("Maximale Anzahl: ");
  Serial.println(MAXIMALE_ANZAHL);

  Serial.print("1 Zoll = ");
  Serial.print(ZOLL_IN_CM, 2);
  Serial.println(" cm");

  Serial.print("HIGH hat den Wert ");
  Serial.println(HIGH);
  Serial.print("LOW hat den Wert ");
  Serial.println(LOW);
}

void loop() {
}

/*
 * Experimente:
 * 1. Ändere den Wert von MAXIMALE_ANZAHL auf 20.
 * 2. Ergänze in setup() die Zeile MAXIMALE_ANZAHL = 5; und lies die
 *    Fehlermeldung des Compilers.
 * 3. Gib zusätzlich die vordefinierte Konstante A0 aus.
 *
 * Lernfragen:
 * 1. Wodurch unterscheidet sich eine Konstante von einer Variablen?
 * 2. Warum meldet der Compiler beim zweiten Experiment einen Fehler?
 * 3. Warum werden Konstantennamen großgeschrieben?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen eine Konstante von einer Variablen unterscheiden können."
  - "Sie sollen erklären können, warum der Compiler eine nachträgliche Änderung ablehnt."
afterFocus: free
focus:
  - id: konstante-oder-variable
    title: "Konstante oder Variable"
    objective: "Den Unterschied zwischen Konstante und Variable erklären und die Folge einer Änderung vorhersagen."
    questions:
      - kind: concept
        text: "Wodurch unterscheidet sich `MAXIMALE_ANZAHL` von einer gewöhnlichen Variablen?"
      - kind: prediction
        text: "Was meldet der Compiler, wenn in `setup` versucht wird, `MAXIMALE_ANZAHL` einen neuen Wert zuzuweisen?"
  - id: konventionen
    title: "Namen und vordefinierte Konstanten"
    objective: "Die Namenskonvention begründen und vordefinierte Konstanten einordnen."
    questions:
      - kind: concept
        text: "Warum sind die Namen `MAXIMALE_ANZAHL` und `ZOLL_IN_CM` großgeschrieben?"
      - kind: recall
        text: "Welche Zahlenwerte stehen hinter den vordefinierten Konstanten `HIGH` und `LOW`?"
      - kind: transfer
        text: "Für welchen weiteren Wert in einem Arduino-Programm wäre eine Konstante sinnvoll?"
@end-unosim-tutor */
