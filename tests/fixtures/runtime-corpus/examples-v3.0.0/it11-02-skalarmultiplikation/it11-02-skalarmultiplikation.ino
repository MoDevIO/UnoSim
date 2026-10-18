/*
 * IT11.2 – Funktionen auslagern und eine Matrix skalieren
 *
 * Lernziel:
 * Die Ausgabefunktion in mat_func.h auslagern und eine Funktion schreiben,
 * die jedes Element einer Matrix mit einem Faktor multipliziert.
 *
 * Bezug zu den Unterlagen:
 * IT11 Matrizen, Schritt 4 „Organisieren: Auslagern“ und Schritt 5
 * „Funktionen erweitern: Skalar-Multiplikation“.
 *
 * Beobachtung:
 * Zuerst erscheint A, danach 2*A: Jedes Element ist doppelt so groß.
 * M, N und printMatrix() stehen in mat_func.h.
 */

#include "mat_func.h"

double A[M][N] = {
  { 1, 2, 3 },
  { 4, 5, 6 },
  { 7, 8, 9 }
};

void scaleMatrix(double mat[M][N], double faktor) {
  for (byte i = 0; i < M; i++) {
    for (byte k = 0; k < N; k++) {
      mat[i][k] *= faktor;
    }
  }
}

void setup() {
  Serial.begin(115200);
  printMatrix(A, "A", 0);
  scaleMatrix(A, 2);
  printMatrix(A, "2*A", 0);
}

void loop() {
}

/*
 * Experimente:
 * 1. Skaliere A mit dem Faktor 0.5 und gib das Ergebnis mit einer
 *    Nachkommastelle aus.
 * 2. Rufe scaleMatrix(A, 2); zweimal auf.
 * 3. Öffne mat_func.h und ändere dort die Ausgabe des Namens.
 *
 * Lernfragen:
 * 1. Warum verändert scaleMatrix() die Matrix A selbst?
 * 2. Warum ist der Parameter mat hier nicht const?
 * 3. Welchen Vorteil hat es, printMatrix() in mat_func.h auszulagern?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen eine Matrix in einer Funktion elementweise verändern können."
  - "Sie sollen Funktionen in eine Headerdatei auslagern und wiederverwenden können."
afterFocus: free
focus:
  - id: skalieren
    title: "Elementweise skalieren"
    objective: "Erklären, wie `scaleMatrix` jedes Element verändert."
    questions:
      - kind: concept
        text: "Warum verändert `scaleMatrix` die Matrix `A` selbst und nicht eine Kopie?"
      - kind: prediction
        text: "Welcher Wert steht in der Mitte von `A`, nachdem `scaleMatrix(A, 2)` zweimal aufgerufen wurde?"
  - id: auslagern
    title: "Auslagern und const"
    objective: "Den Unterschied zwischen lesender und verändernder Funktion begründen."
    questions:
      - kind: concept
        text: "Warum ist `mat` in `scaleMatrix` anders als in `printMatrix` nicht als konstant deklariert?"
      - kind: concept
        text: "Welchen Vorteil hat es, dass `printMatrix` in einer eigenen Datei steht?"
@end-unosim-tutor */
