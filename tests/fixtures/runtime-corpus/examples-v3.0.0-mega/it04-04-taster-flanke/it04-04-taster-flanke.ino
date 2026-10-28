/*
 * IT04.4 – Einen Tasterwechsel erkennen
 *
 * Lernziel:
 * Einen Taster mit internem Pullup abfragen und nur bei einem Wechsel des
 * Zustands (Flanke) reagieren.
 *
 * Bezug zu den Unterlagen:
 * IT04, Folien „Bauteilwissen: Taster“, „Entprellen von Taster-Signalen“
 * und „Bauteilwissen: Taster abfragen“ (aktueller und alter Zustand, static).
 *
 * Beobachtung:
 * Nur wenn Pin 3 im Simulator umgeschaltet wird, erscheint eine Ausgabe:
 * 0 beim Drücken (Flanke 1 -> 0), 1 beim Loslassen.
 */

const byte PIN_TASTER = 3;

void setup() {
  Serial.begin(115200);
  pinMode(PIN_TASTER, INPUT_PULLUP);
}

void loop() {
  byte taster = digitalRead(PIN_TASTER);
  static byte tasterAlt = HIGH;   // behält seinen Wert zwischen den Durchläufen

  if (taster != tasterAlt) {
    Serial.print("Neuer Zustand: ");
    Serial.println(taster);
    tasterAlt = taster;
  }
}

/*
 * Experimente:
 * 1. Entferne das Schlüsselwort static. Was erscheint jetzt, solange der
 *    Taster gedrückt ist?
 * 2. Gib statt der Zahl „gedrueckt“ oder „losgelassen“ aus.
 * 3. Ergänze nach tasterAlt = taster; ein delay(20); zum Entprellen.
 *
 * Lernfragen:
 * 1. Warum werden zwei Variablen für den Tasterzustand benötigt?
 * 2. Welche Aufgabe hat static bei tasterAlt?
 * 3. Warum liefert der gedrückte Taster bei INPUT_PULLUP den Wert 0?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen einen Taster abfragen und einen Zustandswechsel erkennen können."
  - "Sie sollen erklären können, warum der alte Zustand dauerhaft gespeichert werden muss."
afterFocus: free
focus:
  - id: flanke
    title: "Zustandswechsel erkennen"
    objective: "Erklären, wie der Vergleich zweier Zustände einen Wechsel erkennt."
    questions:
      - kind: concept
        text: "Warum werden `taster` und `tasterAlt` miteinander verglichen?"
      - kind: prediction
        text: "Wie oft erscheint eine Ausgabe, wenn der Taster gedrückt und zwei Sekunden lang gehalten wird?"
  - id: static
    title: "Den alten Zustand speichern"
    objective: "Die Aufgabe von `static` erklären und die Folge ohne `static` vorhersagen."
    questions:
      - kind: concept
        text: "Welche Aufgabe hat `static` bei `tasterAlt`?"
      - kind: prediction
        text: "Was erscheint, solange der Taster gedrückt ist, wenn `static` entfernt wird?"
      - kind: transfer
        text: "Wie würdest du zählen, wie oft der Taster gedrückt wurde?"
@end-unosim-tutor */
