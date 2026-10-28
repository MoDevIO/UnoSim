/*
 * IT03.2 – Zeichen seriell einlesen
 *
 * Lernziel:
 * Mit Serial.available() und Serial.read() einzelne Zeichen empfangen und
 * Zeichen und ASCII-Code unterscheiden.
 *
 * Bezug zu den Unterlagen:
 * IT03, Folien „Serielle Eingabe“ und „Serielle Eingabe Beispiel int/char“.
 *
 * Beobachtung:
 * Sende im seriellen Monitor den Text Hi. Es erscheinen H (Code 72) und
 * i (Code 105). Danach kommt noch Code 10: das Zeilenende, das beim Senden
 * angehängt wird – deshalb steht dort kein sichtbares Zeichen.
 */

void setup() {
  Serial.begin(115200);
  Serial.println("Text eingeben und senden:");
}

void loop() {
  if (Serial.available() > 0) {
    char zeichen = Serial.read();
    int code = zeichen;

    Serial.print("Empfangen: ");
    Serial.print(zeichen);
    Serial.print("  Code: ");
    Serial.println(code);
  }
}

/*
 * Experimente:
 * 1. Sende nacheinander A, 7 und ?.
 * 2. Entferne die Abfrage if (Serial.available() > 0) samt Klammern und
 *    ergänze am Ende von loop() delay(500);. Was erscheint, solange nichts
 *    gesendet wird?
 * 3. Sende ein Wort mit fünf Buchstaben. Wie oft wird loop() dafür mit einem
 *    empfangenen Zeichen durchlaufen?
 *
 * Lernfragen:
 * 1. Warum wird Serial.available() vor Serial.read() geprüft?
 * 2. Was liefert Serial.read(), wenn kein Zeichen vorhanden ist?
 * 3. Warum erscheinen in der Variablen code Zahlen statt Zeichen?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen einzelne Zeichen seriell einlesen und ausgeben können."
  - "Sie sollen den Unterschied zwischen einem Zeichen und seinem Code erklären können."
afterFocus: free
focus:
  - id: zeichen-empfangen
    title: "Zeichen empfangen"
    objective: "Erklären, warum vor dem Lesen geprüft wird, ob ein Zeichen vorliegt."
    questions:
      - kind: concept
        text: "Warum wird `Serial.available` vor `Serial.read` geprüft?"
      - kind: recall
        text: "Welchen Wert liefert `Serial.read`, wenn kein Zeichen vorhanden ist?"
  - id: zeichen-und-code
    title: "Zeichen und Code"
    objective: "Die Ausgabe von `zeichen` und `code` erklären."
    questions:
      - kind: concept
        text: "Warum erscheint für `zeichen` ein Buchstabe, für `code` aber eine Zahl?"
      - kind: prediction
        text: "Welcher Code erscheint nach dem letzten gesendeten Buchstaben, und woher kommt er?"
@end-unosim-tutor */
