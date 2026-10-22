// mat_func.h – Matrixgröße und Ausgabefunktion (IT11.2 bis IT11.5)
#pragma once

const int M = 3;   // Anzahl der Zeilen
const int N = 3;   // Anzahl der Spalten

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
