/*
 * IT11.5 – Matrizen multiplizieren und die Einheitsmatrix prüfen
 *
 * Lernziel:
 * Zwei Matrizen nach der Regel „Zeile mal Spalte“ multiplizieren und
 * prüfen, ob eine Matrix die Einheitsmatrix ist.
 *
 * Bezug zu den Unterlagen:
 * IT11 Matrizen, Schritt 8 „Identität prüfen“ und Schritt 9
 * „Matrizenmultiplikation“.
 *
 * Beobachtung:
 * E ist die Einheitsmatrix (Ausgabe 1). A*E ergibt wieder A.
 * A*B ergibt neue Werte, z. B. oben links 1*9 + 2*6 + 3*3 = 30.
 */

#include "mat_func.h"

double A[M][N] = {
  { 1, 2, 3 },
  { 4, 5, 6 },
  { 7, 8, 9 }
};

double B[M][N] = {
  { 9, 8, 7 },
  { 6, 5, 4 },
  { 3, 2, 1 }
};

double E[M][N] = {
  { 1, 0, 0 },
  { 0, 1, 0 },
  { 0, 0, 1 }
};

double C[M][N];

bool isIdentity(const double mat[M][N]) {
  for (byte i = 0; i < M; i++) {
    for (byte k = 0; k < N; k++) {
      double soll = 0;            // außerhalb der Hauptdiagonalen 0 ...
      if (i == k) {
        soll = 1;                 // ... auf der Hauptdiagonalen 1
      }
      if (mat[i][k] != soll) {
        return false;
      }
    }
  }
  return true;
}

void multiplyMatrix(const double mat1[M][N], const double mat2[M][N], double ergebnis[M][N]) {
  for (byte i = 0; i < M; i++) {
    for (byte k = 0; k < N; k++) {
      ergebnis[i][k] = 0;
      for (byte j = 0; j < N; j++) {
        ergebnis[i][k] += mat1[i][j] * mat2[j][k];
      }
    }
  }
}

void setup() {
  Serial.begin(115200);

  Serial.print("E ist Einheitsmatrix: ");
  Serial.println(isIdentity(E));
  Serial.println();

  multiplyMatrix(A, E, C);
  printMatrix(C, "A*E", 0);

  multiplyMatrix(A, B, C);
  printMatrix(C, "A*B", 0);
}

void loop() {
}

/*
 * Experimente:
 * 1. Prüfe mit isIdentity(), ob A die Einheitsmatrix ist.
 * 2. Berechne B*A und vergleiche mit A*B.
 * 3. Rechne das Element in der Mitte von A*B von Hand nach.
 *
 * Lernfragen:
 * 1. Welche Zeile und welche Spalte werden für ergebnis[i][k] verwendet?
 * 2. Warum werden für die Multiplikation drei Schleifen benötigt?
 * 3. Warum wird ergebnis[i][k] vor der innersten Schleife auf 0 gesetzt?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen zwei Matrizen nach der Regel Zeile mal Spalte multiplizieren können."
  - "Sie sollen prüfen können, ob eine Matrix die Einheitsmatrix ist."
afterFocus: free
focus:
  - id: zeile-mal-spalte
    title: "Zeile mal Spalte"
    objective: "Erklären, wie ein Element des Produkts berechnet wird."
    questions:
      - kind: concept
        text: "Welche Zeile von `mat1` und welche Spalte von `mat2` werden für `ergebnis[i][k]` verwendet?"
      - kind: concept
        text: "Warum wird `ergebnis[i][k]` vor der innersten Schleife auf 0 gesetzt?"
      - kind: application
        text: "Welcher Wert steht in der Mitte von `A*B`?"
  - id: einheitsmatrix
    title: "Die Einheitsmatrix"
    objective: "Die Prüfung in `isIdentity` erklären und das Produkt mit `E` vorhersagen."
    questions:
      - kind: concept
        text: "Woran erkennt `isIdentity`, dass eine Matrix keine Einheitsmatrix ist?"
      - kind: prediction
        text: "Welches Ergebnis liefert `multiplyMatrix(A, E, C)`, und warum?"
      - kind: transfer
        text: "Wie würdest du mit `multiplyMatrix` prüfen, ob die Reihenfolge der Faktoren das Ergebnis verändert?"
@end-unosim-tutor */
