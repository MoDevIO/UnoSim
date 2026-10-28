/*
 * IT07.2 – Einen Wert aus einer Funktion zurückgeben
 *
 * Lernziel:
 * Einer Funktion Parameter übergeben, ihr Ergebnis mit return zurückgeben
 * und einen Funktionsprototyp lesen.
 *
 * Bezug zu den Unterlagen:
 * IT07, Folien „Funktionen“ (Was geht rein? Was kommt zurück?),
 * „Beispiel Funktion zur Berechnung des Mittelwertes zweier Zahlen“ und
 * „Funktionsprototyp“.
 *
 * Beobachtung:
 * Der Mittelwert von 4 und 8 ist 6.00, der von 4 und 7 ist 5.50.
 */

float mittelwert(int wert1, int wert2);   // Funktionsprototyp: nur die Schnittstelle

void setup() {
  Serial.begin(115200);

  float mw = mittelwert(4, 8);
  Serial.print("Mittelwert von 4 und 8: ");
  Serial.println(mw, 2);

  mw = mittelwert(4, 7);
  Serial.print("Mittelwert von 4 und 7: ");
  Serial.println(mw, 2);
}

void loop() {
}

float mittelwert(int wert1, int wert2) {
  float ergebnis = (wert1 + wert2) / 2.0;
  return ergebnis;
}

/*
 * Experimente:
 * 1. Ersetze 2.0 durch 2. Welcher Mittelwert ergibt sich jetzt für 4 und 7?
 * 2. Verwende den Aufruf direkt in Serial.println(mittelwert(10, 5), 2);.
 * 3. Entferne den Funktionsprototyp. Die Arduino-Umgebung erzeugt Prototypen
 *    automatisch, deshalb compiliert das Programm trotzdem.
 *
 * Lernfragen:
 * 1. Was geht in die Funktion hinein und was kommt heraus?
 * 2. Was bewirkt die Anweisung return?
 * 3. Warum ist (wert1 + wert2) / 2 eine ganzzahlige Division?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen eine Funktion mit Parametern und Rückgabewert schreiben und aufrufen können."
  - "Sie sollen erklären können, warum die Division im Mittelwert mit 2.0 gerechnet wird."
afterFocus: free
focus:
  - id: schnittstelle
    title: "Schnittstelle der Funktion"
    objective: "Parameter, Rückgabetyp und Prototyp benennen."
    questions:
      - kind: concept
        text: "Was geht in `mittelwert` hinein, und was kommt heraus?"
      - kind: concept
        text: "Wozu dient die Zeile mit dem Prototyp von `mittelwert` vor `setup`?"
  - id: rueckgabe
    title: "Rückgabe und Division"
    objective: "Die Wirkung von `return` erklären und den Einfluss von `2.0` vorhersagen."
    questions:
      - kind: concept
        text: "Was bewirkt `return ergebnis`?"
      - kind: prediction
        text: "Welcher Mittelwert ergibt sich für 4 und 7, wenn `2.0` durch 2 ersetzt wird?"
      - kind: transfer
        text: "Wie würdest du eine Funktion schreiben, die den Mittelwert von drei Zahlen zurückgibt?"
@end-unosim-tutor */
