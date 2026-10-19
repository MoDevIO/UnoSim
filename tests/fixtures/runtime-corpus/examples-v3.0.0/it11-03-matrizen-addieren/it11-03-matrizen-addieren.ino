/*
 * IT11.3 – Zwei Matrizen addieren
 *
 * Lernziel:
 * Zwei Matrizen gleicher Größe elementweise addieren.
 *
 * Bezug zu den Unterlagen:
 * IT11 Matrizen, Schritt 6 „Funktionen erweitern: Matrix-Addition“.
 *
 * Beobachtung:
 * Wie auf der Folie: A, A+B und B. In A+B steht überall 10, weil sich die
 * Elemente von A und B an jeder Position zu 10 ergänzen.
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

void addMatrix(double mat1[M][N], const double mat2[M][N]) {
  for (byte i = 0; i < M; i++) {
    for (byte k = 0; k < N; k++) {
      mat1[i][k] += mat2[i][k];
    }
  }
}

void setup() {
  Serial.begin(115200);
  printMatrix(A, "A", 0);
  addMatrix(A, B);
  printMatrix(A, "A+B", 0);
  printMatrix(B, "B", 0);
}

void loop() {
}

/*
 * Experimente:
 * 1. Ändere ein Element von B. An welcher Stelle von A+B ändert sich das Ergebnis?
 * 2. Rufe addMatrix(A, B); zweimal auf.
 * 3. Schreibe eine Funktion subMatrix(), die B von A subtrahiert.
 *
 * Lernfragen:
 * 1. Welche Elemente werden miteinander addiert?
 * 2. Warum müssen beide Matrizen dieselben Abmessungen besitzen?
 * 3. Warum steht nach dem Aufruf das Ergebnis in A und nicht in einer neuen Matrix?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen zwei Matrizen elementweise addieren können."
afterFocus: free
focus:
  - id: elementweise
    title: "Elementweise Addition"
    objective: "Erklären, welche Elemente addiert werden und warum gleiche Abmessungen nötig sind."
    questions:
      - kind: concept
        text: "Welche Elemente werden in `mat1[i][k] += mat2[i][k]` miteinander addiert?"
      - kind: concept
        text: "Warum müssen `A` und `B` dieselben Abmessungen besitzen?"
  - id: ergebnis
    title: "Wo das Ergebnis steht"
    objective: "Die Wirkung von `addMatrix` auf `A` beschreiben und vorhersagen."
    questions:
      - kind: prediction
        text: "Welche Werte stehen in `A`, wenn `addMatrix(A, B)` zweimal aufgerufen wird?"
      - kind: transfer
        text: "Wie würdest du die Funktion ändern, damit `A` unverändert bleibt und die Summe in einer dritten Matrix steht?"
@end-unosim-tutor */
