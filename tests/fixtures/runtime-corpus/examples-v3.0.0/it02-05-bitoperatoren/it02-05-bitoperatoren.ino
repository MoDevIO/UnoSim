/*
 * IT02.5 – Einzelne Bits prüfen und setzen (optional)
 *
 * Lernziel:
 * Mit dem bitweisen UND ein Bit prüfen (Bitmaske) und mit dem bitweisen
 * ODER ein Bit setzen („Aufodern“).
 *
 * Bezug zu den Unterlagen:
 * IT02 Datenmanipulation, Abschnitt „Bitweise Operatoren“ und Folie
 * „Der Nutzen von bitweisen Operatoren“. Laut Folie nicht klausurrelevant.
 *
 * Beobachtung:
 * Zuerst ist Bit 2 nicht gesetzt (0). Nach dem Aufodern ist es gesetzt (1).
 * BIN gibt keine führenden Nullen aus.
 */

byte wert = 0b00101001;
const byte MASKE_BIT_2 = 0b00000100;   // dezimal 4

void setup() {
  Serial.begin(115200);

  Serial.print("wert vorher:  ");
  Serial.println(wert, BIN);
  Serial.print("Bit 2 gesetzt? ");
  Serial.println((wert & MASKE_BIT_2) && 1);

  wert = wert | MASKE_BIT_2;           // Bit 2 setzen

  Serial.print("wert nachher: ");
  Serial.println(wert, BIN);
  Serial.print("Bit 2 gesetzt? ");
  Serial.println((wert & MASKE_BIT_2) && 1);
}

void loop() {
}

/*
 * Experimente:
 * 1. Ändere die Maske so, dass Bit 0 geprüft wird.
 * 2. Gib wert & MASKE_BIT_2 einmal ohne && 1 aus. Warum erscheint 100?
 * 3. Vergleiche die Ausgaben von wert & 6 und wert && 6.
 *
 * Lernfragen:
 * 1. Warum bleibt bei wert & MASKE_BIT_2 höchstens ein gesetztes Bit übrig?
 * 2. Welche Wirkung hat wert | MASKE_BIT_2 auf die übrigen Bits?
 * 3. Worin unterscheiden sich & und &&?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen mit einer Bitmaske ein Bit prüfen und setzen können."
afterFocus: free
focus:
  - id: bitmaske
    title: "Bit prüfen"
    objective: "Erklären, wie eine Maske ein einzelnes Bit herausfiltert."
    questions:
      - kind: concept
        text: "Warum bleibt bei `wert & MASKE_BIT_2` höchstens ein gesetztes Bit übrig?"
      - kind: concept
        text: "Wozu dient `&& 1` am Ende der Prüfung?"
  - id: bit-setzen
    title: "Bit setzen"
    objective: "Die Wirkung des bitweisen ODER beschreiben und vom logischen UND abgrenzen."
    questions:
      - kind: prediction
        text: "Was ändert sich an `wert`, wenn `wert | MASKE_BIT_2` ein zweites Mal ausgeführt wird?"
      - kind: transfer
        text: "Wie würdest du prüfen, ob Bit 3 in `wert` gesetzt ist?"
@end-unosim-tutor */
