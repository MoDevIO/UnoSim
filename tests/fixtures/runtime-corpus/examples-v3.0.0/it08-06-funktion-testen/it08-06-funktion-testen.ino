/*
 * IT08.6 – Eine Funktion mit Testfällen prüfen
 *
 * Lernziel:
 * Eine Funktion mit Testfällen absichern: für bekannte Eingaben das
 * erwartete Ergebnis festlegen und automatisch vergleichen.
 *
 * Bezug zu den Unterlagen:
 * IT08, Abschnitt „Funktionen testen mit Unit Tests“ (Grenzen, negative
 * Werte, Genauigkeit). Auf den Folien wird dafür die Bibliothek AUnit mit
 * assertEqual() verwendet; dieses Beispiel zeigt dieselbe Idee ohne Bibliothek.
 *
 * Beobachtung:
 * Zwei Tests sind OK, ein Test meldet FEHLER: mittelwert() enthält einen
 * absichtlich eingebauten Fehler.
 */

float mittelwert(int wert1, int wert2) {
  return (wert1 + wert2) / 2;          // enthält einen Fehler
}

void pruefeGleich(const char *testname, float ist, float soll) {
  float abweichung = ist - soll;
  if (abweichung < 0) {
    abweichung = -abweichung;
  }

  Serial.print(testname);
  if (abweichung < 0.0001) {
    Serial.println(": OK");
  } else {
    Serial.print(": FEHLER, ist ");
    Serial.print(ist, 2);
    Serial.print(", soll ");
    Serial.println(soll, 2);
  }
}

void setup() {
  Serial.begin(115200);

  pruefeGleich("mittelwert(4, 8)", mittelwert(4, 8), 6.0);
  pruefeGleich("mittelwert(4, 7)", mittelwert(4, 7), 5.5);
  pruefeGleich("mittelwert(-3, 3)", mittelwert(-3, 3), 0.0);
}

void loop() {
}

/*
 * Experimente:
 * 1. Finde und behebe den Fehler in mittelwert(). Laufen danach alle Tests?
 * 2. Ergänze einen Testfall mit zwei negativen Zahlen.
 * 3. Ergänze einen Testfall nahe an der Grenze des Datentyps int.
 *
 * Lernfragen:
 * 1. Warum besteht der erste Test, obwohl die Funktion einen Fehler enthält?
 * 2. Warum vergleicht pruefeGleich() die Abweichung statt ist == soll?
 * 3. Welche Testfälle sind besonders geeignet, um Fehler zu finden?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen eine Funktion mit selbst gewählten Testfällen prüfen können."
  - "Sie sollen begründen können, welche Testfälle Fehler aufdecken."
afterFocus: free
focus:
  - id: testfaelle
    title: "Testfälle"
    objective: "Erklären, warum ein Test besteht und ein anderer scheitert."
    questions:
      - kind: concept
        text: "Warum besteht der Test mit `mittelwert(4, 8)`, obwohl `mittelwert` einen Fehler enthält?"
      - kind: concept
        text: "Welche Ursache hat der FEHLER beim Test mit `mittelwert(4, 7)`?"
  - id: vergleich
    title: "Ergebnisse vergleichen"
    objective: "Die Vergleichsmethode von `pruefeGleich` begründen und neue Testfälle wählen."
    questions:
      - kind: concept
        text: "Warum vergleicht `pruefeGleich` die `abweichung` mit einer kleinen Schwelle statt `ist` und `soll` direkt?"
      - kind: transfer
        text: "Welchen weiteren Testfall würdest du ergänzen, um `mittelwert` gründlicher zu prüfen?"
@end-unosim-tutor */
