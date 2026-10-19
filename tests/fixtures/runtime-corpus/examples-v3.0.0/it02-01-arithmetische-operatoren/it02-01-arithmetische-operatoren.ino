/*
 * IT02.1 – Mit arithmetischen Operatoren rechnen
 *
 * Lernziel:
 * Die Operatoren +, -, *, / und % anwenden und den Unterschied zwischen
 * ganzzahliger Division und Division mit Kommazahlen erklären.
 *
 * Bezug zu den Unterlagen:
 * IT02 Datenmanipulation, Folien „Addition / Subtraktion / Multiplikation /
 * Division“ und „Modulo“ (13 / 5 = 2 Rest 3).
 *
 * Beobachtung:
 * a / b ergibt 2, a % b ergibt 3. Mit float-Variablen ergibt x / y = 2.60.
 */

int a = 13;
int b = 5;
float x = 13.0;
float y = 5.0;

void setup() {
  Serial.begin(115200);

  Serial.print("a + b = ");
  Serial.println(a + b);
  Serial.print("a - b = ");
  Serial.println(a - b);
  Serial.print("a * b = ");
  Serial.println(a * b);
  Serial.print("a / b = ");
  Serial.println(a / b);
  Serial.print("a % b = ");
  Serial.println(a % b);

  Serial.print("x / y = ");
  Serial.println(x / y, 2);
}

void loop() {
}

/*
 * Experimente:
 * 1. Setze a auf 20 und b auf 4. Welchen Rest liefert a % b jetzt?
 * 2. Ergänze float z = a / b; und gib z mit zwei Nachkommastellen aus.
 *    Warum erscheint 2.00 und nicht 2.60?
 * 3. Ergänze a = a + 1; vor den Ausgaben. Schreibe dasselbe danach mit a++;
 *
 * Lernfragen:
 * 1. Warum ist 13 / 5 bei Variablen vom Typ int gleich 2?
 * 2. Welche Bedeutung hat das Ergebnis von 13 % 5?
 * 3. Wann wird bei einer Rechnung mit Nachkommastellen gerechnet?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen die Operatoren +, -, *, / und % anwenden können."
  - "Sie sollen erklären können, wann ganzzahlig und wann mit Nachkommastellen dividiert wird."
afterFocus: free
focus:
  - id: ganzzahldivision
    title: "Ganzzahlige Division"
    objective: "Erklären, warum `a / b` und `x / y` verschiedene Ergebnisse liefern."
    questions:
      - kind: concept
        text: "Warum liefert `a / b` ein anderes Ergebnis als `x / y`?"
      - kind: prediction
        text: "Welches Ergebnis erwartest du, wenn das Ergebnis von `a / b` in einer zusätzlichen Variablen vom Typ `float` gespeichert wird?"
  - id: modulo
    title: "Rest einer Division"
    objective: "Die Bedeutung des Rests erklären und einen Einsatzzweck nennen."
    questions:
      - kind: concept
        text: "Welche Bedeutung hat das Ergebnis von `a % b`?"
      - kind: application
        text: "Wie könntest du mit dem Operator `%` prüfen, ob eine Zahl gerade ist?"
@end-unosim-tutor */
