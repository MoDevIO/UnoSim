/*
 * IT08.4 – Mit typedef einen lesbaren Datentyp festlegen
 *
 * Lernziel:
 * Mit typedef einen Alias für eine Struktur festlegen und Strukturen als
 * Parameter und Rückgabewert von Funktionen verwenden.
 *
 * Bezug zu den Unterlagen:
 * IT08, Folie „struct – mit typedef“ und Abschnitt „Beispiel Unit Testing
 * für Vektorfunktionen“ (Vektor addieren, Länge berechnen).
 *
 * Beobachtung:
 * (0, 1) + (2, 2) = (2.00, 3.00). Die Länge des Ergebnisses ist 3.61.
 */

typedef struct vektor {
  float x;
  float y;
} Vektor;

Vektor addieren(Vektor v, Vektor s) {
  v.x += s.x;
  v.y += s.y;
  return v;
}

float laenge(Vektor v) {
  return sqrt(v.x * v.x + v.y * v.y);
}

void ausgeben(Vektor v) {
  Serial.print("(");
  Serial.print(v.x, 2);
  Serial.print(", ");
  Serial.print(v.y, 2);
  Serial.print(")");
}

void setup() {
  Serial.begin(115200);

  Vektor a = {0, 1};
  Vektor b = {2, 2};
  Vektor summe = addieren(a, b);

  ausgeben(a);
  Serial.print(" + ");
  ausgeben(b);
  Serial.print(" = ");
  ausgeben(summe);
  Serial.println();

  Serial.print("Laenge: ");
  Serial.println(laenge(summe), 2);
}

void loop() {
}

/*
 * Experimente:
 * 1. Schreibe eine Funktion subtrahieren() und berechne b - a.
 * 2. Deklariere eine Variable mit struct vektor c = {3, 4}; statt mit Vektor.
 *    Gib ihre Länge aus.
 * 3. Ergänze eine Funktion skalieren(Vektor v, float faktor).
 *
 * Lernfragen:
 * 1. Wofür steht der Name Vektor nach der typedef-Anweisung?
 * 2. Warum verändert addieren() die Variable a in setup() nicht?
 * 3. Wie gelangt das Ergebnis von addieren() nach setup()?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen mit typedef einen Alias für eine Struktur festlegen können."
  - "Sie sollen Strukturen als Parameter und Rückgabewert von Funktionen verwenden können."
afterFocus: free
focus:
  - id: alias
    title: "Ein Alias mit typedef"
    objective: "Die Wirkung von `typedef` erklären."
    questions:
      - kind: concept
        text: "Wofür steht der Name `Vektor` nach der Anweisung mit `typedef`?"
      - kind: recall
        text: "Wie würdest du eine Variable desselben Typs ohne den Alias `Vektor` deklarieren?"
  - id: struktur-als-rueckgabe
    title: "Struktur als Parameter und Rückgabe"
    objective: "Erklären, wie `addieren` mit Kopien arbeitet und ihr Ergebnis zurückgibt."
    questions:
      - kind: concept
        text: "Warum verändert `addieren` die Variable `a` in `setup` nicht?"
      - kind: prediction
        text: "Welche Länge liefert `laenge` für einen Vektor mit x gleich 3 und y gleich 4?"
      - kind: transfer
        text: "Wie würdest du eine Funktion schreiben, die einen `Vektor` vom anderen subtrahiert?"
@end-unosim-tutor */
