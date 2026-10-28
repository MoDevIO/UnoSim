/*
 * IT01.4 – Zeichen und ihre Codes
 *
 * Lernziel:
 * Erklären, dass eine char-Variable ein Zeichen als Zahl aus der
 * ASCII-Tabelle speichert.
 *
 * Bezug zu den Unterlagen:
 * IT01 Daten, Folie „Datentyp für Zeichen“; IT02, Folie „Datentyp char verstehen“.
 *
 * Beobachtung:
 * A hat den Code 65, der Code 66 ergibt das Zeichen B, # hat den Code 35
 * und auf A folgt B.
 */

char zeichen1 = 'A';
char zeichen2 = 66;     // Zahlenwert aus der ASCII-Tabelle
char zeichen3 = '#';

void setup() {
  Serial.begin(115200);

  int code1 = zeichen1;
  Serial.print(zeichen1);
  Serial.print(" hat den Code ");
  Serial.println(code1);

  Serial.print("Code 66 ist das Zeichen ");
  Serial.println(zeichen2);

  int code3 = zeichen3;
  Serial.print(zeichen3);
  Serial.print(" hat den Code ");
  Serial.println(code3);

  char naechstes = zeichen1 + 1;
  Serial.print("Auf ");
  Serial.print(zeichen1);
  Serial.print(" folgt ");
  Serial.println(naechstes);
}

void loop() {
}

/*
 * Experimente:
 * 1. Setze zeichen1 auf 'a'. Um wie viel unterscheiden sich die Codes von
 *    Groß- und Kleinbuchstaben?
 * 2. Gib mit Zahlenwerten aus der ASCII-Tabelle die Buchstaben X, Y und Z aus.
 * 3. Setze zeichen2 auf 48. Welches Zeichen erscheint?
 *
 * Lernfragen:
 * 1. Was wird in einer char-Variablen tatsächlich gespeichert?
 * 2. Warum ergibt zeichen1 + 1 den nächsten Buchstaben?
 * 3. Warum ist das Zeichen '7' nicht dasselbe wie die Zahl 7?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen erklären können, dass `char` ein Zeichen als Zahlencode speichert."
afterFocus: free
focus:
  - id: zeichen-und-code
    title: "Zeichen und Code"
    objective: "Den Zusammenhang zwischen einem Zeichen und seinem ASCII-Code erklären."
    questions:
      - kind: concept
        text: "Wie hängen `zeichen1` und `code1` zusammen?"
      - kind: recall
        text: "Welches Zeichen gehört zum Code, mit dem `zeichen2` initialisiert wird?"
  - id: mit-zeichen-rechnen
    title: "Mit Zeichen rechnen"
    objective: "Vorhersagen, welches Zeichen eine Rechnung mit Codes ergibt."
    questions:
      - kind: prediction
        text: "Welches Zeichen wird für `naechstes` ausgegeben, wenn `zeichen1` mit dem Kleinbuchstaben a initialisiert wird?"
      - kind: transfer
        text: "Wie würdest du aus einem Großbuchstaben in `zeichen1` den passenden Kleinbuchstaben berechnen?"
@end-unosim-tutor */
