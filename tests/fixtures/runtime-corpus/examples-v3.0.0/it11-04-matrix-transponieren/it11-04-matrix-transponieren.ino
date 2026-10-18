/*
 * IT11.4 – Eine Matrix transponieren
 *
 * Lernziel:
 * Beim Transponieren Zeilen- und Spaltenindex vertauschen und das Ergebnis
 * in eine zweite Matrix schreiben.
 *
 * Bezug zu den Unterlagen:
 * IT11 Matrizen, Schritt 7 „Funktionen erweitern: Transponieren“.
 *
 * Beobachtung:
 * Die erste Zeile von A wird zur ersten Spalte von AT. Die Hauptdiagonale
 * 1, 5, 9 bleibt unverändert.
 */

#include "mat_func.h"

double A[M][N] = {
  { 1, 2, 3 },
  { 4, 5, 6 },
  { 7, 8, 9 }
};

double AT[N][M];

void transposeMatrix(const double mat[M][N], double ergebnis[N][M]) {
  for (byte i = 0; i < M; i++) {
    for (byte k = 0; k < N; k++) {
      ergebnis[k][i] = mat[i][k];
    }
  }
}

void setup() {
  Serial.begin(115200);
  printMatrix(A, "A", 0);
  transposeMatrix(A, AT);
  printMatrix(AT, "AT", 0);
}

void loop() {
}

/*
 * Experimente:
 * 1. Verwende eine symmetrische Matrix, z. B. mit A[0][1] = A[1][0] = 2.
 * 2. Transponiere AT ein zweites Mal. Welche Matrix entsteht?
 * 3. Versuche, A ohne zweite Matrix direkt in sich selbst zu transponieren.
 *    Warum gehen dabei Werte verloren?
 *
 * Lernfragen:
 * 1. Welche beiden Indizes werden beim Transponieren vertauscht?
 * 2. Was geschieht mit den Elementen auf der Hauptdiagonalen?
 * 3. Warum wird das Ergebnis in eine zweite Matrix geschrieben?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen eine Matrix transponieren und die Vertauschung der Indizes erklären können."
afterFocus: free
focus:
  - id: indizes-tauschen
    title: "Indizes vertauschen"
    objective: "Die vertauschten Indizes und die Hauptdiagonale erklären."
    questions:
      - kind: concept
        text: "Welche beiden Indizes werden in `ergebnis[k][i] = mat[i][k]` vertauscht?"
      - kind: prediction
        text: "Welcher Wert steht in `AT` an der Position mit dem Zeilenindex 0 und dem Spaltenindex 2?"
  - id: zweite-matrix
    title: "Eine zweite Matrix"
    objective: "Begründen, warum das Ergebnis in eine eigene Matrix geschrieben wird."
    questions:
      - kind: concept
        text: "Warum schreibt `transposeMatrix` das Ergebnis in `ergebnis` und nicht zurück in `mat`?"
      - kind: transfer
        text: "Wie würdest du mit `transposeMatrix` prüfen, ob eine Matrix symmetrisch ist?"
@end-unosim-tutor */
