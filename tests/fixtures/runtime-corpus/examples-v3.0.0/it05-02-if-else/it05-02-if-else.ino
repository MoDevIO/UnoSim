/*
 * IT05.2 – Zwischen zwei Alternativen entscheiden
 *
 * Lernziel:
 * Mit if/else genau einen von zwei Programmzweigen ausführen.
 *
 * Bezug zu den Unterlagen:
 * IT05, Folien „Einfache Verzweigung – if/else“ (Syntax und Beispiel).
 *
 * Beobachtung:
 * Liegt der Wert an A0 über 600, leuchtet die LED an Pin 13 und es erscheint
 * „hoch“. Sonst ist die LED aus und es erscheint „nicht hoch“.
 */

const byte PIN_SENSOR = A0;
const byte PIN_LED = 13;
const unsigned int GRENZWERT = 600;

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
}

void loop() {
  unsigned int messwert = analogRead(PIN_SENSOR);
  Serial.print(messwert);

  if (messwert > GRENZWERT) {
    digitalWrite(PIN_LED, HIGH);
    Serial.println("  hoch");
  } else {
    digitalWrite(PIN_LED, LOW);
    Serial.println("  nicht hoch");
  }

  delay(500);
}

/*
 * Experimente:
 * 1. Stelle A0 auf 800, danach genau auf 600.
 * 2. Entferne den else-Zweig. Was passiert mit der LED, wenn der Wert wieder sinkt?
 * 3. Zeichne zu loop() ein UML-Aktivitätsdiagramm mit beiden Zweigen.
 *
 * Lernfragen:
 * 1. Können beide Zweige in einem Durchlauf ausgeführt werden?
 * 2. Welcher Zweig wird bei messwert = 600 ausgeführt?
 * 3. Warum wird der else-Zweig zum Ausschalten der LED gebraucht?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen mit if/else zwischen zwei Alternativen entscheiden können."
afterFocus: free
focus:
  - id: genau-ein-zweig
    title: "Genau ein Zweig"
    objective: "Erklären, dass genau ein Zweig ausgeführt wird, und den Grenzfall vorhersagen."
    questions:
      - kind: concept
        text: "Können der Zweig nach `if` und der Zweig nach `else` in einem Durchlauf beide ausgeführt werden?"
      - kind: prediction
        text: "Welcher Zweig wird ausgeführt, wenn `messwert` genau dem Wert von `GRENZWERT` entspricht?"
  - id: else-zweig
    title: "Aufgabe des else-Zweigs"
    objective: "Begründen, warum der `else`-Zweig für das Ausschalten nötig ist."
    questions:
      - kind: prediction
        text: "Was passiert mit der LED an `PIN_LED`, wenn der `else`-Zweig fehlt und der Messwert wieder sinkt?"
      - kind: transfer
        text: "Wie würdest du einen zweiten Grenzwert für eine Warnmeldung ergänzen?"
@end-unosim-tutor */
