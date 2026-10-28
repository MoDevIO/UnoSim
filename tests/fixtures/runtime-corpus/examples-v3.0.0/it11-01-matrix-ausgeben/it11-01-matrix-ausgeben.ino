/*
 * IT11.1 – Eine Matrix mit einer Funktion lesbar ausgeben
 *
 * Lernziel:
 * Eine Matrix als zweidimensionales Array speichern und mit einer Funktion
 * zeilen- und spaltenweise ausgeben, mit wählbarer Genauigkeit.
 *
 * Bezug zu den Unterlagen:
 * IT11 Matrizen, Folien „Matrizen im Speicher halten“ und „Ausgabe, schön
 * lesbar“ (Schritt 1 bis 3: sequenziell, Schleifen, Genauigkeit).
 *
 * Beobachtung:
 * Die Matrix A erscheint in drei Zeilen mit einer Nachkommastelle;
 * der Name A steht vor der mittleren Zeile.
 */

const int M = 3;   // Anzahl der Zeilen
const int N = 3;   // Anzahl der Spalten

double A[M][N] = {
  { 1, 2, 3 },
  { 4, 5, 6 },
  { 7, 8, 9 }
};

void printMatrix(const double mat[M][N], const char *name = "M", byte precision = 2) {
  for (int i = 0; i < M; i++) {
    if (i == 1) {
      Serial.print(name);
      Serial.print(" = \t");
    } else {
      Serial.print("\t");
    }
    for (int k = 0; k < N; k++) {
      Serial.print(mat[i][k], precision);
      Serial.print("\t");
    }
    Serial.println();
  }
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  printMatrix(A, "A", 1);
}

void loop() {
}

/*
 * Experimente:
 * 1. Rufe printMatrix(A); ohne die letzten beiden Argumente auf.
 * 2. Gib A mit 0 und mit 3 Nachkommastellen aus.
 * 3. Setze die Hauptdiagonale von A auf 0 und gib A erneut aus.
 *
 * Lernfragen:
 * 1. Welches Element wird mit A[1][2] angesprochen?
 * 2. Warum werden zwei Schleifen benötigt?
 * 3. Was geschieht, wenn beim Aufruf name und precision weggelassen werden?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen eine Matrix als zweidimensionales Array speichern und mit einer Funktion ausgeben können."
afterFocus: free
focus:
  - id: elemente
    title: "Elemente der Matrix"
    objective: "Ein Element über zwei Indizes bestimmen und die Zahl der Schleifen begründen."
    questions:
      - kind: application
        text: "Welcher Wert steht in `A` an der Position mit dem Zeilenindex 1 und dem Spaltenindex 2?"
      - kind: concept
        text: "Warum werden in `printMatrix` zwei Schleifen benötigt?"
  - id: parameter
    title: "Parameter der Ausgabefunktion"
    objective: "Die Parameter von `printMatrix` und ihre Standardwerte erklären."
    questions:
      - kind: concept
        text: "Welche Aufgabe hat der Parameter `precision`?"
      - kind: prediction
        text: "Wie sieht die Ausgabe aus, wenn `printMatrix` nur mit `A` aufgerufen wird?"
      - kind: concept
        text: "Warum ist der Parameter `mat` als `const` deklariert?"
@end-unosim-tutor */
