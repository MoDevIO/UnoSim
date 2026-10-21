/*
 * IT03.4 – Eine LED blinken lassen
 *
 * Lernziel:
 * Einen Pin als Ausgang einrichten und in loop() abwechselnd ein- und
 * ausschalten; Leucht- und Pausendauer als Konstanten festlegen.
 *
 * Bezug zu den Unterlagen:
 * IT03, Folien „Digitalen Arduino-Ausgang schalten mit digitalWrite“ und
 * „Arduino-Beispielprogramm“; Übung Ü1.1.
 *
 * Beobachtung:
 * Die LED an Pin 13 leuchtet 500 ms und ist dann 300 ms aus – endlos.
 */

const byte PIN_LED = 13;
const int LEUCHTDAUER = 500;   // ms
const int PAUSENDAUER = 300;   // ms

void setup() {
  pinMode(PIN_LED, OUTPUT);
}

void loop() {
  digitalWrite(PIN_LED, HIGH);
  delay(LEUCHTDAUER);
  digitalWrite(PIN_LED, LOW);
  delay(PAUSENDAUER);
}

/*
 * Experimente:
 * 1. Stelle Leucht- und Pausendauer auf je 1000 ms ein (Ü1.1).
 * 2. Lasse die LED dreimal kurz (200 ms) aufleuchten: das Morsezeichen S.
 * 3. Entferne die letzte Zeile delay(PAUSENDAUER);. Warum scheint die LED
 *    jetzt dauerhaft zu leuchten?
 *
 * Lernfragen:
 * 1. Welche Aufgabe hat pinMode()?
 * 2. Warum steht das Blinken in loop() und nicht in setup()?
 * 3. Was macht der Arduino während delay()?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen einen digitalen Ausgang zyklisch schalten können."
  - "Sie sollen den Ablauf von setup() und loop() an einem Blinkprogramm erklären können."
afterFocus: free
focus:
  - id: ausgang-schalten
    title: "Ausgang schalten"
    objective: "Die Aufgaben von `pinMode` und `digitalWrite` erklären."
    questions:
      - kind: concept
        text: "Welche Aufgabe hat `pinMode(PIN_LED, OUTPUT)`?"
      - kind: recall
        text: "Welche Spannung liegt an `PIN_LED` an, solange `HIGH` geschrieben ist?"
  - id: zeitlicher-ablauf
    title: "Zeitlicher Ablauf"
    objective: "Den Ablauf in `loop` beschreiben und eine Änderung vorhersagen."
    questions:
      - kind: concept
        text: "Warum steht das Blinken in `loop` und nicht in `setup`?"
      - kind: prediction
        text: "Was beobachtest du, wenn die letzte Zeile `delay(PAUSENDAUER)` entfernt wird?"
      - kind: transfer
        text: "Wie würdest du das Programm ändern, um das Morsezeichen S auszugeben?"
@end-unosim-tutor */
